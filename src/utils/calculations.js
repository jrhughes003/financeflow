import { endOfMonth, parseISO, format, addMonths, subMonths, getDay } from 'date-fns';
import {
  ANOMALY_MIN_AVERAGE,
  ANOMALY_MULTIPLIER,
  ANOMALY_LOOKBACK_MONTHS,
  DEFAULT_TREND_MONTHS,
} from './constants';
import { withEffectiveAmount } from './reimbursements';
import { getInvestmentsValue } from './accounts';

// Format currency consistently
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

// Normalize any income frequency to monthly equivalent
export function toMonthlyAmount(amount, frequency) {
  switch (frequency) {
    case 'weekly': return amount * 52 / 12;
    case 'biweekly': return amount * 26 / 12;
    case 'semi-monthly': return amount * 2;
    case 'monthly': return amount;
    case 'annual': return amount / 12;
    default: return amount;
  }
}

// Get total monthly income from all income sources
export function getTotalIncome(incomes) {
  return incomes.reduce((sum, inc) => sum + toMonthlyAmount(inc.amount, inc.frequency), 0);
}

// Get transactions for a specific month/year (or all if month/year not provided).
// Uses plain YYYY-MM-DD string comparison to avoid timezone-offset bugs.
// parseISO('2026-03-01') returns UTC midnight — in ET (UTC-5) that's Feb 28 at 7pm,
// which would wrongly place March 1st transactions in February.
export function getTransactionsForPeriod(transactions, month, year) {
  if (month === undefined || year === undefined) return transactions;
  const mm = String(month + 1).padStart(2, '0');
  const startStr = `${year}-${mm}-01`;
  const endStr = format(endOfMonth(new Date(year, month, 1)), 'yyyy-MM-dd');
  return transactions.filter(t => {
    const d = (t.date || '').slice(0, 10); // take only YYYY-MM-DD portion
    // Exclude exceptions and savings transfers — savings isn't a category expense
    // and is accounted for separately via goal contributions.
    return d >= startStr && d <= endStr && !t.isException && t.kind !== 'savings';
  })
    // Fronted purchases count net of what's been paid back (see reimbursements.js).
    .map(withEffectiveAmount);
}

// Round to cents to avoid floating-point drift (0.1 + 0.2 = 0.30000000000000004)
function roundCents(n) {
  return Math.round(n * 100) / 100;
}

// Total expenses for a period (excludes exceptions)
export function getTotalExpenses(transactions, month, year) {
  const total = getTransactionsForPeriod(transactions, month, year)
    .reduce((sum, t) => sum + t.amount, 0);
  return roundCents(total);
}

// Spending grouped by category for a period
export function getSpendingByCategory(transactions, month, year) {
  const filtered = getTransactionsForPeriod(transactions, month, year);
  const map = {};
  filtered.forEach(t => {
    map[t.category] = roundCents((map[t.category] || 0) + t.amount);
  });
  return map;
}

// Rollover carry for a budget: the previous month's unused (positive) or
// overspent (negative) amount, which folds into this month's effective limit.
// Budgets in FinanceFlow are not per-month, so the previous month's limit is the
// same base amount; we carry a single month (predictable and bounded) rather than
// compounding indefinitely. Returns 0 when rollover is off.
export function getRolloverCarry(budget, transactions, month, year) {
  if (!budget || !budget.rollover) return 0;
  const prev = subMonths(new Date(year, month, 1), 1);
  const prevSpending = getSpendingByCategory(transactions, prev.getMonth(), prev.getFullYear());
  const prevActual = prevSpending[budget.category] || 0;
  return roundCents(budget.amount - prevActual);
}

// Budget status for each category. When a budget has rollover enabled, the prior
// month's leftover/overage is folded into an `effectiveBudget` against which
// usage, flex, and status are measured.
export function getBudgetStatus(budgets, transactions, month, year) {
  const spending = getSpendingByCategory(transactions, month, year);
  return budgets.map(b => {
    const actual = spending[b.category] || 0;
    const flex = b.flex || 0; // percentage of acceptable overage
    const carry = getRolloverCarry(b, transactions, month, year);
    // Effective limit can't go below zero (a large prior overage zeroes it out).
    const effectiveBudget = roundCents(Math.max(0, b.amount + carry));
    const flexLimit = effectiveBudget * (1 + flex / 100);
    const percentUsed = effectiveBudget > 0 ? (actual / effectiveBudget) * 100 : 0;
    let status = 'good';
    if (actual > flexLimit) status = 'danger';
    else if (percentUsed >= 80) status = 'warning';
    return {
      category: b.category,
      budget: b.amount,
      carry,
      effectiveBudget,
      actual,
      flex: b.flex || 0,
      flexLimit,
      variance: effectiveBudget - actual,
      percentUsed,
      status,
      rollover: b.rollover || false,
    };
  });
}

// Categories that were over budget (danger) in at least `minOverMonths` of the
// trailing `monthsBack` months. Computes each month's statuses once (monthsBack
// calls total) instead of re-running getBudgetStatus per-budget-per-month.
export function getConsistentlyOverBudget(budgets, transactions, month, year, monthsBack = 3, minOverMonths = 2) {
  const overCounts = {};
  for (let i = 1; i <= monthsBack; i++) {
    const d = subMonths(new Date(year, month, 1), i);
    const statuses = getBudgetStatus(budgets, transactions, d.getMonth(), d.getFullYear());
    statuses.forEach(s => {
      if (s.status === 'danger') overCounts[s.category] = (overCounts[s.category] || 0) + 1;
    });
  }
  return budgets.filter(b => (overCounts[b.category] || 0) >= minOverMonths);
}

// Savings rate: (income - expenses) / income * 100
export function getSavingsRate(incomes, transactions, month, year) {
  const income = getTotalIncome(incomes);
  const expenses = getTotalExpenses(transactions, month, year);
  if (income === 0) return 0;
  return Math.max(0, ((income - expenses) / income) * 100);
}

// Net worth: investments + savings goal progress - debts. Investments tracked
// against a statement (see accounts.js) use their estimated value today.
export function getNetWorth(investments, debts, savingsGoals, { today = new Date() } = {}) {
  const assets = getInvestmentsValue(investments, { today })
    + savingsGoals.reduce((s, g) => s + g.currentAmount, 0);
  const liabilities = debts.reduce((s, d) => s + d.balance, 0);
  return assets - liabilities;
}

// Monthly trend: returns array of {month, year, label, [categoryId]: amount, total}
export function getMonthlyTrend(transactions, numMonths = DEFAULT_TREND_MONTHS) {
  const now = new Date();
  const result = [];
  for (let i = numMonths - 1; i >= 0; i--) {
    const d = subMonths(now, i);
    const m = d.getMonth();
    const y = d.getFullYear();
    const spending = getSpendingByCategory(transactions, m, y);
    const total = Object.values(spending).reduce((s, v) => s + v, 0);
    result.push({ month: m, year: y, label: format(d, 'MMM yyyy'), ...spending, total });
  }
  return result;
}

// Budget health score: A-F based on % of categories within budget
export function getBudgetHealthScore(budgets, transactions, month, year) {
  if (!budgets.length) return { grade: 'N/A', percent: 0, color: '#94a3b8' };
  const statuses = getBudgetStatus(budgets, transactions, month, year);
  const withinBudget = statuses.filter(s => s.status !== 'danger').length;
  const percent = Math.round((withinBudget / statuses.length) * 100);
  let grade, color;
  if (percent >= 90) { grade = 'A'; color = '#22c55e'; }
  else if (percent >= 80) { grade = 'B'; color = '#84cc16'; }
  else if (percent >= 70) { grade = 'C'; color = '#f59e0b'; }
  else if (percent >= 60) { grade = 'D'; color = '#f97316'; }
  else { grade = 'F'; color = '#ef4444'; }
  return { grade, percent, color };
}

// Sum of savings contributions logged against a specific goal. A contribution is
// any transaction tagged kind === 'savings' whose goalId matches.
export function getGoalContributions(transactions, goalId) {
  if (!goalId) return 0;
  const total = (transactions || [])
    .filter(t => t.kind === 'savings' && t.goalId === goalId)
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  return roundCents(total);
}

// Derived progress for a savings goal: the manually-entered opening balance
// (currentAmount) plus everything contributed via savings transactions.
export function getGoalProgress(goal, transactions) {
  const opening = Number(goal.currentAmount) || 0;
  const contributed = getGoalContributions(transactions, goal.id);
  const total = roundCents(opening + contributed);
  const target = Number(goal.targetAmount) || 0;
  return {
    opening,
    contributed,
    currentAmount: total,
    percent: target > 0 ? Math.min(100, (total / target) * 100) : 0,
  };
}

// Detect anomalies: categories spending well above their rolling average.
// Thresholds come from constants but may be overridden via settings.
export function detectAnomalies(transactions, month, year, options = {}) {
  const minAverage = options.minAverage ?? ANOMALY_MIN_AVERAGE;
  const multiplier = options.multiplier ?? ANOMALY_MULTIPLIER;
  const now = new Date(year, month, 1);
  const currentSpending = getSpendingByCategory(transactions, month, year);
  const alerts = [];

  // Build rolling average over the lookback window
  const months = Array.from({ length: ANOMALY_LOOKBACK_MONTHS }, (_, i) => {
    const d = subMonths(now, i + 1);
    return getSpendingByCategory(transactions, d.getMonth(), d.getFullYear());
  });

  const categories = [...new Set(transactions.map(t => t.category))];
  categories.forEach(cat => {
    const monthlyAverages = months.map(m => m[cat] || 0);
    const avg = monthlyAverages.reduce((s, v) => s + v, 0) / ANOMALY_LOOKBACK_MONTHS;
    const current = currentSpending[cat] || 0;
    if (avg > minAverage && current > avg * multiplier) {
      alerts.push({
        category: cat,
        current,
        average: avg,
        ratio: current / avg,
        message: `You spent ${formatCurrency(current)} on this category this month — ${Math.round(current / avg)}x your usual ${formatCurrency(avg)}.`
      });
    }
  });
  return alerts;
}

// Project when a savings goal will be reached
export function projectGoalCompletion(goal, monthlyContribution) {
  const remaining = goal.targetAmount - goal.currentAmount;
  if (monthlyContribution <= 0 || remaining <= 0) return null;
  const months = Math.ceil(remaining / monthlyContribution);
  return { months, completionDate: addMonths(new Date(), months) };
}

// Get top merchants by total spend
export function getTopMerchants(transactions, limit = 5) {
  const map = {};
  transactions.forEach(t => {
    if (!map[t.merchant]) map[t.merchant] = { merchant: t.merchant, total: 0, count: 0, category: t.category };
    map[t.merchant].total += t.amount;
    map[t.merchant].count += 1;
  });
  return Object.values(map).sort((a, b) => b.total - a.total).slice(0, limit);
}

// Spending by day of week (0=Sun..6=Sat)
export function getSpendingByDayOfWeek(transactions) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const counts = new Array(7).fill(0);
  const totals = new Array(7).fill(0);
  transactions.forEach(t => {
    const dow = getDay(parseISO(t.date));
    counts[dow]++;
    totals[dow] += t.amount;
  });
  return days.map((name, i) => ({ name, total: totals[i], count: counts[i], avg: counts[i] ? totals[i] / counts[i] : 0 }));
}

// Month-over-month change for total spending
export function getMonthOverMonthChange(transactions, month, year) {
  const curr = getTotalExpenses(transactions, month, year);
  const prevDate = subMonths(new Date(year, month, 1), 1);
  const prev = getTotalExpenses(transactions, prevDate.getMonth(), prevDate.getFullYear());
  if (prev === 0) return null;
  return { current: curr, previous: prev, change: curr - prev, percent: ((curr - prev) / prev) * 100 };
}

// Compound interest projection for investments
export function projectInvestmentValue(currentValue, annualReturn, years) {
  return currentValue * Math.pow(1 + annualReturn / 100, years);
}

// Debt payoff calculation
export function calculateDebtPayoff(balance, interestRate, monthlyPayment) {
  if (monthlyPayment <= 0) return null;
  const monthlyRate = interestRate / 100 / 12;
  if (monthlyRate === 0) return { months: Math.ceil(balance / monthlyPayment), totalInterest: 0 };
  const months = Math.ceil(-Math.log(1 - (monthlyRate * balance) / monthlyPayment) / Math.log(1 + monthlyRate));
  const totalPaid = monthlyPayment * months;
  return { months, totalInterest: totalPaid - balance };
}
