// What the ledger is filtered to, as one value.
//
// One object rather than eight useStates so it can be remembered between
// visits, saved under a name, and applied by a pure function a test can call.

import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import type { Transaction } from '../types/domain';
import type { LedgerFilters, LedgerView } from '../types/ledger';

export type { LedgerFilters, LedgerView, LedgerSortField } from '../types/ledger';

export const EMPTY_FILTERS: LedgerFilters = {
  search: '', category: '', from: '', to: '', min: '', max: '', tag: '',
  exceptionsOnly: false, sortField: 'date', sortDir: 'desc',
};

/** How many filters are narrowing the list, for the "Filters (2)" button. */
export function activeFilterCount(f: LedgerFilters): number {
  return [f.category, f.from, f.to, f.min, f.max, f.tag].filter(Boolean).length + (f.exceptionsOnly ? 1 : 0);
}

export function applyLedgerFilters(transactions: Transaction[], f: LedgerFilters): Transaction[] {
  let list = [...transactions];
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(t =>
      t.merchant.toLowerCase().includes(q)
      || (t.notes || '').toLowerCase().includes(q)
      || (t.tags || []).some(tag => tag.toLowerCase().includes(q)));
  }
  if (f.category) list = list.filter(t => t.category === f.category);
  if (f.from) list = list.filter(t => t.date >= f.from);
  if (f.to) list = list.filter(t => t.date <= f.to);
  if (f.min) list = list.filter(t => t.amount >= parseFloat(f.min));
  if (f.max) list = list.filter(t => t.amount <= parseFloat(f.max));
  if (f.tag) {
    const tag = f.tag.toLowerCase();
    list = list.filter(t => (t.tags || []).some(x => x.toLowerCase() === tag));
  }
  if (f.exceptionsOnly) list = list.filter(t => t.isException);

  const dir = f.sortDir === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    const va = a[f.sortField] ?? '';
    const vb = b[f.sortField] ?? '';
    if (va < vb) return -dir;
    if (va > vb) return dir;
    // Stable within a day: newest-added last on screen when ascending.
    return 0;
  });
  return list;
}

const iso = (d: Date): string => format(d, 'yyyy-MM-dd');

/** Views every ledger has. Dates are worked out from today each time. */
export function builtInViews(today: Date, fallbackCategory: string): LedgerView[] {
  const last = subMonths(today, 1);
  return [
    { id: 'this-month', name: 'This month', filters: { from: iso(startOfMonth(today)), to: iso(endOfMonth(today)) } },
    { id: 'last-month', name: 'Last month', filters: { from: iso(startOfMonth(last)), to: iso(endOfMonth(last)) } },
    { id: 'uncategorised', name: 'Needs a category', filters: { category: fallbackCategory } },
    { id: 'imported', name: 'Imported', filters: { tag: 'imported' } },
    { id: 'one-offs', name: 'One-offs', filters: { exceptionsOnly: true } },
  ];
}

/** A view applied over a clean slate, keeping the current sort. */
export function viewFilters(view: LedgerView, current: LedgerFilters): LedgerFilters {
  return { ...EMPTY_FILTERS, sortField: current.sortField, sortDir: current.sortDir, ...view.filters };
}

/** The filters worth saving: everything except the free-text search and sort. */
export function savableFilters(f: LedgerFilters): Partial<LedgerFilters> {
  const out: Partial<LedgerFilters> = {};
  (Object.keys(EMPTY_FILTERS) as (keyof LedgerFilters)[]).forEach(k => {
    if (k === 'sortField' || k === 'sortDir') return;
    if (f[k] !== EMPTY_FILTERS[k]) (out as Record<string, unknown>)[k] = f[k];
  });
  return out;
}

/** Does the current filter set equal this view? Used to highlight it. */
export function matchesView(f: LedgerFilters, view: LedgerView): boolean {
  const target = viewFilters(view, f);
  return (Object.keys(EMPTY_FILTERS) as (keyof LedgerFilters)[]).every(k => f[k] === target[k]);
}
