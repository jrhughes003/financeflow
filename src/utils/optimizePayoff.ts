// Finding the cheapest order to pay debts off.
//
// Avalanche (highest rate first) and snowball (smallest balance first) are
// heuristics over one family of strategies: pay every minimum, then throw
// whatever is spare at a single target until it clears. Within that family and
// with fixed rates, avalanche is provably optimal — every dollar should go
// where it stops the most interest, and the highest rate is exactly that. This
// search confirms that rather than contradicting it.
//
// Where the heuristics lose is when the rates move. A card at 0% until March
// that reverts to 25% is cheap today and expensive soon; avalanche sorts by
// today's rate and puts it last, snowball ignores rates entirely, and both walk
// into the reversion. Deferred loans do something similar from the other side —
// a balance that cannot be paid yet is not a balance you should be planning
// around today.
//
// The search is exhaustive over orderings for small numbers of debts, which is
// what makes "optimal" a claim rather than a hope:
//
//   n debts → n! orderings, each simulated over up to MAX_MONTHS.
//   8 debts is 40,320 orderings — fine. 12 would be 479 million — not.
//
// So past a threshold it switches to a greedy construction with lookahead:
// build the order one position at a time, each time trying every remaining debt
// in the next slot and keeping the cheapest. That is O(n²) simulations and
// finds the promo-expiry cases, without claiming optimality it can't prove.

import { simulateDebtPayoff } from './planning';
import { monthsUntilRepayment } from './accounts';

import type { Debt, Money } from '../types/domain';
import type { PayoffOptions, PayoffSimulation } from '../types/analysis';

// 8! = 40,320 simulations runs in well under a second; 9! = 362,880 does not.
export const EXHAUSTIVE_LIMIT = 8;

/** One ordering, scored. Infinity when the plan never clears at this payment. */
interface Candidate {
  cost: Money;
  result: PayoffSimulation;
}

interface Best extends Candidate {
  order: string[];
}

interface GreedyPick extends Candidate {
  candidate: string;
  order: string[];
}

interface SearchResult {
  best: Best | null;
  /** How many orderings were simulated, for reporting what the search cost. */
  searched: number;
  /** False when the greedy fallback ran, which makes no optimality claim. */
  exhaustive: boolean;
}

const activeDebts = (debts: Debt[] = []): Debt[] => debts.filter(d => (Number(d.balance) || 0) > 0);

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) { yield items; return; }
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) yield [items[i], ...tail];
  }
}

/** Total interest for one target order; Infinity when the plan never clears. */
function costOf(debts: Debt[], order: string[], options: PayoffOptions): Candidate {
  const result = simulateDebtPayoff(debts, { ...options, strategy: 'custom', order });
  return {
    cost: result.feasible ? result.totalInterest : Infinity,
    result,
  };
}

function exhaustiveSearch(debts: Debt[], ids: string[], options: PayoffOptions): SearchResult {
  let best: Best | null = null;
  let searched = 0;

  for (const order of permutations(ids)) {
    searched += 1;
    const { cost, result } = costOf(debts, order, options);
    if (!best || cost < best.cost - 0.005) best = { cost, order, result };
  }
  return { best, searched, exhaustive: true };
}

function greedySearch(debts: Debt[], ids: string[], options: PayoffOptions): SearchResult {
  const remaining = [...ids];
  const order: string[] = [];
  let searched = 0;
  let best: GreedyPick | null = null;

  while (remaining.length) {
    let pick: GreedyPick | null = null;
    for (const candidate of remaining) {
      // Score the prefix with this candidate next, letting the rest follow in
      // the order they came — a fixed tail keeps the comparison honest.
      const trial = [...order, candidate, ...remaining.filter(id => id !== candidate)];
      searched += 1;
      const { cost, result } = costOf(debts, trial, options);
      if (!pick || cost < pick.cost - 0.005) pick = { cost, candidate, result, order: trial };
    }
    // Every iteration scores at least one candidate, so `pick` is set here.
    if (!pick) break;
    order.push(pick.candidate);
    remaining.splice(remaining.indexOf(pick.candidate), 1);
    best = pick;
  }
  return { best: best && { cost: best.cost, order, result: best.result }, searched, exhaustive: false };
}

/**
 * The cheapest payoff order, and what it saves against the heuristics.
 *
 * @returns null when there is nothing to optimise (no debts, or only one).
 */
export function optimizePayoff(
  debts: Debt[],
  {
    extra = 0, today = new Date(), limit = EXHAUSTIVE_LIMIT,
  }: { extra?: Money; today?: Date; limit?: number } = {},
) {
  const active = activeDebts(debts);
  if (active.length < 2) return null;

  const options = { extra, today };

  // Search in avalanche order, and keep the incumbent on a tie. Orderings often
  // tie — a deferred loan's position cannot affect cost, because no payment can
  // reach it yet — and without this the winner among equals is arbitrary, so
  // the plan might open with "pay the loan you aren't allowed to pay". Starting
  // from the conventional answer means a tie resolves to it.
  const ids = [...active]
    .sort((a, b) => (monthsUntilRepayment(a, { today }) - monthsUntilRepayment(b, { today }))
      || ((Number(b.interestRate) || 0) - (Number(a.interestRate) || 0))
      || ((Number(a.balance) || 0) - (Number(b.balance) || 0)))
    .map(d => d.id);

  const avalanche = simulateDebtPayoff(debts, { ...options, strategy: 'avalanche' });
  const snowball = simulateDebtPayoff(debts, { ...options, strategy: 'snowball' });

  const { best, searched, exhaustive } = active.length <= limit
    ? exhaustiveSearch(debts, ids, options)
    : greedySearch(debts, ids, options);

  if (!best || !Number.isFinite(best.cost)) {
    // Nothing clears at this payment level — the honest answer is that no
    // ordering fixes it, not a cheapest-looking arrangement of an impossible plan.
    return {
      feasible: false, avalanche, snowball, searched, exhaustive,
      order: null, result: null, savingVsAvalanche: 0, savingVsSnowball: 0,
    };
  }

  const byId = new Map(active.map(d => [d.id, d]));
  const saving = (other: PayoffSimulation): Money | null =>
    (other.feasible ? Math.round((other.totalInterest - best.cost) * 100) / 100 : null);

  return {
    feasible: true,
    exhaustive,
    searched,
    order: best.order.map(id => ({ id, name: byId.get(id)?.name })),
    result: best.result,
    totalInterest: best.cost,
    months: best.result.months,
    avalanche,
    snowball,
    savingVsAvalanche: saving(avalanche) ?? 0,
    savingVsSnowball: saving(snowball) ?? 0,
    // True when a heuristic is already optimal, which is the common case and
    // worth saying plainly rather than dressing up a zero as a result.
    matchesAvalanche: avalanche.feasible && Math.abs(avalanche.totalInterest - best.cost) < 0.01,
    matchesSnowball: snowball.feasible && Math.abs(snowball.totalInterest - best.cost) < 0.01,
  };
}
