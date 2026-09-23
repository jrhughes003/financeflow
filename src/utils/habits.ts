// Spending-habit analytics: daily calendar, no-spend streaks, month rhythm,
// purchase sizes, and subcategory / tag breakdowns.
//
// "Everyday" spending excludes fixed charges (recurring templates and detected
// periodic bills) so an autopay rent or insurance bill doesn't break a
// no-spend day or distort the rhythm.

import { format, getDaysInMonth, subMonths, addDays } from 'date-fns';
import { getTransactionsForPeriod } from './calculations';
import { isFixedTransaction, detectIrregularExpenses } from './insights';
import { withEffectiveAmount } from './reimbursements';
import { PURCHASE_SIZE_BUCKETS, SYSTEM_TAGS } from './constants';

import type { Money, RecurringTemplate, Transaction } from '../types/domain';

const roundCents = (n: number): Money => Math.round(n * 100) / 100;
const sum = (arr: number[]): number => arr.reduce((s, v) => s + v, 0);
const pad = (n: number): string => String(n).padStart(2, '0');

function everydayFilter(
  transactions: Transaction[],
  recurringTemplates: RecurringTemplate[],
  today: Date,
): (t: Transaction) => boolean {
  const { billTransactionIds } = detectIrregularExpenses(transactions, { recurringTemplates, today });
  return t => !isFixedTransaction(t, recurringTemplates, billTransactionIds);
}

// ---------------------------------------------------------------------------
// Calendar + streaks
// ---------------------------------------------------------------------------

/**
 * One entry per day of the month with everyday spending, plus no-spend stats.
 * Days after `today` are marked `future` and ignored by the stats.
 *
 * @returns { days: [{ date, day, weekday, total, count, fixedTotal, future }],
 *            noSpendDays, elapsedDays, currentStreak, longestStreak,
 *            spendDays, avgPerSpendDay, biggestDay }
 */
export function getSpendingCalendar(
  transactions: Transaction[],
  month: number,
  year: number,
  {
    recurringTemplates = [], today = new Date(),
  }: { recurringTemplates?: RecurringTemplate[]; today?: Date } = {},
) {
  const isEveryday = everydayFilter(transactions, recurringTemplates, today);
  const txns = getTransactionsForPeriod(transactions, month, year);
  const todayStr = format(today, 'yyyy-MM-dd');
  const n = getDaysInMonth(new Date(year, month, 1));

  const days = Array.from({ length: n }, (_, i) => {
    const date = `${year}-${pad(month + 1)}-${pad(i + 1)}`;
    const dayTx = txns.filter(t => t.date.slice(0, 10) === date);
    const everyday = dayTx.filter(isEveryday);
    return {
      date,
      day: i + 1,
      weekday: new Date(year, month, i + 1).getDay(),
      total: roundCents(sum(everyday.map(t => t.amount))),
      count: everyday.length,
      fixedTotal: roundCents(sum(dayTx.filter(t => !isEveryday(t)).map(t => t.amount))),
      future: date > todayStr,
    };
  });

  const elapsed = days.filter(d => !d.future);
  let longest = 0, run = 0;
  elapsed.forEach(d => {
    run = d.total === 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  });
  // Current streak: consecutive no-spend days ending at the last elapsed day.
  let current = 0;
  for (let i = elapsed.length - 1; i >= 0 && elapsed[i].total === 0; i--) current++;

  const spendDays = elapsed.filter(d => d.total > 0);
  type Day = (typeof spendDays)[number];
  const biggest = spendDays.reduce<Day | null>((m, d) => (!m || d.total > m.total ? d : m), null);
  return {
    days,
    // False when nothing at all was recorded — "no-spend" would be misleading.
    hasData: txns.length > 0,
    elapsedDays: elapsed.length,
    noSpendDays: elapsed.length - spendDays.length,
    currentStreak: current,
    longestStreak: longest,
    spendDays: spendDays.length,
    avgPerSpendDay: spendDays.length ? roundCents(sum(spendDays.map(d => d.total)) / spendDays.length) : 0,
    biggestDay: biggest,
  };
}

// ---------------------------------------------------------------------------
// Month rhythm (early vs late month)
// ---------------------------------------------------------------------------

/** Which third of the month a day falls in. */
type SegmentKey = 'early' | 'mid' | 'late';

const SEGMENTS: { key: SegmentKey; label: string; from: number; to: number }[] = [
  { key: 'early', label: 'Days 1–10', from: 1, to: 10 },
  { key: 'mid', label: 'Days 11–20', from: 11, to: 20 },
  { key: 'late', label: 'Day 21–end', from: 21, to: 31 },
];

/**
 * Average everyday spending per day in each third of the month, over the
 * trailing full months with data. A strong early-month skew is the classic
 * "spend right after payday" pattern.
 * @returns { months, segments: [{ key, label, perDay }], earlyVsLatePct }
 */
export function getMonthRhythm(
  transactions: Transaction[],
  {
    recurringTemplates = [], today = new Date(), lookback = 6,
  }: { recurringTemplates?: RecurringTemplate[]; today?: Date; lookback?: number } = {},
) {
  const isEveryday = everydayFilter(transactions, recurringTemplates, today);
  const totals: Record<SegmentKey, number> = { early: 0, mid: 0, late: 0 };
  const dayCounts: Record<SegmentKey, number> = { early: 0, mid: 0, late: 0 };
  let months = 0;

  for (let i = 1; i <= lookback; i++) {
    const d = subMonths(new Date(today.getFullYear(), today.getMonth(), 1), i);
    const txns = getTransactionsForPeriod(transactions, d.getMonth(), d.getFullYear());
    if (!txns.length) continue;
    months++;
    const n = getDaysInMonth(d);
    SEGMENTS.forEach(s => { dayCounts[s.key] += Math.min(s.to, n) - s.from + 1; });
    txns.filter(isEveryday).forEach(t => {
      const day = Number(t.date.slice(8, 10));
      const seg = SEGMENTS.find(s => day >= s.from && day <= s.to);
      // The segments cover 1-31, so a real date always lands in one.
      if (seg) totals[seg.key] += t.amount;
    });
  }

  const segments = SEGMENTS.map(s => ({
    key: s.key,
    label: s.label,
    perDay: dayCounts[s.key] ? roundCents(totals[s.key] / dayCounts[s.key]) : 0,
  }));
  const early = segments[0].perDay;
  const late = segments[2].perDay;
  return {
    months,
    segments,
    earlyVsLatePct: late > 0 ? Math.round(((early - late) / late) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// Purchase sizes
// ---------------------------------------------------------------------------

/**
 * How spending splits across purchase sizes over the trailing `days` days.
 * Answers "is it lots of small stuff or a few big buys?"
 * @returns { count, total, buckets: [{ label, min, max, count, total, countPct, totalPct }] }
 */
export function getPurchaseSizeBreakdown(
  transactions: Transaction[],
  {
    today = new Date(), days = 90, edges = PURCHASE_SIZE_BUCKETS,
  }: { today?: Date; days?: number; edges?: number[] } = {},
) {
  const since = format(addDays(today, -days), 'yyyy-MM-dd');
  const until = format(today, 'yyyy-MM-dd');
  const txns = (transactions || [])
    .filter(t => {
      const d = (t.date || '').slice(0, 10);
      return d >= since && d <= until && !t.isException && t.kind !== 'savings';
    })
    .map(withEffectiveAmount)
    .filter(t => t.amount > 0);
  const total = sum(txns.map(t => t.amount));

  const ranges = [0, ...edges].map((min, i) => ({ min, max: i < edges.length ? edges[i] : null }));
  const buckets = ranges.map(({ min, max }) => {
    const inBucket = txns.filter(t => t.amount >= min && (max === null || t.amount < max));
    const bucketTotal = sum(inBucket.map(t => t.amount));
    return {
      label: max === null ? `$${min}+` : min === 0 ? `Under $${max}` : `$${min}–${max}`,
      min,
      max,
      count: inBucket.length,
      total: roundCents(bucketTotal),
      countPct: txns.length ? Math.round((inBucket.length / txns.length) * 100) : 0,
      totalPct: total > 0 ? Math.round((bucketTotal / total) * 100) : 0,
    };
  });
  return { count: txns.length, total: roundCents(total), buckets, days };
}

// ---------------------------------------------------------------------------
// Subcategories & tags
// ---------------------------------------------------------------------------

/** Totals by subcategory for a set of transactions (e.g. one category's month). */
export function getSubcategoryBreakdown(txns: Transaction[]) {
  const map = new Map();
  (txns || []).forEach(t => {
    const name = (t.subcategory || '').trim() || 'Unspecified';
    const g = map.get(name) || { name, total: 0, count: 0 };
    g.total += t.amount;
    g.count++;
    map.set(name, g);
  });
  const total = sum([...map.values()].map(g => g.total));
  return [...map.values()]
    .map(g => ({ ...g, total: roundCents(g.total), pct: total > 0 ? Math.round((g.total / total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Spending per tag. Tags are grouped case-insensitively (shown as first seen);
 * app-added tags are excluded. Pass month/year to limit to one month.
 * @returns [{ tag, total, count, firstDate, lastDate, topCategory }]
 */
export function getTagBreakdown(
  transactions: Transaction[],
  { month, year }: { month?: number; year?: number } = {},
) {
  const txns = month === undefined
    ? (transactions || []).filter(t => !t.isException && t.kind !== 'savings').map(withEffectiveAmount)
    : getTransactionsForPeriod(transactions, month, year);
  const system = new Set(SYSTEM_TAGS);
  const map = new Map();
  txns.forEach(t => {
    const seen = new Set();
    (t.tags || []).forEach(raw => {
      const tag = String(raw).trim();
      const key = tag.toLowerCase();
      if (!tag || system.has(key) || seen.has(key)) return;
      seen.add(key);
      const g = map.get(key) || { tag, total: 0, count: 0, firstDate: t.date, lastDate: t.date, byCategory: {} };
      g.total += t.amount;
      g.count++;
      if (t.date < g.firstDate) g.firstDate = t.date;
      if (t.date > g.lastDate) g.lastDate = t.date;
      g.byCategory[t.category] = (g.byCategory[t.category] || 0) + t.amount;
      map.set(key, g);
    });
  });
  return [...map.values()]
    .map(({ byCategory, ...g }) => ({
      ...g,
      total: roundCents(g.total),
      topCategory: Object.entries(byCategory as Record<string, number>)
        .sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.total - a.total);
}
