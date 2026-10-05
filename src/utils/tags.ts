/*
 * Keeping one tag from becoming two.
 *
 * A ledger here held 168 transactions tagged 'RBC' and 36 tagged 'rbc', which
 * every filter, group and chart treated as unrelated. Neither spelling was a
 * typo: the CSV importer lowercases the account name it derives a tag from
 * (exportUtils), while the transaction form stores exactly what was typed. Two
 * reasonable rules, one split tag.
 *
 * The fix is to canonicalise on the way in rather than to normalise case on
 * the way out. Lowercasing everything would turn 'TD' into 'td' and 'RRSP'
 * into 'rrsp', which is worse than the problem — tags are often initialisms,
 * and their capitalisation is meaningful to the person who typed it. So a new
 * tag that matches an existing one case-insensitively adopts the existing
 * spelling, and the first spelling used wins by default.
 */

import type { Transaction } from '../types/domain';

/** Comparison key: case and surrounding whitespace are not distinguishing. */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Every tag in use, most-used first.
 *
 * Frequency order matters for the merge below: when a tag has split, the
 * spelling the user has on more transactions is the one to keep.
 */
export function tagCounts(transactions: Transaction[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of transactions || []) {
    for (const raw of t.tags || []) {
      const tag = String(raw).trim();
      if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

/**
 * The spelling `tag` should be stored as, given what already exists.
 *
 * Returns the existing spelling when one matches case-insensitively, and the
 * trimmed input otherwise. `existing` is consulted in order, so passing a
 * frequency-sorted list makes the most-used spelling win.
 */
export function canonicalTag(tag: string, existing: Iterable<string>): string {
  const key = tagKey(tag);
  if (!key) return '';
  for (const candidate of existing) {
    if (tagKey(candidate) === key) return String(candidate).trim();
  }
  return tag.trim();
}

/** Canonicalise a list, dropping blanks and duplicates. */
export function canonicaliseTags(tags: string[], existing: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags || []) {
    const canonical = canonicalTag(String(tag), existing);
    if (!canonical) continue;
    const key = tagKey(canonical);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

/**
 * Variants that should be merged, as {wrong spelling → right spelling}.
 *
 * For cleaning up a ledger that already split. The winner is the spelling used
 * most; ties go to the one encountered first, which `tagCounts` makes stable.
 */
export function tagMergeMap(transactions: Transaction[]): Map<string, string> {
  const counts = tagCounts(transactions);
  const winnerByKey = new Map<string, string>();
  for (const spelling of counts.keys()) {
    const key = tagKey(spelling);
    if (!winnerByKey.has(key)) winnerByKey.set(key, spelling);
  }
  const merges = new Map<string, string>();
  for (const spelling of counts.keys()) {
    const winner = winnerByKey.get(tagKey(spelling));
    if (winner && winner !== spelling) merges.set(spelling, winner);
  }
  return merges;
}

/** Apply a merge map to one transaction's tags. */
export function applyTagMerge(tags: string[] | undefined, merges: Map<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags || []) {
    const next = merges.get(tag) ?? tag;
    if (seen.has(next)) continue; // merging can collide two tags into one
    seen.add(next);
    out.push(next);
  }
  return out;
}
