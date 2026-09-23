// The optimiser has to earn its place against two heuristics that are already
// good. These tests pin both halves of that: it must *match* avalanche where
// avalanche is provably optimal, and beat it where the rates move.

import { describe, it, expect } from 'vitest';
import { optimizePayoff, EXHAUSTIVE_LIMIT } from './optimizePayoff';
import { simulateDebtPayoff } from './planning';
import { makeDebt } from '../test/factories';
import type { Debt, Money } from '../types/domain';

const TODAY = new Date(2026, 8, 22); // 2026-09-22
const opts = { today: TODAY, extra: 400 };

const debt = (
  id: string, balance: Money, rate: number, min: Money, extra: Partial<Debt> = {},
): Debt => makeDebt({
  id, name: id, type: 'credit_card', balance, interestRate: rate, minimumPayment: min, ...extra,
});

// optimizePayoff returns null when there are fewer than two debts to order.
// Every case that binds `best` expects a plan, so narrow once here instead of
// at each use — and fail by name rather than silently, if it ever stops.
type Plan = NonNullable<ReturnType<typeof optimizePayoff>>;
const expectPlan = (debts: Debt[], options: Parameters<typeof optimizePayoff>[1]): Plan => {
  const best = optimizePayoff(debts, options);
  expect(best).not.toBeNull();
  if (!best) throw new Error('optimizePayoff returned null');
  return best;
};

describe('where avalanche is already optimal', () => {
  const debts = [
    debt('visa', 4000, 22.99, 80),
    debt('line', 9000, 9.5, 120),
    debt('car', 12000, 6.4, 300),
  ];

  it('finds the same total as avalanche, and says so', () => {
    const best = expectPlan(debts, opts);
    expect(best.feasible).toBe(true);
    expect(best.exhaustive).toBe(true);
    // With fixed rates, paying the highest rate first stops the most interest —
    // the exhaustive search confirms the theory rather than beating it.
    expect(best.matchesAvalanche).toBe(true);
    expect(best.savingVsAvalanche).toBeCloseTo(0, 2);
    expect(best.order?.[0].id).toBe('visa');
  });

  it('still beats snowball when the two disagree', () => {
    // In the set above, balance order happens to match rate order, so both
    // heuristics pick the same plan. Snowball only loses when the smallest
    // balance is not the most expensive one.
    const awkward = [
      debt('tiny', 900, 4.5, 30),      // smallest, and cheapest
      debt('card', 6000, 24.99, 120),  // dearest
    ];
    const best = expectPlan(awkward, opts);
    expect(best.savingVsSnowball).toBeGreaterThan(0);
    expect(best.matchesAvalanche).toBe(true);
    expect(best.order?.[0].id).toBe('card');
  });

  it('searched every ordering', () => {
    const best = expectPlan(debts, opts);
    expect(best.searched).toBe(6); // 3! = 6
  });
});

describe('where a promotional rate expires', () => {
  // The case the heuristics cannot see: a card at 0% that reverts to 26.99% in
  // four months, against a card that charges 19.99% the whole way. Avalanche
  // sorts by today's rate and clears the 19.99% first, walking into the
  // reversion with the balance intact.
  const debts = [
    debt('promo', 6000, 0, 60, { promoUntil: '2027-01-22', postPromoRate: 26.99 }),
    debt('steady', 5000, 19.99, 100),
  ];

  it('beats avalanche by clearing the promo balance before it reverts', () => {
    const best = expectPlan(debts, { today: TODAY, extra: 900 });
    expect(best.feasible).toBe(true);
    expect(best.order?.[0].id).toBe('promo');
    expect(best.savingVsAvalanche).toBeGreaterThan(0);
  });

  it('the heuristic really does target the other debt first', () => {
    const avalanche = simulateDebtPayoff(debts, { today: TODAY, extra: 900, strategy: 'avalanche' });
    expect(avalanche.payoffs[0].id).toBe('steady'); // sorted by today's rate
  });

  it('charges nothing while the promotional rate is running', () => {
    const only = [debt('promo', 3000, 0, 100, { promoUntil: '2028-01-01', postPromoRate: 26.99 })];
    const plan = simulateDebtPayoff(only, { today: TODAY, extra: 400 });
    expect(plan.feasible).toBe(true);
    expect(plan.totalInterest).toBeCloseTo(0, 2); // cleared well inside the promo window
  });

  it('applies the reverted rate once the window closes', () => {
    const slow = [debt('promo', 9000, 0, 50, { promoUntil: '2026-11-22', postPromoRate: 24 })];
    const plan = simulateDebtPayoff(slow, { today: TODAY, extra: 0 });
    // Two months at 0%, then 24% — so there is interest, but less than a full
    // term at 24% would cost.
    expect(plan.totalInterest).toBeGreaterThan(0);
  });
});

describe('deferred loans', () => {
  it('does not plan around a balance that cannot be paid yet', () => {
    const debts = [
      debt('osap', 17400, 0, 290, { repaymentStart: '2027-04-01' }),
      debt('visa', 2340, 19.99, 75),
    ];
    const best = expectPlan(debts, opts);
    expect(best.feasible).toBe(true);
    // Every ordering ties here, because no payment can reach the deferred loan
    // until 2027 — so the plan should open with the debt you can actually pay,
    // not with an arbitrary winner among equals.
    expect(best.order?.[0].id).toBe('visa');
    expect(best.result?.payoffs[0].id).toBe('visa');
  });
});

describe('honesty about what it can and cannot do', () => {
  it('returns nothing when there is nothing to order', () => {
    expect(optimizePayoff([], opts)).toBeNull();
    expect(optimizePayoff([debt('only', 1000, 5, 50)], opts)).toBeNull();
  });

  it('reports infeasible rather than ranking impossible plans', () => {
    // Minimums nowhere near the interest: no ordering saves this.
    const debts = [debt('a', 50000, 29.99, 10), debt('b', 40000, 27.99, 10)];
    const best = expectPlan(debts, { today: TODAY, extra: 0 });
    expect(best.feasible).toBe(false);
    expect(best.order).toBeNull();
  });

  it('switches to the greedy search when exhaustive would be too slow', () => {
    const many = Array.from({ length: EXHAUSTIVE_LIMIT + 1 }, (_, i) =>
      debt(`d${i}`, 2000 + i * 500, 5 + i * 2, 40));
    const best = expectPlan(many, { today: TODAY, extra: 600 });
    expect(best.exhaustive).toBe(false);
    // O(n²) rather than n!: 9 debts is 45 simulations, not 362,880.
    expect(best.searched).toBeLessThan(100);
    expect(best.order).toHaveLength(EXHAUSTIVE_LIMIT + 1);
  });

  it('never returns a plan worse than the better heuristic', () => {
    const debts = [
      debt('a', 3000, 18, 60),
      debt('b', 7000, 11, 90),
      debt('c', 1500, 24.99, 40),
      debt('d', 12000, 6, 220),
    ];
    const best = expectPlan(debts, opts);
    const heuristicBest = Math.min(best.avalanche.totalInterest, best.snowball.totalInterest);
    expect(best.totalInterest).toBeLessThanOrEqual(heuristicBest + 0.01);
  });
});
