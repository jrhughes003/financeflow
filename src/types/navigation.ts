// The pages the app can show.
//
// Shared between App, which owns the map from id to element, and Layout, which
// owns the sidebar. Two lists that have to agree, and previously agreed only by
// everyone remembering to edit both: a typo in either was a page that silently
// fell back to the dashboard.

export const PAGE_IDS = [
  'dashboard',
  'transactions',
  'owed',
  'recurring',
  'budget',
  'goals',
  'comparison',
  'analytics',
  'reports',
  'income',
  'investments',
  'debts',
  'plan',
  'settings',
] as const;

export type PageId = (typeof PAGE_IDS)[number];

/** Counts shown against a nav entry — things waiting on the user. */
export interface NavBadge {
  label: string;
  title: string;
}

export type NavBadges = Partial<Record<PageId, NavBadge>>;

/**
 * What the two analytics panels that take props are given.
 *
 * The rest read the ledger from context; these two are handed a period because
 * SpendingAnalytics owns the month selector above them.
 */
export interface PeriodPanelProps {
  transactions: import('./domain').Transaction[];
  month: number;
  year: number;
}
