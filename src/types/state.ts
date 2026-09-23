// The store: the whole in-memory state, the actions that change it, and the
// one narrowing function that turns untrusted JSON into an AppState.

import type {
  Budget, Category, Debt, Goal, Income, Investment,
  RecurringTemplate, Transaction,
} from './domain';
import type { LifePlan } from './lifeplan';

/**
 * Every field optional: settings accumulated over versions and nothing
 * backfills them. The object itself is always present.
 */
export interface Settings {
  currency?: string;
  showSampleData?: boolean;
  aiEnabled?: boolean;
  /** Overrides the default anomaly floor in src/utils/constants.js. */
  anomalyMinAverage?: number;
  anomalyMultiplier?: number;
  /** Merchant → category, learned from corrections the user has made. */
  merchantCategoryHints?: Record<string, string>;
  dismissedBudgetTips?: string[];
  dismissedDuplicates?: string[];
  /** Plan Ahead lives in settings rather than its own tables. */
  lifePlan?: LifePlan;
}

export interface AppState {
  transactions: Transaction[];
  budgets: Budget[];
  incomes: Income[];
  /**
   * Load-bearing snake_case. This exact string is a table name in
   * electron/db/schema.cjs and is iterated by that string in repository.cjs, so
   * renaming it to `savingsGoals` orphans every saved goal in every existing
   * database. It is inconsistent, and it stays.
   */
  savings_goals: Goal[];
  investments: Investment[];
  debts: Debt[];
  recurringTemplates: RecurringTemplate[];
  customCategories: Category[];
  settings: Settings;
}

/** The collection keys, for code that walks the state generically. */
export const COLLECTION_KEYS = [
  'transactions', 'budgets', 'incomes', 'savings_goals',
  'investments', 'debts', 'recurringTemplates', 'customCategories',
] as const;

export type CollectionKey = (typeof COLLECTION_KEYS)[number];

// --- Actions ----------------------------------------------------------------

/**
 * One member per `case` in the reducer.
 *
 * A discriminated union rather than `{ type: string; payload: unknown }`
 * because the halves are not independent: DELETE_* takes an id and ADD_*
 * takes the whole record, and the two are easy to swap by accident. It is also
 * why src/hooks/useUndoableDelete.js builds actions through factories — a
 * `type` read out of a lookup table is just `string` and can never be checked
 * against this.
 */
export type Action =
  | { type: 'ADD_TRANSACTION'; payload: Transaction }
  | { type: 'UPDATE_TRANSACTION'; payload: Transaction }
  | { type: 'DELETE_TRANSACTION'; payload: string }
  | { type: 'MARK_EXCEPTION'; payload: string }
  | { type: 'IMPORT_TRANSACTIONS'; payload: Transaction[] }
  | { type: 'SET_BUDGET'; payload: Budget }
  | { type: 'DELETE_BUDGET'; payload: string }
  | { type: 'ADD_INCOME'; payload: Income }
  | { type: 'UPDATE_INCOME'; payload: Income }
  | { type: 'DELETE_INCOME'; payload: string }
  | { type: 'ADD_GOAL'; payload: Goal }
  | { type: 'UPDATE_GOAL'; payload: Goal }
  | { type: 'DELETE_GOAL'; payload: string }
  | { type: 'ADD_INVESTMENT'; payload: Investment }
  | { type: 'UPDATE_INVESTMENT'; payload: Investment }
  | { type: 'DELETE_INVESTMENT'; payload: string }
  | { type: 'ADD_DEBT'; payload: Debt }
  | { type: 'UPDATE_DEBT'; payload: Debt }
  | { type: 'DELETE_DEBT'; payload: string }
  | { type: 'ADD_RECURRING_TEMPLATE'; payload: RecurringTemplate }
  | { type: 'UPDATE_RECURRING_TEMPLATE'; payload: RecurringTemplate }
  | { type: 'DELETE_RECURRING_TEMPLATE'; payload: string }
  | { type: 'ADD_CATEGORY'; payload: Category }
  | { type: 'DELETE_CATEGORY'; payload: string }
  | { type: 'LOAD_DATA'; payload: AppState }
  | { type: 'RESET_DATA' }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<Settings> };

export type Dispatch = (action: Action) => void;

// --- The trust boundary -----------------------------------------------------

/**
 * Coerce arbitrary JSON into an AppState, filling in anything missing.
 *
 * Three sources hand the app shapes nobody has checked: a legacy localStorage
 * blob, a backup file the user chose, and rows round-tripped through SQLite and
 * IPC. Declaring those `AppState` would be a lie that propagates — every
 * consumer downstream would then be trusting a guarantee nothing established.
 * They are typed `unknown` and pass through here.
 *
 * Deliberately forgiving rather than rejecting: a backup missing a collection
 * added in a later version is normal, and refusing to load it would be worse
 * than filling in an empty array.
 */
export function asAppState(value: unknown): AppState {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const list = <T,>(key: CollectionKey): T[] => (Array.isArray(raw[key]) ? (raw[key] as T[]) : []);

  return {
    transactions: list('transactions'),
    budgets: list('budgets'),
    incomes: list('incomes'),
    savings_goals: list('savings_goals'),
    investments: list('investments'),
    debts: list('debts'),
    recurringTemplates: list('recurringTemplates'),
    customCategories: list('customCategories'),
    settings: (raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) as Settings,
  };
}

/** Does this look like app state at all? Used to reject an unrelated JSON file. */
export function looksLikeAppState(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return COLLECTION_KEYS.some(key => Array.isArray(raw[key]));
}
