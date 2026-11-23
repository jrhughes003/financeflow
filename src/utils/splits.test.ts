import { describe, it, expect } from 'vitest';
import { applySplit, mergeSplit, validateSplit, splitGroup, foldSplits } from './splits';
import { findDuplicates } from './importDedupe';
import type { Transaction } from '../types/domain';

const costco: Transaction = { id: 't1', date: '2026-11-08', merchant: 'Costco', amount: 143.82, category: 'groceries', tags: ['rbc'] };

describe('splits', () => {
  const parts = [{ category: 'groceries', amount: 98.32 }, { category: 'household', amount: 45.5 }];

  it('validates that parts add up to the charge', () => {
    expect(validateSplit(143.82, parts)).toBeNull();
    expect(validateSplit(143.82, [parts[0]])).toMatch(/two parts/);
    expect(validateSplit(150, parts)).toMatch(/less than the charge, by \$6\.18/);
    expect(validateSplit(143.82, [{ category: '', amount: 143.82 }, { category: 'x', amount: 0 }])).toMatch(/category/);
  });

  it('keeps the original id on the first part and links the rest', () => {
    const out = applySplit(costco, parts);
    expect(out.map(t => [t.id, t.category, t.amount])).toEqual([['t1', 'groceries', 98.32], ['t1_s1', 'household', 45.5]]);
    expect(new Set(out.map(t => t.splitGroupId)).size).toBe(1);
    expect(out[1].tags).toEqual(['rbc']);
    expect(splitGroup(out[1], out)).toHaveLength(2);
  });

  it('merges back to the original charge', () => {
    const merged = mergeSplit(applySplit(costco, parts));
    expect(merged.amount).toBe(143.82);
    expect(merged.id).toBe('t1');
    expect(merged.splitGroupId).toBeUndefined();
  });

  it('lets an import match the whole charge of a split purchase', () => {
    const ledger = applySplit(costco, parts);
    const incoming = [{ ...costco, id: 'n1', merchant: 'COSTCO WHOLESALE #123' }];
    expect(findDuplicates(incoming, ledger)[0]).toBeNull();
    expect(findDuplicates(incoming, foldSplits(ledger))[0]?.strength).toBe('exact');
  });
});

describe('splits and duplicate detection', () => {
  it('does not report two equal parts of one split as a duplicate charge', async () => {
    const { detectDuplicateCharges } = await import('./insights');
    const parts = applySplit(costco, [{ category: 'groceries', amount: 71.91 }, { category: 'household', amount: 71.91 }]);
    expect(detectDuplicateCharges(parts, { today: new Date(2026, 10, 10) })).toEqual([]);
  });
});
