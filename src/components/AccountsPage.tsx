// Accounts: the chequing, savings and credit-card balances that day-to-day
// money moves through.
//
// These already existed, but in the wrong rooms. A chequing account was an
// "investment" of type Cash, so adding one meant going to the Investments page,
// and Cash Flow said as much in its empty state. Cards were debts, next to the
// student loan. This page shows both together and makes the one frequent job —
// typing in today's balance from the bank app — a single field per account.
//
// Storage is unchanged (an Investment with type 'cash', a Debt with type
// 'credit_card'), so nothing existing moves and every other screen that reads
// them keeps working.

import React, { useState } from 'react';
import { Plus, Check, Landmark, CreditCard } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import { useToast } from '../context/ToastContext';
import { Panel, Button, Money } from './ui';
import { LIQUID_TYPES, CARD_TYPES } from '../utils/position';
import type { Debt, Investment } from '../types/domain';
import type { PageId } from '../types/navigation';

const INPUT = 'h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent';
const today = (): string => format(new Date(), 'yyyy-MM-dd');

const fmtAsOf = (d?: string): string => {
  if (!d) return 'no date';
  try { return format(parseISO(d), 'd MMM yyyy'); } catch { return d; }
};

/** One row: name, balance, and a field to type today's balance into. */
function BalanceRow({ name, balance, asOf, tone, onUpdate }: {
  name: string;
  balance: number;
  asOf?: string;
  tone: 'have' | 'owe';
  onUpdate: (value: number) => void;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = parseFloat(draft);
    if (!Number.isFinite(v)) return;
    onUpdate(Math.round(v * 100) / 100);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-2 h-auto min-h-row px-2.5 py-1 border-b border-line last:border-b-0">
      <span className="flex-1 min-w-[8rem] text-ink truncate">{name}</span>
      <span className="text-caption text-ink-muted w-36 text-right whitespace-nowrap">{asOf !== undefined ? `as of ${fmtAsOf(asOf)}` : ''}</span>
      <Money value={tone === 'owe' ? -balance : balance} size="sm" className={`w-28 text-right ${tone === 'owe' ? 'text-negative' : 'text-ink'}`} />
      <form
        className="flex items-center gap-1"
        onSubmit={e => { e.preventDefault(); commit(); }}
      >
        <input
          type="number"
          step="0.01"
          inputMode="decimal"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Today's balance"
          aria-label={`Today's balance for ${name}`}
          className={`${INPUT} w-36 text-right`}
        />
        <Button type="submit" size="sm" icon={Check} disabled={!draft.trim()}>Update</Button>
      </form>
    </div>
  );
}

function AddForm({ kind, onAdd }: { kind: 'bank' | 'card'; onAdd: (name: string, balance: number) => void }) {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 px-2.5 py-2 bg-surface-sunk border-t border-line"
      onSubmit={e => {
        e.preventDefault();
        const v = parseFloat(balance);
        if (!name.trim() || !Number.isFinite(v)) return;
        onAdd(name.trim(), Math.round(v * 100) / 100);
        setName(''); setBalance('');
      }}
    >
      <input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'bank' ? 'e.g. RBC Chequing' : 'e.g. Visa'} aria-label="Name" className={`${INPUT} flex-1 min-w-[10rem]`} />
      <input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} placeholder={kind === 'bank' ? 'Balance' : 'Amount owing'} aria-label="Balance" className={`${INPUT} w-32 text-right`} />
      <Button type="submit" size="sm" icon={Plus} disabled={!name.trim() || !balance.trim()}>
        {kind === 'bank' ? 'Add account' : 'Add card'}
      </Button>
    </form>
  );
}

export default function AccountsPage({ onNavigate }: { onNavigate?: (page: PageId) => void }) {
  const { state, dispatch } = useFinancial();
  const { toast } = useToast();
  const banks = state.investments.filter(i => LIQUID_TYPES.has(String(i.type)));
  const cards = state.debts.filter(d => CARD_TYPES.has(String(d.type)));
  const have = banks.reduce((s, a) => s + (Number(a.currentValue) || 0), 0);
  const owe = cards.reduce((s, d) => s + (Number(d.balance) || 0), 0);

  const updateBank = (a: Investment, value: number) => {
    // A cash balance is a statement: it replaces the old figure and is dated
    // today, so Cash Flow starts from it. No growth rate is invented.
    // Logged entries dated up to today are already inside the new balance;
    // only ones still in the future stay pending on top of it.
    const pending = (a.entries || []).filter(e => e.date > today());
    dispatch({ type: 'UPDATE_INVESTMENT', payload: { ...a, currentValue: value, asOfDate: today(), syncedAt: Date.now(), entries: pending } });
    toast(`${a.name} updated`, { type: 'neutral', action: { label: 'Undo', onClick: () => dispatch({ type: 'UPDATE_INVESTMENT', payload: a }) } });
  };

  const updateCard = (d: Debt, value: number) => {
    dispatch({ type: 'UPDATE_DEBT', payload: { ...d, balance: value } });
    toast(`${d.name} updated`, { type: 'neutral', action: { label: 'Undo', onClick: () => dispatch({ type: 'UPDATE_DEBT', payload: d }) } });
  };

  const addBank = (name: string, balance: number) => {
    dispatch({
      type: 'ADD_INVESTMENT',
      payload: { id: `inv_${Date.now()}`, name, type: 'cash', currentValue: balance, costBasis: balance, asOfDate: today(), annualReturn: 0 },
    });
  };

  const addCard = (name: string, balance: number) => {
    dispatch({
      type: 'ADD_DEBT',
      payload: { id: `debt_${Date.now()}`, name, type: 'credit_card', balance, originalBalance: balance, interestRate: 20.99, minimumPayment: 0 },
    });
    toast(`${name} added with a 20.99% rate — set the real rate on the Debts page`, { duration: 8000 });
  };

  return (
    <div className="space-y-2 animate-fade-in max-w-4xl">
      <p className="font-sans text-sm text-ink-secondary px-0.5">
        The accounts your everyday money moves through. Type in today&apos;s balance from your bank app and Cash Flow
        and the dashboard start from it. Investments and loans live on their own pages.
      </p>

      <Panel bordered title="Where it stands" meta="TODAY">
        <div className="grid grid-cols-3 divide-x divide-line">
          <div className="px-2.5 py-2"><p className="label-micro">In the bank</p><Money value={have} size="lg" className="text-ink" /></div>
          <div className="px-2.5 py-2"><p className="label-micro">Owed on cards</p><Money value={-owe} size="lg" className="text-negative" /></div>
          <div className="px-2.5 py-2"><p className="label-micro">Available</p><Money value={have - owe} size="lg" signed colour /></div>
        </div>
      </Panel>

      <Panel bordered title="Bank accounts" meta={`${banks.length} ACCOUNT${banks.length === 1 ? '' : 'S'}`}>
        {banks.length === 0 && (
          <p className="font-sans text-sm text-ink-muted px-2.5 py-2 flex items-center gap-2"><Landmark className="w-4 h-4" aria-hidden="true" />No bank accounts yet. Add your chequing account below.</p>
        )}
        {banks.map(a => (
          <BalanceRow key={a.id} name={a.name} balance={Number(a.currentValue) || 0} asOf={a.asOfDate ?? ''} tone="have" onUpdate={v => updateBank(a, v)} />
        ))}
        <AddForm kind="bank" onAdd={addBank} />
      </Panel>

      <Panel bordered title="Credit cards" meta={`${cards.length} CARD${cards.length === 1 ? '' : 'S'}`}>
        {cards.length === 0 && (
          <p className="font-sans text-sm text-ink-muted px-2.5 py-2 flex items-center gap-2"><CreditCard className="w-4 h-4" aria-hidden="true" />No cards yet.</p>
        )}
        {cards.map(d => (
          <BalanceRow key={d.id} name={d.name} balance={Number(d.balance) || 0} tone="owe" onUpdate={v => updateCard(d, v)} />
        ))}
        <AddForm kind="card" onAdd={addCard} />
      </Panel>

      {onNavigate && (
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => onNavigate('investments')}>Investments →</Button>
          <Button size="sm" onClick={() => onNavigate('debts')}>Loans &amp; debts →</Button>
          <Button size="sm" onClick={() => onNavigate('cashflow')}>Cash flow →</Button>
        </div>
      )}
    </div>
  );
}
