/*
 * Which categories the Analytics screen is willing to show you.
 *
 * Both functions under test pick a subset of the taxonomy, and both used to
 * drop the rest without saying so. That is a bad failure mode for a finance
 * app: nothing looks broken, the chart renders, and the categories you are
 * missing are exactly the ones you cannot see are missing.
 *
 * The bug these cover was dormant for as long as the app had five categories —
 * five fit inside a limit of six — and only became visible when the taxonomy
 * grew to eighteen. So the tests below are written against a list longer than
 * the limit on purpose; a fixture with five rows would pass against the broken
 * code.
 */

import { describe, expect, it } from 'vitest';
import { topCategoriesByTrend, withRestSlice, REST_SLICE_ID } from './categorySelection';
import { CATEGORIES } from './categorization';

describe('topCategoriesByTrend', () => {
  // Two months of totals, keyed by category id, as getMonthlyTrend returns
  // them — plus the `label` field a real row carries.
  const trendFrom = (totals: Record<string, number>) => [
    { label: 'Aug 2026', ...totals },
    { label: 'Sep 2026' },
  ];

  it('ranks by spend, not by position in the category list', () => {
    // `home` is declared 17th and `products` 18th and they dominate the
    // ledger here, while six earlier-declared categories hold a dollar each.
    // The seven small ones are there deliberately: with fewer than `limit`
    // competitors the cut never bites, and a fixture like that passes against
    // the declaration-order implementation too.
    const trend = trendFrom({
      dining_out: 1, groceries: 1, transportation: 1, housing: 1,
      utilities: 1, subscriptions: 1, health: 1,
      home: 900, products: 400,
    });
    const picked = topCategoriesByTrend(CATEGORIES, trend, 6).map(c => c.id);
    expect(picked.slice(0, 2)).toEqual(['home', 'products']);
    expect(picked).toHaveLength(6);
  });

  it('keeps the biggest six when more than six have spending', () => {
    const trend = trendFrom({
      dining_out: 10, groceries: 20, transportation: 30, housing: 40,
      utilities: 50, subscriptions: 60, health: 70, travel: 80,
    });
    const picked = topCategoriesByTrend(CATEGORIES, trend, 6).map(c => c.id);
    // The two smallest fall off; the two largest are the late-declared ones,
    // which is the case the old code got backwards.
    expect(picked).toEqual(['travel', 'health', 'subscriptions', 'utilities', 'housing', 'transportation']);
    expect(picked).not.toContain('dining_out');
  });

  it('sums across every month in the window rather than looking at one', () => {
    const trend = [
      { label: 'Aug', dining_out: 100, housing: 0 },
      { label: 'Sep', dining_out: 0, housing: 150 },
    ];
    const picked = topCategoriesByTrend(CATEGORIES, trend, 6).map(c => c.id);
    expect(picked).toEqual(['housing', 'dining_out']);
  });

  it('leaves out categories with no spending at all', () => {
    const trend = trendFrom({ groceries: 50 });
    expect(topCategoriesByTrend(CATEGORIES, trend, 6)).toHaveLength(1);
  });

  it('ignores the label field, which is a string sitting among the numbers', () => {
    // Number('Aug 2026') is NaN, and a NaN total would sort unpredictably and
    // could survive the `> 0` filter if it were ever compared the other way.
    const picked = topCategoriesByTrend([{ id: 'label' }], trendFrom({}), 6);
    expect(picked).toEqual([]);
  });

  it('returns nothing for an empty ledger', () => {
    expect(topCategoriesByTrend(CATEGORIES, [], 6)).toEqual([]);
  });
});

describe('withRestSlice', () => {
  const rest = (count: number, value: number) => ({ id: REST_SLICE_ID, name: `Other (${count})`, value });
  const slices = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `c${i}`, value: 100 - i }));

  it('adds one slice carrying the total of everything past the cut', () => {
    const out = withRestSlice(slices(12), 9, rest);
    expect(out).toHaveLength(10);
    expect(out[9].id).toBe(REST_SLICE_ID);
    // The tail is c9, c10, c11 at 91, 90, 89.
    expect(out[9].value).toBe(91 + 90 + 89);
    expect(out[9].name).toBe('Other (3)');
  });

  it('preserves the total, which is the whole point', () => {
    const all = slices(14);
    const expected = all.reduce((s, d) => s + d.value, 0);
    const out = withRestSlice(all, 9, rest);
    expect(out.reduce((s, d) => s + d.value, 0)).toBe(expected);
  });

  it('leaves a short list alone rather than adding an empty Other', () => {
    expect(withRestSlice(slices(4), 9, rest)).toHaveLength(4);
    expect(withRestSlice(slices(9), 9, rest)).toHaveLength(9);
  });

  it('does not add a zero-valued slice when the tail is all zeroes', () => {
    const padded = [...slices(9), { id: 'z', name: 'z', value: 0 }];
    const out = withRestSlice(padded, 9, rest);
    expect(out).toHaveLength(9);
    expect(out.some(d => d.id === REST_SLICE_ID)).toBe(false);
  });

  it('handles an empty list', () => {
    expect(withRestSlice([], 9, rest)).toEqual([]);
  });
});
