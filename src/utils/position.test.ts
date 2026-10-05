/*
 * "Where does my money stand" — the number you act on.
 *
 * The case it exists for: a card paid off in pieces through the month, where
 * the statement balance is a snapshot of a past date and tells you nothing.
 * The tests below pin the two decisions that make the figure trustworthy —
 * cards are subtracted at their *current* balance, and money owed to you is
 * kept out of spendable cash.
 */

import { describe, expect, it } from 'vitest';
import { buildPosition, hasPositionData } from './position';
import type { Debt, Income, Investment, RecurringTemplate, Transaction } from '../types/domain';

const cash = (o: Partial<Investment>): Investment =>
  ({ id: 'c', name: 'Chequing', type: 'cash', currentValue: 1000, ...o }) as Investment;
const card = (o: Partial<Debt>): Debt =>
  ({ id: 'd', name: 'Cobalt', type: 'credit_card', balance: 400, interestRate: 20, minimumPayment: 10, ...o }) as Debt;
const owedTx = (date: string, amount: number, repaid = 0): Transaction => ({
  id: `t${date}${amount}`, date, merchant: 'Flights', amount: amount * 2, category: 'travel',
  owed: { amount, payments: repaid ? [{ id: 'p', date, amount: repaid }] : [] },
} as Transaction);

const base = {
  today: new Date(2026, 9, 5),
  horizon: new Date(2026, 10, 1),
  investments: [] as Investment[],
  debts: [] as Debt[],
  transactions: [] as Transaction[],
  incomes: [] as Income[],
  recurringTemplates: [] as RecurringTemplate[],
  plan: {},
};

describe('available now', () => {
  it('is cash minus what the cards currently owe', () => {
    const p = buildPosition({ ...base, investments: [cash({ currentValue: 1500 })], debts: [card({ balance: 400 })] });
    expect(p.haveTotal).toBe(1500);
    expect(p.oweTotal).toBe(400);
    expect(p.availableNow).toBe(1100);
  });

  it('does not change when a card is paid, because the money was already spent', () => {
    // Pay $200 off the card: chequing drops, the card balance drops with it.
    const before = buildPosition({ ...base, investments: [cash({ currentValue: 1500 })], debts: [card({ balance: 400 })] });
    const after = buildPosition({ ...base, investments: [cash({ currentValue: 1300 })], debts: [card({ balance: 200 })] });
    expect(after.availableNow).toBe(before.availableNow);
  });

  it('adds up several cash accounts and several cards', () => {
    const p = buildPosition({
      ...base,
      investments: [cash({ id: 'a', currentValue: 1000 }), cash({ id: 'b', name: 'TD', currentValue: 250 })],
      debts: [card({ id: 'x', balance: 300 }), card({ id: 'y', name: 'Visa', balance: 150 })],
    });
    expect(p.availableNow).toBe(800);
    expect(p.have).toHaveLength(2);
    expect(p.owe).toHaveLength(2);
  });

  it('leaves invested accounts out of spendable cash', () => {
    // A TFSA is not money you can spend this week.
    const p = buildPosition({
      ...base,
      investments: [cash({ currentValue: 1000 }), { id: 't', name: 'TFSA', type: 'stocks', currentValue: 59000 } as Investment],
    });
    expect(p.haveTotal).toBe(1000);
  });

  it('leaves a student loan out of the card total', () => {
    // OSAP is a real debt, but it is not a revolving balance you clear monthly,
    // and subtracting it from this week's spending money would be nonsense.
    const p = buildPosition({
      ...base,
      investments: [cash({ currentValue: 1000 })],
      debts: [{ id: 'o', name: 'OSAP', type: 'student_loan', balance: 22776, interestRate: 0, minimumPayment: 0 } as Debt],
    });
    expect(p.oweTotal).toBe(0);
    expect(p.availableNow).toBe(1000);
  });

  it('can go negative, and says so rather than clamping', () => {
    const p = buildPosition({ ...base, investments: [cash({ currentValue: 100 })], debts: [card({ balance: 900 })] });
    expect(p.availableNow).toBe(-800);
  });

  it('is zero with nothing entered', () => {
    expect(buildPosition({ ...base }).availableNow).toBe(0);
  });
});

describe('money owed to you', () => {
  it('stays out of available, because it is not spendable yet', () => {
    const p = buildPosition({
      ...base,
      investments: [cash({ currentValue: 1000 })],
      transactions: [owedTx('2026-10-01', 500)],
    });
    expect(p.availableNow).toBe(1000);
    expect(p.owedToYouTotal).toBe(500);
  });

  it('splits by age, so an old debt reads differently from a new one', () => {
    const p = buildPosition({
      ...base,
      transactions: [
        owedTx('2026-09-28', 100), // a week old
        owedTx('2026-08-10', 50),  // ~2 months
        owedTx('2026-05-25', 64),  // over 3 months
      ],
    });
    const byLabel = Object.fromEntries(p.owedToYou.map(b => [b.label, b.amount]));
    expect(byLabel['Last 30 days']).toBe(100);
    expect(byLabel['1–3 months']).toBe(50);
    expect(byLabel['Over 3 months']).toBe(64);
    expect(p.owedToYouTotal).toBe(214);
  });

  it('counts only what is still outstanding after repayments', () => {
    const p = buildPosition({ ...base, transactions: [owedTx('2026-10-01', 500, 200)] });
    expect(p.owedToYouTotal).toBe(300);
  });

  it('drops empty age buckets rather than showing zeroes', () => {
    const p = buildPosition({ ...base, transactions: [owedTx('2026-10-01', 100)] });
    expect(p.owedToYou).toHaveLength(1);
  });

  it('ignores a transaction with no owed record', () => {
    const plain = { id: 'x', date: '2026-10-01', merchant: 'Coffee', amount: 5, category: 'dining_out' } as Transaction;
    expect(buildPosition({ ...base, transactions: [plain] }).owedToYouTotal).toBe(0);
  });
});

describe('coming in and out', () => {
  it('counts a one-off income dated before the horizon', () => {
    const p = buildPosition({
      ...base,
      incomes: [{ id: 'i', name: 'Bonus', amount: 2675, frequency: 'once', date: '2026-10-20' } as Income],
    });
    expect(p.incomingOneOffs).toHaveLength(1);
    expect(p.comingInTotal).toBe(2675);
  });

  it('ignores a one-off beyond the horizon', () => {
    const p = buildPosition({
      ...base,
      incomes: [{ id: 'i', name: 'Later', amount: 1000, frequency: 'once', date: '2027-01-01' } as Income],
    });
    expect(p.comingInTotal).toBe(0);
  });

  it('counts a bill due before the horizon', () => {
    const p = buildPosition({
      ...base,
      recurringTemplates: [{ id: 'r', merchant: 'Rent', amount: 1650, category: 'housing', frequency: 'monthly', nextDate: '2026-11-01' } as RecurringTemplate],
    });
    expect(p.comingOutTotal).toBe(1650);
  });

  it('leaves a switched-off bill out', () => {
    const p = buildPosition({
      ...base,
      recurringTemplates: [{ id: 'r', merchant: 'Old', amount: 50, category: 'other', frequency: 'monthly', nextDate: '2026-10-20', active: false } as RecurringTemplate],
    });
    expect(p.comingOutTotal).toBe(0);
  });

  it('counts planned payments but not planned income, which belongs in coming in', () => {
    const p = buildPosition({
      ...base,
      plan: {
        items: [
          { id: 'a', label: 'Tuition', amount: 2200, date: '2026-10-20', kind: 'out' },
          { id: 'b', label: 'Refund', amount: 100, date: '2026-10-21', kind: 'in' },
        ],
      },
    });
    expect(p.comingOutTotal).toBe(2200);
  });

  it('projects a balance at the horizon', () => {
    const p = buildPosition({
      ...base,
      investments: [cash({ currentValue: 2000 })],
      debts: [card({ balance: 500 })],
      transactions: [owedTx('2026-10-01', 300)],
      recurringTemplates: [{ id: 'r', merchant: 'Rent', amount: 1000, category: 'housing', frequency: 'monthly', nextDate: '2026-10-25' } as RecurringTemplate],
    });
    // 2000 − 500 + 300 − 1000
    expect(p.expectedByHorizon).toBe(800);
  });
});

describe('staleness', () => {
  it('reports the oldest confirmed balance, not the newest', () => {
    // A position is only as current as its stalest input.
    const p = buildPosition({
      ...base,
      investments: [cash({ id: 'a', asOfDate: '2026-10-04' }), cash({ id: 'b', name: 'TD', asOfDate: '2026-09-01' })],
    });
    expect(p.oldestAsOf).toBe('2026-09-01');
  });

  it('names accounts that have never been dated', () => {
    const p = buildPosition({ ...base, investments: [cash({ name: 'Chequing' })] });
    expect(p.undatedAccounts).toEqual(['Chequing']);
    expect(p.oldestAsOf).toBeNull();
  });
});

describe('hasPositionData', () => {
  it('is false until a cash account or card exists', () => {
    expect(hasPositionData([], [])).toBe(false);
    expect(hasPositionData([{ id: 't', name: 'TFSA', type: 'stocks', currentValue: 1 } as Investment], [])).toBe(false);
  });

  it('is true with either one', () => {
    expect(hasPositionData([cash({})], [])).toBe(true);
    expect(hasPositionData([], [card({})])).toBe(true);
  });
});

describe('hasCash', () => {
  it('is false when only cards are known', () => {
    // Cards without cash makes availableNow the whole card balance as a
    // negative — true, but not a position, and not something to seed a
    // projection with.
    const p = buildPosition({ ...base, debts: [card({ balance: 2340 })] });
    expect(p.availableNow).toBe(-2340);
    expect(p.hasCash).toBe(false);
  });

  it('is true once a cash account exists', () => {
    expect(buildPosition({ ...base, investments: [cash({})] }).hasCash).toBe(true);
  });
});
