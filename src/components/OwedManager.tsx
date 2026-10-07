import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Check, X, Undo2, Edit2, ChevronDown } from 'lucide-react';
import { useFinancial, useGetCategory } from '../context/FinancialContext';
import { formatCurrency } from '../utils/calculations';
import { getOwedSummary, addRepayment, removeRepayment, setForgiven } from '../utils/reimbursements';
import TransactionEntry from './TransactionEntry';
import { Panel, PanelGrid, KeyValue, Money, Meter, Button, CategoryMark } from './ui';
import type { Category, IsoDate, Transaction } from '../types/domain';

/** One fronted purchase as the summary reports it, open or settled. */
type OwedItem = ReturnType<typeof getOwedSummary>['open'][number];
/** The four states a fronted purchase can be in. */
type OwedStatus = OwedItem['status'];

const fmtDate = (d: IsoDate): string => format(parseISO(d.slice(0, 10)), 'MMM d, yyyy');
const today = (): IsoDate => format(new Date(), 'yyyy-MM-dd');
const age = (days: number): string => (days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`);

// Outlined status tags. "Partly paid back" is a neutral fact rather than good
// or bad news, so it takes the info colour, which <Badge> has no tone for.
const STATUS: Record<OwedStatus, { label: string; cls: string }> = {
  open: { label: 'Not paid back', cls: 'text-caution border-current' },
  partial: { label: 'Partly paid back', cls: 'text-info border-current' },
  settled: { label: 'Paid back', cls: 'text-positive border-current' },
  forgiven: { label: 'Forgiven', cls: 'text-ink-secondary border-line-strong' },
};

function StatusTag({ status }: { status: OwedStatus }) {
  const st = STATUS[status];
  return (
    <span className={`inline-flex items-center shrink-0 px-1 py-px border text-[10px] leading-[14px] font-medium uppercase tracking-[0.06em] whitespace-nowrap ${st.cls}`}>
      {st.label}
    </span>
  );
}

const INPUT = 'h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent';

// Repayments as outlined tags, each with its own undo.
function Payments({ item, onUndo }: { item: OwedItem; onUndo: (tx: Transaction, id: string) => void }) {
  if (!item.payments.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {item.payments.map(p => (
        <span key={p.id} className="inline-flex items-center gap-1 h-5 pl-1.5 border border-line text-caption text-positive">
          {formatCurrency(p.amount)} on {fmtDate(p.date)}
          <button onClick={() => onUndo(item.t, p.id)} title="Remove this payment" aria-label="Remove this payment"
            className="inline-flex items-center justify-center w-[18px] h-[18px] text-ink-muted hover:text-negative hover:bg-negative-tint">
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

  const savePartial = () => {
    const value = parseFloat(amount);
    if (!(value > 0)) return;
    onUpdate(addRepayment(t, { amount: value, date }));
    setMode(null); setAmount(''); setDate(today());
  };

  return (
    <div className="px-2.5 py-1.5 border-b border-line last:border-b-0">
      <div className="flex items-center gap-2 min-h-row">
        <p className="text-ink truncate min-w-0">{t.merchant}</p>
        <StatusTag status={item.status} />
        <span className="ml-auto text-right whitespace-nowrap">
          <Money value={item.remaining} size="sm" className="text-positive font-medium" />
        </span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-caption text-ink-muted">
        <span className="flex flex-wrap items-baseline gap-x-1.5 min-w-0">
          <CategoryMark color={cat.color} name={cat.name} className="text-ink-secondary" />
          <span>· {fmtDate(t.date)} ({age(item.ageDays)}) · you paid {formatCurrency(t.amount)}</span>
          {item.people && <span>· split {item.people} ways</span>}
        </span>
        <span className="uppercase whitespace-nowrap">still owed{item.repaid > 0 && ` of ${formatCurrency(item.owed)}`}</span>
      </div>

      {item.repaid > 0 && <Meter value={item.repaid} max={item.owed} tone="positive" className="mt-1.5" />}
      <Payments item={item} onUndo={(tx, id) => onUpdate(removeRepayment(tx, id))} />

      {mode === 'partial' ? (
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 border border-line bg-surface-sunk px-1.5 py-1">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink-muted" aria-hidden="true">$</span>
            <input
              type="number" min="0" step="0.01" autoFocus placeholder={item.remaining.toFixed(2)} value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') savePartial(); if (e.key === 'Escape') setMode(null); }}
              className={`${INPUT} w-28 pl-5 text-right`}
              aria-label="Amount paid back"
            />
          </div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className={INPUT} aria-label="Date paid back" />
          <Button size="sm" variant="primary" onClick={savePartial} disabled={!(parseFloat(amount) > 0)}>Record</Button>
          <Button size="sm" onClick={() => setMode(null)}>Cancel</Button>
          {parseFloat(amount) > item.remaining && <span className="font-sans text-caption text-ink-muted">Only {formatCurrency(item.remaining)} is owed — that's what will be recorded.</span>}
        </div>
      ) : mode === 'forgive' ? (
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 border border-line bg-surface-sunk px-1.5 py-1">
          <span className="font-sans text-caption text-ink-secondary">Stop tracking the {formatCurrency(item.remaining)} still owed? It stays counted as your spending.</span>
          <Button size="sm" variant="primary" onClick={() => { onUpdate(setForgiven(t, true)); setMode(null); }}>Forgive</Button>
          <Button size="sm" onClick={() => setMode(null)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1 mt-1.5">
          <Button size="sm" variant="primary" icon={Check} onClick={() => onUpdate(addRepayment(t, { amount: item.remaining, date: today() }))}>
            Paid back in full
          </Button>
          <Button size="sm" onClick={() => setMode('partial')}>Partial payment…</Button>
          <Button size="sm" onClick={() => setMode('forgive')}>Forgive</Button>
          <Button size="sm" variant="ghost" icon={Edit2} onClick={() => onEdit(t)} title="Edit purchase or amount owed">Edit</Button>
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
    <div className="space-y-2 animate-fade-in">
      {editTx && <TransactionEntry isModal editTransaction={editTx} onClose={() => setEditTx(null)} />}

      <PanelGrid className="grid-flow-row-dense">
        {/* The figure the page is about, and its supporting cast */}
        <Panel title="Owed to you" meta={`${summary.openCount} OPEN`} className="col-span-12 md:col-span-5 xl:col-span-4">
          <div className="px-2.5 py-2 border-b border-line">
            <Money value={summary.outstanding} size="display"
              className={summary.outstanding > 0 ? 'text-positive' : ''} />
            <p className="text-caption text-ink-muted mt-1">
              {summary.openCount
                ? `across ${summary.openCount} purchase${summary.openCount > 1 ? 's' : ''} you fronted`
                : 'everything is settled'}
            </p>
          </div>
          <KeyValue label="Oldest unpaid" delta={summary.open.length ? age(summary.open[0].ageDays).toUpperCase() : undefined}>
            {summary.oldestOpenDate ? fmtDate(summary.oldestOpenDate) : '—'}
          </KeyValue>
          <KeyValue label="Paid back this month">
            <Money value={summary.repaidThisMonth} size="sm" />
          </KeyValue>
          <KeyValue label="Paid back, all time">
            <Money value={summary.totalRepaid} size="sm" className="text-ink-secondary" />
          </KeyValue>
        </Panel>

        {/* Open items */}
        <Panel
          title="Waiting to be paid back"
          meta={summary.open.length ? `${summary.open.length} ITEM${summary.open.length > 1 ? 'S' : ''}` : undefined}
          className="col-span-12 md:col-span-7 xl:col-span-8"
        >
          <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">
            Purchases you fronted for others. The full amount counts as your spending until it's paid back; each repayment lowers
            that purchase's month.
          </p>
          {summary.open.length === 0 ? (
            <div className="p-3">
              <p className="font-sans text-sm text-ink-muted">Nobody owes you anything right now.</p>
              <p className="font-sans text-caption text-ink-muted mt-1">
                When you pay for others, add or edit the transaction and tick <span className="font-medium text-ink-secondary">"I paid for others — they owe me back"</span>.
              </p>
            </div>
          ) : (
            <div>
              {summary.open.map(item => (
                <OpenItem key={item.t.id} item={item} getCategory={getCategory} onUpdate={update} onEdit={setEditTx} />
              ))}
            </div>
          )}
        </Panel>

        {/* Settled and forgiven, collapsed by default */}
        {summary.closed.length > 0 && (
          <Panel
            title={(
              <button onClick={() => setShowClosed(s => !s)} className="inline-flex items-center gap-1.5 uppercase hover:text-accent-ink" aria-expanded={showClosed}>
                Settled ({summary.closed.length})
                <ChevronDown className={`w-3.5 h-3.5 text-ink-muted transition-transform ${showClosed ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
            )}
            className="col-span-12"
          >
            {showClosed && (
              <div>
                {summary.closed.map(item => (
                  <div key={item.t.id} className="px-2.5 py-1 border-b border-line last:border-b-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-h-row">
                      <p className="text-ink truncate min-w-0">{item.t.merchant}</p>
                      <StatusTag status={item.status} />
                      <p className="text-caption text-ink-muted">
                        {fmtDate(item.t.date)} · {formatCurrency(item.repaid)} of {formatCurrency(item.owed)} paid back
                        {item.status === 'forgiven' && ` · ${formatCurrency(item.forgivenAmount)} forgiven`}
                      </p>
                      {item.status === 'forgiven' && (
                        <Button size="sm" variant="ghost" icon={Undo2} className="ml-auto" onClick={() => update(setForgiven(item.t, false))}>
                          Reopen
                        </Button>
                      )}
                    </div>
                    <Payments item={item} onUndo={(tx, id) => update(removeRepayment(tx, id))} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}
      </PanelGrid>
    </div>
  );
}
