// Month adjustments, outside-budget categories, retired-category redirects and
// trips: the pieces that let a ledger replace its categories without the
// budget screens lying about it.
import { describe, it, expect } from 'vitest';
import { makeBudget, makeCategory, makeTransaction, makeOwed } from '../test/factories';
import {
  budgetAmountFor, getBudgetStatus, getRolloverCarry, isOutsideBudget, getOutsideBudgetSpending,
  monthsOfHistory, monthKey, type Taxonomy,
} from './calculations';
import { autoCategorize, resolveCategoryId, fallbackCategoryId, getAllCategories } from './categorization';
import { getTripStatuses, tripBudget } from './trips';
import { projectMonthEnd } from './insights';
import type { LifePlan } from '../types/lifeplan';

const custom = [
  makeCategory({ id: 'travel', name: 'Travel', outsideBudget: true }),
  makeCategory({ id: 'shopping', name: 'Shopping' }),
  makeCategory({ id: 'products', name: 'Old shopping', retired: true, replacedBy: 'shopping' }),
];
const taxonomy: Taxonomy = { categories: getAllCategories(custom), parentOverrides: {} };

describe('month adjustments', () => {
  const b = makeBudget({ category: 'shopping', amount: 175, monthAdjustments: { '2026-12': 350 } });

  it('adds the delta in its month only', () => {
    expect(budgetAmountFor(b, 11, 2026)).toBe(525);
    expect(budgetAmountFor(b, 10, 2026)).toBe(175);
    expect(budgetAmountFor(b, 11, 2027)).toBe(175);
  });

  it('never goes below zero', () => {
    expect(budgetAmountFor(makeBudget({ amount: 100, monthAdjustments: { '2026-01': -500 } }), 0, 2026)).toBe(0);
  });

  it('is what getBudgetStatus measures against, and reports the adjustment', () => {
    const tx = [makeTransaction({ date: '2026-12-10', category: 'shopping', amount: 400 })];
    const [s] = getBudgetStatus([b], tx, 11, 2026, taxonomy);
    expect(s.budget).toBe(525);
    expect(s.adjustment).toBe(350);
    expect(s.status).toBe('good');
    const [nov] = getBudgetStatus([b], [makeTransaction({ date: '2026-11-10', category: 'shopping', amount: 400 })], 10, 2026, taxonomy);
    expect(nov.adjustment).toBe(0);
    expect(nov.status).toBe('danger');
  });

  it('rollover carries the previous month\'s adjusted limit', () => {
    const r = makeBudget({ category: 'shopping', amount: 100, rollover: true, monthAdjustments: { '2026-12': 50 } });
    const tx = [makeTransaction({ date: '2026-12-05', category: 'shopping', amount: 120 })];
    expect(getRolloverCarry(r, tx, 0, 2027, taxonomy)).toBe(30);
  });

  it('monthKey pads the month', () => expect(monthKey(0, 2027)).toBe('2027-01'));
});

describe('outside-budget categories', () => {
  const tx = [
    makeTransaction({ date: '2026-09-20', category: 'travel', amount: 900, owed: makeOwed({ amount: 450, payments: [{ id: 'p', date: '2026-10-01', amount: 450 }] }) }),
    makeTransaction({ date: '2026-09-10', category: 'shopping', amount: 40 }),
  ];

  it('flags the category and nothing else', () => {
    expect(isOutsideBudget('travel', taxonomy)).toBe(true);
    expect(isOutsideBudget('shopping', taxonomy)).toBe(false);
  });

  it('reports outside spending on its own, net of repayments', () => {
    expect(getOutsideBudgetSpending(tx, 8, 2026, taxonomy)).toEqual({ travel: 450 });
  });

  it('travel never lands in the shopping budget', () => {
    const [s] = getBudgetStatus([makeBudget({ category: 'shopping', amount: 175 })], tx, 8, 2026, taxonomy);
    expect(s.actual).toBe(40);
  });

  it('a child of an outside-budget group is outside too', () => {
    const t: Taxonomy = { ...taxonomy, categories: [...taxonomy.categories, makeCategory({ id: 'flights', parent: 'travel' })] };
    expect(isOutsideBudget('flights', t)).toBe(true);
  });

  it('is left out of the month-end projection', () => {
    const p = projectMonthEnd({ transactions: tx, budgets: [], taxonomy, today: new Date(2026, 8, 28) });
    expect(p.categories.map(c => c.category)).not.toContain('travel');
  });
});

describe('monthsOfHistory', () => {
  it('counts from the first transaction to now, inclusive', () => {
    const tx = [makeTransaction({ date: '2026-05-01' }), makeTransaction({ date: '2026-09-01' })];
    expect(monthsOfHistory(tx, new Date(2026, 10, 14))).toBe(7);
  });
  it('is at least one', () => expect(monthsOfHistory([], new Date())).toBe(1));
});

describe('retired categories redirect new suggestions', () => {
  it('follows replacedBy', () => {
    expect(resolveCategoryId('products', custom)).toBe('shopping');
    expect(resolveCategoryId('shopping', custom)).toBe('shopping');
    expect(fallbackCategoryId(custom)).toBe('shopping');
  });

  it('autoCategorize answers with the replacement', () => {
    expect(autoCategorize('zzz unknown merchant', custom)).toBe('shopping');
    expect(autoCategorize('zzz unknown merchant', [])).toBe('products');
  });

  it('survives a cycle and a dangling pointer', () => {
    const loop = [makeCategory({ id: 'a', replacedBy: 'b' }), makeCategory({ id: 'b', replacedBy: 'a' })];
    expect(['a', 'b']).toContain(resolveCategoryId('a', loop));
    expect(resolveCategoryId('x', [makeCategory({ id: 'x', replacedBy: 'nowhere' })])).toBe('x');
  });
});

describe('trips', () => {
  const lifePlan = { events: [{ id: 'ev1', type: 'oneTime', name: 'Big Trip', date: '2027-06', amount: '4000' }] } as unknown as LifePlan;
  const tx = [
    makeTransaction({ date: '2026-07-10', amount: 100, tags: ['Beach-trip'] }),
    makeTransaction({ date: '2026-07-11', amount: 50, tags: ['beach-trip'], isException: true }),
    makeTransaction({ date: '2026-07-12', amount: 999, tags: ['other'] }),
  ];

  it('sums every tagged transaction, one-offs included, tag case-insensitive', () => {
    const [s] = getTripStatuses([{ id: 't', name: 'Beach', tag: 'Beach-trip' }], tx);
    expect(s.spent).toBe(150);
    expect(s.count).toBe(2);
    expect(s.budget).toBeNull();
    expect([s.firstDate, s.lastDate]).toEqual(['2026-07-10', '2026-07-11']);
  });

  it('takes its budget from a linked Plan Ahead event', () => {
    expect(tripBudget({ id: 't', name: 'Big', tag: 'Big-trip', lifePlanEventId: 'ev1' }, lifePlan)).toEqual({ budget: 4000, source: 'lifePlan' });
  });

  it('an explicit budget wins over the event', () => {
    expect(tripBudget({ id: 't', name: 'Big', tag: 'b', budget: 5000, lifePlanEventId: 'ev1' }, lifePlan)).toEqual({ budget: 5000, source: 'trip' });
  });
});
