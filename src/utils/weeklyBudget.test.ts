/*
 * The weekly budget split.
 *
 * The point of the feature is to catch an expensive first week while there is
 * still most of a month to recover in, so the tests that matter are the ones
 * where a week overspends: later weeks must shrink by exactly that much, and
 * bills must never be what makes week one look blown.
 */

import { describe, expect, it } from 'vitest';
import { buildWeeklyBudget, weeksOfMonth } from './weeklyBudget';

// November 2026: starts on a Sunday, 30 days.
const NOV = { year: 2026, month: 10 };
const tx = (day: number, amount: number, fixed = false) =>
  ({ date: `2026-11-${String(day).padStart(2, '0')}`, amount, fixed });

describe('weeksOfMonth', () => {
  it('folds short stubs at either end into the neighbouring week', () => {
    // Monday weeks would be 1 | 2–8 | 9–15 | 16–22 | 23–29 | 30.
    expect(weeksOfMonth(NOV.year, NOV.month)).toEqual([
      { start: 1, end: 8 }, { start: 9, end: 15 }, { start: 16, end: 22 }, { start: 23, end: 30 },
    ]);
  });

  it('keeps edge weeks of three days or more', () => {
    // October 2026 starts on a Thursday: 1–4 is long enough to stand alone.
    expect(weeksOfMonth(2026, 9)[0]).toEqual({ start: 1, end: 4 });
  });

  it('covers every day of the month exactly once', () => {
    for (let m = 0; m < 12; m++) {
      for (const start of [0, 1] as const) {
        const weeks = weeksOfMonth(2026, m, start);
        const days = new Date(2026, m + 1, 0).getDate();
        expect(weeks[0].start).toBe(1);
        expect(weeks[weeks.length - 1].end).toBe(days);
        weeks.slice(1).forEach((w, i) => expect(w.start).toBe(weeks[i].end + 1));
      }
    }
  });

  it('honours a Sunday week start', () => {
    expect(weeksOfMonth(NOV.year, NOV.month, 0)[0]).toEqual({ start: 1, end: 7 });
  });
});

describe('buildWeeklyBudget', () => {
  const base = { ...NOV, budget: 3000, billsDue: 0, transactions: [], today: 10 };

  it('takes bills off the top instead of charging them to their week', () => {
    const r = buildWeeklyBudget({ ...base, transactions: [tx(1, 1200, true), tx(2, 100)], billsDue: 300 });
    expect(r.bills).toBe(1500);
    expect(r.discretionaryBudget).toBe(1500);
    expect(r.weeks[0].spent).toBe(100);
    expect(r.weeks[0].bills).toBe(1200);
    expect(r.weeks[0].allowance).toBeCloseTo((1500 * 8) / 30);
  });

  it('splits evenly by days when nothing has been spent', () => {
    const r = buildWeeklyBudget({ ...base, today: 0 });
    expect(r.weeks.map(w => w.allowance)).toEqual(r.weeks.map(w => w.plan));
    expect(r.weeks.reduce((s, w) => s + w.allowance, 0)).toBeCloseTo(3000);
    expect(r.current).toBeNull();
  });

  it('shrinks later weeks by exactly what an early week overspent', () => {
    // Week one (8 days) has a plan of 800; spend 1100.
    const r = buildWeeklyBudget({ ...base, transactions: [tx(3, 1100)] });
    expect(r.weeks[0].status).toBe('closed');
    expect(r.weeks[1].status).toBe('current');
    const rest = r.weeks.slice(1).reduce((s, w) => s + w.allowance, 0);
    expect(rest).toBeCloseTo(3000 - 1100);
    expect(r.weeks[1].allowance).toBeCloseTo((1900 * 7) / 22);
    expect(r.carryIn).toBeCloseTo(-300);
  });

  it('gives an underspent week back to the rest of the month', () => {
    const r = buildWeeklyBudget({ ...base, transactions: [tx(3, 500)] });
    expect(r.carryIn).toBeCloseTo(300);
    expect(r.weeks[1].allowance).toBeGreaterThan(r.weeks[1].plan);
  });

  it('keeps the current week\'s allowance fixed as it spends, and passes any overrun on', () => {
    const quiet = buildWeeklyBudget({ ...base, transactions: [tx(9, 50)] });
    const loud = buildWeeklyBudget({ ...base, transactions: [tx(9, 1500)] });
    expect(loud.weeks[1].allowance).toBeCloseTo(quiet.weeks[1].allowance);
    // Under its allowance, the current week doesn't change what follows.
    const idle = buildWeeklyBudget(base);
    expect(quiet.weeks[2].allowance).toBeCloseTo(idle.weeks[2].allowance);
    // Over it, later weeks absorb the difference.
    expect(loud.weeks[2].allowance).toBeLessThan(quiet.weeks[2].allowance);
  });

  it('never hands out a negative allowance', () => {
    const r = buildWeeklyBudget({ ...base, transactions: [tx(2, 5000)] });
    r.weeks.forEach(w => expect(w.allowance).toBeGreaterThanOrEqual(0));
  });

  it('treats a closed month as all weeks closed', () => {
    const r = buildWeeklyBudget({ ...base, today: 31 });
    expect(r.weeks.every(w => w.status === 'closed')).toBe(true);
    expect(r.current).toBeNull();
  });

  it('ignores transactions dated outside the month', () => {
    const r = buildWeeklyBudget({ ...base, transactions: [{ date: '2026-10-31', amount: 999, fixed: false }] });
    expect(r.weeks.reduce((s, w) => s + w.spent, 0)).toBe(0);
  });
});
