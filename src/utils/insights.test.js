import { describe, it, expect } from 'vitest';
import {
  getCategoryDeltas,
  isFixedTransaction,
  templateOccurrences,
  projectMonthEnd,
  forecastCashFlow,
  getCategoryAverages,
  getRecurringCosts,
  getSavingsOpportunities,
  simulateCuts,
  getGoalMonthlyContribution,
  goalTimelineImpact,
} from './insights';

const tx = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  date: '2026-03-15',
  merchant: 'Test',
  amount: 10,
  category: 'dining_out',
  isException: false,
  ...over,
});

// Local-time dates (month is 0-indexed).
const day = (y, m, d) => new Date(y, m, d);

describe('getCategoryDeltas', () => {
  it('compares a finished month against the previous month and trailing average', () => {
    const txns = [
      tx({ date: '2026-01-10', amount: 100 }),
      tx({ date: '2026-02-10', amount: 200 }),
      tx({ date: '2026-03-10', amount: 300 }),
      tx({ date: '2026-04-10', amount: 450 }),
    ];
    const { rows, totals, cutoffDay, historyMonths } = getCategoryDeltas(txns, 3, 2026, { today: day(2026, 5, 1) });
    expect(cutoffDay).toBeNull();
    expect(historyMonths).toBe(3);
    const r = rows.find(x => x.category === 'dining_out');
    expect(r.current).toBe(450);
    expect(r.previous).toBe(300);
    expect(r.average).toBe(200);
    expect(r.changeVsAverage).toBe(250);
    expect(r.pctVsPrevious).toBeCloseTo(50);
    expect(totals.current).toBe(450);
  });

  it('cuts comparison months at the same day when the month is in progress', () => {
    const txns = [
      tx({ date: '2026-02-05', amount: 50 }),
      tx({ date: '2026-02-25', amount: 500 }), // after the cutoff day — excluded
      tx({ date: '2026-03-04', amount: 80 }),
    ];
    const { rows, cutoffDay } = getCategoryDeltas(txns, 2, 2026, { today: day(2026, 2, 10) });
    expect(cutoffDay).toBe(10);
    expect(rows[0].previous).toBe(50);
    expect(rows[0].current).toBe(80);
  });

  it('ignores empty history months when averaging', () => {
    const txns = [tx({ date: '2026-02-10', amount: 90 }), tx({ date: '2026-03-10', amount: 100 })];
    const { rows, historyMonths } = getCategoryDeltas(txns, 2, 2026, { today: day(2026, 4, 1) });
    expect(historyMonths).toBe(1);
    expect(rows[0].average).toBe(90);
  });

  it('includes categories that dropped to zero', () => {
    const txns = [tx({ date: '2026-02-10', category: 'groceries', amount: 60 })];
    const { rows } = getCategoryDeltas(txns, 2, 2026, { today: day(2026, 4, 1) });
    expect(rows[0]).toMatchObject({ category: 'groceries', current: 0, changeVsPrevious: -60 });
  });
});

describe('isFixedTransaction / templateOccurrences', () => {
  const templates = [{ id: 'r1', merchant: 'Netflix', amount: 15, category: 'subscriptions', frequency: 'monthly', nextDate: '2026-03-20' }];

  it('treats template-posted or template-merchant transactions as fixed', () => {
    expect(isFixedTransaction(tx({ recurringTemplateId: 'x' }), [])).toBe(true);
    expect(isFixedTransaction(tx({ merchant: ' netflix ' }), templates)).toBe(true);
    expect(isFixedTransaction(tx({ merchant: 'Chipotle' }), templates)).toBe(false);
    expect(isFixedTransaction(tx({ merchant: 'Netflix' }), [{ ...templates[0], active: false }])).toBe(false);
  });

  it('enumerates future occurrences inside a window', () => {
    expect(templateOccurrences(templates[0], '2026-03-01', '2026-05-31')).toEqual(['2026-03-20', '2026-04-20', '2026-05-20']);
    const weekly = { ...templates[0], frequency: 'weekly', nextDate: '2026-03-02' };
    expect(templateOccurrences(weekly, '2026-03-01', '2026-03-31')).toHaveLength(5);
    expect(templateOccurrences({ ...templates[0], active: false }, '2026-03-01', '2026-03-31')).toEqual([]);
  });
});

describe('projectMonthEnd', () => {
  it('uses pace alone with no history, plus scheduled recurring charges', () => {
    const txns = [tx({ date: '2026-04-05', amount: 100 })];
    const templates = [{ id: 'r1', merchant: 'Gym', amount: 40, category: 'health', frequency: 'monthly', nextDate: '2026-04-25' }];
    const p = projectMonthEnd({ transactions: txns, recurringTemplates: templates, today: day(2026, 3, 10) });
    const dining = p.categories.find(c => c.category === 'dining_out');
    // 100 over 10 days → 10/day × 20 remaining days.
    expect(dining.projected).toBe(300);
    expect(p.categories.find(c => c.category === 'health').projected).toBe(40);
    expect(p.totals.projected).toBe(340);
    expect(p.confidence).toBe('low');
  });

  it('blends pace with history and flags budgets on track to be exceeded', () => {
    const txns = [
      tx({ date: '2026-01-10', amount: 300 }),
      tx({ date: '2026-02-10', amount: 300 }),
      tx({ date: '2026-03-10', amount: 300 }),
      tx({ date: '2026-04-10', amount: 300 }), // already at last months' full total
    ];
    const budgets = [{ id: 'b', category: 'dining_out', amount: 350, flex: 0 }];
    const p = projectMonthEnd({ transactions: txns, budgets, today: day(2026, 3, 15) });
    const dining = p.categories[0];
    // weight 0.5: pace 20/day, history 10/day → 15/day × 15 days = 225.
    expect(dining.projected).toBe(525);
    expect(dining.status).toBe('over');
    expect(dining.overBy).toBe(175);
    expect(p.warnings).toHaveLength(1);
    expect(p.confidence).toBe('high');
  });

  it('does not double-count recurring bills already posted', () => {
    const templates = [{ id: 'r1', merchant: 'Rent Co', amount: 1000, category: 'housing', frequency: 'monthly', nextDate: '2026-05-01' }];
    const txns = [tx({ date: '2026-04-01', merchant: 'Rent Co', amount: 1000, category: 'housing', recurringTemplateId: 'r1' })];
    const p = projectMonthEnd({ transactions: txns, recurringTemplates: templates, today: day(2026, 3, 5) });
    expect(p.categories.find(c => c.category === 'housing').projected).toBe(1000);
  });
});

describe('forecastCashFlow', () => {
  it('projects income minus scheduled and typical spend, with a range', () => {
    const txns = [
      tx({ date: '2026-02-10', amount: 400 }),
      tx({ date: '2026-03-10', amount: 600 }),
    ];
    const templates = [{ id: 'r1', merchant: 'Gym', amount: 50, category: 'health', frequency: 'monthly', nextDate: '2026-04-20' }];
    const f = forecastCashFlow({
      transactions: txns, incomes: [{ amount: 2000, frequency: 'monthly' }],
      recurringTemplates: templates, today: day(2026, 3, 10), months: 3,
    });
    expect(f.historyMonths).toBe(2);
    expect(f.discretionaryAverage).toBe(500);
    expect(f.discretionaryRange).toEqual([400, 600]);
    expect(f.rows.map(r => r.label)).toEqual(['May 2026', 'Jun 2026', 'Jul 2026']);
    expect(f.rows[0]).toMatchObject({ income: 2000, fixed: 50, net: 1450, cumulative: 1450, cumulativeRange: [1350, 1550] });
    expect(f.rows[2].cumulative).toBe(4350);
  });
});

describe('getCategoryAverages', () => {
  it('averages only months that have data', () => {
    const txns = [tx({ date: '2026-03-10', amount: 90 }), tx({ date: '2026-02-10', category: 'groceries', amount: 30 })];
    const a = getCategoryAverages(txns, { today: day(2026, 3, 10) });
    expect(a.months).toBe(2);
    expect(a.byCategory).toEqual({ dining_out: 45, groceries: 15 });
    expect(a.total).toBe(60);
  });
});

describe('getRecurringCosts', () => {
  it('merges templates with detected charges and annualizes', () => {
    const templates = [{ id: 'r1', merchant: 'Gym', amount: 10, category: 'health', frequency: 'weekly', nextDate: '2026-04-20' }];
    const txns = ['2026-01-05', '2026-02-05', '2026-03-05'].map(date => tx({ date, merchant: 'Spotify', amount: 12, category: 'subscriptions' }));
    const costs = getRecurringCosts(txns, templates);
    expect(costs.map(c => c.merchant)).toEqual(['Gym', 'Spotify']);
    expect(costs[1]).toMatchObject({ monthly: 12, annual: 144, source: 'detected' });
  });

  it('skips detected weekly habits but keeps weekly templates', () => {
    const txns = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'].map(date => tx({ date, merchant: 'Kroger', amount: 80, category: 'groceries' }));
    expect(getRecurringCosts(txns, [])).toEqual([]);
  });

  it('excludes savings transfers', () => {
    const txns = ['2026-01-10', '2026-02-10', '2026-03-10'].map(date => tx({ date, merchant: 'Transfer', amount: 200, kind: 'savings' }));
    expect(getRecurringCosts(txns, [])).toEqual([]);
  });
});

describe('getSavingsOpportunities', () => {
  const today = day(2026, 6, 10); // July 2026; recent window Apr–Jun, earlier Jan–Mar.

  it('returns nothing without history', () => {
    expect(getSavingsOpportunities({ transactions: [], today })).toEqual([]);
  });

  it('flags categories consistently over budget', () => {
    const txns = ['2026-04-10', '2026-05-10', '2026-06-10'].map(date => tx({ date, amount: 300 }));
    const budgets = [{ id: 'b', category: 'dining_out', amount: 200, flex: 0 }];
    const [first] = getSavingsOpportunities({ transactions: txns, budgets, today });
    expect(first).toMatchObject({ type: 'over_budget', category: 'dining_out', monthlySaving: 100, annualSaving: 1200, suggestedCutPct: 33 });
  });

  it('flags categories trending up versus the prior window', () => {
    const txns = [
      ...['2026-01-10', '2026-02-10', '2026-03-10'].map(date => tx({ date, category: 'products', amount: 100 })),
      ...['2026-04-10', '2026-05-10', '2026-06-10'].map(date => tx({ date, category: 'products', amount: 160 })),
    ];
    const ops = getSavingsOpportunities({ transactions: txns, today });
    expect(ops.find(o => o.type === 'trending_up')).toMatchObject({ category: 'products', monthlySaving: 60 });
  });

  it('flags frequent small purchases at one merchant', () => {
    const txns = [];
    ['04', '05', '06'].forEach(m => { for (let d = 1; d <= 5; d++) txns.push(tx({ date: `2026-${m}-0${d}`, merchant: 'Starbucks', amount: 6 })); });
    const small = getSavingsOpportunities({ transactions: txns, today }).find(o => o.type === 'frequent_small');
    expect(small).toMatchObject({ merchant: 'Starbucks', perMonth: 5, monthlySpend: 30, monthlySaving: 15 });
  });

  it('flags recurring price increases and lists recurring costs last', () => {
    const txns = [
      ['2026-03-05', 10], ['2026-04-05', 10], ['2026-05-05', 10], ['2026-06-05', 13],
    ].map(([date, amount]) => tx({ date, merchant: 'StreamCo', amount, category: 'subscriptions' }));
    const ops = getSavingsOpportunities({ transactions: txns, today });
    expect(ops.find(o => o.type === 'price_increase')).toMatchObject({ merchant: 'StreamCo', before: 10, after: 13, monthlySaving: 3 });
    expect(ops[ops.length - 1].type).toBe('recurring_review');
  });

  it('reports the old price, not an average spanning the change', () => {
    const txns = [
      ['2026-03-05', 10], ['2026-04-05', 10], ['2026-05-05', 13], ['2026-06-05', 13],
    ].map(([date, amount]) => tx({ date, merchant: 'StreamCo', amount, category: 'subscriptions' }));
    const inc = getSavingsOpportunities({ transactions: txns, today }).find(o => o.type === 'price_increase');
    expect(inc).toMatchObject({ before: 10, after: 13 });
  });

  it('ignores price changes that happened before the window', () => {
    const txns = [
      ['2026-01-05', 10], ['2026-02-05', 13], ['2026-03-05', 13], ['2026-04-05', 13], ['2026-05-05', 13], ['2026-06-05', 13],
    ].map(([date, amount]) => tx({ date, merchant: 'StreamCo', amount, category: 'subscriptions' }));
    expect(getSavingsOpportunities({ transactions: txns, today }).find(o => o.type === 'price_increase')).toBeUndefined();
  });
});

describe('simulateCuts', () => {
  it('computes savings and new savings rate', () => {
    const r = simulateCuts({ dining_out: 400, groceries: 600 }, { dining_out: 25 }, 2000);
    expect(r).toMatchObject({ currentSpend: 1000, newSpend: 900, monthlySaving: 100, annualSaving: 1200, currentRate: 50, newRate: 55 });
    expect(simulateCuts({ a: 10 }, {}, 0).newRate).toBeNull();
  });
});

describe('goal timeline', () => {
  const goal = { id: 'g1', targetAmount: 1000, currentAmount: 100 };
  const txns = [
    tx({ kind: 'savings', goalId: 'g1', date: '2026-05-10', amount: 150 }),
    tx({ kind: 'savings', goalId: 'g1', date: '2026-06-10', amount: 150 }),
    tx({ kind: 'savings', goalId: 'g1', date: '2026-01-10', amount: 999 }), // outside window
  ];
  const opts = { today: day(2026, 6, 10) };

  it('averages contributions over the trailing window', () => {
    expect(getGoalMonthlyContribution(txns.slice(0, 2), 'g1', opts)).toBe(100);
  });

  it('shows how extra monthly savings shortens the timeline', () => {
    const r = goalTimelineImpact(goal, txns.slice(0, 2), 100, opts);
    expect(r.remaining).toBe(600);
    expect(r.currentMonths).toBe(6);
    expect(r.newMonths).toBe(3);
    expect(goalTimelineImpact({ id: 'g2', targetAmount: 500, currentAmount: 0 }, [], 0, opts).currentMonths).toBeNull();
  });
});
