// "Owed to me": purchases the user fronted for other people.
//
// A transaction can carry an optional `owed` record:
//   owed: {
//     amount:   total others owe back (≤ the transaction amount)
//     people:   optional — how many people it was split between, incl. the user
//     payments: [{ id, date, amount }]  repayments received
//     forgiven: true once the user writes off whatever is still unpaid
//     forgivenDate
//   }
//
// Accounting rule (user's choice): the full amount counts as spending until
// money actually comes back; each repayment reduces the purchase's spending in
// its ORIGINAL month. Forgiving an unpaid remainder changes nothing — it was
// already counted as spending. `t.amount` itself always stays the charged
// amount (what the bank statement shows).

import { format } from 'date-fns';

const roundCents = n => Math.round(n * 100) / 100;
const sum = arr => arr.reduce((s, v) => s + v, 0);

/** Owed amount for an even split: everyone except the user owes their share. */
export function owedFromSplit(amount, people) {
  const n = Math.floor(Number(people) || 0);
  const a = Number(amount) || 0;
  if (n < 2 || a <= 0) return 0;
  // Rounding to cents can hand over the whole amount on a tiny bill — a penny
  // split two ways rounds 0.005 up to 0.01 — which would say the payer owes
  // nothing for their own share. Property test found it; keep at least a cent.
  return Math.min(roundCents((a * (n - 1)) / n), roundCents(a - 0.01));
}

/**
 * Status of a transaction's owed record, or null when nothing is owed.
 * status: open (nothing back yet) | partial | settled | forgiven
 */
export function getOwedStatus(t) {
  const o = t && t.owed;
  const owed = roundCents(Number(o && o.amount) || 0);
  if (!o || owed <= 0) return null;
  const payments = [...(o.payments || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  // Repayments beyond what's owed don't count (can't recover more than owed).
  const repaid = roundCents(Math.min(owed, sum(payments.map(p => Number(p.amount) || 0))));
  const unpaid = roundCents(owed - repaid);
  const forgiven = !!o.forgiven && unpaid > 0;
  const remaining = forgiven ? 0 : unpaid;
  let status = 'open';
  if (unpaid <= 0) status = 'settled';
  else if (forgiven) status = 'forgiven';
  else if (repaid > 0) status = 'partial';
  return {
    owed,
    repaid,
    remaining,
    forgivenAmount: forgiven ? unpaid : 0,
    status,
    isOpen: remaining > 0,
    people: o.people || null,
    payments,
    lastPaymentDate: payments.length ? payments[payments.length - 1].date : null,
  };
}

/** What the purchase costs the user right now: charged amount minus repayments. */
export function effectiveAmount(t) {
  const s = getOwedStatus(t);
  const amount = Number(t.amount) || 0;
  if (!s || s.repaid <= 0) return amount;
  return roundCents(Math.max(0, amount - s.repaid));
}

/**
 * The transaction as spending math should see it. Returns the same object when
 * nothing has been repaid (cheap, and keeps identity for memoization).
 */
export function withEffectiveAmount(t) {
  const eff = effectiveAmount(t);
  return eff === t.amount ? t : { ...t, amount: eff, chargedAmount: t.amount };
}

let seq = 0;
const newId = () => `pay_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/**
 * Record a repayment. The amount is capped at what's still unpaid; a repayment
 * on a forgiven remainder re-opens it. Returns the updated transaction, or the
 * original unchanged if there's nothing to record.
 */
export function addRepayment(t, { amount, date = format(new Date(), 'yyyy-MM-dd'), id = newId() } = {}) {
  const s = getOwedStatus(t);
  if (!s) return t;
  const unpaid = roundCents(s.owed - s.repaid);
  const value = roundCents(Math.min(Number(amount) || 0, unpaid));
  if (value <= 0) return t;
  const payments = [...(t.owed.payments || []), { id, date, amount: value }];
  const stillUnpaid = roundCents(unpaid - value);
  return {
    ...t,
    owed: {
      ...t.owed,
      payments,
      // Money arriving means it wasn't really written off.
      forgiven: stillUnpaid > 0 ? false : t.owed.forgiven,
    },
  };
}

/** Remove a repayment (undo a mistake). */
export function removeRepayment(t, paymentId) {
  if (!t.owed) return t;
  return { ...t, owed: { ...t.owed, payments: (t.owed.payments || []).filter(p => p.id !== paymentId) } };
}

/** Write off (or un-write-off) whatever is still unpaid. */
export function setForgiven(t, forgiven, date = format(new Date(), 'yyyy-MM-dd')) {
  if (!t.owed) return t;
  const owed = { ...t.owed, forgiven: !!forgiven };
  if (forgiven) owed.forgivenDate = date;
  else delete owed.forgivenDate;
  return { ...t, owed };
}

/**
 * Build/replace the owed record from the entry form, keeping any repayments
 * already recorded. Returns undefined to clear it.
 */
export function buildOwed(existing, { enabled, amount, people }) {
  const value = roundCents(Number(amount) || 0);
  if (!enabled || value <= 0) return undefined;
  return {
    amount: value,
    people: Number(people) >= 2 ? Math.floor(Number(people)) : null,
    payments: existing?.payments || [],
    forgiven: existing?.forgiven || false,
    ...(existing?.forgivenDate ? { forgivenDate: existing.forgivenDate } : {}),
  };
}

/**
 * Everything the "Owed to me" page needs.
 * @returns { outstanding, openCount, open: [...], closed: [...],
 *            repaidThisMonth, totalRepaid, oldestOpenDate }
 * Items: { t, ...getOwedStatus(t), ageDays }
 */
export function getOwedSummary(transactions, { today = new Date() } = {}) {
  const monthPrefix = format(today, 'yyyy-MM');
  const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const items = (transactions || [])
    .map(t => ({ t, s: getOwedStatus(t) }))
    .filter(x => x.s)
    .map(({ t, s }) => {
      const [y, m, d] = (t.date || '').slice(0, 10).split('-').map(Number);
      const ageDays = y ? Math.max(0, Math.round((todayMs - new Date(y, m - 1, d).getTime()) / 86400000)) : 0;
      return { t, ...s, ageDays };
    });

  const open = items.filter(i => i.isOpen).sort((a, b) => (a.t.date || '').localeCompare(b.t.date || ''));
  const closed = items.filter(i => !i.isOpen)
    .sort((a, b) => ((b.lastPaymentDate || b.t.date || '')).localeCompare(a.lastPaymentDate || a.t.date || ''));
  const allPayments = items.flatMap(i => i.payments);

  return {
    outstanding: roundCents(sum(open.map(i => i.remaining))),
    openCount: open.length,
    open,
    closed,
    repaidThisMonth: roundCents(sum(allPayments.filter(p => (p.date || '').startsWith(monthPrefix)).map(p => p.amount))),
    totalRepaid: roundCents(sum(allPayments.map(p => p.amount))),
    oldestOpenDate: open.length ? open[0].t.date : null,
  };
}
