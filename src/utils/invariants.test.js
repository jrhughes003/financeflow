// Property-based tests over the money rules.
//
// The rest of the suite is example-based: given these transactions, expect this
// total. That catches the cases someone thought of. These assert properties
// that must hold for *every* input — money is conserved, a balance only falls,
// a share is between 0 and 100 — and let fast-check search for the input that
// breaks them, shrinking any failure to its smallest form.
//
// For a ledger, the invariants are the specification. A rollover that quietly
// creates money, or a payoff schedule that grows a balance, is wrong in a way
// no single example would necessarily reveal.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  getTotalExpenses, getSpendingByCategory, getBudgetStatus, getRolloverCarry,
  toMonthlyAmount, calculateDebtPayoff, getGoalProgress, getTotalIncome,
} from './calculations';
import { effectiveAmount, getOwedStatus, owedFromSplit } from './reimbursements';

const CATEGORIES = ['dining_out', 'groceries', 'transportation', 'subscriptions', 'products'];
const cents = () => fc.integer({ min: 1, max: 500000 }).map(n => n / 100);

// A transaction in the shape the app actually stores.
const transaction = (month = 8, year = 2026) => fc.record({
  id: fc.uuid(),
  date: fc.integer({ min: 1, max: 28 }).map(d => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
  merchant: fc.constantFrom('Metro', 'Esso', 'Netflix', 'Sakura', 'Amazon'),
  amount: cents(),
  category: fc.constantFrom(...CATEGORIES),
  isException: fc.boolean(),
  kind: fc.constantFrom('expense', 'savings'),
});

const ledger = (min = 0, max = 40) => fc.array(transaction(), { minLength: min, maxLength: max });

describe('spending is conserved', () => {
  it('per-category totals always sum to the overall total', () => {
    fc.assert(fc.property(ledger(), txns => {
      const total = getTotalExpenses(txns, 8, 2026);
      const summed = Object.values(getSpendingByCategory(txns, 8, 2026)).reduce((a, b) => a + b, 0);
      expect(Math.abs(total - summed)).toBeLessThan(0.02); // rounding only
    }), { numRuns: 300 });
  });

  it('never counts a savings transfer or a flagged one-off as spending', () => {
    fc.assert(fc.property(ledger(1), txns => {
      const spendable = txns.filter(t => t.kind !== 'savings' && !t.isException);
      const total = getTotalExpenses(txns, 8, 2026);
      const ceiling = spendable.reduce((sum, t) => sum + t.amount, 0);
      expect(total).toBeLessThanOrEqual(ceiling + 0.02);
      expect(total).toBeGreaterThanOrEqual(0);
    }), { numRuns: 300 });
  });

  it('adding a transaction can only increase the total', () => {
    fc.assert(fc.property(ledger(), transaction(), (txns, extra) => {
      const before = getTotalExpenses(txns, 8, 2026);
      const after = getTotalExpenses([...txns, extra], 8, 2026);
      expect(after).toBeGreaterThanOrEqual(before - 0.02);
    }), { numRuns: 300 });
  });
});

describe('reimbursements never invent money', () => {
  const owedTransaction = fc.record({
    amount: cents(),
    payments: fc.array(cents(), { maxLength: 5 }),
    share: fc.double({ min: 0.01, max: 1, noNaN: true }),
  }).map(({ amount, payments, share }) => ({
    id: 'x', date: '2026-09-10', merchant: 'Dinner', category: 'dining_out',
    amount, kind: 'expense', isException: false,
    owed: {
      amount: Math.round(amount * share * 100) / 100,
      payments: payments.map((a, i) => ({ id: `p${i}`, date: '2026-09-11', amount: a })),
      forgiven: false,
    },
  }));

  it('a purchase never costs more than was charged, nor less than nothing', () => {
    fc.assert(fc.property(owedTransaction, t => {
      const effective = effectiveAmount(t);
      expect(effective).toBeGreaterThanOrEqual(0);
      expect(effective).toBeLessThanOrEqual(t.amount + 0.001);
    }), { numRuns: 500 });
  });

  it('repayments are capped at what was owed, however many are logged', () => {
    fc.assert(fc.property(owedTransaction, t => {
      const status = getOwedStatus(t);
      if (!status) return;
      expect(status.repaid).toBeLessThanOrEqual(status.owed + 0.001);
      expect(status.remaining).toBeGreaterThanOrEqual(0);
      expect(status.repaid + status.remaining).toBeCloseTo(status.owed, 2);
    }), { numRuns: 500 });
  });

  it('an even split always leaves the payer with their own share', () => {
    fc.assert(fc.property(cents(), fc.integer({ min: 2, max: 12 }), (amount, people) => {
      const owed = owedFromSplit(amount, people);
      expect(owed).toBeLessThan(amount);
      const mine = amount - owed;
      expect(Math.abs(mine - amount / people)).toBeLessThan(0.02);
    }), { numRuns: 300 });
  });
});

describe('budgets and rollover', () => {
  const budget = fc.record({
    id: fc.uuid(),
    category: fc.constantFrom(...CATEGORIES),
    amount: fc.integer({ min: 0, max: 3000 }),
    flex: fc.integer({ min: 0, max: 50 }),
    rollover: fc.boolean(),
  });

  it('the effective limit is the budget plus its carry, and never negative', () => {
    fc.assert(fc.property(fc.array(budget, { minLength: 1, maxLength: 5 }), ledger(), (budgets, txns) => {
      // Positional, not by category: two budgets may share a category (an
      // import can produce that), and looking up by name would compare a row
      // against the wrong source.
      getBudgetStatus(budgets, txns, 8, 2026).forEach((status, index) => {
        expect(status.effectiveBudget).toBeGreaterThanOrEqual(0);
        expect(status.effectiveBudget).toBeCloseTo(Math.max(0, budgets[index].amount + status.carry), 2);
      });
    }), { numRuns: 200 });
  });

  it('carries nothing when rollover is off', () => {
    fc.assert(fc.property(budget, ledger(), (b, txns) => {
      const carry = getRolloverCarry({ ...b, rollover: false }, txns, 8, 2026);
      expect(carry).toBe(0);
    }), { numRuns: 200 });
  });

  it('variance always reconciles the limit against what was spent', () => {
    fc.assert(fc.property(fc.array(budget, { minLength: 1, maxLength: 5 }), ledger(), (budgets, txns) => {
      getBudgetStatus(budgets, txns, 8, 2026).forEach(s => {
        expect(s.variance).toBeCloseTo(s.effectiveBudget - s.actual, 2);
        if (s.effectiveBudget > 0) expect(s.percentUsed).toBeCloseTo((s.actual / s.effectiveBudget) * 100, 2);
      });
    }), { numRuns: 200 });
  });
});

describe('debt payoff', () => {
  it('a balance only ever falls, and the schedule ends', () => {
    fc.assert(fc.property(
      fc.integer({ min: 100, max: 100000 }),
      fc.double({ min: 0, max: 29.99, noNaN: true }),
      fc.integer({ min: 50, max: 5000 }),
      (balance, rate, payment) => {
        const result = calculateDebtPayoff(balance, rate, payment);
        if (!result || result.months === null || result.months === Infinity) {
          // Not payable: the payment doesn't cover the interest. That's a valid
          // answer, and the only one that may be non-finite.
          return;
        }
        expect(result.months).toBeGreaterThan(0);
        expect(Number.isFinite(result.months)).toBe(true);
        expect(result.totalInterest).toBeGreaterThanOrEqual(-0.01);
        // Paying interest can never cost less than the principal itself.
        expect(result.totalPaid ?? balance + result.totalInterest).toBeGreaterThanOrEqual(balance - 0.01);
      },
    ), { numRuns: 400 });
  });

  it('a bigger payment is never slower, and a higher rate never cheaper', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1000, max: 50000 }),
      fc.double({ min: 1, max: 25, noNaN: true }),
      fc.integer({ min: 200, max: 2000 }),
      (balance, rate, payment) => {
        const slow = calculateDebtPayoff(balance, rate, payment);
        const fast = calculateDebtPayoff(balance, rate, payment * 2);
        if (!slow?.months || !fast?.months) return;
        expect(fast.months).toBeLessThanOrEqual(slow.months);

        const cheap = calculateDebtPayoff(balance, rate, payment);
        const dear = calculateDebtPayoff(balance, Math.min(29.99, rate * 2), payment);
        if (cheap?.months && dear?.months) {
          expect(dear.totalInterest).toBeGreaterThanOrEqual(cheap.totalInterest - 0.01);
        }
      },
    ), { numRuns: 300 });
  });
});

describe('income and goals', () => {
  it('monthly equivalents scale linearly with the amount', () => {
    fc.assert(fc.property(
      cents(),
      fc.constantFrom('weekly', 'biweekly', 'semi-monthly', 'monthly', 'annual'),
      fc.integer({ min: 2, max: 5 }),
      (amount, frequency, factor) => {
        const single = toMonthlyAmount(amount, frequency);
        const scaled = toMonthlyAmount(amount * factor, frequency);
        expect(scaled).toBeCloseTo(single * factor, 4);
        expect(single).toBeGreaterThan(0);
      },
    ), { numRuns: 300 });
  });

  it('total income is the sum of its sources, in any order', () => {
    const source = fc.record({
      id: fc.uuid(),
      amount: cents(),
      frequency: fc.constantFrom('weekly', 'biweekly', 'semi-monthly', 'monthly', 'annual'),
    });
    fc.assert(fc.property(fc.array(source, { maxLength: 8 }), sources => {
      const total = getTotalIncome(sources);
      const reversed = getTotalIncome([...sources].reverse());
      expect(total).toBeCloseTo(reversed, 6);
      expect(total).toBeGreaterThanOrEqual(0);
    }), { numRuns: 300 });
  });

  it('goal progress is the opening balance plus contributions, and the percentage is bounded', () => {
    const goal = fc.record({ id: fc.constant('g1'), currentAmount: cents(), targetAmount: cents() });
    const contributions = fc.array(cents(), { maxLength: 10 });
    fc.assert(fc.property(goal, contributions, (g, amounts) => {
      const txns = amounts.map((amount, i) => ({
        id: `t${i}`, date: '2026-09-10', merchant: 'Savings', amount,
        category: 'savings', kind: 'savings', goalId: 'g1', isException: false,
      }));
      const progress = getGoalProgress(g, txns);
      const expected = g.currentAmount + amounts.reduce((a, b) => a + b, 0);
      expect(progress.currentAmount).toBeCloseTo(expected, 2);
      expect(progress.percent).toBeGreaterThanOrEqual(0);
      expect(progress.percent).toBeLessThanOrEqual(100); // capped, never 143%
    }), { numRuns: 300 });
  });
});
