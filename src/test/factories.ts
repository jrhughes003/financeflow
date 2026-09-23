// Builders for the domain records tests need.
//
// Tests are full of deliberately partial fixtures — `{ id: 't1', amount: 10 }`
// is enough to exercise a total, and spelling out a date, a merchant and a
// category every time would bury the thing under test. The wrong fix is to
// loosen the domain types until those literals compile, because that throws
// away the guarantee for the 15k lines of source that rely on it.
//
// So the fixtures get a default and an override instead. `makeTransaction({ id:
// 't1', amount: 10 })` is shorter than the literal it replaces and reads
// better: what is written down is exactly what the test cares about.

import type {
  Budget, Category, Debt, Goal, Income, Investment,
  OwedRecord, RecurringTemplate, Transaction,
} from '../types/domain';
import type { AppState, Settings } from '../types/state';

export const makeTransaction = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  date: '2026-09-15',
  merchant: 'Metro',
  amount: 10,
  category: 'groceries',
  ...over,
});

export const makeOwed = (over: Partial<OwedRecord> = {}): OwedRecord => ({
  amount: 0,
  people: null,
  payments: [],
  forgiven: false,
  ...over,
});

export const makeBudget = (over: Partial<Budget> = {}): Budget => ({
  id: 'b1',
  category: 'groceries',
  amount: 400,
  flex: 10,
  rollover: false,
  ...over,
});

export const makeIncome = (over: Partial<Income> = {}): Income => ({
  id: 'i1',
  name: 'Salary',
  amount: 5000,
  frequency: 'monthly',
  ...over,
});

export const makeGoal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  name: 'Emergency fund',
  targetAmount: 10000,
  currentAmount: 0,
  monthlyContribution: 200,
  targetDate: '2027-12-31',
  ...over,
});

export const makeInvestment = (over: Partial<Investment> = {}): Investment => ({
  id: 'v1',
  name: 'Index fund',
  type: 'stocks',
  currentValue: 10000,
  ...over,
});

export const makeDebt = (over: Partial<Debt> = {}): Debt => ({
  id: 'd1',
  name: 'Visa',
  type: 'credit_card',
  balance: 2000,
  interestRate: 19.99,
  minimumPayment: 50,
  ...over,
});

export const makeRecurring = (over: Partial<RecurringTemplate> = {}): RecurringTemplate => ({
  id: 'rt1',
  merchant: 'Spotify',
  amount: 12,
  category: 'subscriptions',
  frequency: 'monthly',
  nextDate: '2026-10-01',
  ...over,
});

export const makeCategory = (over: Partial<Category> = {}): Category => ({
  id: 'c1',
  name: 'Custom',
  color: '#000000',
  icon: 'Tag',
  subcategories: [],
  keywords: [],
  ...over,
});

export const makeSettings = (over: Partial<Settings> = {}): Settings => ({
  currency: 'CAD',
  showSampleData: false,
  ...over,
});

/** An empty ledger, for tests that need a whole state rather than one record. */
export const makeState = (over: Partial<AppState> = {}): AppState => ({
  transactions: [],
  budgets: [],
  incomes: [],
  savings_goals: [],
  investments: [],
  debts: [],
  recurringTemplates: [],
  customCategories: [],
  settings: makeSettings(),
  ...over,
});
