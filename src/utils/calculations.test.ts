import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  toMonthlyAmount,
  getTotalIncome,
  getTransactionsForPeriod,
  getTotalExpenses,
  getSpendingByCategory,
  getBudgetStatus,
  getSavingsRate,
  getNetWorth,
  getBudgetHealthScore,
  detectAnomalies,
  projectGoalCompletion,
  getTopMerchants,
  getSpendingByDayOfWeek,
  calculateDebtPayoff,
  getMonthlyTrend,
  getRolloverCarry,
  getGoalContributions,
  getGoalProgress,
  getConsistentlyOverBudget,
} from './calculations';
import { makeBudget, makeDebt, makeGoal, makeIncome, makeInvestment, makeTransaction } from '../test/factories';
import type { IncomeFrequency, Transaction } from '../types/domain';

// Helper: build a transaction with sane defaults.
const tx = (over: Partial<Transaction> = {}): Transaction => makeTransaction({
  id: Math.random().toString(36).slice(2),
  date: '2026-03-15',
  merchant: 'Test',
  amount: 10,
  category: 'dining_out',
  subcategory: '',
  notes: '',
  tags: [],
  isException: false,
  ...over,
});

// March 2026 is month index 2.
const MARCH = { month: 2, year: 2026 };

describe('toMonthlyAmount', () => {
  it('normalizes each frequency to a monthly figure', () => {
    expect(toMonthlyAmount(100, 'weekly')).toBeCloseTo(100 * 52 / 12);
    expect(toMonthlyAmount(100, 'biweekly')).toBeCloseTo(100 * 26 / 12);
    expect(toMonthlyAmount(100, 'semi-monthly')).toBe(200);
    expect(toMonthlyAmount(100, 'monthly')).toBe(100);
    expect(toMonthlyAmount(1200, 'annual')).toBe(100);
    // A frequency outside the union — the case exists to cover the default branch.
    expect(toMonthlyAmount(100, 'unknown' as IncomeFrequency)).toBe(100); // default passthrough
  });
});

describe('getTotalIncome', () => {
  it('sums monthly-equivalent income across sources', () => {
    const incomes = [
      makeIncome({ amount: 1000, frequency: 'monthly' }),
      makeIncome({ id: 'i2', amount: 1200, frequency: 'annual' }), // -> 100/mo
    ];
    expect(getTotalIncome(incomes)).toBeCloseTo(1100);
  });
  it('returns 0 for no income', () => {
    expect(getTotalIncome([])).toBe(0);
  });
});

describe('getTransactionsForPeriod', () => {
  const txns = [
    tx({ date: '2026-02-28', amount: 1 }),
    tx({ date: '2026-03-01', amount: 2 }),
    tx({ date: '2026-03-31', amount: 3 }),
    tx({ date: '2026-04-01', amount: 4 }),
  ];

  it('includes only transactions within the month (string-boundary safe)', () => {
    const result = getTransactionsForPeriod(txns, MARCH.month, MARCH.year);
    expect(result.map(t => t.amount).sort()).toEqual([2, 3]);
  });

  it('returns all transactions when month/year omitted', () => {
    expect(getTransactionsForPeriod(txns).length).toBe(4);
  });

  it('excludes transactions flagged as exceptions', () => {
    const withException = [...txns, tx({ date: '2026-03-15', amount: 99, isException: true })];
    const result = getTransactionsForPeriod(withException, MARCH.month, MARCH.year);
    expect(result.find(t => t.amount === 99)).toBeUndefined();
  });

  it('handles a date with a time/timezone suffix by taking the YYYY-MM-DD slice', () => {
    const result = getTransactionsForPeriod(
      [tx({ date: '2026-03-01T23:00:00.000Z', amount: 7 })],
      MARCH.month, MARCH.year,
    );
    expect(result.map(t => t.amount)).toEqual([7]);
  });
});

describe('getTotalExpenses', () => {
  it('sums the period and rounds to cents (no float drift)', () => {
    const txns = [tx({ amount: 0.1 }), tx({ amount: 0.2 })];
    expect(getTotalExpenses(txns, MARCH.month, MARCH.year)).toBe(0.3);
  });
});

describe('getSpendingByCategory', () => {
  it('groups and rounds per category', () => {
    const txns = [
      tx({ category: 'dining_out', amount: 10.1 }),
      tx({ category: 'dining_out', amount: 0.2 }),
      tx({ category: 'groceries', amount: 5 }),
    ];
    expect(getSpendingByCategory(txns, MARCH.month, MARCH.year)).toEqual({
      dining_out: 10.3,
      groceries: 5,
    });
  });
});

describe('getBudgetStatus', () => {
  const budgets = [makeBudget({ id: 'b1', category: 'dining_out', amount: 100, flex: 10, rollover: false })];

  it('flags good when under 80%', () => {
    const txns = [tx({ amount: 50 })];
    const [s] = getBudgetStatus(budgets, txns, MARCH.month, MARCH.year);
    expect(s.status).toBe('good');
    expect(s.variance).toBe(50);
    expect(s.percentUsed).toBe(50);
  });

  it('flags warning at/above 80% but within flex', () => {
    const txns = [tx({ amount: 85 })];
    const [s] = getBudgetStatus(budgets, txns, MARCH.month, MARCH.year);
    expect(s.status).toBe('warning');
  });

  it('flags danger above the flex limit', () => {
    const txns = [tx({ amount: 120 })]; // flexLimit = 110
    const [s] = getBudgetStatus(budgets, txns, MARCH.month, MARCH.year);
    expect(s.status).toBe('danger');
    expect(s.flexLimit).toBeCloseTo(110);
  });

  it('handles a zero budget amount without dividing by zero', () => {
    const [s] = getBudgetStatus(
      [makeBudget({ id: 'b1', category: 'dining_out', amount: 0, flex: 10 })],
      [tx({ amount: 5 })], MARCH.month, MARCH.year,
    );
    expect(s.percentUsed).toBe(0);
    expect(s.status).toBe('danger'); // 5 > flexLimit of 0
  });
});

describe('budget rollover', () => {
  // Budget $100; spent $60 in Feb → $40 unused carries into March.
  const txns = [
    tx({ date: '2026-02-10', amount: 60 }),
    tx({ date: '2026-03-10', amount: 0.01 }),
  ];

  it('carries prior-month unused budget when rollover is on', () => {
    const b = makeBudget({ id: 'b1', category: 'dining_out', amount: 100, flex: 0, rollover: true });
    expect(getRolloverCarry(b, txns, MARCH.month, MARCH.year)).toBe(40);
    const [s] = getBudgetStatus([b], txns, MARCH.month, MARCH.year);
    expect(s.effectiveBudget).toBe(140);
    expect(s.carry).toBe(40);
  });

  it('carries a negative amount when the prior month overspent', () => {
    const over = [tx({ date: '2026-02-10', amount: 130 }), tx({ date: '2026-03-10', amount: 10 })];
    const b = makeBudget({ id: 'b1', category: 'dining_out', amount: 100, flex: 0, rollover: true });
    expect(getRolloverCarry(b, over, MARCH.month, MARCH.year)).toBe(-30);
    const [s] = getBudgetStatus([b], over, MARCH.month, MARCH.year);
    expect(s.effectiveBudget).toBe(70);
  });

  it('does not carry when rollover is off (back-compat)', () => {
    const b = makeBudget({ id: 'b1', category: 'dining_out', amount: 100, flex: 0, rollover: false });
    expect(getRolloverCarry(b, txns, MARCH.month, MARCH.year)).toBe(0);
    const [s] = getBudgetStatus([b], txns, MARCH.month, MARCH.year);
    expect(s.effectiveBudget).toBe(100);
  });

  it('clamps a large prior overage so the effective budget never goes negative', () => {
    const over = [tx({ date: '2026-02-10', amount: 500 }), tx({ date: '2026-03-10', amount: 5 })];
    const b = makeBudget({ id: 'b1', category: 'dining_out', amount: 100, flex: 0, rollover: true });
    const [s] = getBudgetStatus([b], over, MARCH.month, MARCH.year);
    expect(s.effectiveBudget).toBe(0);
    expect(s.status).toBe('danger');
  });
});

describe('savings goal contributions', () => {
  const txns = [
    tx({ kind: 'savings', goalId: 'g1', amount: 100 }),
    tx({ kind: 'savings', goalId: 'g1', amount: 50 }),
    tx({ kind: 'savings', goalId: 'g2', amount: 25 }), // different goal
    tx({ kind: 'expense', goalId: 'g1', amount: 999 }), // not a savings tx
  ];

  it('sums only savings transactions linked to the goal', () => {
    expect(getGoalContributions(txns, 'g1')).toBe(150);
    expect(getGoalContributions(txns, 'g2')).toBe(25);
    expect(getGoalContributions(txns, 'missing')).toBe(0);
  });

  it('derives progress from opening balance + contributions', () => {
    const goal = makeGoal({ id: 'g1', targetAmount: 600, currentAmount: 150 }); // 150 opening
    const p = getGoalProgress(goal, txns);
    expect(p.opening).toBe(150);
    expect(p.contributed).toBe(150);
    expect(p.currentAmount).toBe(300);
    expect(p.percent).toBeCloseTo(50);
  });
});

describe('getConsistentlyOverBudget', () => {
  it('flags categories over budget in >= 2 of the last 3 months', () => {
    const budgets = [makeBudget({ id: 'b1', category: 'dining_out', amount: 100, flex: 0 })];
    // Dec & Jan & Feb each spend $200 (danger); March is the current month.
    const txns = [
      tx({ date: '2025-12-10', amount: 200 }),
      tx({ date: '2026-01-10', amount: 200 }),
      tx({ date: '2026-02-10', amount: 200 }),
    ];
    const over = getConsistentlyOverBudget(budgets, txns, MARCH.month, MARCH.year);
    expect(over.map(b => b.category)).toEqual(['dining_out']);
  });

  it('does not flag a single over-budget month', () => {
    const budgets = [makeBudget({ id: 'b1', category: 'dining_out', amount: 100, flex: 0 })];
    const txns = [tx({ date: '2026-02-10', amount: 200 })];
    expect(getConsistentlyOverBudget(budgets, txns, MARCH.month, MARCH.year)).toEqual([]);
  });
});

describe('detectAnomalies options', () => {
  it('respects an overridden multiplier from settings', () => {
    // 3-month avg = $50; current $80 is 1.6x — above a 1.5x threshold, below 2x.
    const txns = [
      tx({ date: '2025-12-10', amount: 50 }),
      tx({ date: '2026-01-10', amount: 50 }),
      tx({ date: '2026-02-10', amount: 50 }),
      tx({ date: '2026-03-10', amount: 80 }),
    ];
    expect(detectAnomalies(txns, MARCH.month, MARCH.year)).toEqual([]); // default 2x
    const alerts = detectAnomalies(txns, MARCH.month, MARCH.year, { multiplier: 1.5 });
    expect(alerts).toHaveLength(1);
  });
});

describe('getSavingsRate', () => {
  it('computes (income - expenses) / income * 100', () => {
    const incomes = [makeIncome({ amount: 1000, frequency: 'monthly' })];
    const txns = [tx({ amount: 250 })];
    expect(getSavingsRate(incomes, txns, MARCH.month, MARCH.year)).toBeCloseTo(75);
  });
  it('never goes negative and returns 0 with no income', () => {
    const incomes = [makeIncome({ amount: 100, frequency: 'monthly' })];
    const txns = [tx({ amount: 500 })];
    expect(getSavingsRate(incomes, txns, MARCH.month, MARCH.year)).toBe(0);
    expect(getSavingsRate([], txns, MARCH.month, MARCH.year)).toBe(0);
  });
});

describe('getNetWorth', () => {
  it('is assets (investments + goal balances) minus debts', () => {
    const investments = [makeInvestment({ currentValue: 1000 })];
    const goals = [makeGoal({ currentAmount: 500 })];
    const debts = [makeDebt({ balance: 300 })];
    expect(getNetWorth(investments, debts, goals)).toBe(1200);
  });
});

describe('getBudgetHealthScore', () => {
  it('returns N/A with no budgets', () => {
    expect(getBudgetHealthScore([], [], MARCH.month, MARCH.year).grade).toBe('N/A');
  });
  it('grades A when all categories are within budget', () => {
    const budgets = [makeBudget({ id: 'b1', category: 'dining_out', amount: 100, flex: 10 })];
    const result = getBudgetHealthScore(budgets, [tx({ amount: 10 })], MARCH.month, MARCH.year);
    expect(result.grade).toBe('A');
    expect(result.percent).toBe(100);
  });
});

describe('detectAnomalies', () => {
  it('flags a category spending well above its 3-month average', () => {
    const txns = [
      // 3 prior months ~ $50 each in dining_out
      tx({ date: '2025-12-10', amount: 50 }),
      tx({ date: '2026-01-10', amount: 50 }),
      tx({ date: '2026-02-10', amount: 50 }),
      // current month spikes to $200 (4x avg)
      tx({ date: '2026-03-10', amount: 200 }),
    ];
    const alerts = detectAnomalies(txns, MARCH.month, MARCH.year);
    expect(alerts.length).toBe(1);
    expect(alerts[0].category).toBe('dining_out');
    expect(alerts[0].ratio).toBeCloseTo(4);
  });

  it('does not flag small categories below the minimum-average floor', () => {
    const txns = [
      tx({ date: '2026-02-10', amount: 3 }),
      tx({ date: '2026-03-10', amount: 9 }), // 3x but avg is only $1
    ];
    expect(detectAnomalies(txns, MARCH.month, MARCH.year)).toEqual([]);
  });
});

describe('projectGoalCompletion', () => {
  it('returns months remaining for a positive contribution', () => {
    const goal = makeGoal({ targetAmount: 1000, currentAmount: 400 });
    const projected = projectGoalCompletion(goal, 100);
    expect(projected).not.toBeNull();
    if (!projected) throw new Error('unreachable');
    expect(projected.months).toBe(6);
  });
  it('returns null when already met or contribution is non-positive', () => {
    expect(projectGoalCompletion(makeGoal({ targetAmount: 100, currentAmount: 100 }), 50)).toBeNull();
    expect(projectGoalCompletion(makeGoal({ targetAmount: 100, currentAmount: 0 }), 0)).toBeNull();
  });
});

describe('getTopMerchants', () => {
  it('ranks merchants by total spend and respects the limit', () => {
    const txns = [
      tx({ merchant: 'A', amount: 10 }),
      tx({ merchant: 'A', amount: 5 }),
      tx({ merchant: 'B', amount: 100 }),
      tx({ merchant: 'C', amount: 1 }),
    ];
    const top = getTopMerchants(txns, 2);
    expect(top.map(m => m.merchant)).toEqual(['B', 'A']);
    expect(top[1]).toMatchObject({ total: 15, count: 2 });
  });
});

describe('getSpendingByDayOfWeek', () => {
  it('buckets spending into the 7 weekdays', () => {
    // 2026-03-15 is a Sunday.
    const result = getSpendingByDayOfWeek([tx({ date: '2026-03-15', amount: 20 })]);
    expect(result).toHaveLength(7);
    expect(result[0]).toMatchObject({ name: 'Sun', total: 20, count: 1, avg: 20 });
  });
});

describe('calculateDebtPayoff', () => {
  it('returns null for a non-positive payment', () => {
    expect(calculateDebtPayoff(1000, 5, 0)).toBeNull();
  });
  it('handles zero-interest debt with simple division', () => {
    expect(calculateDebtPayoff(1000, 0, 100)).toEqual({ months: 10, totalInterest: 0 });
  });
  it('amortizes interest-bearing debt', () => {
    const result = calculateDebtPayoff(1000, 12, 100);
    expect(result).not.toBeNull();
    if (!result) throw new Error('unreachable');
    expect(result.months).toBeGreaterThan(10);
    expect(result.totalInterest).toBeGreaterThan(0);
  });
});

describe('getMonthlyTrend', () => {
  it('returns the requested number of months with labels and totals', () => {
    const trend = getMonthlyTrend([tx({ amount: 10 })], 6);
    expect(trend).toHaveLength(6);
    trend.forEach(m => {
      expect(m).toHaveProperty('label');
      expect(m).toHaveProperty('total');
    });
  });
});

describe('formatCurrency', () => {
  it('formats USD and treats nullish as zero', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    // Declared to take a number, and kept that way so callers holding a
    // `number | undefined` still have to deal with it. The `amount || 0` guard
    // is for values that reach a formatter from disk; the cast pins the guard.
    expect(formatCurrency(null as unknown as number)).toBe('$0.00');
  });
});
