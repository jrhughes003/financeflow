// Planning analytics: budget tune-up suggestions, goal on-track checks, and
// debt payoff strategy comparison. All derived from existing state.

import { subMonths, addMonths, differenceInCalendarMonths, parseISO, isValid, format } from 'date-fns';
import { getTransactionsForPeriod, getGoalProgress } from './calculations';
import { getGoalMonthlyContribution, detectIrregularExpenses } from './insights';
import {
  BUDGET_TUNE_LOOKBACK, BUDGET_TUNE_MIN_MONTHS, BUDGET_TUNE_MIN_AVERAGE, BUDGET_UNDERUSE_RATIO,
} from './constants';

const roundCents = n => Math.round(n * 100) / 100;
const sum = arr => arr.reduce((s, v) => s + v, 0);

// Linear-interpolated percentile (p in 0..1) of a numeric array.
export function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

const roundTo10 = n => Math.max(10, Math.round(n / 10) * 10);

// ---------------------------------------------------------------------------
// Budget tune-up
// ---------------------------------------------------------------------------

/**
 * Compare each budget with what's actually spent over the trailing full months
 * and suggest realistic amounts:
 *   raise      — over the flex limit in at least half the months
 *   lower      — even the biggest month stayed well under the budget
 *   add        — regular spending in a category with no (or a $0) budget
 *
 * Detected periodic bills (insurance every 6 months, annual memberships) are
 * taken out of the month-to-month figures and added back as a steady monthly
 * share (`billShare`), so one bill month doesn't inflate "typical" and the
 * budget still covers the bill over time (best with rollover on).
 * The suggested amount is the 75th-percentile everyday month plus that share,
 * rounded to $10: enough for a typical month without padding for rare spikes.
 *
 * @returns { months, insufficient, suggestions: [{ category, type, budgetId,
 *            current, suggested, median, low, high, average, billShare, bills,
 *            rollover, overMonths, freed }] }
 */
export function getBudgetSuggestions(budgets, transactions, { recurringTemplates = [], today = new Date(), lookback = BUDGET_TUNE_LOOKBACK, minMonths = BUDGET_TUNE_MIN_MONTHS } = {}) {
  const { bills, billTransactionIds } = detectIrregularExpenses(transactions, { recurringTemplates, today });
  const series = Array.from({ length: lookback }, (_, i) => {
    const d = subMonths(new Date(today.getFullYear(), today.getMonth(), 1), i + 1);
    return getTransactionsForPeriod(transactions, d.getMonth(), d.getFullYear());
  })
    .filter(txns => txns.length > 0)
    .map(txns => {
      const byCat = {};
      txns.filter(t => !billTransactionIds.has(t.id)).forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
      return byCat;
    });

  const months = series.length;
  if (months < minMonths) return { months, insufficient: true, suggestions: [] };

  const billsByCat = {};
  bills.forEach(b => { (billsByCat[b.category] = billsByCat[b.category] || []).push(b); });

  const budgetByCat = new Map((budgets || []).map(b => [b.category, b]));
  const categories = new Set([...budgetByCat.keys(), ...series.flatMap(m => Object.keys(m)), ...Object.keys(billsByCat)]);
  const suggestions = [];

  categories.forEach(category => {
    const catBills = billsByCat[category] || [];
    const billShare = roundCents(sum(catBills.map(b => b.steadyMonthly)));
    const everyday = series.map(m => m[category] || 0);
    // What each month needs once bills are smoothed into a monthly share.
    const needed = everyday.map(v => v + billShare);
    const low = percentile(everyday, 0.25);
    const high = percentile(everyday, 0.75);
    const suggested = roundTo10(high + billShare);
    const b = budgetByCat.get(category);
    const base = {
      category,
      median: roundCents(percentile(everyday, 0.5)),
      low: roundCents(low),
      high: roundCents(high),
      average: roundCents(sum(needed) / months),
      billShare,
      bills: catBills.map(x => ({ merchant: x.merchant, amount: x.amount, frequency: x.frequency })),
      rollover: !!(b && b.rollover),
      suggested,
    };

    if (b && b.amount > 0) {
      const limit = b.amount * (1 + (b.flex || 0) / 100);
      const overMonths = needed.filter(v => v > limit).length;
      if (overMonths >= Math.ceil(months / 2) && suggested > b.amount) {
        suggestions.push({ ...base, type: 'raise', budgetId: b.id, current: b.amount, overMonths });
      } else if (Math.max(...needed) < b.amount * BUDGET_UNDERUSE_RATIO && b.amount - suggested >= 20) {
        suggestions.push({ ...base, type: 'lower', budgetId: b.id, current: b.amount, overMonths, freed: roundCents(b.amount - suggested) });
      }
    } else {
      const monthsWithSpend = everyday.filter(v => v > 0).length;
      if ((monthsWithSpend >= Math.ceil((months * 2) / 3) || billShare > 0) && base.average >= BUDGET_TUNE_MIN_AVERAGE) {
        suggestions.push({ ...base, type: 'add', budgetId: b ? b.id : null, current: b ? b.amount : null, overMonths: 0 });
      }
    }
  });

  const order = { raise: 0, add: 1, lower: 2 };
  suggestions.sort((a, b) => (order[a.type] - order[b.type]) || (b.average - a.average));
  return { months, insufficient: false, suggestions };
}

/** Budget object to save when the user accepts a suggestion. */
export function applyBudgetSuggestion(suggestion, budgets, { defaultFlex = 10, now = Date.now() } = {}) {
  const existing = (budgets || []).find(b => b.id === suggestion.budgetId);
  if (existing) return { ...existing, amount: suggestion.suggested };
  return { id: `b_${now}`, category: suggestion.category, amount: suggestion.suggested, flex: defaultFlex, rollover: false };
}

// ---------------------------------------------------------------------------
// Goal on-track check
// ---------------------------------------------------------------------------

/**
 * For each goal, compare the actual contribution pace (from logged savings
 * transactions) and the planned monthly contribution against what's needed to
 * hit the target date.
 *
 * status: reached | no_target | past_due | on_track | behind | stalled
 */
export function getGoalStatuses(goals, transactions, { today = new Date() } = {}) {
  return (goals || []).map(goal => {
    const progress = getGoalProgress(goal, transactions);
    const target = Number(goal.targetAmount) || 0;
    const remaining = roundCents(Math.max(0, target - progress.currentAmount));
    const planned = Number(goal.monthlyContribution) || 0;
    const hasHistory = (transactions || []).some(t => t.kind === 'savings' && t.goalId === goal.id);
    const actual = hasHistory ? getGoalMonthlyContribution(transactions, goal.id, { today }) : null;
    // Pace we project with: real contributions when there are any, else the plan.
    const pace = actual !== null ? actual : planned;

    const targetDate = goal.targetDate ? parseISO(goal.targetDate) : null;
    const hasTarget = targetDate && isValid(targetDate);
    const monthsLeft = hasTarget ? differenceInCalendarMonths(targetDate, today) : null;
    const required = hasTarget && monthsLeft > 0 ? roundCents(remaining / monthsLeft) : null;
    const monthsAtPace = remaining <= 0 ? 0 : pace > 0 ? Math.ceil(remaining / pace) : null;
    const projectedDate = monthsAtPace !== null ? addMonths(today, monthsAtPace) : null;

    let status;
    if (remaining <= 0) status = 'reached';
    else if (!hasTarget) status = pace > 0 ? 'no_target' : 'stalled';
    else if (monthsLeft <= 0) status = 'past_due';
    else if (pace <= 0) status = 'stalled';
    else if (pace + 0.005 >= required) status = 'on_track';
    else status = 'behind';

    return {
      goal,
      currentAmount: progress.currentAmount,
      percent: progress.percent,
      remaining,
      planned,
      actual,
      pace,
      paceSource: actual !== null ? 'actual' : 'planned',
      required,
      shortfall: required !== null ? roundCents(Math.max(0, required - pace)) : null,
      monthsLeft,
      targetDate: hasTarget ? format(targetDate, 'yyyy-MM-dd') : null,
      projectedDate: projectedDate ? format(projectedDate, 'yyyy-MM-dd') : null,
      monthsLate: hasTarget && projectedDate ? Math.max(0, differenceInCalendarMonths(projectedDate, targetDate)) : null,
      status,
    };
  });
}

// ---------------------------------------------------------------------------
// Debt payoff strategies
// ---------------------------------------------------------------------------

const MAX_MONTHS = 600;

/**
 * Month-by-month payoff simulation.
 *   minimum   — every debt gets exactly its minimum; nothing rolls over.
 *   avalanche — minimums on all, everything else to the highest APR first.
 *   snowball  — minimums on all, everything else to the smallest balance first.
 * With avalanche/snowball the monthly budget stays constant (sum of minimums +
 * extra), so a paid-off debt's minimum rolls into the next target.
 *
 * @returns { strategy, feasible, months, totalInterest, totalPaid, debtFreeDate,
 *            payoffs: [{ id, name, month }], timeline: [{ month, balance }] }
 */
export function simulateDebtPayoff(debts, { strategy = 'avalanche', extra = 0, today = new Date() } = {}) {
  const active = (debts || [])
    .filter(d => (Number(d.balance) || 0) > 0)
    .map(d => ({
      id: d.id,
      name: d.name,
      balance: Number(d.balance) || 0,
      rate: (Number(d.interestRate) || 0) / 100 / 12,
      apr: Number(d.interestRate) || 0,
      min: Number(d.minimumPayment) || 0,
    }));

  const empty = { strategy, feasible: true, months: 0, totalInterest: 0, totalPaid: 0, debtFreeDate: format(today, 'yyyy-MM-dd'), payoffs: [], timeline: [{ month: 0, balance: 0 }] };
  if (!active.length) return empty;

  const order = [...active];
  if (strategy === 'avalanche') order.sort((a, b) => (b.apr - a.apr) || (a.balance - b.balance));
  else if (strategy === 'snowball') order.sort((a, b) => (a.balance - b.balance) || (b.apr - a.apr));

  const budget = sum(active.map(d => d.min)) + (strategy === 'minimum' ? 0 : Math.max(0, extra));
  const payoffs = [];
  const timeline = [{ month: 0, balance: roundCents(sum(active.map(d => d.balance))) }];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;
  let bestBalance = Infinity;
  let stuckMonths = 0;

  while (active.some(d => d.balance > 0.005) && month < MAX_MONTHS) {
    month++;
    active.forEach(d => {
      if (d.balance <= 0.005) return;
      const interest = d.balance * d.rate;
      d.balance += interest;
      totalInterest += interest;
    });

    // Minimums first.
    let pool = budget;
    active.forEach(d => {
      if (d.balance <= 0.005) return;
      const pay = Math.min(d.min, d.balance);
      d.balance -= pay;
      pool -= pay;
      totalPaid += pay;
    });

    // Then the rest to targets in order (not for the minimum-only baseline).
    if (strategy !== 'minimum') {
      for (const d of order) {
        if (pool <= 0.005) break;
        if (d.balance <= 0.005) continue;
        const pay = Math.min(pool, d.balance);
        d.balance -= pay;
        pool -= pay;
        totalPaid += pay;
      }
    }

    active.forEach(d => {
      if (d.balance <= 0.005 && !payoffs.some(p => p.id === d.id)) {
        d.balance = 0;
        payoffs.push({ id: d.id, name: d.name, month });
      }
    });

    const total = sum(active.map(d => d.balance));
    timeline.push({ month, balance: roundCents(total) });

    // Balance not shrinking for a year → payments don't cover interest.
    if (total < bestBalance - 0.01) { bestBalance = total; stuckMonths = 0; }
    else if (++stuckMonths >= 12) break;
  }

  const feasible = active.every(d => d.balance <= 0.005);
  return {
    strategy,
    feasible,
    months: feasible ? month : null,
    totalInterest: roundCents(totalInterest),
    totalPaid: roundCents(totalPaid),
    debtFreeDate: feasible ? format(addMonths(today, month), 'yyyy-MM-dd') : null,
    payoffs,
    timeline,
    // Debts that can never be paid at their minimum (for the baseline warning).
    unpayable: active.filter(d => d.balance > 0.005).map(d => ({ id: d.id, name: d.name })),
  };
}

/**
 * Run all three strategies and pick the recommendation: the one with the least
 * interest (avalanche, mathematically) unless snowball is within $50 and clears
 * the first debt sooner — then the quick win may be worth it.
 */
export function compareDebtStrategies(debts, { extra = 0, today = new Date() } = {}) {
  const minimum = simulateDebtPayoff(debts, { strategy: 'minimum', today });
  const avalanche = simulateDebtPayoff(debts, { strategy: 'avalanche', extra, today });
  const snowball = simulateDebtPayoff(debts, { strategy: 'snowball', extra, today });

  let recommended = 'avalanche';
  if (!avalanche.feasible && snowball.feasible) recommended = 'snowball';
  else if (avalanche.feasible && snowball.feasible) {
    const firstWin = s => (s.payoffs[0] ? s.payoffs[0].month : Infinity);
    if (snowball.totalInterest - avalanche.totalInterest <= 50 && firstWin(snowball) < firstWin(avalanche)) recommended = 'snowball';
  }

  const best = recommended === 'avalanche' ? avalanche : snowball;
  return {
    minimum,
    avalanche,
    snowball,
    recommended,
    interestSaved: minimum.feasible && best.feasible ? roundCents(minimum.totalInterest - best.totalInterest) : null,
    monthsSaved: minimum.feasible && best.feasible ? minimum.months - best.months : null,
  };
}
