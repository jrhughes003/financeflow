// Financial Health Score: one 0–100 number built from five parts the app can
// already measure. Parts without enough data are left out and the remaining
// weights are rescaled, so a user with no debts or no budgets isn't penalized.
//
// Every part looks at the trailing full months *before* a reference date, which
// lets the same function produce a month-by-month trend.

import { subMonths, format } from 'date-fns';
import { getTotalIncome, getTransactionsForPeriod, getBudgetStatus, getDisplayCurrency, localeFor } from './calculations';
import { getIncomeSources, getInvestmentsValue, requiredPayment } from './accounts';

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const roundCents = n => Math.round(n * 100) / 100;
const sum = arr => arr.reduce((s, v) => s + v, 0);

export const HEALTH_WEIGHTS = {
  savings: 25,
  budgets: 20,
  emergency: 20,
  debt: 20,
  stability: 15,
};

// Targets that earn a full score for each part.
const TARGET_SAVINGS_RATE = 20;   // percent of income
const TARGET_EMERGENCY_MONTHS = 6;
const MAX_DEBT_RATIO = 40;        // min payments as % of income → score 0
const STABLE_CV = 0.1;            // spending variation → 100 at or below
const UNSTABLE_CV = 0.5;          // → 0 at or above

export function healthLabel(score) {
  if (score === null) return { label: 'Not enough data', color: '#94a3b8' };
  if (score >= 80) return { label: 'Excellent', color: '#16a34a' };
  if (score >= 60) return { label: 'Good', color: '#65a30d' };
  if (score >= 40) return { label: 'Fair', color: '#d97706' };
  return { label: 'Needs work', color: '#dc2626' };
}

function monthsBefore(ref, n) {
  return Array.from({ length: n }, (_, i) => {
    const d = subMonths(new Date(ref.getFullYear(), ref.getMonth(), 1), i + 1);
    return { month: d.getMonth(), year: d.getFullYear() };
  });
}

// Savings balance as of a date: goal opening balances + contributions logged before it.
function savingsAsOf(goals, transactions, beforeStr) {
  const opening = sum((goals || []).map(g => Number(g.currentAmount) || 0));
  const ids = new Set((goals || []).map(g => g.id));
  const contributed = sum((transactions || [])
    .filter(t => t.kind === 'savings' && ids.has(t.goalId) && (t.date || '') < beforeStr)
    .map(t => Number(t.amount) || 0));
  return opening + contributed;
}

/**
 * Score as of `ref` (defaults to today), using the full months before it.
 * @returns { score, label, color, components: [{ key, label, score, weight,
 *            available, value, detail, tip }], monthsUsed }
 */
export function getFinancialHealth(state, { ref = new Date() } = {}) {
  const { transactions = [], budgets = [], incomes = [], savings_goals = [], debts = [], investments = [] } = state || {};
  const income = getTotalIncome(getIncomeSources(incomes, investments));

  // Expenses over the last 3 full months with data (and 6 for stability).
  const six = monthsBefore(ref, 6)
    .map(m => ({ ...m, total: sum(getTransactionsForPeriod(transactions, m.month, m.year).map(t => t.amount)) }))
    .filter(m => m.total > 0);
  const recent = six.slice(0, 3);
  const avgExpenses = recent.length ? sum(recent.map(m => m.total)) / recent.length : null;

  const components = [];
  const add = (key, label, c) => components.push({ key, label, weight: HEALTH_WEIGHTS[key], ...c });

  // 1. Savings rate
  if (income > 0 && avgExpenses !== null) {
    const rate = ((income - avgExpenses) / income) * 100;
    const needed = avgExpenses - income * (1 - TARGET_SAVINGS_RATE / 100);
    add('savings', 'Savings rate', {
      available: true,
      score: clamp((rate / TARGET_SAVINGS_RATE) * 100),
      value: `${Math.round(rate)}%`,
      detail: `of income left after spending (target ${TARGET_SAVINGS_RATE}%)`,
      tip: rate >= TARGET_SAVINGS_RATE ? null : `Spending ${formatWhole(needed)} less per month would reach a ${TARGET_SAVINGS_RATE}% savings rate.`,
    });
  } else {
    add('savings', 'Savings rate', { available: false, detail: income > 0 ? 'Needs a month of spending history' : 'Add your income to score this' });
  }

  // 2. Budget adherence (budget-months within the flex limit)
  const activeBudgets = budgets.filter(b => b.amount > 0);
  if (activeBudgets.length && recent.length) {
    let within = 0, total = 0;
    recent.forEach(m => {
      getBudgetStatus(activeBudgets, transactions, m.month, m.year).forEach(s => {
        total++;
        if (s.status !== 'danger') within++;
      });
    });
    const pct = (within / total) * 100;
    add('budgets', 'Budget adherence', {
      available: true,
      score: clamp(pct),
      value: `${Math.round(pct)}%`,
      detail: `of budgets stayed within limits (last ${recent.length} mo)`,
      tip: pct >= 90 ? null : 'Check Analytics → Plan → Budget tune-up for budgets that are set unrealistically.',
    });
  } else {
    add('budgets', 'Budget adherence', { available: false, detail: activeBudgets.length ? 'Needs a month of spending history' : 'Set budgets to score this' });
  }

  // 3. Emergency fund (savings ÷ monthly expenses)
  if (avgExpenses) {
    // Savings goals plus investment accounts (valued as of the reference date).
    const refStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const saved = savingsAsOf(savings_goals, transactions, format(refStart, 'yyyy-MM-dd'))
      + getInvestmentsValue(investments, { today: refStart });
    const monthsCovered = saved / avgExpenses;
    const milestone = monthsCovered < 3 ? 3 : TARGET_EMERGENCY_MONTHS;
    add('emergency', 'Emergency cushion', {
      available: true,
      score: clamp((monthsCovered / TARGET_EMERGENCY_MONTHS) * 100),
      value: `${monthsCovered.toFixed(1)} mo`,
      detail: `of expenses covered by savings & investments (target ${TARGET_EMERGENCY_MONTHS})`,
      tip: monthsCovered >= TARGET_EMERGENCY_MONTHS ? null : `Saving ${formatWhole(milestone * avgExpenses - saved)} more gets you to ${milestone} months of expenses.`,
    });
  } else {
    add('emergency', 'Emergency cushion', { available: false, detail: 'Needs a month of spending history' });
  }

  // 4. Debt load (minimum payments as a share of income)
  // Deferred loans (repayment not started) don't cost anything monthly yet.
  const owing = debts.filter(d => (Number(d.balance) || 0) > 0);
  const minPayments = sum(owing.map(d => requiredPayment(d, { today: ref })));
  if (!owing.length || minPayments === 0) {
    add('debt', 'Debt load', {
      available: true, score: 100, value: 'None',
      detail: owing.length ? 'no debt payments due yet (deferred)' : 'no debts tracked',
      tip: null,
    });
  } else if (income > 0) {
    const ratio = (minPayments / income) * 100;
    add('debt', 'Debt load', {
      available: true,
      score: clamp(100 - (ratio / MAX_DEBT_RATIO) * 100),
      value: `${Math.round(ratio)}%`,
      detail: 'of income goes to minimum debt payments',
      tip: ratio <= 10 ? null : 'Analytics → Plan → Debt strategy shows the fastest, cheapest payoff order.',
    });
  } else {
    add('debt', 'Debt load', { available: false, detail: 'Add your income to score this' });
  }

  // 5. Spending stability (coefficient of variation of monthly totals)
  if (six.length >= 3) {
    const mean = sum(six.map(m => m.total)) / six.length;
    const sd = Math.sqrt(sum(six.map(m => (m.total - mean) ** 2)) / six.length);
    const cv = mean > 0 ? sd / mean : 0;
    add('stability', 'Spending stability', {
      available: true,
      score: clamp(((UNSTABLE_CV - cv) / (UNSTABLE_CV - STABLE_CV)) * 100),
      value: `±${formatWhole(sd)}`,
      detail: `typical month-to-month swing (last ${six.length} mo)`,
      tip: cv <= STABLE_CV * 2 ? null : 'Big swings usually come from irregular bills — Analytics → Forecast shows what to set aside.',
    });
  } else {
    add('stability', 'Spending stability', { available: false, detail: 'Needs 3 months of history' });
  }

  const scored = components.filter(c => c.available);
  // A debt-only score says nothing about the rest; require at least one spending-based part.
  const meaningful = scored.some(c => c.key !== 'debt');
  const weight = sum(scored.map(c => c.weight));
  const score = meaningful && weight ? Math.round(sum(scored.map(c => c.score * c.weight)) / weight) : null;
  components.forEach(c => { if (c.available) c.score = Math.round(c.score); });

  return { score, ...healthLabel(score), components, monthsUsed: recent.length };
}

/**
 * Score for each of the last `months` month-ends (oldest first). Debts and goal
 * opening balances are today's values — the app doesn't keep their history.
 */
export function getHealthTrend(state, { today = new Date(), months = 6 } = {}) {
  return Array.from({ length: months }, (_, i) => {
    const ref = subMonths(new Date(today.getFullYear(), today.getMonth(), 1), months - 1 - i);
    const { score } = getFinancialHealth(state, { ref });
    return { label: format(subMonths(ref, 1), 'MMM'), score };
  });
}

// Whole dollars: these appear mid-sentence in a tip, where cents are noise.
// Follows the display currency like every other figure — it used to be pinned
// to en-US/USD, so one tip could disagree with the number it was tipping about.
function formatWhole(n) {
  const currency = getDisplayCurrency();
  return new Intl.NumberFormat(localeFor(currency), {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(Math.max(0, roundCents(n)));
}
