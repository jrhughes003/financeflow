// Analytics insights: "what changed" comparisons, month-end / cash-flow
// forecasting, and savings opportunities.
//
// Everything here is pure and derived from existing state (transactions,
// budgets, incomes, recurring templates, goals) — no schema changes. Functions
// that depend on "now" take an explicit `today` Date so they're testable.
//
// Fixed vs discretionary: a transaction is "fixed" when it was posted from a
// recurring template (or matches an active template's merchant). Forecasts
// project fixed spend from the templates' schedules and discretionary spend from
// pace + history, so recurring bills are never double-counted.

import { addMonths, addDays, subMonths, format, getDaysInMonth, parseISO, differenceInCalendarMonths } from 'date-fns';
import {
  getTransactionsForPeriod, getBudgetStatus, getConsistentlyOverBudget,
  getTotalIncome, getGoalProgress, toMonthlyAmount,
} from './calculations';
import { advanceDate, detectRecurringCandidates } from './recurring';
import { effectiveAmount } from './reimbursements';
import {
  INSIGHT_LOOKBACK_MONTHS, FORECAST_HISTORY_MONTHS, FORECAST_MONTHS,
  TREND_UP_THRESHOLD, TREND_UP_MIN_DELTA, SMALL_PURCHASE_MAX,
  SMALL_PURCHASE_MIN_PER_MONTH, PRICE_INCREASE_MIN_PCT, PRICE_INCREASE_MIN_AMOUNT,
  IRREGULAR_MIN_AMOUNT, SEASONAL_SPIKE_RATIO, SEASONAL_SPIKE_MIN_EXTRA,
  DUPLICATE_WINDOW_DAYS, DUPLICATE_LOOKBACK_DAYS,
} from './constants';

import type {
  Budget, Goal, Income, IsoDate, Money, RecurringTemplate, Transaction,
} from '../types/domain';
import type { BudgetStatus } from '../types/analysis';

/** A recurring charge whose price went up, normalised to a monthly figure. */
export interface PriceIncrease {
  merchant: string;
  category: string;
  before: Money;
  after: Money;
  /**
   * The increase per month, converted from the charge's own cadence. An annual
   * subscription going up $60 is $5/month, and comparing it to a monthly one
   * any other way would overstate it twelvefold.
   */
  monthlyIncrease: Money;
}

/**
 * Two charges close enough together to be worth a second look.
 *
 * `key` is the pair of transaction ids, sorted and joined - it is what a
 * dismissal is recorded against, so dismissing a pair has to survive both
 * transactions being re-read in a different order.
 */
export interface DuplicateCharge {
  key: string;
  merchant: string;
  amount: Money;
  category: string;
  first: Transaction;
  second: Transaction;
  daysApart: number;
}

/**
 * Something the user could stop paying, with what it would save.
 *
 * The fields past the common ones differ by `type`, which is why this carries
 * an index signature rather than pretending to a fixed shape. Every one has
 * both a monthly and an annual figure, because the annual figure is what makes
 * a small recurring charge look like the decision it is.
 */
export interface SavingsOpportunity {
  id: string;
  type: string;
  /**
   * Null on the informational entries, which report a total rather than
   * proposing a cut. The UI shows those differently, and a zero here would
   * read as "saves nothing" rather than "is not a saving".
   */
  monthlySaving: Money | null;
  annualSaving: Money | null;

  // The rest depend on `type`. Optional rather than a discriminated union
  // because the panel renders them through one shared row; naming them is
  // still worth more than leaving every read as `unknown`.
  category?: string;
  merchant?: string;
  average?: Money;
  previousAverage?: Money;
  budget?: Money;
  suggestedCutPct?: number;
  /** frequent_small: how often, and what it adds up to. */
  perMonth?: number;
  monthlySpend?: Money;
  averageAmount?: Money;
  /** price_increase: what it was, and what it is now. */
  before?: Money;
  after?: Money;
  /** recurring_review: the informational entry. */
  count?: number;
  monthlyTotal?: Money;
  annualTotal?: Money;
  /** Derived from the function that fills it, rather than restated here. */
  top?: ReturnType<typeof getRecurringCosts>;

  [key: string]: unknown;
}

/** One of the long cadences a bill can fall into. */
export interface Period {
  frequency: 'quarterly' | 'semiannual' | 'annual';
  months: number;
  days: number;
  /** How far a gap may stray from `days` and still count. */
  tolerance: number;
}

/**
 * A charge that repeats on a long cadence, inferred from the gaps between
 * occurrences rather than from a template the user set up.
 *
 * These are the expenses that wreck a monthly budget precisely because they are
 * not monthly, which is why the shape carries both what to set aside to be
 * ready in time and what it costs per month in the long run.
 */
export interface PeriodicBill {
  id: string;
  merchant: string;
  category: string;
  frequency: Period['frequency'];
  periodMonths: number;
  amount: Money;
  lastDate: IsoDate;
  nextDate: IsoDate;
  overdue: boolean;
  monthsUntil: number;
  /** To be ready by the due date, starting now. */
  setAsidePerMonth: Money;
  /** The long-run equivalent, once the fund is running. */
  steadyMonthly: Money;
  occurrences: number;
}

const roundCents = (n: number): Money => Math.round(n * 100) / 100;
const ymd = (d: Date): IsoDate => format(d, 'yyyy-MM-dd');
const dayOf = (t: Transaction): number => Number((t.date || '').slice(8, 10));
const merchantKey = (m: string | undefined): string => (m || '').trim().toLowerCase();
const sum = (arr: number[]): number => arr.reduce((s, v) => s + v, 0);

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function monthBounds(month: number, year: number): { start: IsoDate; end: IsoDate; days: number } {
  const first = new Date(year, month, 1);
  const days = getDaysInMonth(first);
  return { start: ymd(first), end: ymd(new Date(year, month, days)), days };
}

function groupByCategory(txns: Transaction[]): Record<string, Money> {
  const map: Record<string, Money> = {};
  txns.forEach(t => { map[t.category] = roundCents((map[t.category] || 0) + t.amount); });
  return map;
}

// The `n` full months immediately before (month, year), most recent first.
function priorMonths(month: number, year: number, n: number, offset = 0): { month: number; year: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const d = subMonths(new Date(year, month, 1), i + 1 + offset);
    return { month: d.getMonth(), year: d.getFullYear() };
  });
}

// ---------------------------------------------------------------------------
// Fixed vs discretionary
// ---------------------------------------------------------------------------

function activeTemplates(templates: RecurringTemplate[]): RecurringTemplate[] {
  return (templates || []).filter(t => t.active !== false);
}

// `fixedIds` optionally marks extra transactions as fixed — used for detected
// periodic bills (see detectIrregularExpenses) so forecasts schedule them
// explicitly instead of smearing them into the discretionary average.
export function isFixedTransaction(t: Transaction, templates: RecurringTemplate[], fixedIds?: Set<string>): boolean {
  if (t.recurringTemplateId) return true;
  if (fixedIds && fixedIds.has(t.id)) return true;
  const key = merchantKey(t.merchant);
  return activeTemplates(templates).some(tpl => merchantKey(tpl.merchant) === key);
}

/**
 * Dates a recurring template will post on within [startStr, endStr]. Walks
 * forward from the template's nextDate, so already-posted occurrences are never
 * counted (posting a template advances its nextDate).
 */
export function templateOccurrences(template: RecurringTemplate, startStr: IsoDate, endStr: IsoDate): IsoDate[] {
  if (!template || template.active === false || !template.nextDate) return [];
  const out = [];
  let d = template.nextDate;
  for (let guard = 0; d <= endStr && guard < 1000; guard++) {
    if (d >= startStr) out.push(d);
    d = advanceDate(d, template.frequency || 'monthly');
  }
  return out;
}

// Per-category discretionary spend for each of the given months, plus how many
// of those months had any spending at all (months with no data don't dilute
// averages for users with short histories).
function discretionaryHistory(
  transactions: Transaction[],
  templates: RecurringTemplate[],
  months: { month: number; year: number }[],
  fixedIds?: Set<string>,
) {
  const perMonth = months.map(({ month, year }) => {
    const all = getTransactionsForPeriod(transactions, month, year);
    const disc = all.filter(t => !isFixedTransaction(t, templates, fixedIds));
    return { hasData: all.length > 0, byCategory: groupByCategory(disc), total: roundCents(sum(disc.map(t => t.amount))) };
  });
  const active = perMonth.filter(m => m.hasData);
  const avgByCategory: Record<string, Money> = {};
  active.forEach(m => Object.entries(m.byCategory).forEach(([c, v]) => {
    avgByCategory[c] = (avgByCategory[c] || 0) + v / active.length;
  }));
  return { months: active.length, avgByCategory, totals: active.map(m => m.total) };
}

// ---------------------------------------------------------------------------
// 1. What changed
// ---------------------------------------------------------------------------

function pct(current: number, base: number): number | null {
  return base > 0 ? ((current - base) / base) * 100 : null;
}

/**
 * Per-category comparison of a month against the previous month and the
 * trailing average. When the month is still in progress, every comparison month
 * is cut at the same day-of-month so partial months aren't compared to full ones.
 * @returns { rows, totals, cutoffDay, historyMonths }
 */
export function getCategoryDeltas(
  transactions: Transaction[],
  month: number,
  year: number,
  { lookback = INSIGHT_LOOKBACK_MONTHS, today = new Date() }: { lookback?: number; today?: Date } = {},
) {
  const isCurrent = today.getMonth() === month && today.getFullYear() === year;
  const cutoffDay = isCurrent ? today.getDate() : null;
  const spendThrough = (m: number, y: number) => {
    const txns = getTransactionsForPeriod(transactions, m, y);
    return cutoffDay ? txns.filter(t => dayOf(t) <= cutoffDay) : txns;
  };

  const current = groupByCategory(spendThrough(month, year));
  const history = priorMonths(month, year, lookback).map(({ month: m, year: y }) => ({
    hasData: getTransactionsForPeriod(transactions, m, y).length > 0,
    byCategory: groupByCategory(spendThrough(m, y)),
  }));
  const previous = history[0].byCategory;
  const active = history.filter(h => h.hasData);

  const cats = new Set([...Object.keys(current), ...Object.keys(previous)]);
  active.forEach(h => Object.keys(h.byCategory).forEach(c => cats.add(c)));

  const avgOf = (c: string): Money => (active.length ? sum(active.map(h => h.byCategory[c] || 0)) / active.length : 0);
  const makeRow = (cur: Money, prev: Money, avg: Money) => ({
    current: roundCents(cur),
    previous: roundCents(prev),
    average: roundCents(avg),
    changeVsPrevious: roundCents(cur - prev),
    pctVsPrevious: pct(cur, prev),
    changeVsAverage: roundCents(cur - avg),
    pctVsAverage: pct(cur, avg),
  });

  const rows = [...cats]
    .map(c => ({ category: c, ...makeRow(current[c] || 0, previous[c] || 0, avgOf(c)) }))
    .sort((a, b) => active.length
      ? Math.abs(b.changeVsAverage) - Math.abs(a.changeVsAverage)
      : b.current - a.current);

  const totals = makeRow(
    sum(Object.values(current)),
    sum(Object.values(previous)),
    active.length ? sum(active.map(h => sum(Object.values(h.byCategory)))) / active.length : 0,
  );

  return { rows, totals, cutoffDay, historyMonths: active.length };
}

// ---------------------------------------------------------------------------
// Irregular & periodic expenses
// ---------------------------------------------------------------------------

/** A calendar month that spikes every year - holidays, back-to-school. */
export interface SeasonalSpike {
  id: string;
  category: string;
  /** The next occurrence, not the ones already seen. */
  month: number;
  year: number;
  label: string;
  /** How many different years spiked. Two is the minimum to count. */
  years: number;
  /** Above the surrounding months, averaged across those years. */
  expectedExtra: Money;
  typical: Money;
  lastYearTotal: Money;
  monthsUntil: number;
}

/** One year's spike in a given calendar month, against its own baseline. */
interface MonthSpike {
  year: number;
  total: Money;
  baseline: Money;
}

const PERIODS: Period[] = [
  { frequency: 'quarterly', months: 3, days: 91, tolerance: 20 },
  { frequency: 'semiannual', months: 6, days: 182, tolerance: 30 },
  { frequency: 'annual', months: 12, days: 365, tolerance: 45 },
];

const daysBetween = (a: IsoDate, b: IsoDate): number =>
  Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);

// Classify a list of day gaps into one period, or null if they don't all agree.
function classifyPeriod(gaps: number[]): Period | null {
  return PERIODS.find(p => gaps.every(g => Math.abs(g - p.days) <= p.tolerance)) || null;
}

// Dates (YYYY-MM-DD) an item with `nextDate` and `periodMonths` falls on in [start, end].
export function periodicOccurrences(
  item: Pick<PeriodicBill, 'nextDate' | 'periodMonths'>,
  startStr: IsoDate,
  endStr: IsoDate,
): IsoDate[] {
  const out: IsoDate[] = [];
  let d = parseISO(item.nextDate);
  for (let i = 0; i < 200; i++) {
    const s = ymd(d);
    if (s > endStr) break;
    if (s >= startStr) out.push(s);
    d = addMonths(d, item.periodMonths);
  }
  return out;
}

/**
 * Find big expenses that come back every quarter / half-year / year (insurance,
 * memberships, registrations) and category spikes that recur in the same
 * calendar month each year (holidays, back-to-school).
 *
 * Returns:
 *   bills:     [{ id, merchant, category, frequency, periodMonths, amount,
 *                 lastDate, nextDate, monthsUntil, setAsidePerMonth,
 *                 steadyMonthly, occurrences }]
 *   seasonal:  [{ id, category, month, year, label, expectedExtra, typical, lastYearTotal }]
 *   billTransactionIds: Set of transaction ids belonging to detected bills
 *   calendar:  next 12 months [{ label, month, year, bills, seasonal, total }]
 *   monthlySetAside: steady-state monthly amount covering all bills
 */
export function detectIrregularExpenses(
  transactions: Transaction[],
  {
    recurringTemplates = [], today = new Date(), minAmount = IRREGULAR_MIN_AMOUNT,
  }: { recurringTemplates?: RecurringTemplate[]; today?: Date; minAmount?: Money } = {},
) {
  const todayStr = ymd(today);
  const eligible = (transactions || []).filter(t =>
    !t.isException && t.kind !== 'savings' && t.date && !isFixedTransaction(t, recurringTemplates));

  // --- Periodic bills: same merchant, similar amount, quarterly+ cadence ---
  const groups = new Map();
  eligible.filter(t => t.amount >= minAmount).forEach(t => {
    const key = merchantKey(t.merchant);
    if (!key) return;
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  });

  const bills: PeriodicBill[] = [];
  const billTransactionIds = new Set<string>();
  groups.forEach((items, key) => {
    if (items.length < 2) return;
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((t, i) => daysBetween(sorted[i].date.slice(0, 10), t.date.slice(0, 10)));
    const period = classifyPeriod(gaps);
    // Two big charges 3 months apart is often coincidence; quarterly needs 3+.
    if (!period || (period.frequency === 'quarterly' && sorted.length < 3)) return;
    const amounts = sorted.map(t => t.amount);
    const mean = sum(amounts) / amounts.length;
    if (amounts.some(a => Math.abs(a - mean) > mean * 0.25)) return;

    const last = sorted[sorted.length - 1];
    const next = addMonths(parseISO(last.date.slice(0, 10)), period.months);
    // Overdue by more than the tolerance → it probably stopped; skip it.
    if (ymd(next) < ymd(addDays(today, -period.tolerance))) return;
    const nextDate = ymd(next);
    const monthsUntil = Math.max(0, differenceInCalendarMonths(next, today));
    const amount = roundCents(last.amount);
    sorted.forEach(t => billTransactionIds.add(t.id));
    bills.push({
      id: `bill_${key}`,
      merchant: last.merchant,
      category: last.category,
      frequency: period.frequency,
      periodMonths: period.months,
      amount,
      lastDate: last.date.slice(0, 10),
      nextDate,
      overdue: nextDate < todayStr,
      monthsUntil,
      // To be ready by the due date, starting now.
      setAsidePerMonth: roundCents(amount / Math.max(1, monthsUntil)),
      // Long-run equivalent once the fund is up and running.
      steadyMonthly: roundCents(amount / period.months),
      occurrences: sorted.length,
    });
  });
  bills.sort((a, b) => a.nextDate.localeCompare(b.nextDate));

  // --- Seasonal category spikes ---
  // A spike is measured against the surrounding months (not the all-time
  // median), so a lasting step up in spending isn't mistaken for a spike. It
  // only counts as seasonal when the same calendar month spiked in at least two
  // different years — a single big month (a trip, a one-off purchase) is not a
  // pattern.
  const seasonal: SeasonalSpike[] = [];
  const firstDate = eligible.reduce((m, t) => (t.date < m ? t.date : m), todayStr);
  const historyMonths = differenceInCalendarMonths(today, parseISO(firstDate.slice(0, 10)));
  if (historyMonths >= 13) {
    const nonBill = eligible.filter(t => !billTransactionIds.has(t.id));
    const series = priorMonths(today.getMonth(), today.getFullYear(), Math.min(36, historyMonths))
      .reverse()
      .map(({ month, year }) => {
        const txns = getTransactionsForPeriod(nonBill, month, year);
        return { month, year, hasData: txns.length > 0, byCategory: groupByCategory(txns) };
      })
      .filter(m => m.hasData);

    const categories = new Set(series.flatMap(m => Object.keys(m.byCategory)));
    categories.forEach(category => {
      const values = series.map(m => m.byCategory[category] || 0);
      const spikesByMonth = new Map<number, MonthSpike[]>();
      values.forEach((v, i) => {
        const neighbors = values.slice(Math.max(0, i - 3), i).concat(values.slice(i + 1, i + 4));
        if (neighbors.length < 3) return;
        const baseline = median(neighbors);
        if (v < Math.max(baseline * SEASONAL_SPIKE_RATIO, baseline + SEASONAL_SPIKE_MIN_EXTRA)) return;
        const m = series[i];
        let forMonth = spikesByMonth.get(m.month);
        if (!forMonth) { forMonth = []; spikesByMonth.set(m.month, forMonth); }
        forMonth.push({ year: m.year, total: v, baseline });
      });

      spikesByMonth.forEach((spikes, calMonth) => {
        if (new Set(spikes.map(sp => sp.year)).size < 2) return;
        const upcoming = new Date(today.getFullYear(), calMonth, 1);
        if (upcoming < new Date(today.getFullYear(), today.getMonth(), 1)) upcoming.setFullYear(upcoming.getFullYear() + 1);
        const latest = spikes[spikes.length - 1];
        seasonal.push({
          id: `season_${category}_${calMonth}`,
          category,
          month: upcoming.getMonth(),
          year: upcoming.getFullYear(),
          label: format(upcoming, 'MMMM yyyy'),
          years: spikes.length,
          expectedExtra: roundCents(sum(spikes.map(sp => sp.total - sp.baseline)) / spikes.length),
          typical: roundCents(sum(spikes.map(sp => sp.baseline)) / spikes.length),
          lastYearTotal: roundCents(latest.total),
          monthsUntil: differenceInCalendarMonths(upcoming, today),
        });
      });
    });
    seasonal.sort((a, b) => (a.year - b.year) || (a.month - b.month));
  }

  // --- 12-month calendar ---
  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const calendar = Array.from({ length: 12 }, (_, i) => {
    const d = addMonths(startOfThisMonth, i);
    const { start, end } = monthBounds(d.getMonth(), d.getFullYear());
    const monthBills = bills.flatMap(b => periodicOccurrences(b, start, end).map(date => ({ ...b, date })));
    const monthSeasonal = seasonal.filter(s => s.month === d.getMonth() && s.year === d.getFullYear());
    return {
      label: format(d, 'MMM yyyy'),
      month: d.getMonth(),
      year: d.getFullYear(),
      bills: monthBills,
      seasonal: monthSeasonal,
      billTotal: roundCents(sum(monthBills.map(b => b.amount))),
      seasonalTotal: roundCents(sum(monthSeasonal.map(s => s.expectedExtra))),
    };
  });

  return {
    bills,
    seasonal,
    billTransactionIds,
    calendar,
    monthlySetAside: roundCents(sum(bills.map(b => b.steadyMonthly))),
  };
}

// Total of detected bills falling in [start, end].
function billsInRange(bills: PeriodicBill[], start: IsoDate, end: IsoDate) {
  return roundCents(sum(bills.map(b => periodicOccurrences(b, start, end).length * b.amount)));
}

// ---------------------------------------------------------------------------
// 5. Forecasting
// ---------------------------------------------------------------------------

/**
 * Project where the current month will end, per category and in total:
 *   projected = actual so far + recurring charges still to post + expected
 *               discretionary spend for the remaining days.
 * Expected discretionary blends this month's pace with the historical average,
 * weighting pace more as the month progresses (early-month pace is noisy).
 */
export function projectMonthEnd({
  transactions, budgets = [], recurringTemplates = [], today = new Date(),
  lookback = INSIGHT_LOOKBACK_MONTHS,
}: {
  transactions: Transaction[];
  budgets?: Budget[];
  recurringTemplates?: RecurringTemplate[];
  today?: Date;
  lookback?: number;
}) {
  const month = today.getMonth();
  const year = today.getFullYear();
  const { start, end, days } = monthBounds(month, year);
  const elapsed = today.getDate();
  const remainingDays = days - elapsed;
  const weight = elapsed / days;

  const irregular = detectIrregularExpenses(transactions, { recurringTemplates, today });
  const fixedIds = irregular.billTransactionIds;

  const monthTx = getTransactionsForPeriod(transactions, month, year);
  const actual = groupByCategory(monthTx);
  const discActual = groupByCategory(monthTx.filter(t => !isFixedTransaction(t, recurringTemplates, fixedIds)));

  // Scheduled = recurring templates still to post + detected periodic bills due
  // later this month (a bill already paid this month has its nextDate pushed out).
  const recurring: Record<string, Money> = {};
  const addScheduled = (category: string, amount: Money): void => {
    if (category && amount) recurring[category] = roundCents((recurring[category] || 0) + amount);
  };
  activeTemplates(recurringTemplates).forEach(tpl => {
    addScheduled(tpl.category, templateOccurrences(tpl, start, end).length * (Number(tpl.amount) || 0));
  });
  irregular.bills.forEach(b => addScheduled(b.category, billsInRange([b], start, end)));

  const hist = discretionaryHistory(transactions, recurringTemplates, priorMonths(month, year, lookback), fixedIds);

  const statusByCat: Record<string, BudgetStatus> = {};
  getBudgetStatus(budgets, transactions, month, year).forEach(s => { statusByCat[s.category] = s; });

  const cats = new Set([...Object.keys(actual), ...Object.keys(recurring), ...Object.keys(hist.avgByCategory)]);
  const categories = [...cats].map(category => {
    const paceDaily = (discActual[category] || 0) / elapsed;
    const histDaily = (hist.avgByCategory[category] || 0) / days;
    const daily = hist.months ? weight * paceDaily + (1 - weight) * histDaily : paceDaily;
    const discretionaryRemaining = roundCents(daily * remainingDays);
    const recurringRemaining = recurring[category] || 0;
    const act = actual[category] || 0;
    const projected = roundCents(act + recurringRemaining + discretionaryRemaining);

    const s = statusByCat[category];
    const budget = s && s.effectiveBudget > 0 ? s.effectiveBudget : null;
    let status = 'none';
    if (budget) {
      if (projected > s.flexLimit) status = 'over';
      else if (projected >= budget * 0.9) status = 'watch';
      else status = 'ok';
    }
    return {
      category, actual: act, recurringRemaining, discretionaryRemaining, projected,
      budget, flexLimit: s ? s.flexLimit : null,
      overBy: budget ? roundCents(Math.max(0, projected - budget)) : 0,
      status,
    };
  })
    .filter(c => c.projected > 0 || c.budget)
    .sort((a, b) => b.projected - a.projected);

  let confidence = 'low';
  if (hist.months >= 2) confidence = elapsed >= 10 ? 'high' : 'medium';
  else if (elapsed >= 15) confidence = 'medium';

  const tot = (key: 'actual' | 'recurringRemaining' | 'discretionaryRemaining' | 'projected'): Money =>
    roundCents(sum(categories.map(c => c[key])));
  return {
    month, year,
    daysElapsed: elapsed,
    daysInMonth: days,
    historyMonths: hist.months,
    confidence,
    totals: {
      actual: tot('actual'),
      recurringRemaining: tot('recurringRemaining'),
      discretionaryRemaining: tot('discretionaryRemaining'),
      projected: tot('projected'),
      budget: roundCents(sum(categories.map(c => c.budget || 0))),
    },
    categories,
    warnings: categories.filter(c => c.status === 'over' || c.status === 'watch'),
  };
}

/**
 * Month-by-month cash-flow outlook for the next `months` months:
 *   net = monthly income − scheduled recurring charges − detected periodic
 *         bills due that month − typical discretionary.
 * Periodic bills are excluded from the discretionary history so they're counted
 * once, in the month they're due. The discretionary range (±1 standard deviation
 * of recent months) produces a best/worst band around the cumulative line.
 */
export function forecastCashFlow({
  transactions, incomes = [], recurringTemplates = [], today = new Date(),
  months = FORECAST_MONTHS, historyMonths = FORECAST_HISTORY_MONTHS,
}: {
  transactions: Transaction[];
  incomes?: Income[];
  recurringTemplates?: RecurringTemplate[];
  today?: Date;
  months?: number;
  historyMonths?: number;
}) {
  const income = roundCents(getTotalIncome(incomes));
  const { bills, billTransactionIds } = detectIrregularExpenses(transactions, { recurringTemplates, today });
  const hist = discretionaryHistory(transactions, recurringTemplates, priorMonths(today.getMonth(), today.getFullYear(), historyMonths), billTransactionIds);
  const mean = hist.months ? sum(hist.totals) / hist.months : 0;
  const std = hist.months > 1 ? Math.sqrt(sum(hist.totals.map(v => (v - mean) ** 2)) / hist.months) : 0;
  const low = Math.max(0, mean - std);
  const high = mean + std;

  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let cum = 0, cumBest = 0, cumWorst = 0;
  const rows = Array.from({ length: months }, (_, i) => {
    const d = addMonths(startOfThisMonth, i + 1);
    const { start, end } = monthBounds(d.getMonth(), d.getFullYear());
    const fixed = roundCents(sum(activeTemplates(recurringTemplates).map(tpl =>
      templateOccurrences(tpl, start, end).length * (Number(tpl.amount) || 0))));
    const irregular = billsInRange(bills, start, end);
    const net = income - fixed - irregular - mean;
    cum += net;
    cumBest += income - fixed - irregular - low;
    cumWorst += income - fixed - irregular - high;
    return {
      label: format(d, 'MMM yyyy'),
      month: d.getMonth(),
      year: d.getFullYear(),
      income,
      fixed,
      irregular,
      discretionary: roundCents(mean),
      net: roundCents(net),
      cumulative: roundCents(cum),
      cumulativeRange: [roundCents(cumWorst), roundCents(cumBest)],
    };
  });

  return {
    rows,
    income,
    discretionaryAverage: roundCents(mean),
    discretionaryRange: [roundCents(low), roundCents(high)],
    historyMonths: hist.months,
  };
}

// ---------------------------------------------------------------------------
// 4. Savings opportunities + what-if
// ---------------------------------------------------------------------------

/**
 * Average monthly spend per category over the trailing full months that had
 * any data. `offset` shifts the window further back (used for trend detection).
 */
export function getCategoryAverages(
  transactions: Transaction[],
  {
    today = new Date(), lookback = INSIGHT_LOOKBACK_MONTHS, offset = 0,
  }: { today?: Date; lookback?: number; offset?: number } = {},
) {
  const months = priorMonths(today.getMonth(), today.getFullYear(), lookback, offset)
    .map(({ month, year }) => getTransactionsForPeriod(transactions, month, year))
    .filter(txns => txns.length > 0);
  const byCategory: Record<string, Money> = {};
  months.forEach(txns => txns.forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount / months.length;
  }));
  Object.keys(byCategory).forEach(c => { byCategory[c] = roundCents(byCategory[c]); });
  return { byCategory, total: roundCents(sum(Object.values(byCategory))), months: months.length };
}

// Merchants whose last charge jumped relative to their earlier charges.
function detectPriceIncreases(
  transactions: Transaction[],
  templates: RecurringTemplate[],
  window: { start: IsoDate; end: IsoDate },
) {
  const templateByMerchant = new Map(activeTemplates(templates).map(t => [merchantKey(t.merchant), t]));
  const groups = new Map<string, Transaction[]>();
  (transactions || []).forEach(t => {
    if (t.isException || t.kind === 'savings') return;
    const key = merchantKey(t.merchant);
    const recurringLike = t.recurringTemplateId || t.category === 'subscriptions' || templateByMerchant.has(key);
    if (!key || !recurringLike) return;
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  });

  const out: PriceIncrease[] = [];
  groups.forEach((items, key) => {
    if (items.length < 3) return;
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1];
    if (last.date < window.start) return; // stale — the charge may have stopped
    // Walk back over the run of charges at the current price; the charge just
    // before that run is the old price, and the run must have started recently.
    const samePrice = (t: Transaction): boolean => Math.abs(t.amount - last.amount) <= last.amount * 0.01;
    let i = sorted.length - 1;
    while (i > 0 && samePrice(sorted[i - 1])) i--;
    if (i === 0 || sorted[i].date < window.start) return;
    const before = sorted[i - 1].amount;
    const increase = last.amount - before;
    if (before > 0 && increase >= PRICE_INCREASE_MIN_AMOUNT && (increase / before) * 100 >= PRICE_INCREASE_MIN_PCT) {
      const freq = templateByMerchant.get(key)?.frequency || 'monthly';
      out.push({
        merchant: last.merchant,
        category: last.category,
        before: roundCents(before),
        after: roundCents(last.amount),
        monthlyIncrease: roundCents(toMonthlyAmount(increase, freq)),
      });
    }
  });
  return out;
}

// Every recurring charge (templates + auto-detected ones not yet templated),
// normalized to monthly and annual cost.
export function getRecurringCosts(transactions: Transaction[], templates: RecurringTemplate[]) {
  const items = activeTemplates(templates).map(t => ({
    merchant: t.merchant, category: t.category, frequency: t.frequency || 'monthly',
    amount: Number(t.amount) || 0, source: 'template',
  }));
  const known = new Set(items.map(i => merchantKey(i.merchant)));
  // Savings transfers are regular but aren't a cost to cut. Detected weekly /
  // biweekly patterns are usually habits (groceries, gas), not subscriptions, so
  // only monthly/annual detections count; explicit templates always count.
  detectRecurringCandidates((transactions || []).filter(t => t.kind !== 'savings')).forEach(c => {
    if (!known.has(merchantKey(c.merchant)) && (c.frequency === 'monthly' || c.frequency === 'annual')) {
      items.push({ merchant: c.merchant, category: c.category, frequency: c.frequency, amount: c.amount, source: 'detected' });
    }
  });
  return items
    .map(i => {
      const monthly = roundCents(toMonthlyAmount(i.amount, i.frequency));
      return { ...i, monthly, annual: roundCents(monthly * 12) };
    })
    .sort((a, b) => b.annual - a.annual);
}

/**
 * Ranked, deduplicated list of concrete ways to save. Each item carries the
 * data the UI needs to phrase it; `monthlySaving` is null for informational
 * items (e.g. the recurring-charges review).
 *
 * Types: over_budget | trending_up | frequent_small | price_increase | recurring_review
 */
export function getSavingsOpportunities({
  transactions, budgets = [], recurringTemplates = [], today = new Date(),
  lookback = INSIGHT_LOOKBACK_MONTHS,
}: {
  transactions: Transaction[];
  budgets?: Budget[];
  recurringTemplates?: RecurringTemplate[];
  today?: Date;
  lookback?: number;
}) {
  const recent = getCategoryAverages(transactions, { today, lookback });
  if (!recent.months) return [];
  const earlier = getCategoryAverages(transactions, { today, lookback, offset: lookback });
  const month = today.getMonth();
  const year = today.getFullYear();
  const window = { start: ymd(subMonths(new Date(year, month, 1), lookback)), end: ymd(new Date(year, month, 0)) };

  const items: SavingsOpportunity[] = [];
  const withSaving = <T extends object>(item: T, monthly: Money) =>
    ({ ...item, monthlySaving: roundCents(monthly), annualSaving: roundCents(monthly * 12) });

  // Categories over budget in most recent months.
  const overCats = new Set<string>();
  getConsistentlyOverBudget(budgets.filter(b => b.amount > 0), transactions, month, year, lookback, Math.min(2, lookback))
    .forEach(b => {
      const avg = recent.byCategory[b.category] || 0;
      const saving = avg - b.amount;
      if (saving <= 0) return;
      overCats.add(b.category);
      items.push(withSaving({
        id: `over_${b.category}`, type: 'over_budget', category: b.category,
        average: avg, budget: b.amount, suggestedCutPct: Math.round((saving / avg) * 100),
      }, saving));
    });

  // Categories creeping up versus the window before.
  if (earlier.months) {
    Object.entries(recent.byCategory).forEach(([category, avg]) => {
      if (overCats.has(category)) return;
      const prev = earlier.byCategory[category] || 0;
      const delta = avg - prev;
      if (prev > 0 && delta >= TREND_UP_MIN_DELTA && delta / prev >= TREND_UP_THRESHOLD) {
        items.push(withSaving({
          id: `trend_${category}`, type: 'trending_up', category,
          average: avg, previousAverage: prev, suggestedCutPct: Math.round((delta / avg) * 100),
        }, delta));
      }
    });
  }

  // Frequent small purchases at one merchant.
  const small = new Map();
  transactions.forEach(t => {
    const d = (t.date || '').slice(0, 10);
    if (d < window.start || d > window.end || t.isException || t.kind === 'savings') return;
    if (t.amount >= SMALL_PURCHASE_MAX || isFixedTransaction(t, recurringTemplates)) return;
    const key = merchantKey(t.merchant);
    if (!key) return;
    const g = small.get(key) || { merchant: t.merchant, category: t.category, count: 0, total: 0 };
    g.count++; g.total += effectiveAmount(t);
    small.set(key, g);
  });
  [...small.values()]
    .map(g => ({ ...g, perMonth: g.count / recent.months, monthlySpend: g.total / recent.months }))
    .filter(g => g.perMonth >= SMALL_PURCHASE_MIN_PER_MONTH)
    .sort((a, b) => b.monthlySpend - a.monthlySpend)
    .slice(0, 3)
    .forEach(g => items.push(withSaving({
      id: `small_${merchantKey(g.merchant)}`, type: 'frequent_small', category: g.category, merchant: g.merchant,
      perMonth: Math.round(g.perMonth * 10) / 10, monthlySpend: roundCents(g.monthlySpend),
      averageAmount: roundCents(g.total / g.count),
    }, g.monthlySpend / 2)));

  // Recurring charges that got more expensive.
  detectPriceIncreases(transactions, recurringTemplates, window).forEach(p => items.push(withSaving({
    id: `price_${merchantKey(p.merchant)}`, type: 'price_increase', ...p,
  }, p.monthlyIncrease)));

  // Biggest saving first. The informational entry has no saving and is pushed
  // on after this sort, so it stays last either way.
  items.sort((a, b) => (b.annualSaving ?? 0) - (a.annualSaving ?? 0));

  // Informational: total recurring cost, always last.
  const recurring = getRecurringCosts(transactions, recurringTemplates);
  if (recurring.length) {
    const monthly = roundCents(sum(recurring.map(r => r.monthly)));
    items.push({
      id: 'recurring_review', type: 'recurring_review', category: null,
      monthlyTotal: monthly, annualTotal: roundCents(monthly * 12),
      top: recurring.slice(0, 5), count: recurring.length,
      monthlySaving: null, annualSaving: null,
    });
  }
  return items;
}

/**
 * Likely double charges: the same merchant and exact amount within a couple of
 * days. Same-day repeats are always flagged; next-day(s) repeats are skipped for
 * merchants where that exact amount is a habit (e.g. the same coffee order), so
 * routine purchases don't drown out real duplicates.
 * @param dismissed  pair keys the user marked "not a duplicate"
 * @returns [{ key, merchant, amount, first, second, daysApart }] newest first
 */
export function detectDuplicateCharges(
  transactions: Transaction[],
  {
    today = new Date(), dismissed = [], windowDays = DUPLICATE_WINDOW_DAYS,
    lookbackDays = DUPLICATE_LOOKBACK_DAYS,
  }: { today?: Date; dismissed?: string[]; windowDays?: number; lookbackDays?: number } = {},
) {
  const since = ymd(addDays(today, -lookbackDays));
  const dismissedSet = new Set(dismissed);
  const groups = new Map();
  (transactions || []).forEach(t => {
    const d = (t.date || '').slice(0, 10);
    if (!d || d < since || t.isException || t.kind === 'savings' || !(t.amount > 0)) return;
    const key = `${merchantKey(t.merchant)}|${Math.round(t.amount * 100)}`;
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  });

  const out: DuplicateCharge[] = [];
  groups.forEach(items => {
    if (items.length < 2) return;
    const habitual = items.length >= 4;
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      const daysApart = daysBetween(a.date.slice(0, 10), b.date.slice(0, 10));
      if (daysApart > windowDays || (habitual && daysApart > 0)) continue;
      const key = [a.id, b.id].sort().join('|');
      if (dismissedSet.has(key)) continue;
      out.push({ key, merchant: b.merchant, amount: b.amount, category: b.category, first: a, second: b, daysApart });
    }
  });
  return out.sort((x, y) => y.second.date.localeCompare(x.second.date));
}

/**
 * What-if: apply percentage cuts to category averages.
 * @param averages  { [category]: monthly average }
 * @param cuts      { [category]: percent 0-100 }
 * @param income    monthly income
 */
export function simulateCuts(averages: Record<string, Money>, cuts: Record<string, Money>, income: Money) {
  const currentSpend = sum(Object.values(averages));
  const monthlySaving = sum(Object.entries(cuts).map(([c, p]) => (averages[c] || 0) * (p || 0) / 100));
  const newSpend = currentSpend - monthlySaving;
  const rate = (spend: Money): number | null =>
    (income > 0 ? Math.round(((income - spend) / income) * 1000) / 10 : null);
  return {
    currentSpend: roundCents(currentSpend),
    newSpend: roundCents(newSpend),
    monthlySaving: roundCents(monthlySaving),
    annualSaving: roundCents(monthlySaving * 12),
    currentRate: rate(currentSpend),
    newRate: rate(newSpend),
  };
}

// Average monthly contribution to a goal over the trailing window (current
// month included, since contributions are often made mid-month).
export function getGoalMonthlyContribution(
  transactions: Transaction[],
  goalId: string,
  { today = new Date(), lookback = INSIGHT_LOOKBACK_MONTHS }: { today?: Date; lookback?: number } = {},
): Money {
  const contributions = (transactions || []).filter(t => t.kind === 'savings' && t.goalId === goalId && t.date);
  if (!contributions.length) return 0;
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const currentMonth = format(monthStart, 'yyyy-MM');
  // The current month is only part-elapsed. People save on a fixed day, so
  // counting it before that day arrives divides a short total by a whole month
  // and reports an on-track goal as behind. Until this month's contribution
  // lands, measure over completed months only.
  const postedThisMonth = contributions.some(t => t.date.slice(0, 7) === currentMonth);
  const endMonth = postedThisMonth ? monthStart : subMonths(monthStart, 1);

  const since = ymd(subMonths(endMonth, lookback - 1));
  const until = ymd(new Date(endMonth.getFullYear(), endMonth.getMonth(), getDaysInMonth(endMonth)));
  const total = sum(contributions
    .filter(t => t.date >= since && t.date <= until)
    .map(t => Number(t.amount) || 0));

  // A goal started last month shouldn't have its pace diluted by months before
  // its first contribution.
  const first = contributions.reduce((m, t) => (t.date < m ? t.date : m), contributions[0].date);
  const monthsActive = differenceInCalendarMonths(endMonth, parseISO(first.slice(0, 10))) + 1;
  return roundCents(total / Math.max(1, Math.min(lookback, monthsActive)));
}

/**
 * How many months until a goal is reached at its current contribution pace,
 * and with `extraMonthly` added on top. null means "never at this pace".
 */
export function goalTimelineImpact(
  goal: Goal,
  transactions: Transaction[],
  extraMonthly: Money,
  opts: { today?: Date; lookback?: number } = {},
) {
  const { currentAmount } = getGoalProgress(goal, transactions);
  const remaining = (Number(goal.targetAmount) || 0) - currentAmount;
  const base = getGoalMonthlyContribution(transactions, goal.id, opts);
  const monthsAt = (c: Money): number | null =>
    (remaining <= 0 ? 0 : c > 0 ? Math.ceil(remaining / c) : null);
  return {
    remaining: roundCents(Math.max(0, remaining)),
    baseContribution: base,
    currentMonths: monthsAt(base),
    newMonths: monthsAt(base + extraMonthly),
  };
}
