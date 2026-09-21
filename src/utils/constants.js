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
