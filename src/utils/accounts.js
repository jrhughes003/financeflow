// Accounts the app can't link to (e.g. a portfolio held with a financial
// advisor). The user anchors the balance to a statement, and the app estimates
// today's value from there:
//
//   statement balance (as of `asOfDate`)
//   + growth at the expected annual return (compounded daily)
//   − the scheduled monthly withdrawal (on `withdrawalDay` each month)
//   ± extra deposits / withdrawals the user logs
//
// Investment fields used here (all optional, so older investments keep working):
//   currentValue      balance as of asOfDate (the statement balance)
//   asOfDate          YYYY-MM-DD of that balance; without it the value is static
//   annualReturn      expected return, percent per year
//   monthlyWithdrawal amount taken out each month
//   withdrawalDay     day of month it comes out (1–28)
//   withdrawalCountsAsIncome  count the monthly withdrawal as income (default true)
//   entries           [{ id, date, type: 'deposit' | 'withdrawal', amount, note }]
//
// Also: debt helpers for loans that are deferred (no payments due yet).

import { format, addMonths, parseISO, differenceInCalendarMonths, getDaysInMonth } from 'date-fns';

const roundCents = n => Math.round(n * 100) / 100;
const ymd = d => format(d, 'yyyy-MM-dd');
const DAY_MS = 86400000;

const growthFactor = (annualPct, days) => Math.pow(1 + (Number(annualPct) || 0) / 100, days / 365);
const monthlyRate = annualPct => Math.pow(1 + (Number(annualPct) || 0) / 100, 1 / 12) - 1;
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / DAY_MS);

export const isTrackedAccount = inv => !!(inv && inv.asOfDate);

/**
 * Does a logged entry move the estimate, or is it already in the statement
 * balance? Entries after the statement date always count; entries on/before it
 * are assumed included — unless they were logged after the statement was
 * entered (e.g. synced to today's statement, then logged a withdrawal today).
 */
export function entryCountsAfterStatement(inv, e) {
  const anchor = inv.asOfDate.slice(0, 10);
  if (e.date > anchor) return true;
  return e.date === anchor && !!inv.syncedAt && !!e.createdAt && e.createdAt > inv.syncedAt;
}

/** Scheduled withdrawal dates strictly after `afterStr` and on/before `untilStr`. */
export function scheduledWithdrawalDates(inv, afterStr, untilStr) {
  if (!(Number(inv.monthlyWithdrawal) > 0)) return [];
  const day = Math.min(28, Math.max(1, Number(inv.withdrawalDay) || 1));
  const out = [];
  let d = parseISO(afterStr.slice(0, 7) + '-01');
  for (let i = 0; i < 1200; i++) {
    const s = ymd(new Date(d.getFullYear(), d.getMonth(), Math.min(day, getDaysInMonth(d))));
    if (s > untilStr) break;
    if (s > afterStr) out.push(s);
    d = addMonths(d, 1);
  }
  return out;
}

/**
 * Estimated value on `today`, with a breakdown of what moved it since the
 * statement. Untracked investments just return their static value.
 */
export function estimateAccountValue(inv, { today = new Date() } = {}) {
  const base = Number(inv.currentValue) || 0;
  if (!isTrackedAccount(inv)) {
    return { tracked: false, value: base, anchorBalance: base, growth: 0, scheduledWithdrawn: 0, extraWithdrawn: 0, deposited: 0, events: [] };
  }
  const anchor = inv.asOfDate.slice(0, 10);
  const todayStr = ymd(today);
  if (todayStr < anchor) {
    return { tracked: true, value: base, anchorBalance: base, anchorDate: anchor, growth: 0, scheduledWithdrawn: 0, extraWithdrawn: 0, deposited: 0, events: [] };
  }

  const events = [
    ...scheduledWithdrawalDates(inv, anchor, todayStr).map(date => ({ date, type: 'scheduled', amount: Number(inv.monthlyWithdrawal) })),
    // Entries on/before the statement date are already reflected in its balance.
    ...(inv.entries || []).filter(e => e.date <= todayStr && entryCountsAfterStatement(inv, e)).map(e => ({ ...e, amount: Number(e.amount) || 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let value = base;
  let cursor = anchor;
  let growth = 0, scheduledWithdrawn = 0, extraWithdrawn = 0, deposited = 0;
  const grow = to => {
    const before = value;
    value *= growthFactor(inv.annualReturn, daysBetween(cursor, to));
    growth += value - before;
    cursor = to;
  };
  events.forEach(e => {
    grow(e.date);
    if (e.type === 'deposit') { value += e.amount; deposited += e.amount; return; }
    const taken = Math.min(value, e.amount); // can't withdraw more than is there
    value -= taken;
    if (e.type === 'scheduled') scheduledWithdrawn += taken; else extraWithdrawn += taken;
  });
  grow(todayStr);

  return {
    tracked: true,
    value: roundCents(value),
    anchorBalance: base,
    anchorDate: anchor,
    growth: roundCents(growth),
    scheduledWithdrawn: roundCents(scheduledWithdrawn),
    extraWithdrawn: roundCents(extraWithdrawn),
    deposited: roundCents(deposited),
    events,
  };
}

/** Total (estimated) value across investments. */
export function getInvestmentsValue(investments, { today = new Date() } = {}) {
  return roundCents((investments || []).reduce((s, inv) => s + estimateAccountValue(inv, { today }).value, 0));
}

/**
 * Month-by-month projection from today's estimate, continuing the scheduled
 * withdrawal. Reports when the money runs out (if it does) and the withdrawal
 * that growth alone could sustain without shrinking the balance.
 */
export function projectAccount(inv, { today = new Date(), months = 360 } = {}) {
  const start = estimateAccountValue(inv, { today }).value;
  const r = monthlyRate(inv.annualReturn);
  const w = Number(inv.monthlyWithdrawal) || 0;
  const timeline = [{ month: 0, balance: roundCents(start) }];
  let balance = start;
  let depletedMonth = null;
  for (let m = 1; m <= months; m++) {
    balance = balance * (1 + r) - w;
    if (balance <= 0) { balance = 0; depletedMonth = m; timeline.push({ month: m, balance: 0 }); break; }
    timeline.push({ month: m, balance: roundCents(balance) });
  }
  const sustainableMonthly = roundCents(start * r);
  return {
    start: roundCents(start),
    timeline,
    depletedMonth,
    depletionDate: depletedMonth ? ymd(addMonths(today, depletedMonth)) : null,
    sustainableMonthly,
    // Withdrawing no more than growth → balance holds or grows.
    sustainable: w <= sustainableMonthly + 0.005,
    balanceAt: m => (timeline[Math.min(m, timeline.length - 1)] || timeline[timeline.length - 1]).balance,
  };
}

/** Re-anchor to a new statement: that balance as of that date. Entries are kept as history. */
export function syncToStatement(inv, { balance, date, now = Date.now() }) {
  return { ...inv, currentValue: roundCents(Number(balance) || 0), asOfDate: date, syncedAt: now };
}

let seq = 0;
export function addAccountEntry(inv, { type, amount, date, note = '', now = Date.now() }) {
  const value = roundCents(Number(amount) || 0);
  if (value <= 0 || (type !== 'deposit' && type !== 'withdrawal')) return inv;
  const entry = { id: `acct_${now.toString(36)}_${(seq++).toString(36)}`, type, amount: value, date, note, createdAt: now };
  return { ...inv, entries: [...(inv.entries || []), entry] };
}

export function removeAccountEntry(inv, entryId) {
  return { ...inv, entries: (inv.entries || []).filter(e => e.id !== entryId) };
}

/**
 * Income sources for all income math: the user's incomes plus each account's
 * scheduled monthly withdrawal when it's marked to count as income. These
 * synthetic entries are never saved — they're derived on the fly.
 */
export function getIncomeSources(incomes, investments) {
  const fromAccounts = (investments || [])
    .filter(inv => Number(inv.monthlyWithdrawal) > 0 && inv.withdrawalCountsAsIncome !== false)
    .map(inv => ({
      id: `acct_income_${inv.id}`,
      name: `${inv.name} withdrawal`,
      amount: Number(inv.monthlyWithdrawal),
      frequency: 'monthly',
      source: 'account_withdrawal',
      investmentId: inv.id,
      derived: true,
    }));
  return [...(incomes || []), ...fromAccounts];
}

// ---------------------------------------------------------------------------
// Deferred debts
// ---------------------------------------------------------------------------

/** Has this debt's repayment started (as of today)? No start date = already in repayment. */
export function isInRepayment(debt, { today = new Date() } = {}) {
  return !debt.repaymentStart || debt.repaymentStart.slice(0, 10) <= ymd(today);
}

/** Payment currently required each month (0 while deferred). */
export function requiredPayment(debt, opts) {
  return isInRepayment(debt, opts) ? Number(debt.minimumPayment) || 0 : 0;
}

/** Months from today until repayment starts (0 if already started). */
export function monthsUntilRepayment(debt, { today = new Date() } = {}) {
  if (isInRepayment(debt, { today })) return 0;
  return Math.max(0, differenceInCalendarMonths(parseISO(debt.repaymentStart), today));
}
