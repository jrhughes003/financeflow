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

import { addMonths, subMonths, format, getDaysInMonth } from 'date-fns';
import {
  getTransactionsForPeriod, getBudgetStatus, getConsistentlyOverBudget,
  getTotalIncome, getGoalProgress, toMonthlyAmount,
} from './calculations';
import { advanceDate, detectRecurringCandidates } from './recurring';
import {
  INSIGHT_LOOKBACK_MONTHS, FORECAST_HISTORY_MONTHS, FORECAST_MONTHS,
  TREND_UP_THRESHOLD, TREND_UP_MIN_DELTA, SMALL_PURCHASE_MAX,
  SMALL_PURCHASE_MIN_PER_MONTH, PRICE_INCREASE_MIN_PCT, PRICE_INCREASE_MIN_AMOUNT,
} from './constants';

const roundCents = n => Math.round(n * 100) / 100;
const ymd = d => format(d, 'yyyy-MM-dd');
const dayOf = t => Number((t.date || '').slice(8, 10));
const merchantKey = m => (m || '').trim().toLowerCase();
const sum = arr => arr.reduce((s, v) => s + v, 0);

function monthBounds(month, year) {
  const first = new Date(year, month, 1);
  const days = getDaysInMonth(first);
  return { start: ymd(first), end: ymd(new Date(year, month, days)), days };
}

function groupByCategory(txns) {
  const map = {};
  txns.forEach(t => { map[t.category] = roundCents((map[t.category] || 0) + t.amount); });
  return map;
}

// The `n` full months immediately before (month, year), most recent first.
function priorMonths(month, year, n, offset = 0) {
  return Array.from({ length: n }, (_, i) => {
    const d = subMonths(new Date(year, month, 1), i + 1 + offset);
    return { month: d.getMonth(), year: d.getFullYear() };
  });
}

// ---------------------------------------------------------------------------
// Fixed vs discretionary
// ---------------------------------------------------------------------------

function activeTemplates(templates) {
  return (templates || []).filter(t => t.active !== false);
}

export function isFixedTransaction(t, templates) {
  if (t.recurringTemplateId) return true;
  const key = merchantKey(t.merchant);
  return activeTemplates(templates).some(tpl => merchantKey(tpl.merchant) === key);
}

/**
 * Dates a recurring template will post on within [startStr, endStr]. Walks
 * forward from the template's nextDate, so already-posted occurrences are never
 * counted (posting a template advances its nextDate).
 */
export function templateOccurrences(template, startStr, endStr) {
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
function discretionaryHistory(transactions, templates, months) {
  const perMonth = months.map(({ month, year }) => {
    const all = getTransactionsForPeriod(transactions, month, year);
    const disc = all.filter(t => !isFixedTransaction(t, templates));
    return { hasData: all.length > 0, byCategory: groupByCategory(disc), total: roundCents(sum(disc.map(t => t.amount))) };
  });
  const active = perMonth.filter(m => m.hasData);
  const avgByCategory = {};
  active.forEach(m => Object.entries(m.byCategory).forEach(([c, v]) => {
    avgByCategory[c] = (avgByCategory[c] || 0) + v / active.length;
  }));
  return { months: active.length, avgByCategory, totals: active.map(m => m.total) };
}

// ---------------------------------------------------------------------------
// 1. What changed
// ---------------------------------------------------------------------------

function pct(current, base) {
  return base > 0 ? ((current - base) / base) * 100 : null;
}

/**
 * Per-category comparison of a month against the previous month and the
 * trailing average. When the month is still in progress, every comparison month
 * is cut at the same day-of-month so partial months aren't compared to full ones.
 * @returns { rows, totals, cutoffDay, historyMonths }
 */
export function getCategoryDeltas(transactions, month, year, { lookback = INSIGHT_LOOKBACK_MONTHS, today = new Date() } = {}) {
  const isCurrent = today.getMonth() === month && today.getFullYear() === year;
  const cutoffDay = isCurrent ? today.getDate() : null;
  const spendThrough = (m, y) => {
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

  const avgOf = c => (active.length ? sum(active.map(h => h.byCategory[c] || 0)) / active.length : 0);
  const makeRow = (cur, prev, avg) => ({
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
// 5. Forecasting
// ---------------------------------------------------------------------------

/**
 * Project where the current month will end, per category and in total:
 *   projected = actual so far + recurring charges still to post + expected
 *               discretionary spend for the remaining days.
 * Expected discretionary blends this month's pace with the historical average,
 * weighting pace more as the month progresses (early-month pace is noisy).
 */
export function projectMonthEnd({ transactions, budgets = [], recurringTemplates = [], today = new Date(), lookback = INSIGHT_LOOKBACK_MONTHS }) {
  const month = today.getMonth();
  const year = today.getFullYear();
  const { start, end, days } = monthBounds(month, year);
  const elapsed = today.getDate();
  const remainingDays = days - elapsed;
  const weight = elapsed / days;

  const monthTx = getTransactionsForPeriod(transactions, month, year);
  const actual = groupByCategory(monthTx);
  const discActual = groupByCategory(monthTx.filter(t => !isFixedTransaction(t, recurringTemplates)));

  const recurring = {};
  activeTemplates(recurringTemplates).forEach(tpl => {
    const n = templateOccurrences(tpl, start, end).length;
    if (n && tpl.category) recurring[tpl.category] = roundCents((recurring[tpl.category] || 0) + n * (Number(tpl.amount) || 0));
  });

  const hist = discretionaryHistory(transactions, recurringTemplates, priorMonths(month, year, lookback));

  const statusByCat = {};
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

  const tot = key => roundCents(sum(categories.map(c => c[key])));
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
 *   net = monthly income − scheduled recurring charges − typical discretionary.
 * The discretionary range (±1 standard deviation of recent months) produces a
 * best/worst band around the cumulative savings line.
 */
export function forecastCashFlow({ transactions, incomes = [], recurringTemplates = [], today = new Date(), months = FORECAST_MONTHS, historyMonths = FORECAST_HISTORY_MONTHS }) {
  const income = roundCents(getTotalIncome(incomes));
  const hist = discretionaryHistory(transactions, recurringTemplates, priorMonths(today.getMonth(), today.getFullYear(), historyMonths));
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
    const net = income - fixed - mean;
    cum += net;
    cumBest += income - fixed - low;
    cumWorst += income - fixed - high;
    return {
      label: format(d, 'MMM yyyy'),
      month: d.getMonth(),
      year: d.getFullYear(),
      income,
      fixed,
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
export function getCategoryAverages(transactions, { today = new Date(), lookback = INSIGHT_LOOKBACK_MONTHS, offset = 0 } = {}) {
  const months = priorMonths(today.getMonth(), today.getFullYear(), lookback, offset)
    .map(({ month, year }) => getTransactionsForPeriod(transactions, month, year))
    .filter(txns => txns.length > 0);
  const byCategory = {};
  months.forEach(txns => txns.forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount / months.length;
  }));
  Object.keys(byCategory).forEach(c => { byCategory[c] = roundCents(byCategory[c]); });
  return { byCategory, total: roundCents(sum(Object.values(byCategory))), months: months.length };
}

// Merchants whose last charge jumped relative to their earlier charges.
function detectPriceIncreases(transactions, templates, window) {
  const templateByMerchant = new Map(activeTemplates(templates).map(t => [merchantKey(t.merchant), t]));
  const groups = new Map();
  (transactions || []).forEach(t => {
    if (t.isException || t.kind === 'savings') return;
    const key = merchantKey(t.merchant);
    const recurringLike = t.recurringTemplateId || t.category === 'subscriptions' || templateByMerchant.has(key);
    if (!key || !recurringLike) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  const out = [];
  groups.forEach((items, key) => {
    if (items.length < 3) return;
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1];
    if (last.date < window.start) return; // stale — the charge may have stopped
    // Walk back over the run of charges at the current price; the charge just
    // before that run is the old price, and the run must have started recently.
    const samePrice = t => Math.abs(t.amount - last.amount) <= last.amount * 0.01;
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
export function getRecurringCosts(transactions, templates) {
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
export function getSavingsOpportunities({ transactions, budgets = [], recurringTemplates = [], today = new Date(), lookback = INSIGHT_LOOKBACK_MONTHS }) {
  const recent = getCategoryAverages(transactions, { today, lookback });
  if (!recent.months) return [];
  const earlier = getCategoryAverages(transactions, { today, lookback, offset: lookback });
  const month = today.getMonth();
  const year = today.getFullYear();
  const window = { start: ymd(subMonths(new Date(year, month, 1), lookback)), end: ymd(new Date(year, month, 0)) };

  const items = [];
  const withSaving = (item, monthly) => ({ ...item, monthlySaving: roundCents(monthly), annualSaving: roundCents(monthly * 12) });

  // Categories over budget in most recent months.
  const overCats = new Set();
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
    g.count++; g.total += t.amount;
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

  items.sort((a, b) => b.annualSaving - a.annualSaving);

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
 * What-if: apply percentage cuts to category averages.
 * @param averages  { [category]: monthly average }
 * @param cuts      { [category]: percent 0-100 }
 * @param income    monthly income
 */
export function simulateCuts(averages, cuts, income) {
  const currentSpend = sum(Object.values(averages));
  const monthlySaving = sum(Object.entries(cuts).map(([c, p]) => (averages[c] || 0) * (p || 0) / 100));
  const newSpend = currentSpend - monthlySaving;
  const rate = spend => (income > 0 ? Math.round(((income - spend) / income) * 1000) / 10 : null);
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
export function getGoalMonthlyContribution(transactions, goalId, { today = new Date(), lookback = INSIGHT_LOOKBACK_MONTHS } = {}) {
  const since = ymd(subMonths(new Date(today.getFullYear(), today.getMonth(), 1), lookback - 1));
  const total = sum((transactions || [])
    .filter(t => t.kind === 'savings' && t.goalId === goalId && (t.date || '') >= since)
    .map(t => Number(t.amount) || 0));
  return roundCents(total / lookback);
}

/**
 * How many months until a goal is reached at its current contribution pace,
 * and with `extraMonthly` added on top. null means "never at this pace".
 */
export function goalTimelineImpact(goal, transactions, extraMonthly, opts = {}) {
  const { currentAmount } = getGoalProgress(goal, transactions);
  const remaining = (Number(goal.targetAmount) || 0) - currentAmount;
  const base = getGoalMonthlyContribution(transactions, goal.id, opts);
  const monthsAt = c => (remaining <= 0 ? 0 : c > 0 ? Math.ceil(remaining / c) : null);
  return {
    remaining: roundCents(Math.max(0, remaining)),
    baseContribution: base,
    currentMonths: monthsAt(base),
    newMonths: monthsAt(base + extraMonthly),
  };
}
