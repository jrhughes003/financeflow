import { describe, it, expect } from 'vitest';
import {
  applyLedgerFilters, builtInViews, viewFilters, matchesView, savableFilters, activeFilterCount, EMPTY_FILTERS,
} from './ledgerFilters';
import type { Transaction } from '../types/domain';

const tx = (id: string, date: string, amount: number, extra: Partial<Transaction> = {}): Transaction =>
  ({ id, date, merchant: `M${id}`, amount, category: 'dining', ...extra });

const ledger = [
  tx('1', '2026-10-30', 10, { tags: ['imported'] }),
  tx('2', '2026-11-02', 50, { category: 'products' }),
  tx('3', '2026-11-20', 5, { isException: true, tags: ['Trip'] }),
];

describe('applyLedgerFilters', () => {
  it('filters by tag case-insensitively and by one-offs', () => {
    expect(applyLedgerFilters(ledger, { ...EMPTY_FILTERS, tag: 'trip' }).map(t => t.id)).toEqual(['3']);
    expect(applyLedgerFilters(ledger, { ...EMPTY_FILTERS, exceptionsOnly: true }).map(t => t.id)).toEqual(['3']);
  });

  it('sorts by amount both ways', () => {
    expect(applyLedgerFilters(ledger, { ...EMPTY_FILTERS, sortField: 'amount', sortDir: 'asc' }).map(t => t.id)).toEqual(['3', '1', '2']);
    expect(applyLedgerFilters(ledger, { ...EMPTY_FILTERS, sortField: 'amount', sortDir: 'desc' }).map(t => t.id)).toEqual(['2', '1', '3']);
  });
});

describe('views', () => {
  const views = builtInViews(new Date(2026, 10, 23), 'products');

  it('works out this month and last month from today', () => {
    const f = viewFilters(views[0], EMPTY_FILTERS);
    expect([f.from, f.to]).toEqual(['2026-11-01', '2026-11-30']);
    expect(applyLedgerFilters(ledger, f).map(t => t.id)).toEqual(['3', '2']);
    const g = viewFilters(views[1], EMPTY_FILTERS);
    expect([g.from, g.to]).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('recognises when the current filters are a view', () => {
    const f = viewFilters(views[2], EMPTY_FILTERS);
    expect(matchesView(f, views[2])).toBe(true);
    expect(matchesView({ ...f, min: '5' }, views[2])).toBe(false);
  });

  it('saves only what differs from empty, and counts active filters', () => {
    const f = { ...EMPTY_FILTERS, category: 'dining', min: '20', sortDir: 'asc' as const };
    expect(savableFilters(f)).toEqual({ category: 'dining', min: '20' });
    expect(activeFilterCount(f)).toBe(2);
  });
});
