// The records the app stores. Derived from what the code actually writes —
// src/utils/demoData.js builds every one of these, electron/db/schema.cjs
// promotes a subset of Transaction to real columns, and the JSON column keeps
// the rest — rather than from what would be tidy.
//
// Almost every field past the core few is optional on purpose. Records written
// by older versions are still in people's databases, and src/utils/accounts.js
// says so in as many words: "all optional, so older investments keep working".
// Tightening these would not make old data valid, it would just make the types
// disagree with the disk.

/** A calendar date as `YYYY-MM-DD`. Compared as a string, never parsed. */
export type IsoDate = string;

/**
 * Money, in whole currency units.
 *
 * Not integer cents. Every total is rounded with the same
 * `Math.round(n * 100) / 100` step, and src/utils/invariants.test.js holds that
 * discipline in place with property tests. The alias is here to mark intent at
 * the call site, not to promise a different representation.
 */
export type Money = number;

// --- Transactions -----------------------------------------------------------

/** `savings` transactions are excluded from every spending total. */
export type TransactionKind = 'expense' | 'savings';

/** A repayment received against a fronted purchase. */
export interface OwedPayment {
  id: string;
  date: IsoDate;
  amount: Money;
}

/**
 * A purchase the user fronted for other people.
 *
 * The full amount counts as spending until money comes back; each repayment
 * reduces the purchase's spending in its *original* month. Forgiving an unpaid
 * remainder changes nothing, because it was already counted.
 */
export interface OwedRecord {
  /** Total others owe back — at most the transaction amount. */
  amount: Money;
  /** How many people it was split between, including the user. */
  people: number | null;
  payments: OwedPayment[];
  /** True once the user writes off whatever is still unpaid. */
  forgiven: boolean;
  forgivenDate?: IsoDate;
}

export interface Transaction {
  id: string;
  /** Always `YYYY-MM-DD`. Period filtering compares these as strings to avoid
   *  the timezone shift that parsing to Date would introduce. */
  date: IsoDate;
  merchant: string;
  /** What the bank statement shows. Reimbursements never change this. */
  amount: Money;
  /** A category id, including the synthetic `savings` category. */
  category: string;
  subcategory?: string;
  notes?: string;
  tags?: string[];
  /** Excluded from "is this normal for you" comparisons. */
  isException?: boolean;
  kind?: TransactionKind;
  goalId?: string;
  recurringTemplateId?: string;
  owed?: OwedRecord;
}

/**
 * A transaction whose `amount` has been rewritten to what it actually cost
 * after reimbursements, with the charged figure kept alongside.
 *
 * This is a real distinction that the plain object blurs: `withEffectiveAmount`
 * in src/utils/reimbursements.js means `amount` is the net cost downstream of
 * it and the charged cost upstream. Naming it stops the two being confused.
 */
export type EffectiveTransaction = Transaction & { chargedAmount?: Money };

// --- Budgets, income, goals -------------------------------------------------

export interface Budget {
  id: string;
  category: string;
  amount: Money;
  /** Percent over the limit that still counts as on track. */
  flex: number;
  /** Carry a single month of unused room — or overage — into the next. */
  rollover: boolean;
}

/** Note that RecurringFrequency is a different set. Sharing one type would lie. */
export type IncomeFrequency = 'weekly' | 'biweekly' | 'semi-monthly' | 'monthly' | 'annual';

export interface Income {
  id: string;
  name?: string;
  source?: string;
  amount: Money;
  frequency: IncomeFrequency;
  color?: string;
}

/**
 * Income synthesised from an account's scheduled withdrawals.
 *
 * Never persisted — `getIncomeSources` adds these on the way out, so anything
 * consuming that function sees both shapes.
 */
export interface DerivedIncome extends Income {
  source: 'account_withdrawal';
  investmentId: string;
  derived: true;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: Money;
  /** An opening balance, not the running total: progress adds logged savings
   *  transactions on top of this. */
  currentAmount: Money;
  monthlyContribution: Money;
  targetDate: IsoDate;
  color?: string;
  icon?: string;
}

// --- Accounts and debts -----------------------------------------------------

export interface AccountEntry {
  id: string;
  type: 'deposit' | 'withdrawal';
  amount: Money;
  date: IsoDate;
  note?: string;
  createdAt?: number;
}

export interface Investment {
  id: string;
  name: string;
  type: string;
  /** The statement balance, as of `asOfDate`. */
  currentValue: Money;
  /** Without this the value is static rather than projected forward. */
  asOfDate?: IsoDate;
  syncedAt?: number;
  costBasis?: Money;
  /** Percent per year. */
  annualReturn?: number;
  monthlyWithdrawal?: Money;
  /** Day of the month, 1–28. */
  withdrawalDay?: number;
  /** Defaults to true when absent. */
  withdrawalCountsAsIncome?: boolean;
  color?: string;
  entries?: AccountEntry[];
}

export interface Debt {
  id: string;
  name: string;
  type: string;
  balance: Money;
  /** Percent per year. Zero is real here — student loans often are. */
  interestRate: number;
  minimumPayment: Money;
  /** What progress is measured against; losing it loses the progress bar. */
  originalBalance?: Money;
  /** Absent means the debt is already in repayment. */
  repaymentStart?: IsoDate;
}

// --- Recurring charges and categories ---------------------------------------

/** Deliberately not IncomeFrequency: there is no semi-monthly cadence here. */
export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly' | 'annual';

export interface RecurringTemplate {
  id: string;
  merchant: string;
  amount: Money;
  category: string;
  frequency: RecurringFrequency;
  nextDate: IsoDate;
  /** Absent counts as active. */
  active?: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  /** A lucide icon name, resolved at render time — so a string, not a union. */
  icon: string;
  subcategories: string[];
  /** Merchant substrings that classify into this category. */
  keywords: string[];
}
