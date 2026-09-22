import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { HandCoins, Check, X, Undo2, Edit2, ChevronDown, Users } from 'lucide-react';
import { useFinancial, useGetCategory } from '../context/FinancialContext';
import { formatCurrency } from '../utils/calculations';
import { getOwedSummary, addRepayment, removeRepayment, setForgiven } from '../utils/reimbursements';
import TransactionEntry from './TransactionEntry';

const fmtDate = d => format(parseISO(d.slice(0, 10)), 'MMM d, yyyy');
const today = () => format(new Date(), 'yyyy-MM-dd');
const age = days => (days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`);

const STATUS = {
  open: { label: 'Not paid back', cls: 'bg-amber-50 text-amber-700' },
  partial: { label: 'Partly paid back', cls: 'bg-sky-50 text-sky-700' },
  settled: { label: 'Paid back', cls: 'bg-emerald-50 text-emerald-700' },
  forgiven: { label: 'Forgiven', cls: 'bg-gray-100 text-gray-600' },
};

function Stat({ label, value, sub, accent }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${accent || 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// Payment chips with an undo button each.
function Payments({ item, onUndo }) {
  if (!item.payments.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {item.payments.map(p => (
        <span key={p.id} className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 rounded-full pl-2 pr-1 py-0.5">
          {formatCurrency(p.amount)} on {fmtDate(p.date)}
          <button onClick={() => onUndo(item.t, p.id)} title="Remove this payment" className="p-0.5 rounded-full hover:bg-emerald-100">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function OpenItem({ item, getCategory, onUpdate, onEdit }) {
  const [mode, setMode] = useState(null); // null | 'partial' | 'forgive'
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const { t } = item;
  const cat = getCategory(t.category);
  const pct = Math.min(100, (item.repaid / item.owed) * 100);
  const st = STATUS[item.status];

  const savePartial = () => {
    const value = parseFloat(amount);
    if (!(value > 0)) return;
    onUpdate(addRepayment(t, { amount: value, date }));
    setMode(null); setAmount(''); setDate(today());
  };

  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-900 truncate">{t.merchant}</p>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {cat.name} · {fmtDate(t.date)} ({age(item.ageDays)}) · you paid {formatCurrency(t.amount)}
            {item.people && <> · <Users className="inline w-3 h-3 -mt-0.5" /> split {item.people} ways</>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-emerald-700">{formatCurrency(item.remaining)}</p>
          <p className="text-xs text-gray-400">still owed{item.repaid > 0 && ` of ${formatCurrency(item.owed)}`}</p>
        </div>
      </div>

      {item.repaid > 0 && (
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-3">
          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
      )}
      <Payments item={item} onUndo={(tx, id) => onUpdate(removeRepayment(tx, id))} />

      {mode === 'partial' ? (
        <div className="flex flex-wrap items-center gap-2 mt-3 bg-gray-50 rounded-lg p-2">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
            <input
              type="number" min="0" step="0.01" autoFocus placeholder={item.remaining.toFixed(2)} value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') savePartial(); if (e.key === 'Escape') setMode(null); }}
              className="w-28 pl-6 pr-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-emerald-500"
              aria-label="Amount paid back"
            />
          </div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-emerald-500" aria-label="Date paid back" />
          <button onClick={savePartial} disabled={!(parseFloat(amount) > 0)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg">Record</button>
          <button onClick={() => setMode(null)} className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded-lg hover:bg-white">Cancel</button>
          {parseFloat(amount) > item.remaining && <span className="text-xs text-gray-500">Only {formatCurrency(item.remaining)} is owed — that's what will be recorded.</span>}
        </div>
      ) : mode === 'forgive' ? (
        <div className="flex flex-wrap items-center gap-2 mt-3 bg-gray-50 rounded-lg p-2">
          <span className="text-xs text-gray-600">Stop tracking the {formatCurrency(item.remaining)} still owed? It stays counted as your spending.</span>
          <button onClick={() => { onUpdate(setForgiven(t, true)); setMode(null); }} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-800 text-white text-xs font-medium rounded-lg">Forgive</button>
          <button onClick={() => setMode(null)} className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded-lg hover:bg-white">Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={() => onUpdate(addRepayment(t, { amount: item.remaining, date: today() }))}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg">
            <Check className="w-3.5 h-3.5" />Paid back in full
          </button>
          <button onClick={() => setMode('partial')} className="px-3 py-1.5 border border-emerald-200 text-emerald-700 text-xs font-medium rounded-lg hover:bg-emerald-50">Partial payment…</button>
          <button onClick={() => setMode('forgive')} className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded-lg hover:bg-gray-50">Forgive</button>
          <button onClick={() => onEdit(t)} className="inline-flex items-center gap-1 px-2 py-1.5 text-gray-400 hover:text-blue-600 text-xs rounded-lg hover:bg-blue-50" title="Edit purchase or amount owed">
            <Edit2 className="w-3.5 h-3.5" />Edit
          </button>
        </div>
      )}
    </div>
  );
}

export default function OwedManager() {
  const { state, dispatch } = useFinancial();
  const getCategory = useGetCategory();
  const [editTx, setEditTx] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const summary = useMemo(() => getOwedSummary(state.transactions), [state.transactions]);
  const update = t => dispatch({ type: 'UPDATE_TRANSACTION', payload: t });

  return (
    <div className="space-y-5 animate-fade-in">
      {editTx && <TransactionEntry isModal editTransaction={editTx} onClose={() => setEditTx(null)} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Owed to you" value={formatCurrency(summary.outstanding)} accent="text-emerald-700"
          sub={summary.openCount ? `across ${summary.openCount} purchase${summary.openCount > 1 ? 's' : ''}` : 'all settled'} />
        <Stat label="Oldest unpaid" value={summary.oldestOpenDate ? fmtDate(summary.oldestOpenDate) : '—'}
          sub={summary.open.length ? age(summary.open[0].ageDays) : null} />
        <Stat label="Paid back this month" value={formatCurrency(summary.repaidThisMonth)} sub={`${formatCurrency(summary.totalRepaid)} all time`} />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-start gap-2 mb-4">
          <HandCoins className="w-4 h-4 text-emerald-600 mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-gray-900">Waiting to be paid back</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Purchases you fronted for others. The full amount counts as your spending until it's paid back; each repayment lowers
              that purchase's month.
            </p>
          </div>
        </div>

        {summary.open.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500">Nobody owes you anything right now.</p>
            <p className="text-xs text-gray-400 mt-1">
              When you pay for others, add or edit the transaction and tick <span className="font-medium text-gray-600">"I paid for others — they owe me back"</span>.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {summary.open.map(item => (
              <OpenItem key={item.t.id} item={item} getCategory={getCategory} onUpdate={update} onEdit={setEditTx} />
            ))}
          </div>
        )}
      </div>

      {summary.closed.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <button onClick={() => setShowClosed(s => !s)} className="flex items-center justify-between w-full text-left" aria-expanded={showClosed}>
            <h2 className="text-base font-semibold text-gray-900">Settled ({summary.closed.length})</h2>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showClosed ? 'rotate-180' : ''}`} />
          </button>
          {showClosed && (
            <div className="mt-3 divide-y divide-gray-50">
              {summary.closed.map(item => {
                const st = STATUS[item.status];
                return (
                  <div key={item.t.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-800">{item.t.merchant}</p>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        </div>
                        <p className="text-xs text-gray-400">
                          {fmtDate(item.t.date)} · {formatCurrency(item.repaid)} of {formatCurrency(item.owed)} paid back
                          {item.status === 'forgiven' && ` · ${formatCurrency(item.forgivenAmount)} forgiven`}
                        </p>
                      </div>
                      {item.status === 'forgiven' && (
                        <button onClick={() => update(setForgiven(item.t, false))} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                          <Undo2 className="w-3.5 h-3.5" />Reopen
                        </button>
                      )}
                    </div>
                    <Payments item={item} onUndo={(tx, id) => update(removeRepayment(tx, id))} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
