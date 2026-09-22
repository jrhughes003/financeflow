// Default life plan + the starting point pulled from the rest of the app.

import { getGoalProgress } from '../calculations';
import { getCategoryAverages } from '../insights';
import { estimateAccountValue } from '../accounts';

let seq = 0;
export const newId = prefix => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`;

export const BUCKETS = [
  { id: 'nonreg', label: 'Non-registered (taxable)' },
  { id: 'tfsa', label: 'TFSA' },
  { id: 'rrsp', label: 'RRSP' },
  { id: 'fhsa', label: 'FHSA' },
  { id: 'cash', label: 'Cash / savings' },
];

export function createDefaultPlan() {
  return {
    version: 1,
    people: [
      { id: 'me', name: 'You', enabled: true, birthYear: null, retireAge: 65, cppStartAge: 65, oasStartAge: 65, cppAt65: 9000, tfsaRoom: 0, rrspRoom: 0, fhsaAnnual: 0 },
      { id: 'partner', name: 'Partner', enabled: false, birthYear: null, retireAge: 65, cppStartAge: 65, oasStartAge: 65, cppAt65: 9000, tfsaRoom: 0, rrspRoom: 0, fhsaAnnual: 0 },
    ],
    incomes: [],
    living: {
      spendingMode: 'history',
      spendingMonthly: 0,
      historyIncludesRent: false,
      rentMonthly: 0,
      rentGrowthPct: 3,
      retirementSpendingPct: 80,
      emergencyMonths: 3,
      cashOnHand: 0,
    },
    // investmentId → { bucket, owner }
    accountMap: {},
    events: [],
    assumptions: { inflationPct: 2.5, returnPct: 6, cashReturnPct: 2.5, homeAppreciationPct: 3, endAge: 95 },
  };
}

/** Fill in any fields added after a plan was saved (forward-compatible). */
export function normalizePlan(saved) {
  const d = createDefaultPlan();
  if (!saved) return d;
  return {
    ...d,
    ...saved,
    people: d.people.map(p => ({ ...p, ...(saved.people || []).find(s => s.id === p.id) })),
    living: { ...d.living, ...saved.living },
    assumptions: { ...d.assumptions, ...saved.assumptions },
    accountMap: saved.accountMap || {},
    incomes: saved.incomes || [],
    events: saved.events || [],
  };
}

/**
 * Starting point for the projection from the app's own data:
 *   cash            savings goals' progress + cash on hand entered in the plan
 *   accounts        investments at today's estimated value, in the chosen bucket
 *   debts           existing debts (deferred start dates respected)
 *   historyMonthly  average monthly spending over recent full months
 */
export function buildSnapshot(state, plan, { today = new Date() } = {}) {
  const goalsCash = (state.savings_goals || []).reduce((s, g) => s + getGoalProgress(g, state.transactions || []).currentAmount, 0);
  const accounts = (state.investments || []).map(inv => {
    const map = plan.accountMap[inv.id] || {};
    const value = estimateAccountValue(inv, { today }).value;
    return {
      id: inv.id,
      name: inv.name,
      bucket: map.bucket || 'nonreg',
      owner: map.owner || 'me',
      value,
      acb: Number(inv.costBasis) > 0 ? Math.min(Number(inv.costBasis), value) : value,
    };
  });
  const averages = getCategoryAverages(state.transactions || [], { today });
  return {
    cash: goalsCash + (Number(plan.living.cashOnHand) || 0),
    goalsCash,
    accounts,
    debts: (state.debts || []).filter(d => Number(d.balance) > 0),
    historyMonthly: averages.total,
    historyMonths: averages.months,
  };
}
