import { describe, it, expect } from 'vitest';
import {
  owedFromSplit, getOwedStatus, effectiveAmount, withEffectiveAmount,
  addRepayment, removeRepayment, setForgiven, buildOwed, getOwedSummary,
} from './reimbursements';
import { getTotalExpenses, getSpendingByCategory } from './calculations';
import { makeOwed, makeTransaction } from '../test/factories';
import type { Money, OwedPayment, OwedRecord, Transaction } from '../types/domain';

const tx = (over: Partial<Transaction> = {}): Transaction => makeTransaction({
  id: Math.random().toString(36).slice(2),
  date: '2026-09-10', merchant: 'Dinner', amount: 100, category: 'dining_out', isException: false,
  ...over,
});
// Several cases leave a repayment's date off on purpose — getOwedStatus sorts
// with `(a.date || '')` and must cope with records written that way.
const owed = (
  amount: Money, payments: Partial<OwedPayment>[] = [], extra: Partial<OwedRecord> = {},
): OwedRecord => makeOwed({ amount, payments: payments as OwedPayment[], ...extra });

describe('owedFromSplit', () => {
  it('everyone but you owes their share', () => {
    expect(owedFromSplit(100, 4)).toBe(75);
    expect(owedFromSplit(90, 3)).toBe(60);
    expect(owedFromSplit(100, 1)).toBe(0);
    expect(owedFromSplit(0, 4)).toBe(0);
  });
});

describe('getOwedStatus', () => {
  it('is null when nothing is owed', () => {
    expect(getOwedStatus(tx())).toBeNull();
    expect(getOwedStatus(tx({ owed: owed(0) }))).toBeNull();
  });

  it('tracks open, partial, settled, and forgiven', () => {
    expect(getOwedStatus(tx({ owed: owed(75) }))).toMatchObject({ status: 'open', repaid: 0, remaining: 75, isOpen: true });
    expect(getOwedStatus(tx({ owed: owed(75, [{ id: 'p', date: '2026-09-12', amount: 25 }]) })))
      .toMatchObject({ status: 'partial', repaid: 25, remaining: 50 });
    expect(getOwedStatus(tx({ owed: owed(75, [{ id: 'p', date: '2026-09-12', amount: 75 }]) })))
      .toMatchObject({ status: 'settled', remaining: 0, isOpen: false });
    expect(getOwedStatus(tx({ owed: owed(75, [{ id: 'p', date: '2026-09-12', amount: 25 }], { forgiven: true }) })))
      .toMatchObject({ status: 'forgiven', remaining: 0, forgivenAmount: 50, isOpen: false });
  });

  it('never counts more repaid than owed', () => {
    const s = getOwedStatus(tx({ owed: owed(50, [{ id: 'p', amount: 80 }]) }));
    expect(s).not.toBeNull();
    if (!s) throw new Error('unreachable');
    expect(s.repaid).toBe(50);
  });
});

describe('effective amount (full amount until repaid)', () => {
  it('only repayments reduce spending — forgiving does not', () => {
    expect(effectiveAmount(tx({ owed: owed(75) }))).toBe(100);
    expect(effectiveAmount(tx({ owed: owed(75, [{ id: 'p', amount: 30 }]) }))).toBe(70);
    expect(effectiveAmount(tx({ owed: owed(75, [{ id: 'p', amount: 30 }], { forgiven: true }) }))).toBe(70);
  });

  it('keeps object identity when nothing was repaid', () => {
    const t = tx({ owed: owed(75) });
    expect(withEffectiveAmount(t)).toBe(t);
    expect(withEffectiveAmount(tx({ owed: owed(75, [{ id: 'p', amount: 75 }]) }))).toMatchObject({ amount: 25, chargedAmount: 100 });
  });

  it('flows into spending totals in the purchase month', () => {
    const txns = [
      tx({ owed: owed(75, [{ id: 'p', date: '2026-10-02', amount: 50 }]) }), // repaid next month
      tx({ category: 'groceries', amount: 40 }),
    ];
    expect(getTotalExpenses(txns, 8, 2026)).toBe(90); // Sep: 50 + 40
    expect(getSpendingByCategory(txns, 8, 2026)).toEqual({ dining_out: 50, groceries: 40 });
    expect(getTotalExpenses(txns, 9, 2026)).toBe(0);   // Oct: repayment isn't income or spending
  });
});

describe('addRepayment / removeRepayment / setForgiven', () => {
  const base = tx({ owed: owed(75) });

  it('records partial and full repayments, capped at what is unpaid', () => {
    const a = addRepayment(base, { amount: 25, date: '2026-09-12', id: 'p1' });
    expect(getOwedStatus(a)).toMatchObject({ status: 'partial', remaining: 50 });
    const b = addRepayment(a, { amount: 500, date: '2026-09-13', id: 'p2' });
    expect(b.owed).toBeDefined();
    if (!b.owed) throw new Error('unreachable');
    expect(b.owed.payments.map(p => p.amount)).toEqual([25, 50]);
    expect(getOwedStatus(b)?.status).toBe('settled');
    expect(addRepayment(b, { amount: 10 })).toBe(b); // nothing left to repay
    expect(addRepayment(base, { amount: 0 })).toBe(base);
    expect(base.owed?.payments).toEqual([]); // inputs aren't mutated
  });

  it('undoes a repayment', () => {
    const a = addRepayment(base, { amount: 25, id: 'p1' });
    expect(getOwedStatus(removeRepayment(a, 'p1'))?.status).toBe('open');
  });

  it('forgives the remainder, and a later payment re-opens it', () => {
    const f = setForgiven(addRepayment(base, { amount: 25, id: 'p1' }), true, '2026-09-20');
    expect(getOwedStatus(f)).toMatchObject({ status: 'forgiven', remaining: 0, forgivenAmount: 50 });
    expect(f.owed?.forgivenDate).toBe('2026-09-20');
    expect(getOwedStatus(addRepayment(f, { amount: 20 }))).toMatchObject({ status: 'partial', remaining: 30 });
    expect(getOwedStatus(setForgiven(f, false))?.status).toBe('partial');
  });
});

describe('buildOwed', () => {
  it('builds from the form and keeps existing repayments', () => {
    // The owed form hands buildOwed its raw input strings; it coerces with Number().
    expect(buildOwed(undefined, { enabled: true, amount: '75' as unknown as number, people: '4' as unknown as number })).toEqual({ amount: 75, people: 4, payments: [], forgiven: false });
    const existing = owed(75, [{ id: 'p', amount: 25 }]);
    const rebuilt = buildOwed(existing, { enabled: true, amount: 60, people: '' as unknown as number });
    expect(rebuilt).toBeDefined();
    if (!rebuilt) throw new Error('unreachable');
    expect(rebuilt.payments).toEqual(existing.payments);
    expect(buildOwed(existing, { enabled: false, amount: 60 })).toBeUndefined();
    expect(buildOwed(undefined, { enabled: true, amount: 0 })).toBeUndefined();
  });
});

describe('getOwedSummary', () => {
  it('splits open and closed items with totals', () => {
    const txns = [
      tx({ id: 'a', date: '2026-08-01', owed: owed(40) }),
      tx({ id: 'b', date: '2026-09-01', owed: owed(75, [{ id: 'p', date: '2026-09-15', amount: 25 }]) }),
      tx({ id: 'c', date: '2026-07-01', owed: owed(30, [{ id: 'q', date: '2026-08-15', amount: 30 }]) }),
      tx({ id: 'd' }),
    ];
    const s = getOwedSummary(txns, { today: new Date(2026, 8, 21) });
    expect(s.outstanding).toBe(90);
    expect(s.openCount).toBe(2);
    expect(s.open.map(i => i.t.id)).toEqual(['a', 'b']); // oldest first
    expect(s.open[0].ageDays).toBe(51);
    expect(s.closed.map(i => i.t.id)).toEqual(['c']);
    expect(s.repaidThisMonth).toBe(25);
    expect(s.totalRepaid).toBe(55);
  });
});
