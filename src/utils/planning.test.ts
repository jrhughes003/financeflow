import { describe, it, expect } from 'vitest';
import {
  percentile, getBudgetSuggestions, applyBudgetSuggestion, getGoalStatuses,
  simulateDebtPayoff, compareDebtStrategies,
} from './planning';
import { calculateDebtPayoff } from './calculations';
import { makeBudget, makeDebt, makeGoal, makeTransaction } from '../test/factories';
import type { IsoDate, Money, Transaction } from '../types/domain';

const tx = (over: Partial<Transaction> = {}): Transaction => makeTransaction({
  id: Math.random().toString(36).slice(2),
  date: '2026-03-15', merchant: 'Test', amount: 10, category: 'dining_out', isException: false,
  ...over,
});
const day = (y: number, m: number, d: number) => new Date(y, m, d);
// Monthly spending for Jan–Jun 2026 in one category.
const monthly = (category: string, amounts: Money[]): Transaction[] => amounts.map((amount, i) =>
  tx({ date: `2026-0${i + 1}-10`, category, amount }));
const JULY = day(2026, 6, 10);

describe('percentile', () => {
  it('interpolates', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 0.75)).toBe(40);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('getBudgetSuggestions', () => {
  it('needs enough history', () => {
    const r = getBudgetSuggestions([], monthly('groceries', [0, 0, 0, 0, 300, 300]).filter(t => t.amount), { today: JULY });
    expect(r).toMatchObject({ insufficient: true, months: 2, suggestions: [] });
  });

  it('suggests raising a budget that is blown most months', () => {
    const txns = monthly('groceries', [380, 400, 420, 390, 410, 405]);
    const budgets = [makeBudget({ id: 'b1', category: 'groceries', amount: 300, flex: 10 })];
    const [s] = getBudgetSuggestions(budgets, txns, { today: JULY }).suggestions;
    expect(s).toMatchObject({ type: 'raise', budgetId: 'b1', current: 300, overMonths: 6, suggested: 410 });
  });

  it('suggests lowering a budget that is never close', () => {
    const txns = monthly('products', [90, 100, 110, 95, 105, 100]);
    const budgets = [makeBudget({ id: 'b2', category: 'products', amount: 300, flex: 10 })];
    const [s] = getBudgetSuggestions(budgets, txns, { today: JULY }).suggestions;
    expect(s).toMatchObject({ type: 'lower', current: 300, suggested: 100, freed: 200 });
  });

  it('suggests adding a budget for regular unbudgeted spending, incl. $0 placeholders', () => {
    const txns = [...monthly('transportation', [60, 70, 80, 65, 75, 70]), ...monthly('groceries', [300, 300, 300, 300, 300, 300])];
    const budgets = [makeBudget({ id: 'b3', category: 'groceries', amount: 0, flex: 10 })];
    const { suggestions } = getBudgetSuggestions(budgets, txns, { today: JULY });
    expect(suggestions.map(s => [s.category, s.type])).toEqual([['groceries', 'add'], ['transportation', 'add']]);
    expect(suggestions[0].budgetId).toBe('b3');
  });

  it('smooths periodic bills into a monthly share instead of inflating a typical month', () => {
    const txns = [
      ...monthly('transportation', [200, 200, 200, 200, 200, 200]),
      tx({ date: '2025-10-15', merchant: 'GEICO', amount: 600, category: 'transportation' }),
      tx({ date: '2026-04-15', merchant: 'GEICO', amount: 600, category: 'transportation' }),
    ];
    const unbudgeted = getBudgetSuggestions([], txns, { today: JULY }).suggestions[0];
    expect(unbudgeted).toMatchObject({ type: 'add', high: 200, billShare: 100, suggested: 300 });
    expect(unbudgeted.bills).toEqual([{ merchant: 'GEICO', amount: 600, frequency: 'semiannual' }]);

    const tight = getBudgetSuggestions([makeBudget({ id: 'b', category: 'transportation', amount: 250, flex: 0 })], txns, { today: JULY }).suggestions[0];
    expect(tight).toMatchObject({ type: 'raise', overMonths: 6, suggested: 300, rollover: false });
  });

  it('leaves well-calibrated budgets alone', () => {
    const txns = monthly('groceries', [280, 300, 290, 310, 295, 305]);
    const budgets = [makeBudget({ id: 'b1', category: 'groceries', amount: 320, flex: 10 })];
    expect(getBudgetSuggestions(budgets, txns, { today: JULY }).suggestions).toEqual([]);
  });

  it('builds the budget to save', () => {
    const budgets = [makeBudget({ id: 'b1', category: 'groceries', amount: 300, flex: 5, rollover: true })];
    expect(applyBudgetSuggestion({ budgetId: 'b1', category: 'groceries', suggested: 410 }, budgets))
      .toEqual({ id: 'b1', category: 'groceries', amount: 410, flex: 5, rollover: true });
    expect(applyBudgetSuggestion({ budgetId: null, category: 'transportation', suggested: 80 }, budgets, { now: 1 }))
      .toEqual({ id: 'b_1', category: 'transportation', amount: 80, flex: 10, rollover: false });
  });
});

describe('getGoalStatuses', () => {
  const today = day(2026, 6, 10);
  const savings = (amount: Money, date: IsoDate, goalId = 'g1') => tx({ kind: 'savings', goalId, amount, date });

  it('is on track when actual pace covers what is required', () => {
    const goal = makeGoal({ id: 'g1', targetAmount: 1600, currentAmount: 0, monthlyContribution: 100, targetDate: '2027-01-15' });
    const txns = [savings(200, '2026-05-10'), savings(200, '2026-06-10'), savings(200, '2026-07-05')];
    const [s] = getGoalStatuses([goal], txns, { today });
    // 1000 left over 6 months → ~166.67 needed; averaging 200.
    expect(s).toMatchObject({ status: 'on_track', paceSource: 'actual', actual: 200, remaining: 1000, monthsLeft: 6 });
    expect(s.required).toBeCloseTo(166.67);
  });

  it('is behind (with shortfall and lateness) when pace is too slow', () => {
    const goal = makeGoal({ id: 'g1', targetAmount: 1200, currentAmount: 0, monthlyContribution: 100, targetDate: '2026-12-01' });
    const [s] = getGoalStatuses([goal], [], { today });
    // No contributions logged → uses the planned 100/mo; needs 240/mo.
    expect(s).toMatchObject({ status: 'behind', paceSource: 'planned', required: 240, shortfall: 140, monthsLate: 7 });
  });

  it('handles reached, past-due, stalled, and no-target goals', () => {
    const goals = [
      makeGoal({ id: 'a', targetAmount: 100, currentAmount: 100, targetDate: '2027-01-01' }),
      makeGoal({ id: 'b', targetAmount: 500, currentAmount: 0, monthlyContribution: 50, targetDate: '2026-05-01' }),
      makeGoal({ id: 'c', targetAmount: 500, currentAmount: 0, monthlyContribution: 0, targetDate: '2027-05-01' }),
      // The no-target case. getGoalStatuses only tests targetDate for truthiness,
      // so an empty string stands in for the field being absent.
      makeGoal({ id: 'd', targetAmount: 500, currentAmount: 0, monthlyContribution: 50, targetDate: '' }),
    ];
    expect(getGoalStatuses(goals, [], { today }).map(s => s.status)).toEqual(['reached', 'past_due', 'stalled', 'no_target']);
  });
});

describe('simulateDebtPayoff', () => {
  const debts = [
    makeDebt({ id: 'card', name: 'Card', balance: 3000, interestRate: 24, minimumPayment: 90 }),
    makeDebt({ id: 'car', name: 'Car', balance: 1000, interestRate: 6, minimumPayment: 50 }),
  ];

  it('matches the closed-form payoff for a single debt at its minimum', () => {
    const single = [makeDebt({ id: 'x', name: 'X', balance: 5000, interestRate: 18, minimumPayment: 200 })];
    const sim = simulateDebtPayoff(single, { strategy: 'minimum' });
    const closed = calculateDebtPayoff(5000, 18, 200);
    expect(closed).not.toBeNull();
    if (!closed || closed.totalInterest === null) throw new Error('unreachable');
    expect(sim.months).toBe(closed.months);
    // The closed form assumes a full final payment, so it overstates interest by
    // less than one payment; the simulation pays only what's left.
    const overstatement = closed.totalInterest - sim.totalInterest;
    expect(overstatement).toBeGreaterThanOrEqual(0);
    expect(overstatement).toBeLessThan(200);
  });

  it('avalanche targets highest APR first; snowball smallest balance first', () => {
    const av = simulateDebtPayoff(debts, { strategy: 'avalanche', extra: 100 });
    const sb = simulateDebtPayoff(debts, { strategy: 'snowball', extra: 100 });
    expect(sb.payoffs[0].id).toBe('car');
    expect(av.totalInterest).toBeLessThan(sb.totalInterest);
    expect(av.feasible && sb.feasible).toBe(true);
  });

  it('extra payments and rollover beat minimums', () => {
    const min = simulateDebtPayoff(debts, { strategy: 'minimum' });
    const av = simulateDebtPayoff(debts, { strategy: 'avalanche', extra: 100 });
    expect(min.months).not.toBeNull();
    if (min.months === null) throw new Error('unreachable');
    expect(av.months).toBeLessThan(min.months);
    expect(av.totalInterest).toBeLessThan(min.totalInterest);
    expect(av.timeline[av.timeline.length - 1].balance).toBe(0);
  });

  it('flags debts whose minimum never covers the interest', () => {
    const bad = [makeDebt({ id: 'x', name: 'X', balance: 10000, interestRate: 24, minimumPayment: 150 })];
    const sim = simulateDebtPayoff(bad, { strategy: 'minimum' });
    expect(sim.feasible).toBe(false);
    expect(sim.unpayable).toEqual([{ id: 'x', name: 'X' }]);
    // …but extra money can fix it.
    expect(simulateDebtPayoff(bad, { strategy: 'avalanche', extra: 200 }).feasible).toBe(true);
  });

  it('waits for deferred loans to start, then pays them', () => {
    const today = new Date(2026, 8, 22);
    const loans = [makeDebt({ id: 's', name: 'Student', balance: 1200, interestRate: 0, minimumPayment: 100, repaymentStart: '2027-06-01' })];
    const min = simulateDebtPayoff(loans, { strategy: 'minimum', today });
    // Nothing due for 9 months, then 12 payments of $100 at 0%.
    expect(min).toMatchObject({ feasible: true, months: 20, totalInterest: 0, totalPaid: 1200 });
    expect(min.timeline[8].balance).toBe(1200);
    // Extra money can't go to it before repayment starts.
    const av = simulateDebtPayoff(loans, { strategy: 'avalanche', extra: 500, today });
    expect(av.timeline[8].balance).toBe(1200);
    expect(av.months).toBe(10); // month 9 pays 600, month 10 the rest
  });

  it('pays active debts while another is deferred, then rolls into it', () => {
    const today = new Date(2026, 8, 22);
    const debts = [
      makeDebt({ id: 'c', name: 'Card', balance: 500, interestRate: 0, minimumPayment: 100 }),
      makeDebt({ id: 's', name: 'Student', balance: 1000, interestRate: 0, minimumPayment: 100, repaymentStart: '2027-06-01' }),
    ];
    const av = simulateDebtPayoff(debts, { strategy: 'avalanche', today });
    // Card gone in month 5; from month 9 the student loan gets its own $100 plus
    // the card's rolled-over $100 → $200/mo → paid off in month 13.
    expect(av.payoffs.map(p => [p.id, p.month])).toEqual([['c', 5], ['s', 13]]);
  });

  it('returns an empty plan with no debts', () => {
    expect(simulateDebtPayoff([], {})).toMatchObject({ feasible: true, months: 0, payoffs: [] });
  });
});

describe('compareDebtStrategies', () => {
  it('recommends avalanche and reports savings vs minimums', () => {
    const debts = [
      makeDebt({ id: 'card', name: 'Card', balance: 3000, interestRate: 24, minimumPayment: 90 }),
      makeDebt({ id: 'loan', name: 'Loan', balance: 2500, interestRate: 8, minimumPayment: 80 }),
    ];
    const r = compareDebtStrategies(debts, { extra: 150 });
    expect(r.recommended).toBe('avalanche');
    expect(r.interestSaved).toBeGreaterThan(0);
    expect(r.monthsSaved).toBeGreaterThan(0);
  });

  it('prefers snowball when it costs almost nothing extra and wins sooner', () => {
    const debts = [
      makeDebt({ id: 'a', name: 'A', balance: 5000, interestRate: 10.1, minimumPayment: 100 }),
      makeDebt({ id: 'b', name: 'B', balance: 300, interestRate: 10, minimumPayment: 25 }),
    ];
    expect(compareDebtStrategies(debts, { extra: 100 }).recommended).toBe('snowball');
  });
});
