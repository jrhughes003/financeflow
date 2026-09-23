// Shapes the analysis functions return.
//
// These are not stored — nothing here is ever written to the database. They are
// what src/utils/calculations.ts and its callers pass between themselves, and
// they were previously described only by the field names in a return literal.

import type { IsoDate, Money } from './domain';

/** Category id → amount, for one period. */
export type SpendingByCategory = Record<string, Money>;

/** How a category is tracking against its limit. */
export type BudgetStatusName = 'good' | 'warning' | 'danger';

export interface BudgetStatus {
  category: string;
  /** The limit as entered. */
  budget: Money;
  /** Last month's unused room, or overage as a negative. Zero if rollover is off. */
  carry: Money;
  /** budget + carry, floored at zero — what usage is actually measured against. */
  effectiveBudget: Money;
  actual: Money;
  /** Percent of overage that still counts as on track. */
  flex: number;
  flexLimit: Money;
  /** Positive is room left. */
  variance: Money;
  percentUsed: number;
  status: BudgetStatusName;
  rollover: boolean;
}

export interface BudgetHealth {
  /** 'N/A' when there are no budgets to grade. */
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';
  percent: number;
  color: string;
}

/**
 * One month of the trend chart.
 *
 * The category totals are spread in as extra keys alongside the named fields,
 * which is why this carries an index signature.
 */
export interface MonthlyTrendPoint {
  month: number;
  year: number;
  label: string;
  total: Money;
  [category: string]: Money | string | number;
}

export interface GoalProgress {
  /** The balance the user typed in, before any logged contributions. */
  opening: Money;
  contributed: Money;
  currentAmount: Money;
  /** Capped at 100. */
  percent: number;
}

export interface GoalCompletion {
  months: number;
  completionDate: Date;
}

/** A category spending far above its own recent average. */
export interface Anomaly {
  category: string;
  current: Money;
  average: Money;
  ratio: number;
  message: string;
}

export interface MerchantTotal {
  merchant: string;
  total: Money;
  count: number;
  /** The category of the first transaction seen for this merchant. */
  category: string;
}

export interface DayOfWeekSpending {
  name: string;
  total: Money;
  count: number;
  avg: Money;
}

/**
 * A payoff schedule, or nulls when the debt never clears.
 *
 * `months: null` means the payment does not beat the interest, which is a real
 * answer rather than an error — the UI says so rather than showing a number.
 */
export interface DebtPayoff {
  months: number | null;
  totalInterest: Money | null;
}

export interface NetWorthOptions {
  today?: Date;
}

/** Overrides for the anomaly thresholds, which users can set. */
export interface AnomalyOptions {
  minAverage?: number;
  multiplier?: number;
}

/** A period expressed the way the ledger stores dates. */
export interface DateRange {
  start: IsoDate;
  end: IsoDate;
}

// --- Debt planning -----------------------------------------------------------

/** How extra payments are directed once minimums are covered. */
export type PayoffStrategy = 'minimum' | 'avalanche' | 'snowball' | 'custom';

export interface DebtPayoffEvent {
  id: string;
  name: string;
  month: number;
}

export interface PayoffSimulation {
  strategy: PayoffStrategy;
  /** False when at least one debt never clears at this payment level. */
  feasible: boolean;
  /** Null when it never clears — an honest answer, not a missing one. */
  months: number | null;
  totalInterest: Money;
  totalPaid: Money;
  debtFreeDate: IsoDate | null;
  /** When each debt cleared, in the order they did. */
  payoffs: DebtPayoffEvent[];
  timeline: { month: number; balance: Money }[];
  /** Debts that can never be paid at their minimum. */
  unpayable: { id: string; name: string }[];
}

export interface PayoffOptions {
  strategy?: PayoffStrategy;
  /** Above the minimums, per month. */
  extra?: Money;
  today?: Date;
  /** Debt ids in the order to target them; only used by the 'custom' strategy. */
  order?: string[] | null;
}

// Note: the budget-suggestion and goal-status shapes are deliberately not
// written out here. They carry a dozen fields each and change with the
// heuristics that produce them, so an inferred return type stays correct where
// a hand-written one would quietly drift. Parameters are annotated; returns are
// inferred.
