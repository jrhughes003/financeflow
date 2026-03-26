import { endOfMonth, parseISO, format, addMonths, subMonths, getDay } from 'date-fns';

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
    return d >= startStr && d <= endStr && !t.isException;
  });
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

// Budget status for each category
export function getBudgetStatus(budgets, transactions, month, year) {
  const spending = getSpendingByCategory(transactions, month, year);
  return budgets.map(b => {
    const actual = spending[b.category] || 0;
    const flex = b.flex || 0; // percentage of acceptable overage
    const flexLimit = b.amount * (1 + flex / 100);
    const percentUsed = b.amount > 0 ? (actual / b.amount) * 100 : 0;
    let status = 'good';
    if (actual > flexLimit) status = 'danger';
    else if (percentUsed >= 80) status = 'warning';
    return {
      category: b.category,
      budget: b.amount,
      actual,
      flex: b.flex || 0,
      flexLimit,
      variance: b.amount - actual,
      percentUsed,
      status,
      rollover: b.rollover || false,
    };
  });
}

// Savings rate: (income - expenses) / income * 100
export function getSavingsRate(incomes, transactions, month, year) {
  const income = getTotalIncome(incomes);
  const expenses = getTotalExpenses(transactions, month, year);
  if (income === 0) return 0;
  return Math.max(0, ((income - expenses) / income) * 100);
}

// Net worth: investments + savings goal progress - debts
export function getNetWorth(investments, debts, savingsGoals) {
  const assets = investments.reduce((s, i) => s + i.currentValue, 0)
    + savingsGoals.reduce((s, g) => s + g.currentAmount, 0);
  const liabilities = debts.reduce((s, d) => s + d.balance, 0);
  return assets - liabilities;
}

// Monthly trend: returns array of {month, year, label, [categoryId]: amount, total}
export function getMonthlyTrend(transactions, numMonths = 6) {
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

// Detect anomalies: categories spending 2x more than rolling 3-month average
export function detectAnomalies(transactions, month, year) {
  const now = new Date(year, month, 1);
  const currentSpending = getSpendingByCategory(transactions, month, year);
  const alerts = [];

  // Build 3-month average
  const months = [1, 2, 3].map(i => {
    const d = subMonths(now, i);
    return getSpendingByCategory(transactions, d.getMonth(), d.getFullYear());
  });

  const categories = [...new Set(transactions.map(t => t.category))];
  categories.forEach(cat => {
    const monthlyAverages = months.map(m => m[cat] || 0);
    const avg = monthlyAverages.reduce((s, v) => s + v, 0) / 3;
    const current = currentSpending[cat] || 0;
    if (avg > 10 && current > avg * 2) {
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
