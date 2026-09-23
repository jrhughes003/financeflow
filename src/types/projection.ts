// The life-plan engine's inputs and outputs.
//
// Separate from lifeplan.ts, which holds what the user *enters*. These are what
// the simulation consumes and produces — the starting balances taken from the
// rest of the app, and the year-by-year result the Plan Ahead pages chart.

import type { Debt, Money } from './domain';
import type { BucketId, HouseEvent, PersonId, PlanEvent, YearMonth } from './lifeplan';

/** One of the user's investments, mapped into the plan's money model. */
export interface SnapshotAccount {
  id: string;
  name: string;
  bucket: BucketId;
  owner: PersonId;
  value: Money;
  /** Adjusted cost base. Capped at the value, so an account can't start at a loss. */
  acb: Money;
}

/** Where the plan starts from, built out of current app data. */
export interface PlanSnapshot {
  /** Goal balances plus whatever cash the user declared. */
  cash: Money;
  goalsCash: Money;
  accounts: SnapshotAccount[];
  debts: Debt[];
  /** Average monthly spending from the ledger, used when spendingMode is 'history'. */
  historyMonthly: Money;
  /** How many months that average is drawn from — few months, weak average. */
  historyMonths: number;
}

/** Per-person tax inputs and withdrawals for one year. */
export interface PersonYear {
  employment: Money;
  cpp: Money;
  oas: Money;
  rrspWithdrawals: Money;
  capGains: Money;
  deductions: Money;
  /** Tax withheld through the year, before the year-end true-up. */
  withheld: Money;
  rrspContrib: Money;
  fhsaContrib: Money;
  tfsaWithdrawn: Money;
}

/**
 * What a year's row reports per person — not the same shape as PersonYear.
 *
 * The accumulator carries what tax needs as *input* (withheld, deductions,
 * TFSA withdrawals); this carries what the year *came to* once the year-end
 * true-up has run. They were one untyped object and were easy to confuse.
 */
export interface PersonYearSummary {
  age: number;
  employment: Money;
  cpp: Money;
  oas: Money;
  rrspWithdrawals: Money;
  capGains: Money;
  rrspContrib: Money;
  fhsaContrib: Money;
  /** Income tax plus payroll. */
  tax: Money;
  incomeTax: Money;
  payroll: Money;
  averageRate: number;
  marginalRate: number;
}

export interface YearSpending {
  living: Money;
  /** Rent, or mortgage interest, taxes, insurance and upkeep once a home exists. */
  housing: Money;
  debt: Money;
  recurring: Money;
  events: Money;
  total: Money;
}

export interface YearBalances {
  cash: Money;
  nonreg: Money;
  tfsa: Money;
  rrsp: Money;
  fhsa: Money;
  /** Everything that could be spent — excludes home equity. */
  liquid: Money;
}

/** Something notable that happened in a year, for the timeline. */
export interface YearEvent {
  label: string;
  amount?: Money;
  [key: string]: unknown;
}

/** One calendar year of the projection. */
export interface PlanRow {
  year: number;
  /** Usually 12; fewer in the first and last years. */
  months: number;
  ages: Record<string, number>;
  retired: boolean;
  byPerson: Record<string, PersonYearSummary>;
  income: Money;
  /** Income tax plus payroll. */
  tax: Money;
  incomeTax: Money;
  payroll: Money;
  afterTax: Money;
  /** A fraction, not a percentage. */
  averageTaxRate: number;
  marginalRate: number;
  spending: YearSpending;
  contributions: Money;
  employerMatch: Money;
  invested: Money;
  withdrawals: Money;
  /** What the plan could not fund this year. Non-zero means it failed. */
  shortfall: Money;
  events: YearEvent[];
  balances: YearBalances;
  homeValue: Money;
  mortgage: Money;
  otherDebt: Money;
  netWorth: Money;
  /** Divide by this to read the year in today's dollars. */
  inflationIndex: number;
}

/** The first month the plan ran short, if it ever did. */
export interface Shortfall {
  year: number;
  /** Zero-based. */
  month: number;
  date: string;
  amount: Money;
}

export interface PlanResult {
  rows: PlanRow[];
  /** Keyed by event id: what each event actually cost when it happened. */
  eventResults: Record<string, unknown>;
  firstShortfall: Shortfall | null;
  retirementRow: PlanRow | null;
  finalRow: PlanRow | null;
  startYm: YearMonth;
}

/** Returned instead of a projection when the plan lacks a birth year. */
export interface NeedsSetup {
  needsSetup: true;
}

export type PlanOutcome = PlanResult | NeedsSetup;

export function needsSetup(result: PlanOutcome): result is NeedsSetup {
  return 'needsSetup' in result;
}

/** A dated occurrence of an event — cars can repeat, so one event yields many. */
export interface EventOccurrence {
  event: PlanEvent;
  date: YearMonth;
  /** 0 for the first, incrementing for each repeat. */
  occurrence: number;
}

/** A debt as the simulation carries it: monthly rate, and when payments begin. */
export interface SimulatedDebt {
  name: string;
  balance: Money;
  /** Monthly interest rate as a fraction. */
  r: number;
  payment: Money;
  /** Month index when repayment starts; 0 means immediately. */
  startK: number;
  /** Set on car loans so they can be identified in the timeline. */
  label?: string;
}

/** The home, once a house event has happened. */
export interface SimulatedHome {
  value: Money;
  mortgage: Money;
  /** Monthly mortgage rate, semi-annually compounded per Canadian convention. */
  r: number;
  payment: Money;
  /**
   * The event that bought it. Property tax, insurance, upkeep and condo fees
   * are read off this rather than copied, so editing the event and re-running
   * cannot leave the two disagreeing.
   */
  params: HouseEvent;
}

/** Per-person registered accounts and the room left in them. */
export interface RegisteredAccounts {
  rrsp: Money;
  tfsa: Money;
  fhsa: Money;
  /** Contributions to date against the FHSA lifetime cap. */
  fhsaLifetime: Money;
  tfsaRoom: Money;
  rrspRoom: Money;
  /** Outstanding Home Buyers' Plan balance. */
  hbp: Money;
  hbpRepayFrom: number | null;
  hbpAnnual: Money;
}
