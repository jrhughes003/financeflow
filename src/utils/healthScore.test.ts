import { describe, it, expect } from 'vitest';
import { getFinancialHealth, getHealthTrend, healthLabel } from './healthScore';

const tx = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  date: '2026-03-15', merchant: 'Test', amount: 10, category: 'dining_out', isException: false,
  ...over,
});
const ref = new Date(2026, 6, 10); // July 2026 → uses Jan–Jun
const monthlySpend = amounts => amounts.map((amount, i) => tx({ date: `2026-0${i + 1}-10`, amount }));
const byKey = r => Object.fromEntries(r.components.map(c => [c.key, c]));

describe('getFinancialHealth', () => {
  it('returns no score without spending history', () => {
    const r = getFinancialHealth({ incomes: [{ amount: 3000, frequency: 'monthly' }], debts: [] }, { ref });
    expect(r.score).toBeNull();
    expect(r.label).toBe('Not enough data');
  });

  it('scores each part and combines them by weight', () => {
    const state = {
      transactions: [
        ...monthlySpend([2000, 2000, 2000, 2000, 2000, 2000]),
        tx({ kind: 'savings', goalId: 'g1', date: '2026-02-01', amount: 2000 }),
      ],
      incomes: [{ amount: 2500, frequency: 'monthly' }],
      budgets: [{ id: 'b', category: 'dining_out', amount: 2100, flex: 0 }],
      savings_goals: [{ id: 'g1', currentAmount: 4000, targetAmount: 20000 }],
      debts: [{ id: 'd', balance: 5000, minimumPayment: 250 }],
    };
    const r = getFinancialHealth(state, { ref });
    const c = byKey(r);
    expect(c.savings).toMatchObject({ score: 100, value: '20%' });   // (2500−2000)/2500
    expect(c.budgets).toMatchObject({ score: 100 });
    expect(c.emergency).toMatchObject({ score: 50, value: '3.0 mo' }); // 6000 / 2000
    expect(c.debt).toMatchObject({ score: 75, value: '10%' });        // 250 / 2500
    expect(c.stability.score).toBe(100);
    // (100·25 + 100·20 + 50·20 + 75·20 + 100·15) / 100
    expect(r.score).toBe(85);
    expect(r.label).toBe('Excellent');
  });

  it('rescales weights around unavailable parts and gives tips', () => {
    const state = {
      transactions: monthlySpend([0, 0, 0, 0, 3000, 3000]).filter(t => t.amount),
      incomes: [{ amount: 3000, frequency: 'monthly' }],
      budgets: [], savings_goals: [], debts: [],
    };
    const r = getFinancialHealth(state, { ref });
    const c = byKey(r);
    expect(c.budgets.available).toBe(false);
    expect(c.stability.available).toBe(false);
    expect(c.savings.score).toBe(0);
    expect(c.savings.tip).toMatch(/\$600 less per month/);
    expect(c.emergency.tip).toMatch(/\$9,000 more gets you to 3 months/);
    // savings 0·25 + emergency 0·20 + debt 100·20 over weight 65
    expect(r.score).toBe(31);
  });
});

describe('getHealthTrend', () => {
  it('returns one score per month, oldest first, ending at the current score', () => {
    const state = {
      transactions: monthlySpend([1000, 1000, 1000, 1000, 1000, 1000]),
      incomes: [{ amount: 2000, frequency: 'monthly' }],
      budgets: [], savings_goals: [], debts: [],
    };
    const trend = getHealthTrend(state, { today: ref, months: 3 });
    expect(trend.map(t => t.label)).toEqual(['Apr', 'May', 'Jun']);
    expect(trend[2].score).toBe(getFinancialHealth(state, { ref }).score);
  });
});

describe('healthLabel', () => {
  it('maps score bands', () => {
    expect(healthLabel(85).label).toBe('Excellent');
    expect(healthLabel(65).label).toBe('Good');
    expect(healthLabel(45).label).toBe('Fair');
    expect(healthLabel(10).label).toBe('Needs work');
  });
});
