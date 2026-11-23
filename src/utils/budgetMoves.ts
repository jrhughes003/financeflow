// Moving budget room between categories for one month.
//
// "Dining Out is $173 over" is only half a signal; the other half is what to
// do about it. The usual answer is to cover it from a category with room
// left, for this month only — which the budget model already supports as a
// one-month adjustment. These are the pure pieces the dashboard's buttons use.

import type { Budget } from '../types/domain';
import type { BudgetStatus } from '../types/analysis';

const round = (n: number): number => Math.round(n * 100) / 100;

export const monthKey = (month: number, year: number): string => `${year}-${String(month + 1).padStart(2, '0')}`;

/** A budget with `delta` added to its adjustment for one month. Zero adjustments are removed. */
export function adjustMonth(budget: Budget, key: string, delta: number): Budget {
  const adj = { ...(budget.monthAdjustments || {}) };
  const next = round((adj[key] || 0) + delta);
  if (next === 0) delete adj[key]; else adj[key] = next;
  const { monthAdjustments: _old, ...rest } = budget;
  return Object.keys(adj).length ? { ...rest, monthAdjustments: adj } : rest;
}

/**
 * The category best placed to cover an overage: the one with the most room
 * left this month, other than the one that is over. Null when nothing has room.
 */
export function bestDonor(statuses: BudgetStatus[], overCategory: string): BudgetStatus | null {
  const candidates = statuses
    .filter(s => s.category !== overCategory && s.effectiveBudget > 0 && s.effectiveBudget - s.actual > 0)
    .sort((a, b) => (b.effectiveBudget - b.actual) - (a.effectiveBudget - a.actual));
  return candidates[0] ?? null;
}

/** How much of `needed` the donor can give without going over itself. */
export function coverable(donor: BudgetStatus, needed: number): number {
  return round(Math.min(needed, Math.max(0, donor.effectiveBudget - donor.actual)));
}
