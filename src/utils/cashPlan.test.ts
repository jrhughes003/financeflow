/*
 * The short-term cash flow projection.
 *
 * What makes this worth testing hard is that its whole job is finding a
 * trough, and a trough is exactly what an averaged projection hides. A balance
 * that ends the month comfortably can still go negative on the 12th; if the
 * arithmetic quietly smooths a payday, the tool reports "fine" about the one
 * situation you built it to catch.
 */

import { describe, expect, it } from 'vitest';
import { buildCashFlow, paydaysBetween } from './cashPlan';
import type { Income, RecurringTemplate } from '../types/domain';

const income = (o: Partial<Income>): Income =>
  ({ id: 'i', name: 'Pay', amount: 1000, frequency: 'monthly', ...o }) as Income;
const template = (o: Partial<RecurringTemplate>): RecurringTemplate =>
  ({ id: 't', merchant: 'Rent', amount: 1000, category: 'housing', frequency: 'monthly', nextDate: '2026-11-01', ...o }) as RecurringTemplate;

const base = {
  today: new Date(2026, 9, 5), // 5 Oct 2026
  months: 3,
  plan: { openingBalance: 1000, items: [] },
  incomes: [],
  recurringTemplates: [],
  monthlyDiscretionary: 0,
};

describe('paydaysBetween', () => {
  const start = new Date(2026, 9, 1);
  const end = new Date(2026, 10, 30);

  it('steps biweekly from the anchor, forwards and backwards', () => {
    const days = paydaysBetween(income({ frequency: 'biweekly' }), '2026-10-09', start, end);
    expect(days).toContain('2026-10-09');
    expect(days).toContain('2026-10-23');
    expect(days).toContain('2026-11-06');
    // Anchored mid-window, it still finds the payday before the anchor.
    expect(days[0] <= '2026-10-09').toBe(true);
  });

  it('keeps the day of the month for a monthly income', () => {
    const days = paydaysBetween(income({ frequency: 'monthly' }), '2026-10-15', start, end);
    expect(days).toEqual(['2026-10-15', '2026-11-15']);
  });

  it('pays twice a month when semi-monthly', () => {
    const days = paydaysBetween(income({ frequency: 'semi-monthly' }), '2026-10-01', start, end);
    expect(days).toEqual(['2026-10-01', '2026-10-16', '2026-11-01', '2026-11-16']);
  });

  it('pulls a 31st back to the last day of a short month', () => {
    // November has 30 days. Claiming a 31 Nov payday would drop it entirely or
    // slide it into December, depending on how the date was built.
    const days = paydaysBetween(income({ frequency: 'monthly' }), '2026-10-31', start, end);
    expect(days).toEqual(['2026-10-31', '2026-11-30']);
  });

  it('returns nothing for a one-off, which is dated rather than scheduled', () => {
    expect(paydaysBetween(income({ frequency: 'once' }), '2026-10-15', start, end)).toEqual([]);
  });
});

describe('buildCashFlow', () => {
  it('starts tomorrow, because today is already in the ledger', () => {
    const r = buildCashFlow({ ...base });
    expect(r.days[0].date).toBe('2026-10-06');
  });

  it('holds the opening balance when nothing happens', () => {
    const r = buildCashFlow({ ...base });
    expect(r.openingBalance).toBe(1000);
    expect(r.endingBalance).toBe(1000);
    expect(r.firstNegative).toBeNull();
  });

  it('applies a planned payment on its date and not before', () => {
    const r = buildCashFlow({
      ...base,
      plan: { openingBalance: 1000, items: [{ id: 'a', label: 'Tuition', amount: 400, date: '2026-10-20', kind: 'out' }] },
    });
    expect(r.days.find(d => d.date === '2026-10-19')!.balance).toBe(1000);
    expect(r.days.find(d => d.date === '2026-10-20')!.balance).toBe(600);
  });

  it('applies planned income the same way', () => {
    const r = buildCashFlow({
      ...base,
      plan: { openingBalance: 0, items: [{ id: 'a', label: 'Refund', amount: 250, date: '2026-11-02', kind: 'in' }] },
    });
    expect(r.days.find(d => d.date === '2026-11-02')!.balance).toBe(250);
  });

  it('finds the trough, not just the ending balance', () => {
    // Ends level, dips hard in between. A monthly total would call this fine.
    const r = buildCashFlow({
      ...base,
      plan: {
        openingBalance: 500,
        items: [
          { id: 'out', label: 'Rent', amount: 900, date: '2026-10-10', kind: 'out' },
          { id: 'in', label: 'Pay', amount: 900, date: '2026-10-25', kind: 'in' },
        ],
      },
    });
    expect(r.endingBalance).toBe(500);
    expect(r.lowest).toEqual({ date: '2026-10-10', balance: -400 });
    expect(r.firstNegative).toBe('2026-10-10');
  });

  it('places a one-off income on its date', () => {
    const r = buildCashFlow({
      ...base,
      incomes: [income({ frequency: 'once', amount: 2675, date: '2026-11-15', name: 'Bonus' })],
    });
    expect(r.days.find(d => d.date === '2026-11-14')!.balance).toBe(1000);
    expect(r.days.find(d => d.date === '2026-11-15')!.balance).toBe(3675);
  });

  it('ignores a one-off with no date rather than guessing one', () => {
    const r = buildCashFlow({ ...base, incomes: [income({ frequency: 'once', amount: 500 })] });
    expect(r.endingBalance).toBe(1000);
  });

  it('schedules recurring income on its paydays when anchored', () => {
    const r = buildCashFlow({
      ...base,
      months: 1,
      incomes: [income({ frequency: 'monthly', amount: 2000, date: '2026-10-20' })],
    });
    expect(r.days.find(d => d.date === '2026-10-19')!.balance).toBe(1000);
    expect(r.days.find(d => d.date === '2026-10-20')!.balance).toBe(3000);
    expect(r.smoothedIncomes).toEqual([]);
  });

  it('smooths unanchored income and says which, rather than drawing a confident line', () => {
    const r = buildCashFlow({
      ...base,
      months: 1,
      incomes: [income({ frequency: 'monthly', amount: 3044, name: 'Qoherent' })],
    });
    expect(r.smoothedIncomes).toEqual(['Qoherent']);
    // ~$100/day, so it climbs steadily instead of stepping on a payday.
    expect(r.days[0].balance).toBeGreaterThan(1000);
    expect(r.days[0].balance).toBeLessThan(1200);
  });

  it('subtracts recurring bills on each occurrence', () => {
    const r = buildCashFlow({
      ...base,
      recurringTemplates: [template({ amount: 1000, nextDate: '2026-11-01' })],
    });
    expect(r.days.find(d => d.date === '2026-10-31')!.balance).toBe(1000);
    expect(r.days.find(d => d.date === '2026-11-01')!.balance).toBe(0);
    expect(r.days.find(d => d.date === '2026-12-01')!.balance).toBe(-1000);
  });

  it('leaves a switched-off bill out of the projection', () => {
    const r = buildCashFlow({
      ...base,
      recurringTemplates: [template({ active: false })],
    });
    expect(r.endingBalance).toBe(1000);
  });

  it('spreads everyday spending evenly, because it genuinely is', () => {
    const r = buildCashFlow({ ...base, months: 1, monthlyDiscretionary: 304.4 });
    // ~$10/day off the balance.
    expect(r.days[0].balance).toBeCloseTo(990, 0);
    expect(r.endingBalance).toBeLessThan(1000);
  });

  it('clamps the horizon to six months', () => {
    // From 5 Oct 2026, six months out is 5 Apr 2027 — asking for 24 gets six.
    const r = buildCashFlow({ ...base, months: 24 });
    expect(r.days[r.days.length - 1].date).toBe('2027-04-05');
  });

  it('clamps a horizon below one month up to one', () => {
    const r = buildCashFlow({ ...base, months: 0 });
    expect(r.days[r.days.length - 1].date).toBe('2026-11-05');
  });

  it('ignores a malformed planned item instead of producing NaN', () => {
    const r = buildCashFlow({
      ...base,
      plan: {
        openingBalance: 1000,
        items: [
          { id: 'bad', label: 'x', amount: Number.NaN, date: '2026-10-20', kind: 'out' },
          { id: 'nodate', label: 'y', amount: 50, date: '', kind: 'out' },
        ],
      },
    });
    expect(Number.isFinite(r.endingBalance)).toBe(true);
    expect(r.endingBalance).toBe(1000);
  });

  it('drops an item dated outside the horizon', () => {
    const r = buildCashFlow({
      ...base,
      months: 1,
      plan: { openingBalance: 1000, items: [{ id: 'far', label: 'Later', amount: 500, date: '2027-06-01', kind: 'out' }] },
    });
    expect(r.endingBalance).toBe(1000);
  });

  it('totals money in and out', () => {
    const r = buildCashFlow({
      ...base,
      months: 1,
      plan: {
        openingBalance: 0,
        items: [
          { id: 'a', label: 'In', amount: 300, date: '2026-10-10', kind: 'in' },
          { id: 'b', label: 'Out', amount: 100, date: '2026-10-12', kind: 'out' },
        ],
      },
    });
    expect(r.totals.in).toBeCloseTo(300, 2);
    expect(r.totals.out).toBeCloseTo(100, 2);
  });

  it('treats a negative amount on an out item as an outflow, not a refund', () => {
    // A user typing -400 into a "payment" row means the same as 400.
    const r = buildCashFlow({
      ...base,
      plan: { openingBalance: 1000, items: [{ id: 'a', label: 'P', amount: -400, date: '2026-10-20', kind: 'out' }] },
    });
    expect(r.days.find(d => d.date === '2026-10-20')!.balance).toBe(600);
  });
});
