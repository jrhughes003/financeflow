// SQLite schema for FinanceFlow's local database.
//
// Design: a lossless hybrid. The `transactions` table promotes the queryable
// fields (date, amount, category, …) into real columns so Phase 3's AI feature
// can run grounded SQL aggregates, while a `data` JSON column on every table
// preserves the complete original object — so no field is ever dropped on a
// round-trip, regardless of how the JS object shape evolves. Smaller entities
// (budgets, goals, …) are stored id + JSON; columns can be promoted later if a
// feature needs to query them.

const CURRENT_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id                    TEXT PRIMARY KEY,
  date                  TEXT,
  merchant              TEXT,
  amount                REAL,
  category              TEXT,
  subcategory           TEXT,
  is_exception          INTEGER DEFAULT 0,
  kind                  TEXT DEFAULT 'expense',
  goal_id               TEXT,
  recurring_template_id TEXT,
  data                  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);

CREATE TABLE IF NOT EXISTS budgets            (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS incomes            (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS savings_goals      (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS investments        (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS debts              (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recurring_templates(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS custom_categories  (id TEXT PRIMARY KEY, data TEXT NOT NULL);

-- key/value store for the settings blob and bookkeeping flags (e.g. migration).
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

// Maps a top-level state key <-> its table. The JSON-only tables share one shape;
// `transactions` is handled specially because of its promoted columns.
const COLLECTION_TABLES = [
  { stateKey: 'budgets', table: 'budgets' },
  { stateKey: 'incomes', table: 'incomes' },
  { stateKey: 'savings_goals', table: 'savings_goals' },
  { stateKey: 'investments', table: 'investments' },
  { stateKey: 'debts', table: 'debts' },
  { stateKey: 'recurringTemplates', table: 'recurring_templates' },
  { stateKey: 'customCategories', table: 'custom_categories' },
];

module.exports = { CURRENT_VERSION, SCHEMA_SQL, COLLECTION_TABLES };
