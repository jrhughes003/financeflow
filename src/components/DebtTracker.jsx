import React, { useState } from 'react';
import { Plus, Edit2, Trash2, PauseCircle , Landmark } from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { calculateDebtPayoff, formatCurrency } from '../utils/calculations';
import { addMonths, format, parseISO } from 'date-fns';
import { isInRepayment, requiredPayment, monthsUntilRepayment } from '../utils/accounts';

const DEBT_TYPES = ['credit_card', 'loan', 'mortgage', 'student_loan', 'auto', 'other'];
const DEBT_LABELS = { credit_card: 'Credit Card', loan: 'Personal Loan', mortgage: 'Mortgage', student_loan: 'Student Loan', auto: 'Auto Loan', other: 'Other' };
const DEBT_COLORS = { credit_card: '#ef4444', loan: '#f97316', mortgage: '#8b5cf6', student_loan: '#3b82f6', auto: '#10b981', other: '#94a3b8' };

const EMPTY_FORM = { name: '', type: 'credit_card', balance: '', interestRate: '', minimumPayment: '', originalBalance: '', repaymentStart: '' };
const fmtMonth = d => format(parseISO(d), 'MMM yyyy');

export default function DebtTracker() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const { debts } = state;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [extraPayment, setExtraPayment] = useState({});

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  // Deferred loans (repayment not started yet) have no payment due right now.
  const totalMinPayment = debts.reduce((s, d) => s + requiredPayment(d), 0);
  const deferred = debts.filter(d => d.balance > 0 && !isInRepayment(d));

  const openEdit = (d) => {
    setForm({ ...EMPTY_FORM, ...d, balance: String(d.balance), interestRate: String(d.interestRate), minimumPayment: String(d.minimumPayment), originalBalance: String(d.originalBalance || d.balance), repaymentStart: d.repaymentStart || '' });
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
    };
    dispatch({ type: editId ? 'UPDATE_DEBT' : 'ADD_DEBT', payload });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditId(null);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-red-50 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Total Debt</p>
          <p className="text-xl font-bold text-red-600">{formatCurrency(totalDebt)}</p>
        </div>
        <div className="bg-orange-50 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Payments Due Monthly</p>
          <p className="text-xl font-bold text-orange-600">{formatCurrency(totalMinPayment)}</p>
          {deferred.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">{deferred.length} loan{deferred.length > 1 ? 's' : ''} deferred — not due yet</p>
          )}
        </div>
      </div>

      {/* Debt cards */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Your Debts</h2>
          <button onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); }} className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">
            <Plus className="w-3.5 h-3.5" /> Add Debt
          </button>
        </div>

        {showForm && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Debt Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Chase Sapphire" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500">
                  {DEBT_TYPES.map(t => <option key={t} value={t}>{DEBT_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Current Balance</label>
                <input type="number" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} placeholder="$0" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Interest Rate %</label>
                <input type="number" step="0.1" value={form.interestRate} onChange={e => setForm(f => ({ ...f, interestRate: e.target.value }))} placeholder="0" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Min Monthly Payment</label>
                <input type="number" value={form.minimumPayment} onChange={e => setForm(f => ({ ...f, minimumPayment: e.target.value }))} placeholder="$0" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Original Balance {editId && <span className="text-gray-400">(locked)</span>}
                </label>
                {editId ? (
                  <>
                    <input type="number" value={form.originalBalance} disabled
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-100 text-gray-500 cursor-not-allowed" />
                    <p className="text-[11px] text-gray-400 mt-1">Set at creation — locked so payoff progress stays stable.</p>
                  </>
                ) : (
                  <input type="number" value={form.originalBalance} onChange={e => setForm(f => ({ ...f, originalBalance: e.target.value }))} placeholder="defaults to current balance" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
                )}
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Repayment starts (optional)</label>
                <input type="date" value={form.repaymentStart} onChange={e => setForm(f => ({ ...f, repaymentStart: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
                <p className="text-[11px] text-gray-400 mt-1">For deferred loans (like student loans in school): no payment is expected before this date. Use 0% for interest-free loans.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium">Save</button>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-white">Cancel</button>
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
                // Clamp to 0–100: a balance above the original (or a missing
                // original) shouldn't produce a negative or >100% bar.
                const paidOff = d.originalBalance > 0
                  ? Math.max(0, Math.min(100, ((d.originalBalance - d.balance) / d.originalBalance) * 100))
                  : 0;
                const payoff = calculateDebtPayoff(d.balance, d.interestRate, d.minimumPayment);
                const extra = parseFloat(extraPayment[d.id]) || 0;
                const payoffExtra = extra > 0 ? calculateDebtPayoff(d.balance, d.interestRate, d.minimumPayment + extra) : null;
                const color = DEBT_COLORS[d.type] || '#94a3b8';

                return (
                  <div key={d.id} className="border border-gray-100 rounded-xl p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                          <p className="font-semibold text-gray-900 text-sm">{d.name}</p>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: color + '20', color }}>{DEBT_LABELS[d.type]}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {Number(d.interestRate) === 0 ? 'Interest-free' : `${d.interestRate}% APR`}
                          {' · '}{isInRepayment(d) ? `Min payment ${formatCurrency(d.minimumPayment)}/mo` : d.minimumPayment > 0 ? `${formatCurrency(d.minimumPayment)}/mo once repayment starts` : 'No payment set yet'}
                        </p>
                        {!isInRepayment(d) && (
                          <span className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">
                            <PauseCircle className="w-3.5 h-3.5" />Deferred — repayment starts {fmtMonth(d.repaymentStart)} ({monthsUntilRepayment(d)} mo)
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(d)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => removeItem({ type: 'debt', item: d })} aria-label={`Delete ${d.name}`} title={`Delete ${d.name}`} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>

                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-gray-500">{formatCurrency(d.originalBalance - d.balance)} paid off</span>
                      <span className="font-bold text-gray-900">{formatCurrency(d.balance)} remaining</span>
                    </div>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mb-3">
                      <div className="h-full rounded-full transition-all" style={{ width: `${paidOff}%`, backgroundColor: color }} />
                    </div>

                    {!isInRepayment(d) ? (
                      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
                        {d.minimumPayment > 0 && payoff
                          ? <>Nothing due until {fmtMonth(d.repaymentStart)}. Then at {formatCurrency(d.minimumPayment)}/mo it's paid off in <strong>{payoff.months} months</strong> — around {format(addMonths(parseISO(d.repaymentStart), payoff.months - 1), 'MMM yyyy')}{Number(d.interestRate) === 0 ? ', with no interest.' : '.'}</>
                          : <>Nothing due until {fmtMonth(d.repaymentStart)}. Add the expected monthly payment to see when it'll be paid off.</>}
                      </div>
                    ) : payoff && (
                      <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
                        <p className="text-gray-600">At minimum payment: payoff in <strong>{payoff.months} months</strong> · Total interest: <strong className="text-red-500">{formatCurrency(payoff.totalInterest)}</strong></p>
                        {payoff.months > 12 && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-gray-500 shrink-0">Extra/mo:</span>
                            <input
                              type="number"
                              value={extraPayment[d.id] || ''}
                              onChange={e => setExtraPayment(ep => ({ ...ep, [d.id]: e.target.value }))}
                              placeholder="$50"
                              className="w-20 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:border-blue-500"
                            />
                            {payoffExtra && (
                              <span className="text-green-600 font-medium">
                                → {payoffExtra.months} months ({payoff.months - payoffExtra.months} faster, save {formatCurrency(payoff.totalInterest - payoffExtra.totalInterest)})
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
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Payoff Strategy</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-blue-50 rounded-xl p-4">
              <p className="font-semibold text-blue-800 text-sm mb-1">Avalanche Method</p>
              <p className="text-xs text-blue-600 mb-2">Pay highest interest rate first — saves the most money</p>
              <div className="space-y-1">
                {[...debts].sort((a, b) => b.interestRate - a.interestRate).map((d, i) => (
                  <p key={d.id} className="text-xs text-blue-700">{i + 1}. {d.name} ({d.interestRate}%)</p>
                ))}
              </div>
            </div>
            <div className="bg-purple-50 rounded-xl p-4">
              <p className="font-semibold text-purple-800 text-sm mb-1">Snowball Method</p>
              <p className="text-xs text-purple-600 mb-2">Pay lowest balance first — builds momentum</p>
              <div className="space-y-1">
                {[...debts].sort((a, b) => a.balance - b.balance).map((d, i) => (
                  <p key={d.id} className="text-xs text-purple-700">{i + 1}. {d.name} ({formatCurrency(d.balance)})</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
