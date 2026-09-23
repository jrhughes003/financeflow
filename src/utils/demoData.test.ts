// The demo generator feeds screenshots and first-run exploration, so its output
// has to satisfy the same invariants as real user data: unique ids, valid dates,
// nothing in the future, and enough substance for the analytics to have something
// to say. These tests pin those invariants and the deliberate analytics hooks.

import { describe, it, expect } from 'vitest';
import generateDemoData from './demoData';
import { getTransactionsForPeriod, getBudgetStatus, getGoalProgress, getTotalIncome } from './calculations';
import { getOwedStatus, effectiveAmount } from './reimbursements';
import { runPlan } from './lifeplan/engine';
import { buildSnapshot, normalizePlan } from './lifeplan/snapshot';
import { needsSetup } from '../types/projection';

const TODAY = new Date(2026, 8, 22); // 2026-09-22, fixed so assertions are stable

describe('generateDemoData', () => {
  const data = generateDemoData(TODAY);

  it('produces every top-level state key the app expects', () => {
    expect(Object.keys(data).sort()).toEqual([
      'budgets', 'customCategories', 'debts', 'incomes', 'investments',
      'recurringTemplates', 'savings_goals', 'settings', 'transactions',
    ].sort());
  });

  it('gives every entity a unique string id (SQLite persistence requires it)', () => {
    // The arrays themselves rather than their key names: indexing AppState by a
    // `string` says nothing about what the collection holds.
    const collections: { id: string }[][] = [
      data.transactions, data.budgets, data.incomes, data.savings_goals,
      data.investments, data.debts, data.recurringTemplates, data.customCategories,
    ];
    const all = collections.flatMap(items => items.map(item => item.id));
    all.forEach(id => expect(typeof id).toBe('string'));
    expect(new Set(all).size).toBe(all.length);
  });

  it('writes well-formed dates and never generates a future transaction', () => {
    const todayStr = '2026-09-22';
    data.transactions.forEach(t => {
      expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.date <= todayStr).toBe(true);
    });
  });

  it('keeps transaction fields the shape the rest of the app assumes', () => {
    data.transactions.forEach(t => {
      expect(Array.isArray(t.tags)).toBe(true);
      expect(typeof t.merchant).toBe('string');
      expect(t.merchant.length).toBeGreaterThan(0);
      expect(typeof t.amount).toBe('number');
      expect(t.amount).toBeGreaterThan(0);
      expect(typeof t.isException).toBe('boolean');
      // amounts are rounded to cents
      expect(round2(t.amount)).toBe(t.amount);
    });
  });

  it('is deterministic for a given day', () => {
    const again = generateDemoData(TODAY);
    expect(again.transactions).toEqual(data.transactions);
  });

  it('spans several months of history so trends and forecasts have input', () => {
    const months = new Set(data.transactions.map(t => t.date.slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(6);
  });

  it('feeds goal progress with real savings transactions, not just an opening balance', () => {
    data.savings_goals.forEach(goal => {
      const contributions = data.transactions.filter(t => t.kind === 'savings' && t.goalId === goal.id);
      expect(contributions.length).toBeGreaterThan(0);
      const progress = getGoalProgress(goal, data.transactions);
      expect(progress.contributed).toBeGreaterThan(0);
      expect(progress.currentAmount).toBeGreaterThan(progress.opening);
      expect(progress.percent).toBeGreaterThan(0);
    });
  });

  it('excludes savings transfers from spending', () => {
    const spending = getTransactionsForPeriod(data.transactions, 8, 2026);
    expect(spending.some(t => t.kind === 'savings')).toBe(false);
  });

  it('covers every budgeted category with actual spending', () => {
    // Use the prior full month so a partially elapsed current month can't fail it.
    getBudgetStatus(data.budgets, data.transactions, 7, 2026).forEach(status => {
      expect(status.actual).toBeGreaterThan(0);
    });
  });

  it('produces income that plausibly exceeds a month of spending', () => {
    const monthly = getTotalIncome(data.incomes);
    const spent = getTransactionsForPeriod(data.transactions, 7, 2026).reduce((s, t) => s + t.amount, 0);
    expect(monthly).toBeGreaterThan(spent);
  });

  // --- the deliberate analytics hooks ---------------------------------------

  it('includes a partly repaid split expense for the owed-to-me feature', () => {
    const owed = data.transactions.find(t => t.owed);
    expect(owed).toBeTruthy();
    if (!owed) throw new Error('unreachable');
    const status = getOwedStatus(owed);
    expect(status).not.toBeNull();
    if (!status) throw new Error('unreachable');
    expect(status.status).toBe('partial');
    expect(status.remaining).toBeGreaterThan(0);
    // spending is net of what friends paid back
    expect(effectiveAmount(owed)).toBeCloseTo(owed.amount - status.repaid, 2);
  });

  it('includes a duplicate charge pair within the detection window', () => {
    const byKey: Record<string, string[]> = {};
    data.transactions.forEach(t => {
      const key = `${t.merchant}|${t.amount}`;
      (byKey[key] = byKey[key] || []).push(t.date);
    });
    const dupes = Object.values(byKey).filter(dates => dates.length > 1);
    expect(dupes.length).toBeGreaterThan(0);
  });

  it('includes a flagged exception that stays out of budget math', () => {
    const exception = data.transactions.find(t => t.isException);
    expect(exception).toBeTruthy();
    if (!exception) throw new Error('unreachable');
    const included = getTransactionsForPeriod(data.transactions, Number(exception.date.slice(5, 7)) - 1, Number(exception.date.slice(0, 4)));
    expect(included.some(t => t.id === exception.id)).toBe(false);
  });

  it('includes an interest-free loan still in deferment', () => {
    const deferred = data.debts.find(d => d.repaymentStart);
    expect(deferred).toBeTruthy();
    if (!deferred || !deferred.repaymentStart) throw new Error('unreachable');
    expect(deferred.interestRate).toBe(0);
    expect(deferred.repaymentStart > '2026-09-22').toBe(true);
  });

  it('leaves active recurring templates scheduled in the future', () => {
    expect(data.recurringTemplates.length).toBeGreaterThan(0);
    data.recurringTemplates.forEach(t => {
      expect(t.active).toBe(true);
      expect(t.nextDate > '2026-09-22').toBe(true);
      expect(['weekly', 'biweekly', 'monthly', 'annual']).toContain(t.frequency);
    });
  });

  it('ships a Plan Ahead config that actually projects', () => {
    const plan = normalizePlan(data.settings.lifePlan);
    const snapshot = buildSnapshot(data, plan, { today: TODAY });
    const result = runPlan(plan, snapshot, { today: TODAY });
    // runPlan returns NeedsSetup instead of rows when the plan has no birth
    // year, so the outcome has to be narrowed before rows exist on it.
    expect(needsSetup(result)).toBeFalsy();
    if (needsSetup(result)) throw new Error('unreachable');
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('maps every investment into a life-plan account bucket', () => {
    const { lifePlan } = data.settings;
    expect(lifePlan).toBeDefined();
    if (!lifePlan) throw new Error('unreachable');
    data.investments.forEach(inv => {
      expect(lifePlan.accountMap[inv.id]).toBeTruthy();
    });
  });
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
