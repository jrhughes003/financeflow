// Renderer-side AI helper. Thin wrapper over the Electron AI bridge with graceful
// fallback: when not running in Electron (or no key / AI disabled), calls return
// a structured failure so callers can fall back to deterministic behavior.

import { isElectron, electronApi } from '../storage/storage';
import type { AiFeature, AiResult, AiStatus } from '../types/api';
import type { Category } from '../types/domain';
import type { AppState } from '../types/state';
import { getAllCategories } from '../utils/categorization';
import {
  getSpendingByCategory, getBudgetStatus, getTotalExpenses, getTotalIncome,
  getSavingsRate, detectAnomalies, getMonthlyTrend,
} from '../utils/calculations';
import { getIncomeSources, isInRepayment } from '../utils/accounts';
import {
  getCategoryDeltas, projectMonthEnd, forecastCashFlow,
  getSavingsOpportunities, detectDuplicateCharges, detectIrregularExpenses,
} from '../utils/insights';
import { getGoalStatuses, compareDebtStrategies } from '../utils/planning';

export const aiSupported = isElectron;

export async function getAiStatus(): Promise<AiStatus> {
  const api = electronApi();
  if (!api) return { encryptionAvailable: false, hasKey: false };
  try { return await api.ai.status(); }
  catch { return { encryptionAvailable: false, hasKey: false }; }
}

export async function setAiKey(key: string): Promise<AiResult<void>> {
  const api = electronApi();
  if (!api) return { ok: false, error: 'unavailable' };
  return api.ai.setKey(key);
}

export async function clearAiKey(): Promise<AiResult<void>> {
  const api = electronApi();
  if (!api) return { ok: false, error: 'unavailable' };
  return api.ai.clearKey();
}

// Run a feature. Returns { ok, data } or { ok:false, error }. Never throws.
export async function runAi(feature: AiFeature, input: unknown): Promise<AiResult<unknown>> {
  const api = electronApi();
  if (!api) return { ok: false, error: 'unavailable' };
  try { return await api.ai.run(feature, input); }
  catch (err) { return { ok: false, error: err instanceof Error ? err.message : 'AI request failed' }; }
}

// Compact category taxonomy (id + name only) for prompts.
export function taxonomy(customCategories: Category[] = []): { id: string; name: string }[] {
  return getAllCategories(customCategories).map(c => ({ id: c.id, name: c.name }));
}

// Build the summary for insights / Q&A.
//
// The app already computes a lot of analysis deterministically; sending those
// *conclusions* rather than only raw totals is what makes the narrative specific
// ("dining is up 73% against your own baseline, one duplicate charge flagged")
// while keeping the model out of the arithmetic entirely.
//
// The line this must not cross: no individual transactions. Several analytics
// below are merchant-level internally (duplicates, frequent small purchases,
// price increases, periodic bills) — those are reduced here to counts and dollar
// amounts, deliberately dropping the merchant. Goal and debt names are included:
// they label positions rather than spending records, and advice that can't name
// the goal it's about isn't advice.
export function buildSummary(
  state: AppState,
  month: number,
  year: number,
  { today = new Date() }: { today?: Date } = {},
) {
  const { transactions, budgets, debts = [], recurringTemplates = [] } = state;
  const incomes = getIncomeSources(state.incomes, state.investments);
  const goals = state.savings_goals || [];
  const opts = { today };
  const round = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

  const deltas = getCategoryDeltas(transactions, month, year, opts);
  const monthEnd = projectMonthEnd({ transactions, budgets, recurringTemplates, ...opts });
  const forecast = forecastCashFlow({ transactions, incomes, recurringTemplates, ...opts });
  const opportunities = getSavingsOpportunities({ transactions, budgets, recurringTemplates, ...opts });
  const duplicates = detectDuplicateCharges(transactions, opts);
  const irregular = detectIrregularExpenses(transactions, { recurringTemplates, ...opts });
  const goalStatuses = getGoalStatuses(goals, transactions, opts);
  const debtPlan = debts.length ? compareDebtStrategies(debts, opts) : null;

  return {
    period: { month, year },
    totalExpenses: round(getTotalExpenses(transactions, month, year)),
    totalMonthlyIncome: round(getTotalIncome(incomes)),
    savingsRate: Math.round(getSavingsRate(incomes, transactions, month, year)),
    byCategory: Object.fromEntries(
      Object.entries(getSpendingByCategory(transactions, month, year)).map(([c, v]) => [c, round(v)]),
    ),
    budgetStatus: getBudgetStatus(budgets, transactions, month, year).map(s => ({
      category: s.category, budget: s.effectiveBudget, actual: s.actual, status: s.status,
    })),
    anomalies: detectAnomalies(transactions, month, year).map(a => ({
      category: a.category, current: a.current, average: Math.round(a.average),
    })),
    sixMonthTotals: getMonthlyTrend(transactions, 6).map(m => ({ label: m.label, total: round(m.total) })),

    // This month against the user's own baseline, not against a fixed budget.
    whatChanged: {
      comparedThroughDay: deltas.cutoffDay,
      baselineMonths: deltas.historyMonths,
      total: {
        current: deltas.totals.current,
        usual: deltas.totals.average,
        change: deltas.totals.changeVsAverage,
      },
      byCategory: deltas.rows.slice(0, 6).map(r => ({
        category: r.category,
        current: r.current,
        usual: r.average,
        change: r.changeVsAverage,
        pct: r.pctVsAverage === null ? null : Math.round(r.pctVsAverage),
      })),
    },

    // Where the month lands if the rest of it resembles the recent past.
    monthEndProjection: {
      confidence: monthEnd.confidence,
      daysElapsed: monthEnd.daysElapsed,
      daysInMonth: monthEnd.daysInMonth,
      projected: monthEnd.totals.projected,
      budget: monthEnd.totals.budget,
      categoriesProjectedOver: monthEnd.categories
        .filter(c => c.overBy > 0)
        .map(c => ({ category: c.category, projected: c.projected, budget: c.budget, overBy: c.overBy })),
    },

    cashFlowOutlook: (forecast.rows || []).slice(0, 4).map(r => ({
      label: r.label, income: r.income, fixed: r.fixed, discretionary: r.discretionary, net: r.net,
    })),

    // Opportunities the app already identified; merchant names dropped on purpose.
    savingsOpportunities: opportunities.slice(0, 5).map(o => ({
      type: o.type,
      category: o.category || null,
      monthlySaving: round(o.monthlySaving),
      annualSaving: round(o.annualSaving),
    })),

    // Counts and totals only — the detail stays in the app.
    flagged: {
      possibleDuplicates: duplicates.length,
      duplicateTotal: round(duplicates.reduce((s, d) => s + (d.amount || 0), 0)),
      periodicBills: (irregular.bills || []).length,
      periodicSetAsidePerMonth: round((irregular.bills || []).reduce((s, b) => s + (b.setAsidePerMonth || 0), 0)),
    },

    goals: goalStatuses.slice(0, 5).map(g => ({
      name: g.goal.name,
      percentComplete: Math.round(g.percent),
      remaining: round(g.remaining),
      contributingPerMonth: round(g.pace),
      requiredPerMonth: g.required === null ? null : round(g.required),
      status: g.status,
      monthsLate: g.monthsLate,
    })),

    debts: debtPlan ? {
      totalBalance: round(debts.reduce((s, d) => s + (Number(d.balance) || 0), 0)),
      recommendedStrategy: debtPlan.recommended,
      interestSaved: debtPlan.interestSaved,
      monthsSaved: debtPlan.monthsSaved,
      items: debts.slice(0, 6).map(d => ({
        name: d.name,
        balance: round(d.balance),
        rate: Number(d.interestRate) || 0,
        deferred: !isInRepayment(d, opts),
      })),
    } : null,
  };
}
