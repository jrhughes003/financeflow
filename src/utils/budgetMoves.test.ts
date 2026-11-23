import { describe, it, expect } from 'vitest';
import { adjustMonth, bestDonor, coverable, monthKey } from './budgetMoves';
import type { Budget } from '../types/domain';
import type { BudgetStatus } from '../types/analysis';

const status = (category: string, effectiveBudget: number, actual: number): BudgetStatus => ({
  category, budget: effectiveBudget, adjustment: 0, carry: 0, effectiveBudget, actual, flex: 0,
  flexLimit: effectiveBudget, variance: effectiveBudget - actual, percentUsed: 0, status: 'good', rollover: false,
});

describe('budget moves', () => {
  it('keys months from a zero-based month', () => {
    expect(monthKey(10, 2026)).toBe('2026-11');
  });

  it('adds to and clears a one-month adjustment', () => {
    const b: Budget = { id: 'b', category: 'dining', amount: 400, flex: 0, rollover: false };
    const up = adjustMonth(b, '2026-11', 173.2);
    expect(up.monthAdjustments).toEqual({ '2026-11': 173.2 });
    expect(adjustMonth(up, '2026-11', -173.2).monthAdjustments).toBeUndefined();
  });

  it('picks the category with the most room, never the one that is over', () => {
    const s = [status('dining', 400, 573), status('shopping', 285, 260), status('groceries', 710, 368)];
    expect(bestDonor(s, 'dining')?.category).toBe('groceries');
    expect(bestDonor([status('dining', 400, 573)], 'dining')).toBeNull();
  });

  it('never covers more than the donor has left', () => {
    expect(coverable(status('shopping', 285, 260), 173)).toBe(25);
    expect(coverable(status('groceries', 710, 368), 173)).toBe(173);
  });
});
