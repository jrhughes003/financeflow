import React, { useId, useState } from 'react';
import { Plus, Edit2, Trash2, Landmark } from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import { Panel, PanelGrid, KeyValue, Button, IconButton, Money, Badge, Meter, CategoryMark, Th } from './ui';
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

const INPUT = 'w-full h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent';

/* An outlined status tag for neutral facts ("deferred"); Badge has no info tone. */
function InfoTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-1 py-px border border-current text-info text-[10px] leading-[14px] font-medium uppercase tracking-[0.06em]">
      {children}
    </span>
  );
}

const COLS = 9;

export default function DebtTracker() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const { debts } = state;
  const fid = useId();
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
    <div className="space-y-2 animate-fade-in">
      <PanelGrid className="grid-flow-row-dense">
        {/* Summary */}
        <Panel title="Total owed" meta={`${debts.length} DEBT${debts.length === 1 ? '' : 'S'}`} className={`col-span-12 md:col-span-5 ${debts.length >= 2 ? 'xl:col-span-4' : 'xl:col-span-12'}`}>
          <div className="px-2.5 py-2 border-b border-line">
            <Money value={totalDebt} size="display" />
          </div>
          <KeyValue
            label="Due monthly"
            delta={deferred.length ? `${deferred.length} loan${deferred.length > 1 ? 's' : ''} deferred` : undefined}
            deltaClassName="text-info"
          >
            <Money value={totalMinPayment} size="sm" />
          </KeyValue>
          <KeyValue label="Debts">{debts.length}</KeyValue>
        </Panel>

        {/* Avalanche vs Snowball */}
        {debts.length >= 2 && (
          <Panel title="Payoff Strategy" className="col-span-12 md:col-span-7 xl:col-span-8">
            <div className="grid sm:grid-cols-2 gap-px bg-line">
              <div className="bg-surface">
                <div className="px-2.5 py-1.5 border-b border-line">
                  <p className="text-micro uppercase font-semibold text-accent-ink">Avalanche Method</p>
                  <p className="font-sans text-caption text-ink-muted mt-0.5">Pay highest interest rate first — saves the most money</p>
                </div>
                {[...debts].sort((a, b) => b.interestRate - a.interestRate).map((d, i) => (
                  <div key={d.id} className="flex items-center gap-2 h-row px-2.5 border-b border-line last:border-b-0 text-sm">
                    <span className="w-4 text-ink-muted">{i + 1}.</span>
                    <span className="flex-1 min-w-0 truncate text-ink">{d.name}</span>
                    <span className="text-ink-secondary">({d.interestRate}%)</span>
                  </div>
                ))}
              </div>
              <div className="bg-surface">
                <div className="px-2.5 py-1.5 border-b border-line">
                  <p className="text-micro uppercase font-semibold text-ink">Snowball Method</p>
                  <p className="font-sans text-caption text-ink-muted mt-0.5">Pay lowest balance first — builds momentum</p>
                </div>
                {[...debts].sort((a, b) => a.balance - b.balance).map((d, i) => (
                  <div key={d.id} className="flex items-center gap-2 h-row px-2.5 border-b border-line last:border-b-0 text-sm">
                    <span className="w-4 text-ink-muted">{i + 1}.</span>
                    <span className="flex-1 min-w-0 truncate text-ink">{d.name}</span>
                    <span className="text-ink-secondary">({formatCurrency(d.balance)})</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        )}

        {/* Debts */}
        <Panel
          title="Your Debts"
          meta={debts.length ? `${formatCurrency(totalDebt)} OUTSTANDING` : undefined}
          actions={(
            <Button size="sm" variant="primary" icon={Plus} onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); }}>
              Add Debt
            </Button>
          )}
          className="col-span-12"
        >
          {showForm && (
            <div className="bg-surface-sunk border-b border-line p-3 space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="col-span-2">
                  <label htmlFor={`${fid}-name`} className="label-micro block mb-1">Debt Name</label>
                  <input id={`${fid}-name`} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Chase Sapphire" className={INPUT} />
                </div>
                <div>
                  <label htmlFor={`${fid}-type`} className="label-micro block mb-1">Type</label>
                  <select id={`${fid}-type`} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={INPUT}>
                    {DEBT_TYPES.map(t => <option key={t} value={t}>{DEBT_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${fid}-bal`} className="label-micro block mb-1">Current Balance</label>
                  <input id={`${fid}-bal`} type="number" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} placeholder="$0" className={INPUT} />
                </div>
                <div>
                  <label htmlFor={`${fid}-rate`} className="label-micro block mb-1">Interest Rate %</label>
                  <input id={`${fid}-rate`} type="number" step="0.1" value={form.interestRate} onChange={e => setForm(f => ({ ...f, interestRate: e.target.value }))} placeholder="0" className={INPUT} />
                </div>
                <div>
                  <label htmlFor={`${fid}-min`} className="label-micro block mb-1">Min Monthly Payment</label>
                  <input id={`${fid}-min`} type="number" value={form.minimumPayment} onChange={e => setForm(f => ({ ...f, minimumPayment: e.target.value }))} placeholder="$0" className={INPUT} />
                </div>
                <div className="col-span-2">
                  <label htmlFor={`${fid}-orig`} className="label-micro block mb-1">
                    Original Balance {editId && <span className="text-ink-muted">(locked)</span>}
                  </label>
                  {editId ? (
                    <>
                      <input id={`${fid}-orig`} type="number" value={form.originalBalance} disabled
                        className="w-full h-7 px-2 bg-surface-hover border border-line rounded-control text-sm text-ink-muted cursor-not-allowed" />
                      <p className="font-sans text-caption text-ink-muted mt-1">Set at creation — locked so payoff progress stays stable.</p>
                    </>
                  ) : (
                    <input id={`${fid}-orig`} type="number" value={form.originalBalance} onChange={e => setForm(f => ({ ...f, originalBalance: e.target.value }))} placeholder="defaults to current balance" className={INPUT} />
                  )}
                </div>
                <div className="col-span-2 md:col-span-4">
                  <label htmlFor={`${fid}-start`} className="label-micro block mb-1">Repayment starts (optional)</label>
                  <input id={`${fid}-start`} type="date" value={form.repaymentStart} onChange={e => setForm(f => ({ ...f, repaymentStart: e.target.value }))}
                    className={`${INPUT} md:w-1/2`} />
                  <p className="font-sans text-caption text-ink-muted mt-1">For deferred loans (like student loans in school): no payment is expected before this date. Use 0% for interest-free loans.</p>
                </div>
                <div>
                  <label htmlFor={`${fid}-promo`} className="label-micro block mb-1">Promo rate ends (optional)</label>
                  <input id={`${fid}-promo`} type="date" value={form.promoUntil} onChange={e => setForm(f => ({ ...f, promoUntil: e.target.value }))} className={INPUT} />
                </div>
                <div>
                  <label htmlFor={`${fid}-post`} className="label-micro block mb-1">Rate after promo (%)</label>
                  <input id={`${fid}-post`} type="number" step="0.01" value={form.postPromoRate} onChange={e => setForm(f => ({ ...f, postPromoRate: e.target.value }))}
                    placeholder="e.g. 24.99" className={INPUT} />
                </div>
                <p className="col-span-2 font-sans text-caption text-ink-muted self-end">For a 0% intro card: the rate above applies until this date, then this one does. The payoff plan will try to clear it first.</p>
              </div>
              <div className="flex gap-1.5">
                <Button variant="primary" onClick={handleSave}>Save</Button>
                <Button variant="secondary" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</Button>
              </div>
            </div>
          )}

          {debts.length === 0
            ? <EmptyState
                compact
                icon={Landmark}
                title="No debts tracked"
                description="Add a loan or card to compare avalanche and snowball payoff plans, and to see interest-free or deferred loans handled properly."
                actionLabel="Add a debt"
                onAction={() => setShowForm(true)}
              />
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <Th>Debt</Th>
                      <Th className="hidden md:table-cell">Type</Th>
                      <Th numeric>Rate</Th>
                      <Th numeric className="hidden sm:table-cell">Payment</Th>
                      <Th numeric className="hidden lg:table-cell">Original</Th>
                      <Th numeric className="hidden sm:table-cell">Paid off</Th>
                      <Th numeric>Remaining</Th>
                      <Th className="w-[16%] hidden md:table-cell">Progress</Th>
                      <Th className="w-14"><span className="sr-only">Actions</span></Th>
                    </tr>
                  </thead>
                  {debts.map(d => {
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
                    const inRepayment = isInRepayment(d);

                    return (
                      <tbody key={d.id}>
                        <tr className="hover:bg-surface-hover">
                          <td className="h-row px-2.5 border-b border-line-faint text-ink font-medium">
                            <CategoryMark color={color} name={d.name} />
                          </td>
                          <td className="px-2.5 border-b border-line-faint text-ink-secondary hidden md:table-cell whitespace-nowrap">{DEBT_LABELS[d.type]}</td>
                          <td className="px-2.5 border-b border-line-faint text-right whitespace-nowrap text-ink-secondary">
                            {Number(d.interestRate) === 0 ? 'Interest-free' : `${d.interestRate}% APR`}
                          </td>
                          <td className="px-2.5 border-b border-line-faint text-right whitespace-nowrap hidden sm:table-cell">
                            {inRepayment
                              ? <span className="text-ink">Min payment {formatCurrency(d.minimumPayment)}/mo</span>
                              : d.minimumPayment > 0
                                ? <span className="text-ink-muted">{formatCurrency(d.minimumPayment)}/mo once repayment starts</span>
                                : <span className="text-ink-muted">No payment set yet</span>}
                          </td>
                          <td className="px-2.5 border-b border-line-faint text-right hidden lg:table-cell"><Money value={original} size="sm" className="text-ink-muted" /></td>
                          <td className="px-2.5 border-b border-line-faint text-right whitespace-nowrap hidden sm:table-cell text-ink-muted">{formatCurrency(original - d.balance)} paid off</td>
                          <td className="px-2.5 border-b border-line-faint text-right whitespace-nowrap font-semibold text-ink">{formatCurrency(d.balance)} remaining</td>
                          <td className="px-2.5 border-b border-line-faint hidden md:table-cell">
                            <div className="flex items-center gap-2">
                              <Meter value={paidOff} max={100} tone="positive" className="flex-1" />
                              <span className="text-caption text-ink-muted w-9 text-right">{paidOff.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-2.5 border-b border-line-faint">
                            <div className="flex gap-0.5 justify-end">
                              <IconButton icon={Edit2} label={`Edit ${d.name}`} onClick={() => openEdit(d)} />
                              <IconButton icon={Trash2} label={`Delete ${d.name}`} variant="danger" onClick={() => removeItem({ type: 'debt', item: d })} />
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={COLS} className="px-2.5 py-1.5 bg-surface-sunk border-b border-line">
                            {!inRepayment ? (
                              <div className="flex items-start gap-2.5">
                                <span className="shrink-0 mt-px"><InfoTag>Deferred — repayment starts {fmtMonth(d.repaymentStart)} ({monthsUntilRepayment(d)} mo)</InfoTag></span>
                                <p className="font-sans text-caption text-ink-secondary">
                                  {d.minimumPayment > 0 && payoff?.months
                                    ? <>Nothing due until {fmtMonth(d.repaymentStart)}. Then at {formatCurrency(d.minimumPayment)}/mo it's paid off in <strong>{payoff.months} months</strong> — around {fmtMonth(d.repaymentStart, payoff.months - 1)}{Number(d.interestRate) === 0 ? ', with no interest.' : '.'}</>
                                    : d.minimumPayment > 0
                                      ? <>Nothing due until {fmtMonth(d.repaymentStart)}. At {formatCurrency(d.minimumPayment)}/mo the interest outpaces the payment, so the balance would never fall.</>
                                      : <>Nothing due until {fmtMonth(d.repaymentStart)}. Add the expected monthly payment to see when it'll be paid off.</>}
                                </p>
                              </div>
                            ) : payoff && !payoff.months ? (
                              // The payment doesn't cover the interest, so there is no
                              // payoff date to show — saying so beats printing NaN.
                              <div className="flex items-start gap-2.5">
                                <Badge tone="negative" className="shrink-0 mt-px">Never</Badge>
                                <p className="font-sans text-caption text-negative">
                                  At {formatCurrency(d.minimumPayment)}/mo the interest outpaces the payment — this balance would never fall.
                                  Raising the payment above {formatCurrency((d.balance * (Number(d.interestRate) || 0)) / 100 / 12)} a month starts paying it down.
                                </p>
                              </div>
                            ) : payoff && (
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
                                {/* months and totalInterest are null together, when the payment never
                                    clears the balance — the branches above have already
                                    ruled that out, but the type is one object, not a union. */}
                                <p className="text-ink-secondary">At minimum payment: payoff in <strong className="text-ink">{payoff.months} months</strong> · Total interest: <strong className="text-negative">{formatCurrency(payoff.totalInterest ?? 0)}</strong></p>
                                {(payoff.months ?? 0) > 12 && (
                                  <div className="flex items-center gap-2">
                                    <label htmlFor={`${fid}-extra-${d.id}`} className="text-ink-muted shrink-0">Extra/mo:</label>
                                    <input
                                      id={`${fid}-extra-${d.id}`}
                                      type="number"
                                      value={extraPayment[d.id] || ''}
                                      onChange={e => setExtraPayment(ep => ({ ...ep, [d.id]: e.target.value }))}
                                      placeholder="$50"
                                      className="w-20 h-6 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
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
                          </td>
                        </tr>
                      </tbody>
                    );
                  })}
                </table>
              </div>
            )}
        </Panel>
      </PanelGrid>
    </div>
  );
}
