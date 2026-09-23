import React, { useState } from 'react';
import { Plus, Edit2, Trash2, PauseCircle , Landmark } from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import { Card, PageLede, Stat, Money } from './ui';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { calculateDebtPayoff, formatCurrency } from '../utils/calculations';
import { addMonths, format, parseISO } from 'date-fns';
import { isInRepayment, requiredPayment, monthsUntilRepayment } from '../utils/accounts';
import type { Debt, IsoDate } from '../types/domain';

const DEBT_TYPES = ['credit_card', 'loan', 'mortgage', 'student_loan', 'auto', 'other'];
// Keyed by Debt.type, which is a free string — an imported debt can carry a
// type these maps have never heard of, so both reads fall back.
const DEBT_LABELS: Record<string, string> = { credit_card: 'Credit Card', loan: 'Personal Loan', mortgage: 'Mortgage', student_loan: 'Student Loan', auto: 'Auto Loan', other: 'Other' };
const DEBT_COLORS: Record<string, string> = { credit_card: 'var(--c-negative)', loan: 'var(--c-data-2)', mortgage: 'var(--c-data-5)', student_loan: 'var(--c-data-1)', auto: 'var(--c-data-6)', other: 'var(--c-ink-muted)' };

/** The form's fields are the text in its inputs; the numbers are parsed on save. */
interface DebtForm {
  name: string;
  type: string;
  balance: string;
  interestRate: string;
  minimumPayment: string;
  originalBalance: string;
  repaymentStart: string;
  promoUntil: string;
  postPromoRate: string;
}

const EMPTY_FORM: DebtForm = { name: '', type: 'credit_card', balance: '', interestRate: '', minimumPayment: '', originalBalance: '', repaymentStart: '', promoUntil: '', postPromoRate: '' };
// A deferred debt always has a repaymentStart, but the type only says it may,
// so this tolerates its absence rather than asserting it away. The offset is
// for "and then paid off in N months", which reads off the same date.
const fmtMonth = (d: IsoDate | undefined, offset = 0): string =>
  (d ? format(addMonths(parseISO(d), offset), 'MMM yyyy') : '—');

export default function DebtTracker() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const { debts } = state;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<DebtForm>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  // Debt id → the extra-per-month text typed against it.
  const [extraPayment, setExtraPayment] = useState<Record<string, string>>({});

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  // Deferred loans (repayment not started yet) have no payment due right now.
  const totalMinPayment = debts.reduce((s, d) => s + requiredPayment(d), 0);
  const deferred = debts.filter(d => d.balance > 0 && !isInRepayment(d));

  const openEdit = (d: Debt) => {
    setForm({ ...EMPTY_FORM, ...d, balance: String(d.balance), interestRate: String(d.interestRate), minimumPayment: String(d.minimumPayment), originalBalance: String(d.originalBalance || d.balance), repaymentStart: d.repaymentStart || '', promoUntil: d.promoUntil || '', postPromoRate: d.postPromoRate === undefined ? '' : String(d.postPromoRate) });
    setEditId(d.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name || !form.balance) return;
    const payload = {
      id: editId || `d_${Date.now()}`,
      name: form.name,
      type: form.type,
      balance: parseFloat(form.balance) || 0,
      interestRate: parseFloat(form.interestRate) || 0,
      minimumPayment: parseFloat(form.minimumPayment) || 0,
      originalBalance: parseFloat(form.originalBalance) || parseFloat(form.balance) || 0,
      // Optional: loans in deferment (e.g. student loans) — no payments until this date.
      ...(form.repaymentStart ? { repaymentStart: form.repaymentStart } : {}),
      // A promotional rate only means something with both halves: when it
      // ends, and what it becomes.
      ...(form.promoUntil && form.postPromoRate !== ''
        ? { promoUntil: form.promoUntil, postPromoRate: parseFloat(form.postPromoRate) || 0 }
        : {}),
    };
    dispatch({ type: editId ? 'UPDATE_DEBT' : 'ADD_DEBT', payload });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditId(null);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Summary */}
      <Card>
        <PageLede
          label="Total owed"
          supporting={(
            <>
              <Stat label="Due monthly"
                hint={deferred.length ? `${deferred.length} loan${deferred.length > 1 ? 's' : ''} deferred` : null}>
                <Money value={totalMinPayment} />
              </Stat>
              <Stat label="Debts">{debts.length}</Stat>
            </>
          )}
        >
          <Money value={totalDebt} size="display" />
        </PageLede>
      </Card>

      {/* Debt cards */}
      <div className="bg-surface rounded-container border border-line p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-ink">Your Debts</h2>
          <button onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); }} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">
            <Plus className="w-3.5 h-3.5" /> Add Debt
          </button>
        </div>

        {showForm && (
          <div className="bg-negative-tint border border-negative rounded-container p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label-micro block mb-1.5">Debt Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Chase Sapphire" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Type</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent">
                  {DEBT_TYPES.map(t => <option key={t} value={t}>{DEBT_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="label-micro block mb-1.5">Current Balance</label>
                <input type="number" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} placeholder="$0" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Interest Rate %</label>
                <input type="number" step="0.1" value={form.interestRate} onChange={e => setForm(f => ({ ...f, interestRate: e.target.value }))} placeholder="0" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Min Monthly Payment</label>
                <input type="number" value={form.minimumPayment} onChange={e => setForm(f => ({ ...f, minimumPayment: e.target.value }))} placeholder="$0" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="label-micro block mb-1.5">
                  Original Balance {editId && <span className="text-ink-muted">(locked)</span>}
                </label>
                {editId ? (
                  <>
                    <input type="number" value={form.originalBalance} disabled
                      className="w-full h-9 px-2.5 bg-surface-hover border border-line rounded-control text-sm text-ink-muted cursor-not-allowed" />
                    <p className="text-micro text-ink-muted mt-1">Set at creation — locked so payoff progress stays stable.</p>
                  </>
                ) : (
                  <input type="number" value={form.originalBalance} onChange={e => setForm(f => ({ ...f, originalBalance: e.target.value }))} placeholder="defaults to current balance" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
                )}
              </div>
              <div className="col-span-2">
                <label className="label-micro block mb-1.5">Repayment starts (optional)</label>
                <input type="date" value={form.repaymentStart} onChange={e => setForm(f => ({ ...f, repaymentStart: e.target.value }))}
                  className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
                <p className="text-micro text-ink-muted mt-1">For deferred loans (like student loans in school): no payment is expected before this date. Use 0% for interest-free loans.</p>
              </div>
              <div>
                <label className="label-micro block mb-1.5">Promo rate ends (optional)</label>
                <input type="date" value={form.promoUntil} onChange={e => setForm(f => ({ ...f, promoUntil: e.target.value }))}
                  className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Rate after promo (%)</label>
                <input type="number" step="0.01" value={form.postPromoRate} onChange={e => setForm(f => ({ ...f, postPromoRate: e.target.value }))}
                  placeholder="e.g. 24.99" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
                <p className="text-micro text-ink-muted mt-1">For a 0% intro card: the rate above applies until this date, then this one does. The payoff plan will try to clear it first.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">Save</button>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {debts.length === 0
            ? <EmptyState
                compact
                icon={Landmark}
                title="No debts tracked"
                description="Add a loan or card to compare avalanche and snowball payoff plans, and to see interest-free or deferred loans handled properly."
                actionLabel="Add a debt"
                onAction={() => setShowForm(true)}
              />
            : debts.map(d => {
                // Clamp to 0–100: a balance above the original shouldn't
                // produce a negative or >100% bar.
                //
                // originalBalance is optional on records written before the
                // field existed, and it falls back to the current balance —
                // the same default the add and edit forms already apply, and
                // the one that reads correctly: nothing paid off yet. Zero
                // would report the whole balance as negative progress.
                const original = d.originalBalance ?? d.balance;
                const paidOff = original > 0
                  ? Math.max(0, Math.min(100, ((original - d.balance) / original) * 100))
                  : 0;
                const payoff = calculateDebtPayoff(d.balance, d.interestRate, d.minimumPayment);
                const extra = parseFloat(extraPayment[d.id]) || 0;
                const payoffExtra = extra > 0 ? calculateDebtPayoff(d.balance, d.interestRate, d.minimumPayment + extra) : null;
                const color = DEBT_COLORS[d.type] || 'var(--c-ink-muted)';

                return (
                  <div key={d.id} className="border border-line rounded-container p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                          <p className="font-semibold text-ink text-sm">{d.name}</p>
                          <span className="text-caption px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: color + '20', color }}>{DEBT_LABELS[d.type]}</span>
                        </div>
                        <p className="text-caption text-ink-muted mt-0.5">
                          {Number(d.interestRate) === 0 ? 'Interest-free' : `${d.interestRate}% APR`}
                          {' · '}{isInRepayment(d) ? `Min payment ${formatCurrency(d.minimumPayment)}/mo` : d.minimumPayment > 0 ? `${formatCurrency(d.minimumPayment)}/mo once repayment starts` : 'No payment set yet'}
                        </p>
                        {!isInRepayment(d) && (
                          <span className="inline-flex items-center gap-1 mt-1 text-caption font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">
                            <PauseCircle className="w-3.5 h-3.5" />Deferred — repayment starts {fmtMonth(d.repaymentStart)} ({monthsUntilRepayment(d)} mo)
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(d)} className="p-1.5 text-ink-muted hover:text-accent hover:bg-accent-tint rounded-control"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => removeItem({ type: 'debt', item: d })} aria-label={`Delete ${d.name}`} title={`Delete ${d.name}`} className="p-1.5 text-ink-muted hover:text-negative hover:bg-negative-tint rounded-control"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>

                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-ink-muted">{formatCurrency(original - d.balance)} paid off</span>
                      <span className="font-bold text-ink">{formatCurrency(d.balance)} remaining</span>
                    </div>
                    <div className="h-2.5 bg-surface-hover rounded-full overflow-hidden mb-3">
                      <div className="h-full rounded-full transition-all" style={{ width: `${paidOff}%`, backgroundColor: color }} />
                    </div>

                    {!isInRepayment(d) ? (
                      <div className="bg-surface-sunk rounded-control p-3 text-caption text-ink-secondary">
                        {d.minimumPayment > 0 && payoff?.months
                          ? <>Nothing due until {fmtMonth(d.repaymentStart)}. Then at {formatCurrency(d.minimumPayment)}/mo it's paid off in <strong>{payoff.months} months</strong> — around {fmtMonth(d.repaymentStart, payoff.months - 1)}{Number(d.interestRate) === 0 ? ', with no interest.' : '.'}</>
                          : d.minimumPayment > 0
                            ? <>Nothing due until {fmtMonth(d.repaymentStart)}. At {formatCurrency(d.minimumPayment)}/mo the interest outpaces the payment, so the balance would never fall.</>
                            : <>Nothing due until {fmtMonth(d.repaymentStart)}. Add the expected monthly payment to see when it'll be paid off.</>}
                      </div>
                    ) : payoff && !payoff.months ? (
                      // The payment doesn't cover the interest, so there is no
                      // payoff date to show — saying so beats printing NaN.
                      <div className="bg-negative-tint rounded-control p-3 text-caption text-negative">
                        At {formatCurrency(d.minimumPayment)}/mo the interest outpaces the payment — this balance would never fall.
                        Raising the payment above {formatCurrency((d.balance * (Number(d.interestRate) || 0)) / 100 / 12)} a month starts paying it down.
                      </div>
                    ) : payoff && (
                      <div className="bg-surface-sunk rounded-control p-3 text-caption space-y-1">
                        {/* months and totalInterest are null together, when the payment never
                            clears the balance — the branches above have already
                            ruled that out, but the type is one object, not a union. */}
                        <p className="text-ink-secondary">At minimum payment: payoff in <strong>{payoff.months} months</strong> · Total interest: <strong className="text-negative">{formatCurrency(payoff.totalInterest ?? 0)}</strong></p>
                        {(payoff.months ?? 0) > 12 && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-ink-muted shrink-0">Extra/mo:</span>
                            <input
                              type="number"
                              value={extraPayment[d.id] || ''}
                              onChange={e => setExtraPayment(ep => ({ ...ep, [d.id]: e.target.value }))}
                              placeholder="$50"
                              className="w-20 h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
                            />
                            {payoffExtra?.months && (
                              <span className="text-positive font-medium">
                                → {payoffExtra.months} months ({(payoff.months ?? 0) - payoffExtra.months} faster, save {formatCurrency((payoff.totalInterest ?? 0) - (payoffExtra.totalInterest ?? 0))})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
          }
        </div>
      </div>

      {/* Avalanche vs Snowball */}
      {debts.length >= 2 && (
        <div className="bg-surface rounded-container border border-line p-5">
          <h2 className="text-lg font-semibold text-ink mb-3">Payoff Strategy</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-accent-tint rounded-container p-4">
              <p className="font-semibold text-accent-ink text-sm mb-1">Avalanche Method</p>
              <p className="text-caption text-accent mb-2">Pay highest interest rate first — saves the most money</p>
              <div className="space-y-1">
                {[...debts].sort((a, b) => b.interestRate - a.interestRate).map((d, i) => (
                  <p key={d.id} className="text-caption text-accent-ink">{i + 1}. {d.name} ({d.interestRate}%)</p>
                ))}
              </div>
            </div>
            <div className="bg-surface-sunk rounded-container p-4">
              <p className="font-semibold text-ink text-sm mb-1">Snowball Method</p>
              <p className="text-caption text-ink-secondary mb-2">Pay lowest balance first — builds momentum</p>
              <div className="space-y-1">
                {[...debts].sort((a, b) => a.balance - b.balance).map((d, i) => (
                  <p key={d.id} className="text-caption text-ink-secondary">{i + 1}. {d.name} ({formatCurrency(d.balance)})</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
