// Keeping Plan Ahead's salary honest against the Income page.
//
// The two can't simply share a number. Plan Ahead wants gross annual pay,
// because it applies Canadian tax itself; the Income page holds what lands in
// the bank. So a plan income is *linked* to an Income source instead, with a
// note of what that source paid when the plan was last brought up to date.
// When the Income page moves — a raise, a new job — the plan says so, and
// offers to move the gross figure by the same proportion.

import type { Income } from '../../types/domain';
import type { PlanIncome } from '../../types/lifeplan';
import { toMonthlyAmount } from '../calculations';

/** A recurring income source's take-home pay per year. One-offs have none. */
export function annualTakeHome(income: Income): number {
  if (income.frequency === 'once') return 0;
  return Math.round(toMonthlyAmount(income.amount, income.frequency) * 12 * 100) / 100;
}

export interface IncomeDrift {
  source: Income;
  was: number;
  now: number;
  /** now / was, for scaling the gross figure. */
  ratio: number;
  /** The plan's gross pay moved by the same proportion. */
  suggestedAnnual: number;
}

/** What changed on the Income page since this plan income was last synced, if anything. */
export function incomeDrift(planIncome: PlanIncome, incomes: Income[]): IncomeDrift | null {
  if (!planIncome.linkedIncomeId) return null;
  const source = incomes.find(i => i.id === planIncome.linkedIncomeId);
  if (!source) return null;
  const now = annualTakeHome(source);
  const was = planIncome.linkedAnnualAtSync ?? now;
  // Under half a percent is rounding in a pay frequency conversion, not news.
  if (was <= 0 || Math.abs(now - was) / was < 0.005) return null;
  const ratio = now / was;
  return { source, was, now, ratio, suggestedAnnual: Math.round(planIncome.annual * ratio / 100) * 100 };
}
