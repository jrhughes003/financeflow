// The merchant table is generated data, so most of what is worth asserting is
// structural: that it agrees with the taxonomy, that it cannot match too
// eagerly, and that a regeneration cannot quietly introduce rows pointing at a
// category that no longer exists.
//
// Behavioural tests derive their fixtures from the table rather than naming
// merchants, because the contents change when it is regenerated and a test
// that hardcodes "Tim Hortons" would fail for a reason that is not a bug.

import { describe, it, expect } from 'vitest';
import {
  lookupMerchant, searchMerchants, referencedCategories, merchantCount,
} from './merchants';
import { CATEGORIES, getAllCategories } from './categorization';
import merchantData from '../data/merchants.json';

const entries = merchantData.merchants as { name: string; category: string; subcategory: string }[];

/** A row from the middle of the table, so the tests are not all about the first one. */
const sample = entries[Math.floor(entries.length / 2)];

describe('the table agrees with the taxonomy', () => {
  it('has merchants at all', () => {
    // A generation that silently produced nothing would otherwise leave every
    // lookup returning null and every test below vacuously passing.
    expect(merchantCount).toBeGreaterThan(50);
    expect(merchantCount).toBe(entries.length);
  });

  it('points only at categories that exist', () => {
    const known = new Set(CATEGORIES.map(c => c.id));
    const unknown = referencedCategories().filter(id => !known.has(id));
    expect(unknown, `these merchants point at categories that no longer exist: ${unknown.join(', ')}`).toEqual([]);
  });

  it('uses a subcategory its category actually declares', () => {
    const byId = new Map(CATEGORIES.map(c => [c.id, c]));
    const wrong = entries.filter((e) => {
      const category = byId.get(e.category);
      return category ? !category.subcategories.includes(e.subcategory) : false;
    });
    expect(wrong.map(e => `${e.name} (${e.category}/${e.subcategory})`)).toEqual([]);
  });

  it('never lists the same merchant twice', () => {
    // Two rows for one merchant means one of them is unreachable, and which
    // one wins depends on file order rather than on anything meaningful.
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const entry of entries) {
      const key = entry.name.toLowerCase();
      if (seen.has(key)) duplicates.push(entry.name);
      seen.add(key);
    }
    expect(duplicates).toEqual([]);
  });
});

describe('lookupMerchant', () => {
  it('matches a known merchant', () => {
    const found = lookupMerchant(sample.name);
    if (!found) throw new Error(`unreachable: ${sample.name} is in the table`);
    expect(found.category).toBe(sample.category);
  });

  it('ignores the noise a statement adds', () => {
    // normaliseMerchant strips digits and punctuation, so a store number or a
    // trailing reference does not stop a match.
    const found = lookupMerchant(`${sample.name.toUpperCase()} #4021`);
    if (!found) throw new Error('unreachable: store numbers should not defeat a match');
    expect(found.name).toBe(sample.name);
  });

  it('does not match a longer name that merely contains one', () => {
    // The whole point of matching on the full name. The table holds "Gap",
    // "Roots" and "Metro"; a substring rule would file "Bloor Roots Cafe"
    // under clothing and "Metrolinx" under groceries.
    expect(lookupMerchant(`${sample.name} Plaza Dental Clinic`)).toBeNull();
  });

  it('returns null rather than guessing', () => {
    expect(lookupMerchant('Zzzz Nonexistent Merchant Qqq')).toBeNull();
    expect(lookupMerchant('')).toBeNull();
    expect(lookupMerchant('   ')).toBeNull();
  });
});

describe('searchMerchants', () => {
  it('needs enough to go on', () => {
    // One character would match a large fraction of the table, which is a wall
    // of names rather than a suggestion.
    expect(searchMerchants('')).toEqual([]);
    expect(searchMerchants('a')).toEqual([]);
  });

  it('offers an exact match before a prefix match', () => {
    const results = searchMerchants(sample.name);
    expect(results.length).toBeGreaterThan(0);
    const first = results[0];
    if (!first) throw new Error('unreachable');
    expect(first.name).toBe(sample.name);
    expect(first.rank).toBe(0);
  });

  it('ranks are non-decreasing, so the best answer is always first', () => {
    const prefix = sample.name.slice(0, 3);
    const results = searchMerchants(prefix, 20);
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i].rank).toBeGreaterThanOrEqual(results[i - 1].rank);
    }
  });

  it('honours the limit', () => {
    // 'a' is excluded as too short, so use a two-letter prefix that is common.
    const results = searchMerchants('ca', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('matches a word inside the name, not just the start', () => {
    const multiWord = entries.find(e => e.name.split(' ').length > 1);
    if (!multiWord) throw new Error('unreachable: the table has multi-word names');
    const secondWord = multiWord.name.split(' ')[1];
    if (!secondWord || secondWord.length < 2) return; // nothing to search on
    const results = searchMerchants(secondWord, 30);
    expect(results.some(r => r.name === multiWord.name)).toBe(true);
  });
});

describe('the table does not fight the keyword matcher', () => {
  it('is reachable through getAllCategories, so custom categories still work', () => {
    // A sanity check on the seam rather than the table: the app resolves a
    // category id through getAllCategories, which merges the user's own
    // categories in. A merchant pointing at a built-in id must still resolve.
    const ids = new Set(getAllCategories([]).map(c => c.id));
    expect(referencedCategories().every(id => ids.has(id))).toBe(true);
  });
});
