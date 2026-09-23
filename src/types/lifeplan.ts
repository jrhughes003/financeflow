// Plan Ahead: the long-range projection's inputs.
//
// Stored inside settings rather than in its own tables, which is why none of
// this appears in the SQLite schema. Every field is what src/utils/lifeplan/
// actually reads — the engine switches on `PlanEvent['type']` and reads a
// different set of fields per branch, which is the one place here where the
// types earn their keep immediately.

import type { IsoDate, Money } from './domain';

/** A month as `YYYY-MM`. Compared as a string, like IsoDate. */
export type YearMonth = string;

export type PersonId = 'me' | 'partner';

/** Where money sits, which decides how it is taxed on the way out. */
export type BucketId = 'nonreg' | 'tfsa' | 'rrsp' | 'fhsa' | 'cash';

export interface PlanPerson {
  id: PersonId;
  name: string;
  enabled: boolean;
  /** Null until the user fills it in; the projection needs it to run at all. */
  birthYear: number | null;
  retireAge: number;
  cppStartAge: number;
  oasStartAge: number;
  /** Annual CPP at 65, before any deferral bonus. */
  cppAt65: Money;
  tfsaRoom: Money;
  rrspRoom: Money;
  fhsaAnnual: Money;
  /** Counts against the FHSA lifetime cap, which the annual room does not. */
  fhsaContributedSoFar?: Money;
}

export interface PlanIncome {
  id: string;
  name: string;
  personId: PersonId;
  annual: Money;
  /** Percent per year, on top of inflation. */
  growthPct?: number;
  rrspPct?: number;
  employerMatchPct?: number;
  start?: YearMonth;
  end?: YearMonth;
}

export interface PlanLiving {
  /** `history` derives spending from the ledger; `custom` uses the figure below. */
  spendingMode: 'history' | 'custom';
  spendingMonthly: Money;
  historyIncludesRent: boolean;
  rentMonthly: Money;
  rentGrowthPct: number;
  /** Spending in retirement as a percent of spending before it. */
  retirementSpendingPct: number;
  emergencyMonths: number;
  cashOnHand: Money;
}

export interface PlanAssumptions {
  inflationPct: number;
  returnPct: number;
  cashReturnPct: number;
  homeAppreciationPct: number;
  endAge: number;
}

// --- Events -----------------------------------------------------------------

interface PlanEventBase {
  id: string;
  name?: string;
  /**
   * When it happens. Written as `YYYY-MM` by the forms, but the engine slices
   * to seven characters, so a full `YYYY-MM-DD` works too. Empty on a
   * just-created event the user has not dated yet, and a recurring event has
   * `start`/`end` instead.
   */
  date?: YearMonth | IsoDate;
  /** Absent counts as enabled. */
  enabled?: boolean;
}

/** Canadian specifics live in src/utils/lifeplan/housing.js. */
export interface HouseEvent extends PlanEventBase {
  type: 'house';
  price: Money;
  downPct?: number;
  mortgageRate?: number;
  amortizationYears?: number;
  /** Changes both the land-transfer rebate and the insured amortisation cap. */
  firstTime?: boolean;
  /** Toronto charges a municipal land transfer tax on top of Ontario's. */
  toronto?: boolean;
  propertyTaxPct?: number;
  insuranceAnnual?: Money;
  maintenancePct?: number;
  condoFeesMonthly?: Money;
  sellingCostsPct?: number;
  useFHSA?: boolean;
  /** Home Buyers' Plan: an RRSP withdrawal that isn't taxed. */
  useHBP?: boolean;
}

/** 'loan' is the only financed option; anything else is paid in cash. */
export type CarFinancing = 'loan' | 'cash';

export interface CarEvent extends PlanEventBase {
  type: 'car';
  price: Money;
  financing?: CarFinancing;
  downPct?: number;
  loanRate?: number;
  loanMonths?: number;
  /** Non-zero makes the event repeat on this cadence to the end of the plan. */
  replaceEveryYears?: number;
}

export interface OneTimeEvent extends PlanEventBase {
  type: 'oneTime';
  /** Negative is a cost, positive a windfall. */
  amount: Money;
}

export interface RecurringEvent extends PlanEventBase {
  type: 'recurring';
  monthly: Money;
  start?: YearMonth;
  end?: YearMonth;
  /** Grow with inflation rather than staying nominal. */
  inflate?: boolean;
}

/**
 * The plan's second discriminated union.
 *
 * src/utils/lifeplan/engine.js and PlanEvents.jsx both switch on `type` and
 * then read a completely different set of fields per branch, with nothing
 * checking that the fields are there.
 */
export type PlanEvent = HouseEvent | CarEvent | OneTimeEvent | RecurringEvent;

export type PlanEventType = PlanEvent['type'];

// --- The plan ---------------------------------------------------------------

/** Which bucket an app investment counts as, and whose it is. */
export interface AccountMapping {
  bucket: BucketId;
  owner: PersonId;
}

export interface LifePlan {
  version: number;
  people: PlanPerson[];
  incomes: PlanIncome[];
  living: PlanLiving;
  /** Keyed by investment id. */
  accountMap: Record<string, AccountMapping>;
  events: PlanEvent[];
  assumptions: PlanAssumptions;
  /** Saved copies of the whole plan, for side-by-side comparison. */
  scenarios: PlanScenario[];
}

/**
 * A saved plan, minus its own scenarios — otherwise saving a scenario would
 * nest a copy of every previous one. scenarioFromPlan strips them.
 */
export interface PlanScenario {
  id: string;
  name: string;
  savedAt: string;
  plan: Omit<LifePlan, 'scenarios'>;
}
