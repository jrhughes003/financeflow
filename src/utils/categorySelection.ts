/*
 * Choosing which categories a chart will show.
 *
 * Both functions here pick a subset of the taxonomy, and both exist because
 * the versions they replaced dropped the remainder without saying so. That is
 * a poor failure mode for a ledger: the chart renders, nothing looks broken,
 * and the categories you are missing are precisely the ones you cannot see are
 * missing.
 *
 * They are plain functions in a plain file rather than inline in the Analytics
 * component so they can be tested without rendering anything — which is how
 * the ordering bug below was pinned down.
 */

/** The slice that stands in for every category past the cut. */
export const REST_SLICE_ID = '__rest__';

/**
 * The `limit` categories accounting for the most spending across `trend`.
 *
 * What this replaced filtered the category list and took the first `limit`,
 * which is declaration order in categorization.ts. The trend chart could
 * therefore only ever offer Dining Out, Groceries, Transportation, Housing,
 * Utilities and Subscriptions — positions 1 to 6 — whatever the ledger held.
 * Everything from Health onward was unreachable, Shopping included, and
 * Shopping is where every transaction the auto-categoriser cannot place ends
 * up.
 *
 * It was invisible while the taxonomy had five categories, because five fit
 * inside a limit of six. Expanding to eighteen turned a latent bug into two
 * thirds of the taxonomy silently missing.
 *
 * `trend` rows carry a `label` string beside the numeric category totals, so
 * the values are read through Number() and a non-numeric one contributes zero
 * rather than NaN.
 */
export function topCategoriesByTrend<C extends { id: string }>(
  categories: C[],
  trend: Record<string, unknown>[],
  limit: number,
): C[] {
  return categories
    .map(cat => ({ cat, total: trend.reduce((sum, m) => sum + (Number(m[cat.id]) || 0), 0) }))
    .filter(x => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map(x => x.cat);
}

/**
 * The `limit` largest slices, with the remainder gathered into one rather than
 * discarded.
 *
 * A category pie that omits its tail does not add up to the total printed
 * above it. Nine slices keeps the ring legible; dropping the tenth onward
 * silently does not, and with eighteen categories the tail stopped being
 * hypothetical.
 *
 * `rest` builds the extra slice, so this stays free of any opinion about
 * colour or wording.
 */
export function withRestSlice<S extends { value: number }>(
  ranked: S[],
  limit: number,
  rest: (count: number, total: number) => S,
): S[] {
  if (ranked.length <= limit) return ranked;
  const tail = ranked.slice(limit);
  const total = tail.reduce((sum, d) => sum + d.value, 0);
  // A tail that sums to nothing earns no slice — an "Other: $0.00" wedge is
  // noise, and Recharts would render it as a zero-width sliver with a legend
  // entry.
  if (total <= 0) return ranked.slice(0, limit);
  return [...ranked.slice(0, limit), rest(tail.length, total)];
}
