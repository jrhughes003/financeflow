// The ledger's filter state, as stored. Types only, so the worker build (which
// includes src/types) does not pull in date-fns or the DOM.

export type LedgerSortField = 'date' | 'merchant' | 'category' | 'amount';

export interface LedgerFilters {
  search: string;
  category: string;
  from: string;
  to: string;
  min: string;
  max: string;
  /** Only transactions carrying this tag. */
  tag: string;
  /** Only the ones marked as one-offs. */
  exceptionsOnly: boolean;
  sortField: LedgerSortField;
  sortDir: 'asc' | 'desc';
}

/** A named filter set: the built-in ones, or one the user saved. */
export interface LedgerView {
  id: string;
  name: string;
  filters: Partial<LedgerFilters>;
}
