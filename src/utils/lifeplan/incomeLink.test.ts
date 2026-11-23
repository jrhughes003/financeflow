import { describe, it, expect } from 'vitest';
import { annualTakeHome, incomeDrift } from './incomeLink';
import type { Income } from '../../types/domain';
import type { PlanIncome } from '../../types/lifeplan';

const salary: Income = { id: 'i1', name: 'Job', amount: 2500, frequency: 'biweekly' };
const plan = (extra: Partial<PlanIncome> = {}): PlanIncome => ({ id: 'p1', name: 'Job', personId: 'me', annual: 80000, ...extra });

describe('incomeDrift', () => {
  it('annualises take-home pay, and gives a one-off none', () => {
    expect(annualTakeHome(salary)).toBeCloseTo(65000, 0);
    expect(annualTakeHome({ ...salary, frequency: 'once', date: '2026-01-01' })).toBe(0);
  });

  it('is silent when unlinked or unchanged', () => {
    expect(incomeDrift(plan(), [salary])).toBeNull();
    expect(incomeDrift(plan({ linkedIncomeId: 'i1', linkedAnnualAtSync: annualTakeHome(salary) }), [salary])).toBeNull();
  });

  it('reports a raise and scales the gross figure by the same proportion', () => {
    const was = annualTakeHome(salary);
    const raised = { ...salary, amount: 2750 };
    const d = incomeDrift(plan({ linkedIncomeId: 'i1', linkedAnnualAtSync: was }), [raised]);
    expect(d?.ratio).toBeCloseTo(1.1, 5);
    expect(d?.suggestedAnnual).toBe(88000);
  });

  it('is silent when the linked source was deleted', () => {
    expect(incomeDrift(plan({ linkedIncomeId: 'gone', linkedAnnualAtSync: 1 }), [salary])).toBeNull();
  });
});
