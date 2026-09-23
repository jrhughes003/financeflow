// Centralized tunable constants — extracted from inline "magic numbers" so they
// have names and a single source of truth. Phase 2 will surface some of these
// through user settings; until then these are the defaults used everywhere.

// --- Anomaly detection (calculations.js: detectAnomalies) ---
// A category is flagged only if its 3-month average exceeds this floor (avoids
// noise from tiny/incidental categories) AND the current month is at least
// ANOMALY_MULTIPLIER times that average.
export const ANOMALY_MIN_AVERAGE = 10;
export const ANOMALY_MULTIPLIER = 2;

// --- Transaction history pagination (TransactionHistory.jsx) ---
export const PAGE_SIZE = 25;

// --- Budget flex defaults (sampleData.js / new-budget form) ---
// "flex" is the percentage of acceptable overage before a budget is flagged.
export const DEFAULT_FLEX = 10;
export const SUBSCRIPTION_FLEX = 5;

// --- Trend / rolling-window defaults ---
export const DEFAULT_TREND_MONTHS = 6;
export const ANOMALY_LOOKBACK_MONTHS = 3;

// --- Analytics insights (insights.js) ---
// Trailing full months used as the "usual" baseline for comparisons, forecasts,
// and savings opportunities.
export const INSIGHT_LOOKBACK_MONTHS = 3;
// Months of history used to estimate the discretionary-spend range in the
// cash-flow outlook, and how many months ahead it projects.
export const FORECAST_HISTORY_MONTHS = 6;
export const FORECAST_MONTHS = 6;
// A category "is trending up" when its recent average beats the prior window by
// at least this fraction AND this many dollars per month.
export const TREND_UP_THRESHOLD = 0.2;
export const TREND_UP_MIN_DELTA = 20;
// "Small purchases add up": purchases under SMALL_PURCHASE_MAX at one merchant,
// at least SMALL_PURCHASE_MIN_PER_MONTH times a month on average.
export const SMALL_PURCHASE_MAX = 25;
export const SMALL_PURCHASE_MIN_PER_MONTH = 4;
// Minimum jump (percent and dollars) for a recurring charge to count as a price increase.
export const PRICE_INCREASE_MIN_PCT = 5;
export const PRICE_INCREASE_MIN_AMOUNT = 1;

// --- Duplicate charge detection ---
// Same merchant + exact amount within this many days (looking back this far).
export const DUPLICATE_WINDOW_DAYS = 2;
export const DUPLICATE_LOOKBACK_DAYS = 90;

// --- Irregular / periodic expenses ---
// Charges at or above this amount are candidates for quarterly/semiannual/annual bills.
export const IRREGULAR_MIN_AMOUNT = 50;
// A category-month is a seasonal spike when it's at least RATIO × its median
// month AND at least MIN_EXTRA dollars above it.
export const SEASONAL_SPIKE_RATIO = 1.75;
export const SEASONAL_SPIKE_MIN_EXTRA = 100;

// --- Budget tune-up (planning.js) ---
// Months of history considered, and the minimum needed before suggesting.
export const BUDGET_TUNE_LOOKBACK = 6;
export const BUDGET_TUNE_MIN_MONTHS = 3;
// Suggest adding a budget for categories spent on in most months averaging at least this.
export const BUDGET_TUNE_MIN_AVERAGE = 25;
// Suggest lowering when even the highest month stayed under this share of the budget.
export const BUDGET_UNDERUSE_RATIO = 0.75;

// --- Purchase-size buckets (habits.js) ---
export const PURCHASE_SIZE_BUCKETS = [10, 25, 50, 100, 250];
// Tags the app adds itself; excluded from tag analytics.
export const SYSTEM_TAGS = ['recurring', 'ai-imported'];
