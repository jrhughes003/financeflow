// Renderer-side AI helper. Thin wrapper over window.api.ai with graceful
// fallback: when not running in Electron (or no key / AI disabled), calls return
// a structured failure so callers can fall back to deterministic behavior.

import { isElectron } from '../storage/storage';
import { getAllCategories } from '../utils/categorization';
import {
  getSpendingByCategory, getBudgetStatus, getTotalExpenses, getTotalIncome,
  getSavingsRate, detectAnomalies, getMonthlyTrend,
} from '../utils/calculations';

export const aiSupported = isElectron;

export async function getAiStatus() {
  if (!isElectron) return { encryptionAvailable: false, hasKey: false };
  try { return await window.api.ai.status(); }
  catch { return { encryptionAvailable: false, hasKey: false }; }
}

export async function setAiKey(key) {
  if (!isElectron) return { ok: false, error: 'unavailable' };
  return window.api.ai.setKey(key);
}

export async function clearAiKey() {
  if (!isElectron) return { ok: false, error: 'unavailable' };
  return window.api.ai.clearKey();
}

// Run a feature. Returns { ok, data } or { ok:false, error }. Never throws.
export async function runAi(feature, input) {
  if (!isElectron) return { ok: false, error: 'unavailable' };
  try { return await window.api.ai.run(feature, input); }
  catch (err) { return { ok: false, error: err?.message || 'AI request failed' }; }
}

// Compact category taxonomy (id + name only) for prompts.
export function taxonomy(customCategories = []) {
  return getAllCategories(customCategories).map(c => ({ id: c.id, name: c.name }));
}

// Build an aggregate-only summary for insights / Q&A — no raw transactions.
export function buildSummary(state, month, year) {
  const { transactions, budgets, incomes } = state;
  return {
    period: { month, year },
    totalExpenses: getTotalExpenses(transactions, month, year),
    totalMonthlyIncome: getTotalIncome(incomes),
    savingsRate: Math.round(getSavingsRate(incomes, transactions, month, year)),
    byCategory: getSpendingByCategory(transactions, month, year),
    budgetStatus: getBudgetStatus(budgets, transactions, month, year).map(s => ({
      category: s.category, budget: s.effectiveBudget, actual: s.actual, status: s.status,
    })),
    anomalies: detectAnomalies(transactions, month, year).map(a => ({
      category: a.category, current: a.current, average: Math.round(a.average),
    })),
    sixMonthTotals: getMonthlyTrend(transactions, 6).map(m => ({ label: m.label, total: m.total })),
  };
}
