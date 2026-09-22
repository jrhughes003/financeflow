// Data-minimization gate for AI features.
//
// Every outbound AI request is built here from an explicit per-feature allow-list,
// so a feature can only ever send the fields it genuinely needs — never the raw
// ledger by accident. Prefer aggregates over raw transactions wherever possible
// (insights and queries send summaries, not individual transactions). This is the
// concrete mechanism behind the README's privacy promise.

// Pick only the named keys from an object (undefined keys are dropped).
function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

// Allowed fields per feature. Anything not listed is stripped before sending.
const ALLOW = {
  // Categorization needs only the merchant string and the category taxonomy.
  categorize: ['merchant', 'categories'],
  // Natural-language entry: the user's text, today's date for relative dates,
  // and the taxonomy to map onto.
  parse_entry: ['text', 'today', 'categories'],
  // Q&A sends the question itself and nothing else about the user's finances.
  // Figures reach the model only when it calls the local aggregate tools in
  // aggregates.cjs, which answer with sums and counts computed on this machine.
  query: ['question', 'today', 'categories'],
  // Insights run on aggregates only (totals, trends, budget status, anomalies).
  insights: ['summary'],
  // Receipt/statement parsing must send the raw pasted text plus the taxonomy.
  extract: ['text', 'categories'],
};

/**
 * Build the minimal payload for an AI feature. Throws on an unknown feature so a
 * typo can't silently send an unfiltered object.
 */
function buildPayload(feature, input) {
  const allow = ALLOW[feature];
  if (!allow) throw new Error(`Unknown AI feature: ${feature}`);
  return pick(input || {}, allow);
}

module.exports = { buildPayload, ALLOW };
