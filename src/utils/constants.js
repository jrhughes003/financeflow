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
