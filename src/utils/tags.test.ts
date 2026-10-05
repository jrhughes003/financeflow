/*
 * Tag canonicalisation.
 *
 * The case that prompted it: 168 transactions tagged 'RBC' and 36 tagged
 * 'rbc', which every filter and chart treated as two unrelated tags. Neither
 * was a typo — the CSV importer lowercased the account name it derived its tag
 * from, while the form stored what was typed.
 */

import { describe, expect, it } from 'vitest';
import {
  tagKey, tagCounts, canonicalTag, canonicaliseTags, tagMergeMap, applyTagMerge,
} from './tags';
import type { Transaction } from '../types/domain';

const tx = (tags: string[]): Transaction => ({ id: String(Math.random()), tags } as Transaction);

describe('tagKey', () => {
  it('ignores case and surrounding space', () => {
    expect(tagKey('RBC')).toBe(tagKey(' rbc '));
  });
  it('keeps distinct tags distinct', () => {
    expect(tagKey('RBC')).not.toBe(tagKey('TD'));
  });
});

describe('canonicalTag', () => {
  it('adopts a spelling already in use', () => {
    expect(canonicalTag('rbc', ['TD', 'RBC'])).toBe('RBC');
  });

  it('keeps a genuinely new tag as typed', () => {
    // Not lowercased: tags are often initialisms, and turning 'TFSA' into
    // 'tfsa' would be worse than the problem being solved.
    expect(canonicalTag('TFSA', ['RBC'])).toBe('TFSA');
  });

  it('trims', () => {
    expect(canonicalTag('  groceries  ', [])).toBe('groceries');
  });

  it('prefers the first candidate, so a frequency-ordered list wins on count', () => {
    expect(canonicalTag('rBc', ['RBC', 'rbc'])).toBe('RBC');
  });

  it('returns empty for whitespace', () => {
    expect(canonicalTag('   ', ['RBC'])).toBe('');
  });
});

describe('canonicaliseTags', () => {
  it('drops blanks and case-duplicates within one entry', () => {
    expect(canonicaliseTags(['RBC', 'rbc', '', '  '], [])).toEqual(['RBC']);
  });

  it('maps each entry against what exists', () => {
    expect(canonicaliseTags(['rbc', 'TD'], ['RBC', 'TD'])).toEqual(['RBC', 'TD']);
  });

  it('handles nothing', () => {
    expect(canonicaliseTags([], ['RBC'])).toEqual([]);
  });
});

describe('tagCounts', () => {
  it('counts uses and orders by frequency', () => {
    const counts = tagCounts([tx(['RBC']), tx(['RBC']), tx(['TD'])]);
    expect([...counts.keys()]).toEqual(['RBC', 'TD']);
    expect(counts.get('RBC')).toBe(2);
  });

  it('keeps variants apart, because that is the thing being detected', () => {
    const counts = tagCounts([tx(['RBC']), tx(['rbc'])]);
    expect(counts.size).toBe(2);
  });

  it('survives transactions with no tags', () => {
    expect(tagCounts([{ id: 'x' } as Transaction]).size).toBe(0);
  });
});

describe('tagMergeMap', () => {
  it('merges the rarer spelling into the commoner one', () => {
    // The real shape: 'RBC' x168, 'rbc' x36.
    const txs = [...Array(168)].map(() => tx(['RBC'])).concat([...Array(36)].map(() => tx(['rbc'])));
    const merges = tagMergeMap(txs);
    expect(merges.get('rbc')).toBe('RBC');
    expect(merges.has('RBC')).toBe(false);
  });

  it('is empty when nothing has split', () => {
    expect(tagMergeMap([tx(['RBC']), tx(['TD'])]).size).toBe(0);
  });

  it('handles three variants of one tag', () => {
    const txs = [tx(['RBC']), tx(['RBC']), tx(['rbc']), tx(['Rbc'])];
    const merges = tagMergeMap(txs);
    expect(merges.get('rbc')).toBe('RBC');
    expect(merges.get('Rbc')).toBe('RBC');
  });
});

describe('applyTagMerge', () => {
  const merges = new Map([['rbc', 'RBC']]);

  it('rewrites the losing spelling', () => {
    expect(applyTagMerge(['rbc', 'TD'], merges)).toEqual(['RBC', 'TD']);
  });

  it('collapses a transaction that carried both spellings', () => {
    // Otherwise the merge would leave 'RBC' twice on one transaction.
    expect(applyTagMerge(['RBC', 'rbc'], merges)).toEqual(['RBC']);
  });

  it('leaves untouched tags alone', () => {
    expect(applyTagMerge(['TD'], merges)).toEqual(['TD']);
  });

  it('handles a transaction with no tags', () => {
    expect(applyTagMerge(undefined, merges)).toEqual([]);
  });
});
