import { describe, it, expect } from 'vitest';
import {
  getSpendingCalendar, getMonthRhythm, getPurchaseSizeBreakdown,
  getSubcategoryBreakdown, getTagBreakdown,
} from './habits';

const tx = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  date: '2026-03-15', merchant: 'Test', amount: 10, category: 'dining_out', isException: false,
  ...over,
});
const day = (y, m, d) => new Date(y, m, d);

describe('getSpendingCalendar', () => {
  it('builds days, counts no-spend days and streaks through today only', () => {
    const txns = [
      tx({ date: '2026-04-01', amount: 20 }),
      tx({ date: '2026-04-02', amount: 5 }),
      tx({ date: '2026-04-06', amount: 12 }),
      tx({ date: '2026-04-20', amount: 99 }), // future relative to today
    ];
    const c = getSpendingCalendar(txns, 3, 2026, { today: day(2026, 3, 10) });
    expect(c.days).toHaveLength(30);
    expect(c.hasData).toBe(true);
    expect(getSpendingCalendar([], 3, 2026, { today: day(2026, 3, 10) }).hasData).toBe(false);
    expect(c.days[0]).toMatchObject({ date: '2026-04-01', day: 1, total: 20, count: 1, future: false });
    expect(c.days[19].future).toBe(true);
    expect(c.elapsedDays).toBe(10);
    expect(c.noSpendDays).toBe(7);
    expect(c.longestStreak).toBe(4);   // Apr 7–10
    expect(c.currentStreak).toBe(4);
    expect(c.biggestDay.date).toBe('2026-04-01');
    expect(c.avgPerSpendDay).toBeCloseTo(37 / 3);
  });

  it("doesn't let a fixed bill break a no-spend day", () => {
    const templates = [{ id: 'r1', merchant: 'Rent Co', amount: 1000, category: 'housing', frequency: 'monthly', nextDate: '2026-05-01' }];
    const txns = [tx({ date: '2026-04-01', merchant: 'Rent Co', amount: 1000, recurringTemplateId: 'r1' })];
    const c = getSpendingCalendar(txns, 3, 2026, { recurringTemplates: templates, today: day(2026, 3, 30) });
    expect(c.days[0]).toMatchObject({ total: 0, fixedTotal: 1000 });
    expect(c.noSpendDays).toBe(30);
  });
});

describe('getMonthRhythm', () => {
  it('compares spending per day across thirds of the month', () => {
    const txns = [
      tx({ date: '2026-03-02', amount: 200 }), // early: 200 / 10 days = 20/day
      tx({ date: '2026-03-15', amount: 100 }), // mid:   100 / 10 = 10/day
      tx({ date: '2026-03-25', amount: 110 }), // late:  110 / 11 = 10/day
    ];
    const r = getMonthRhythm(txns, { today: day(2026, 3, 5) });
    expect(r.months).toBe(1);
    expect(r.segments.map(s => s.perDay)).toEqual([20, 10, 10]);
    expect(r.earlyVsLatePct).toBe(100);
  });
});

describe('getPurchaseSizeBreakdown', () => {
  it('buckets purchases by size with count and spend shares', () => {
    const txns = [5, 8, 15, 30, 150, 300].map((amount, i) => tx({ date: `2026-03-0${i + 1}`, amount }));
    txns.push(tx({ date: '2026-03-05', amount: 1000, isException: true }));
    const r = getPurchaseSizeBreakdown(txns, { today: day(2026, 2, 10) });
    expect(r.count).toBe(6);
    expect(r.total).toBe(508);
    expect(r.buckets.map(b => b.label)).toEqual(['Under $10', '$10–25', '$25–50', '$50–100', '$100–250', '$250+']);
    expect(r.buckets.map(b => b.count)).toEqual([2, 1, 1, 0, 1, 1]);
    expect(r.buckets[5]).toMatchObject({ total: 300, totalPct: 59, countPct: 17 });
  });
});

describe('getSubcategoryBreakdown', () => {
  it('groups by subcategory with an Unspecified bucket', () => {
    const r = getSubcategoryBreakdown([
      tx({ subcategory: 'Coffee & Drinks', amount: 30 }),
      tx({ subcategory: 'Coffee & Drinks', amount: 20 }),
      tx({ subcategory: '', amount: 50 }),
      tx({ subcategory: 'Restaurant', amount: 100 }),
    ]);
    expect(r).toEqual([
      { name: 'Restaurant', total: 100, count: 1, pct: 50 },
      { name: 'Coffee & Drinks', total: 50, count: 2, pct: 25 },
      { name: 'Unspecified', total: 50, count: 1, pct: 25 },
    ]);
  });
});

describe('getTagBreakdown', () => {
  const txns = [
    tx({ date: '2026-03-01', tags: ['Vacation'], amount: 100, category: 'transportation' }),
    tx({ date: '2026-03-03', tags: ['vacation', 'VACATION'], amount: 50, category: 'dining_out' }),
    tx({ date: '2026-04-01', tags: ['gift'], amount: 40 }),
    tx({ date: '2026-04-01', tags: ['recurring', 'ai-imported'], amount: 999 }),
    tx({ date: '2026-04-02', tags: ['gift'], amount: 10, isException: true }),
  ];

  it('groups tags case-insensitively and drops app-added tags', () => {
    const r = getTagBreakdown(txns);
    expect(r.map(t => [t.tag, t.total, t.count])).toEqual([['Vacation', 150, 2], ['gift', 40, 1]]);
    expect(r[0]).toMatchObject({ firstDate: '2026-03-01', lastDate: '2026-03-03', topCategory: 'transportation' });
  });

  it('can be limited to a month', () => {
    expect(getTagBreakdown(txns, { month: 3, year: 2026 }).map(t => t.tag)).toEqual(['gift']);
  });
});
