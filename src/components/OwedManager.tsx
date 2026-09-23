import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { HandCoins, Check, X, Undo2, Edit2, ChevronDown, Users } from 'lucide-react';
import { useFinancial, useGetCategory } from '../context/FinancialContext';
import { formatCurrency } from '../utils/calculations';
import { getOwedSummary, addRepayment, removeRepayment, setForgiven } from '../utils/reimbursements';
import TransactionEntry from './TransactionEntry';
import { Card, PageLede, Stat as UiStat, Money } from './ui';
import type { Category, IsoDate, Transaction } from '../types/domain';

/** One fronted purchase as the summary reports it, open or settled. */
type OwedItem = ReturnType<typeof getOwedSummary>['open'][number];
/** The four states a fronted purchase can be in. */
type OwedStatus = OwedItem['status'];

const fmtDate = (d: IsoDate): string => format(parseISO(d.slice(0, 10)), 'MMM d, yyyy');
const today = (): IsoDate => format(new Date(), 'yyyy-MM-dd');
const age = (days: number): string => (days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`);

const STATUS: Record<OwedStatus, { label: string; cls: string }> = {
  open: { label: 'Not paid back', cls: 'bg-caution-tint text-caution' },
  partial: { label: 'Partly paid back', cls: 'bg-sky-50 text-sky-700' },
  settled: { label: 'Paid back', cls: 'bg-positive-tint text-positive' },
  forgiven: { label: 'Forgiven', cls: 'bg-surface-hover text-ink-secondary' },
};

function Stat({ label, value, sub, accent }: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="bg-surface rounded-container border border-line p-4">
      <p className="text-caption font-medium text-ink-muted mb-1">{label}</p>
      <p className={`text-xl font-bold ${accent || 'text-ink'}`}>{value}</p>
      {sub && <p className="text-caption text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// Payment chips with an undo button each.
function Payments({ item, onUndo }: { item: OwedItem; onUndo: (tx: Transaction, id: string) => void }) {
  if (!item.payments.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {item.payments.map(p => (
        <span key={p.id} className="inline-flex items-center gap-1 text-caption bg-positive-tint text-positive rounded-full pl-2 pr-1 py-0.5">
          {formatCurrency(p.amount)} on {fmtDate(p.date)}
          <button onClick={() => onUndo(item.t, p.id)} title="Remove this payment" className="p-0.5 rounded-full hover:bg-positive-tint">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function OpenItem({ item, getCategory, onUpdate, onEdit }: {
  item: OwedItem;
  getCategory: (id: string) => Category;
  onUpdate: (t: Transaction) => void;
  onEdit: (t: Transaction) => void;
}) {
  const [mode, setMode] = useState<'partial' | 'forgive' | null>(null);
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
    <div className="border border-line rounded-container p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-ink truncate">{t.merchant}</p>
            <span className={`text-caption font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          </div>
          <p className="text-caption text-ink-muted mt-0.5">
            {cat.name} · {fmtDate(t.date)} ({age(item.ageDays)}) · you paid {formatCurrency(t.amount)}
            {item.people && <> · <Users className="inline w-3 h-3 -mt-0.5" /> split {item.people} ways</>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-positive">{formatCurrency(item.remaining)}</p>
          <p className="text-caption text-ink-muted">still owed{item.repaid > 0 && ` of ${formatCurrency(item.owed)}`}</p>
        </div>
      </div>

      {item.repaid > 0 && (
        <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden mt-3">
          <div className="h-full bg-positive rounded-full" style={{ width: `${pct}%` }} />
        </div>
      )}
      <Payments item={item} onUndo={(tx, id) => onUpdate(removeRepayment(tx, id))} />

      {mode === 'partial' ? (
        <div className="flex flex-wrap items-center gap-2 mt-3 bg-surface-sunk rounded-control p-2">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-muted">$</span>
            <input
              type="number" min="0" step="0.01" autoFocus placeholder={item.remaining.toFixed(2)} value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') savePartial(); if (e.key === 'Escape') setMode(null); }}
              className="w-28 h-9 pl-6 pr-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
              aria-label="Amount paid back"
            />
          </div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-2 py-1.5 border border-line-strong rounded-control text-sm bg-surface focus:outline-none focus:border-positive" aria-label="Date paid back" />
          <button onClick={savePartial} disabled={!(parseFloat(amount) > 0)} className="px-3 py-1.5 bg-positive hover:bg-positive disabled:opacity-40 text-ink-inverse text-caption font-medium rounded-control">Record</button>
          <button onClick={() => setMode(null)} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
          {parseFloat(amount) > item.remaining && <span className="text-caption text-ink-muted">Only {formatCurrency(item.remaining)} is owed — that's what will be recorded.</span>}
        </div>
      ) : mode === 'forgive' ? (
        <div className="flex flex-wrap items-center gap-2 mt-3 bg-surface-sunk rounded-control p-2">
          <span className="text-caption text-ink-secondary">Stop tracking the {formatCurrency(item.remaining)} still owed? It stays counted as your spending.</span>
          <button onClick={() => { onUpdate(setForgiven(t, true)); setMode(null); }} className="px-3 py-1.5 bg-ink hover:bg-ink text-ink-inverse text-caption font-medium rounded-control">Forgive</button>
          <button onClick={() => setMode(null)} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={() => onUpdate(addRepayment(t, { amount: item.remaining, date: today() }))}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-positive hover:bg-positive text-ink-inverse text-caption font-medium rounded-control">
            <Check className="w-3.5 h-3.5" />Paid back in full
          </button>
          <button onClick={() => setMode('partial')} className="px-3 py-1.5 border border-positive text-positive text-caption font-medium rounded-control hover:bg-positive-tint">Partial payment…</button>
          <button onClick={() => setMode('forgive')} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">Forgive</button>
          <button onClick={() => onEdit(t)} className="inline-flex items-center gap-1 px-2 py-1.5 text-ink-muted hover:text-accent text-caption rounded-control hover:bg-accent-tint" title="Edit purchase or amount owed">
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
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const summary = useMemo(() => getOwedSummary(state.transactions), [state.transactions]);
  const update = (t: Transaction) => dispatch({ type: 'UPDATE_TRANSACTION', payload: t });

  return (
    <div className="space-y-5 animate-fade-in">
      {editTx && <TransactionEntry isModal editTransaction={editTx} onClose={() => setEditTx(null)} />}

      <Card>
        <PageLede
          label="Owed to you"
          supporting={(
            <>
              <UiStat label="Oldest unpaid" hint={summary.open.length ? age(summary.open[0].ageDays) : null}>
                {summary.oldestOpenDate ? fmtDate(summary.oldestOpenDate) : '—'}
              </UiStat>
              <UiStat label="Paid back this month" hint={`${formatCurrency(summary.totalRepaid)} all time`}>
                <Money value={summary.repaidThisMonth} />
              </UiStat>
            </>
          )}
        >
          <Money value={summary.outstanding} size="display"
            className={summary.outstanding > 0 ? 'text-positive' : ''} />
          <p className="text-caption text-ink-muted mt-2">
            {summary.openCount
              ? `across ${summary.openCount} purchase${summary.openCount > 1 ? 's' : ''} you fronted`
              : 'everything is settled'}
          </p>
        </PageLede>
      </Card>

      <div className="bg-surface rounded-container border border-line p-5">
        <div className="flex items-start gap-2 mb-4">
          <HandCoins className="w-4 h-4 text-positive mt-0.5" />
          <div>
            <h2 className="text-lg font-semibold text-ink">Waiting to be paid back</h2>
            <p className="text-caption text-ink-muted mt-0.5">
              Purchases you fronted for others. The full amount counts as your spending until it's paid back; each repayment lowers
              that purchase's month.
            </p>
          </div>
        </div>

        {summary.open.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-ink-muted">Nobody owes you anything right now.</p>
            <p className="text-caption text-ink-muted mt-1">
              When you pay for others, add or edit the transaction and tick <span className="font-medium text-ink-secondary">"I paid for others — they owe me back"</span>.
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
        <div className="bg-surface rounded-container border border-line p-5">
          <button onClick={() => setShowClosed(s => !s)} className="flex items-center justify-between w-full text-left" aria-expanded={showClosed}>
            <h2 className="text-lg font-semibold text-ink">Settled ({summary.closed.length})</h2>
            <ChevronDown className={`w-4 h-4 text-ink-muted transition-transform ${showClosed ? 'rotate-180' : ''}`} />
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
                          <p className="text-sm font-medium text-ink">{item.t.merchant}</p>
                          <span className={`text-caption font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        </div>
                        <p className="text-caption text-ink-muted">
                          {fmtDate(item.t.date)} · {formatCurrency(item.repaid)} of {formatCurrency(item.owed)} paid back
                          {item.status === 'forgiven' && ` · ${formatCurrency(item.forgivenAmount)} forgiven`}
                        </p>
                      </div>
                      {item.status === 'forgiven' && (
                        <button onClick={() => update(setForgiven(item.t, false))} className="inline-flex items-center gap-1 text-caption text-accent hover:text-accent-ink font-medium">
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
