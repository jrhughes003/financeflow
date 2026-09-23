import { describe, it, expect } from 'vitest';
import {
  isTrackedAccount, scheduledWithdrawalDates, estimateAccountValue, getInvestmentsValue,
  projectAccount, syncToStatement, addAccountEntry, removeAccountEntry, getIncomeSources,
  isInRepayment, requiredPayment, monthsUntilRepayment,
} from './accounts';
import { makeDebt, makeIncome, makeInvestment } from '../test/factories';
import type { AccountEntry, Investment } from '../types/domain';

const day = (y: number, m: number, d: number) => new Date(y, m, d);
const advisor = (over: Partial<Investment> = {}): Investment => makeInvestment({
  id: 'adv', name: 'Advisor account', type: 'retirement',
  currentValue: 100000, asOfDate: '2026-06-30', annualReturn: 6,
  monthlyWithdrawal: 2000, withdrawalDay: 1, entries: [],
  ...over,
});

describe('scheduledWithdrawalDates', () => {
  it('lists each month’s withdrawal after the statement date', () => {
    expect(scheduledWithdrawalDates(advisor(), '2026-06-30', '2026-09-22')).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect(scheduledWithdrawalDates(advisor({ withdrawalDay: 15 }), '2026-06-15', '2026-08-14')).toEqual(['2026-07-15']);
    expect(scheduledWithdrawalDates(advisor({ monthlyWithdrawal: 0 }), '2026-06-30', '2026-09-22')).toEqual([]);
  });
});

describe('estimateAccountValue', () => {
  it('returns the static value for untracked investments', () => {
    const r = estimateAccountValue(makeInvestment({ currentValue: 5000 }), { today: day(2026, 8, 22) });
    expect(r).toMatchObject({ tracked: false, value: 5000 });
    expect(isTrackedAccount(makeInvestment({ currentValue: 5000 }))).toBe(false);
  });

  it('grows at the expected return with no withdrawals', () => {
    const r = estimateAccountValue(advisor({ monthlyWithdrawal: 0, asOfDate: '2025-09-22' }), { today: day(2026, 8, 22) });
    expect(r.value).toBeCloseTo(106000, -1); // one year at 6%
    expect(r.growth).toBeCloseTo(6000, -1);
  });

  it('subtracts scheduled withdrawals and applies logged entries after the statement', () => {
    const inv = advisor({
      entries: [
        { id: 'e1', date: '2026-06-20', type: 'withdrawal', amount: 9999 }, // before statement → ignored
        { id: 'e2', date: '2026-08-15', type: 'withdrawal', amount: 1500 },
        { id: 'e3', date: '2026-09-10', type: 'deposit', amount: 500 },
      ],
    });
    const r = estimateAccountValue(inv, { today: day(2026, 8, 22) });
    expect(r.scheduledWithdrawn).toBe(6000);
    expect(r.extraWithdrawn).toBe(1500);
    expect(r.deposited).toBe(500);
    // 100k − 6000 − 1500 + 500 = 93,000 before growth; ~84 days at 6% adds ~1.3k.
    expect(r.value).toBeGreaterThan(94000);
    expect(r.value).toBeLessThan(94600);
    expect(r.value).toBeCloseTo(100000 + r.growth - 6000 - 1500 + 500, 2);
  });

  it('never goes negative', () => {
    const r = estimateAccountValue(advisor({ currentValue: 3000 }), { today: day(2026, 8, 22) });
    expect(r.value).toBe(0);
    // Everything that was there, including the little growth before it ran out.
    expect(r.scheduledWithdrawn).toBeCloseTo(3000 + r.growth, 2);
  });

  it('totals across investments', () => {
    expect(getInvestmentsValue([advisor({ monthlyWithdrawal: 0, annualReturn: 0 }), makeInvestment({ currentValue: 2500 })], { today: day(2026, 8, 22) })).toBe(102500);
  });
});

describe('projectAccount', () => {
  it('reports when withdrawals run the account down', () => {
    const p = projectAccount(advisor({ asOfDate: '2026-09-22' }), { today: day(2026, 8, 22) });
    expect(p.sustainable).toBe(false);
    // Annuity formula: n = −ln(1 − PV·r/PMT) / ln(1 + r) ≈ 57.4 → runs out in month 58.
    expect(p.depletedMonth).toBe(58);
    expect(p.sustainableMonthly).toBeCloseTo(486.76, 1);
    expect(p.timeline[p.timeline.length - 1].balance).toBe(0);
  });

  it('is sustainable when withdrawals are within growth', () => {
    const p = projectAccount(advisor({ asOfDate: '2026-09-22', monthlyWithdrawal: 400 }), { today: day(2026, 8, 22), months: 120 });
    expect(p.sustainable).toBe(true);
    expect(p.depletedMonth).toBeNull();
    expect(p.balanceAt(120)).toBeGreaterThan(100000);
  });
});

describe('statement sync and entries', () => {
  it('re-anchors to a new statement and keeps history', () => {
    const inv = addAccountEntry(advisor(), { type: 'withdrawal', amount: 300, date: '2026-07-10' });
    // The statement form passes its raw input string; syncToStatement coerces it.
    const synced = syncToStatement(inv, { balance: '97250.5' as unknown as number, date: '2026-08-31' });
    expect(synced).toMatchObject({ currentValue: 97250.5, asOfDate: '2026-08-31' });
    expect(synced.entries).toHaveLength(1);
    // Only the Sep 1 withdrawal applies after the new statement.
    expect(estimateAccountValue(synced, { today: day(2026, 8, 22) }).scheduledWithdrawn).toBe(2000);
  });

  it('counts an entry logged after syncing to a same-day statement', () => {
    const synced = syncToStatement(advisor(), { balance: 90000, date: '2026-09-22', now: 1000 });
    const before = addAccountEntry(advisor({ asOfDate: '2026-09-22', syncedAt: 5000 }), { type: 'withdrawal', amount: 400, date: '2026-09-22', now: 1000 });
    const after = addAccountEntry(synced, { type: 'withdrawal', amount: 400, date: '2026-09-22', now: 2000 });
    const today = day(2026, 8, 22);
    expect(estimateAccountValue(after, { today }).value).toBe(89600);    // logged after the sync → counts
    expect(estimateAccountValue(before, { today }).extraWithdrawn).toBe(0); // logged before the sync → in the statement
  });

  it('adds and removes entries, ignoring invalid ones', () => {
    const a = addAccountEntry(advisor(), { type: 'deposit', amount: 250, date: '2026-09-01' });
    expect(a.entries).toBeDefined();
    if (!a.entries) throw new Error('unreachable');
    expect(a.entries[0]).toMatchObject({ type: 'deposit', amount: 250 });
    expect(addAccountEntry(a, { type: 'deposit', amount: 0, date: '2026-09-01' })).toBe(a);
    // 'bogus' is the point of the case: an unknown entry type must be rejected.
    expect(addAccountEntry(a, { type: 'bogus' as AccountEntry['type'], amount: 5, date: '2026-09-01' })).toBe(a);
    expect(removeAccountEntry(a, a.entries[0].id).entries).toEqual([]);
  });
});

describe('getIncomeSources', () => {
  it('adds scheduled withdrawals as derived monthly income unless opted out', () => {
    const incomes = [makeIncome({ id: 'job', name: 'Job', amount: 500, frequency: 'monthly' })];
    const sources = getIncomeSources(incomes, [advisor(), advisor({ id: 'x', withdrawalCountsAsIncome: false }), makeInvestment({ id: 'y', currentValue: 1 })]);
    expect(sources).toHaveLength(2);
    expect(sources[1]).toMatchObject({ amount: 2000, frequency: 'monthly', derived: true, investmentId: 'adv' });
  });
});

describe('deferred debts', () => {
  const today = day(2026, 8, 22);
  const loan = makeDebt({ balance: 20000, interestRate: 0, minimumPayment: 250, repaymentStart: '2027-06-01' });

  it('has no required payment until repayment starts', () => {
    expect(isInRepayment(loan, { today })).toBe(false);
    expect(requiredPayment(loan, { today })).toBe(0);
    expect(monthsUntilRepayment(loan, { today })).toBe(9);
    expect(requiredPayment(loan, { today: day(2027, 5, 1) })).toBe(250);
    expect(requiredPayment({ ...loan, repaymentStart: undefined }, { today })).toBe(250);
  });
});
