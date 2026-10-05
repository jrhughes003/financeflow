/*
 * Where the money actually is.
 *
 * The confusing case is a credit card paid off in pieces through the month.
 * Once you have paid part of it, the statement balance is a snapshot of a past
 * date and answers nothing; the current balance is the only figure that stays
 * true however often you pay.
 *
 * So the number that matters is:
 *
 *     available = cash on hand − what the cards currently owe
 *
 * which works because the ledger already counts a card purchase as spending on
 * the day it is made. The money is gone when you tap; paying the card later
 * just moves it from one place you have already spent it to another. A card
 * payment is a transfer, which is why none belong in the transaction list —
 * recording them would count every purchase twice.
 *
 * Money owed *to* you is deliberately kept out of `available`. It is not
 * spendable until it arrives, and a total that mixes the two reads as cash
 * when part of it is a hope. It is reported separately, split by age, because
 * a repayment five months overdue and a flight split from last week deserve
 * different confidence.
 */

import { differenceInCalendarDays, parseISO } from 'date-fns';
import type {
  Debt, Income, Investment, IsoDate, Money, RecurringTemplate, Transaction,
} from '../types/domain';
import type { CashPlan } from '../types/domain';
import { getOwedStatus } from './reimbursements';

/** Investment types that are spendable today rather than invested. */
const LIQUID_TYPES = new Set(['cash']);

/** Debt types that behave like a revolving balance you clear each month. */
const CARD_TYPES = new Set(['credit_card']);

export interface AccountBalance {
  id: string;
  name: string;
  balance: Money;
  /** When the figure was last confirmed. Absent means never. */
  asOf?: IsoDate;
}

export interface OwedBucket {
  label: string;
  amount: Money;
  count: number;
}

export interface Position {
  /** Spendable cash accounts. */
  have: AccountBalance[];
  haveTotal: Money;
  /** Current card balances, as positive numbers owed. */
  owe: AccountBalance[];
  oweTotal: Money;
  /** have − owe: the only figure that survives paying a card mid-month. */
  availableNow: Money;

  /** Outstanding reimbursements, split by how long they have been outstanding. */
  owedToYou: OwedBucket[];
  owedToYouTotal: Money;
  /** One-off income dated between now and the horizon. */
  incomingOneOffs: { label: string; amount: Money; date: IsoDate }[];
  comingInTotal: Money;

  /** Bills and planned payments falling before the horizon. */
  comingOut: { label: string; amount: Money; date: IsoDate }[];
  comingOutTotal: Money;

  expectedByHorizon: Money;
  /**
   * Whether any spendable account is known.
   *
   * Cards without cash gives an arithmetically true `availableNow` that is
   * practically meaningless — it is the whole card balance as a negative, and
   * seeding a projection with it would make the chart alarming for a
   * configuration reason rather than a financial one.
   */
  hasCash: boolean;
  /** The oldest as-of date among the balances, so staleness is visible. */
  oldestAsOf: IsoDate | null;
  /** Accounts with no as-of date at all. */
  undatedAccounts: string[];
}

export interface PositionInput {
  today: Date;
  /** How far ahead "expected by" looks. */
  horizon: Date;
  investments: Investment[];
  debts: Debt[];
  transactions: Transaction[];
  incomes: Income[];
  recurringTemplates: RecurringTemplate[];
  plan: CashPlan;
}

const round = (n: number): Money => Math.round(n * 100) / 100;
const iso = (d: Date): IsoDate => d.toISOString().slice(0, 10);

/**
 * Age buckets for outstanding reimbursements.
 *
 * Thresholds rather than a single total because the shape of the number is the
 * information: one ledger carried $1,530 outstanding, of which $323 was five
 * monthly phone bills nobody had chased. Those are not the same kind of asset
 * as a flight split from last week, and averaging them into one figure hides
 * the only thing worth acting on.
 */
const BUCKETS: { label: string; maxDays: number }[] = [
  { label: 'Last 30 days', maxDays: 30 },
  { label: '1–3 months', maxDays: 90 },
  { label: 'Over 3 months', maxDays: Number.POSITIVE_INFINITY },
];

export function buildPosition(input: PositionInput): Position {
  const { today, horizon, investments, debts, transactions, incomes, recurringTemplates, plan } = input;
  const horizonStr = iso(horizon);
  const todayStr = iso(today);

  // --- have -----------------------------------------------------------------
  const have: AccountBalance[] = (investments || [])
    .filter(a => a && LIQUID_TYPES.has(String(a.type)))
    .map(a => ({ id: a.id, name: a.name, balance: Number(a.currentValue) || 0, asOf: a.asOfDate }));
  const haveTotal = round(have.reduce((s, a) => s + a.balance, 0));

  // --- owe ------------------------------------------------------------------
  // Card balances are stored as positive debt, and shown that way: a minus
  // sign on a row labelled "owe" reads as a credit.
  const owe: AccountBalance[] = (debts || [])
    .filter(d => d && CARD_TYPES.has(String(d.type)))
    .map(d => ({ id: d.id, name: d.name, balance: Number(d.balance) || 0 }));
  const oweTotal = round(owe.reduce((s, d) => s + d.balance, 0));

  const availableNow = round(haveTotal - oweTotal);

  // --- coming in ------------------------------------------------------------
  const outstanding: { amount: Money; ageDays: number }[] = [];
  for (const t of transactions || []) {
    const status = getOwedStatus(t);
    if (!status || !status.isOpen || status.remaining <= 0.005) continue;
    const age = t.date ? differenceInCalendarDays(today, parseISO(t.date.slice(0, 10))) : 0;
    outstanding.push({ amount: status.remaining, ageDays: Math.max(0, age) });
  }
  const owedToYou: OwedBucket[] = BUCKETS.map(b => ({ label: b.label, amount: 0, count: 0 }));
  for (const item of outstanding) {
    const index = BUCKETS.findIndex(b => item.ageDays <= b.maxDays);
    const bucket = owedToYou[index === -1 ? owedToYou.length - 1 : index];
    bucket.amount = round(bucket.amount + item.amount);
    bucket.count += 1;
  }
  const owedToYouTotal = round(outstanding.reduce((s, o) => s + o.amount, 0));

  const incomingOneOffs = (incomes || [])
    .filter(i => i.frequency === 'once' && i.date && i.date > todayStr && i.date <= horizonStr)
    .map(i => ({ label: i.name || 'One-off income', amount: Number(i.amount) || 0, date: i.date as IsoDate }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const comingInTotal = round(
    owedToYouTotal + incomingOneOffs.reduce((s, i) => s + i.amount, 0),
  );

  // --- coming out -----------------------------------------------------------
  const comingOut: { label: string; amount: Money; date: IsoDate }[] = [];
  for (const tpl of recurringTemplates || []) {
    if (!tpl || tpl.active === false || !tpl.nextDate) continue;
    // Only the next occurrence: a horizon of a few weeks is about the bills
    // between here and there, not a full schedule.
    if (tpl.nextDate > todayStr && tpl.nextDate <= horizonStr) {
      comingOut.push({ label: tpl.merchant || 'Bill', amount: Number(tpl.amount) || 0, date: tpl.nextDate });
    }
  }
  for (const item of plan?.items || []) {
    if (item?.kind !== 'out' || !item.date) continue;
    if (item.date > todayStr && item.date <= horizonStr) {
      comingOut.push({ label: item.label || 'Payment', amount: Math.abs(Number(item.amount) || 0), date: item.date });
    }
  }
  comingOut.sort((a, b) => a.date.localeCompare(b.date));
  const comingOutTotal = round(comingOut.reduce((s, c) => s + c.amount, 0));

  // --- staleness ------------------------------------------------------------
  const dated = have.map(a => a.asOf).filter((d): d is IsoDate => Boolean(d));
  const oldestAsOf = dated.length ? dated.slice().sort()[0] : null;
  const undatedAccounts = have.filter(a => !a.asOf).map(a => a.name);

  return {
    have,
    haveTotal,
    owe,
    oweTotal,
    availableNow,
    owedToYou: owedToYou.filter(b => b.count > 0),
    owedToYouTotal,
    incomingOneOffs,
    comingInTotal,
    comingOut,
    comingOutTotal,
    expectedByHorizon: round(availableNow + comingInTotal - comingOutTotal),
    hasCash: have.length > 0,
    oldestAsOf,
    undatedAccounts,
  };
}

/** Whether the app knows enough to show a position at all. */
export function hasPositionData(investments: Investment[], debts: Debt[]): boolean {
  const liquid = (investments || []).some(a => a && LIQUID_TYPES.has(String(a.type)));
  const cards = (debts || []).some(d => d && CARD_TYPES.has(String(d.type)));
  return liquid || cards;
}

export { LIQUID_TYPES, CARD_TYPES };
