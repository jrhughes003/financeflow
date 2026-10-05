/*
 * Have / Owe / Coming in / Coming out, and the one number underneath.
 *
 * The confusion this answers is a card paid down in pieces: once part of a
 * statement is paid, the statement balance describes a date that has passed.
 * Current balances do not have that problem, so the figure here is
 *
 *     available = cash − current card balances
 *
 * which holds however often the cards are paid, because the ledger already
 * counted each purchase on the day it was made.
 *
 * Money owed to you sits below the line rather than inside it. Mixing the two
 * is the specific mistake that makes a total read as spendable when part of it
 * has not arrived.
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowDownRight, ArrowUpRight, Clock, Wallet, CreditCard, Info } from 'lucide-react';
import { formatCurrency } from '../utils/calculations';
import type { Position } from '../utils/position';

export default function PositionPanel({ position, horizon }: { position: Position; horizon: Date }) {
  const p = position;
  const horizonLabel = format(horizon, 'd MMM');

  return (
    <div className="bg-surface rounded-container border border-line p-5">
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
        {/* What you have, and what the cards are holding against it. */}
        <section>
          <Row
            icon={Wallet}
            label="Have"
            detail={p.have.length ? p.have.map(a => a.name).join(', ') : 'No cash account yet'}
            amount={p.haveTotal}
          />
          <Row
            icon={CreditCard}
            label="Owe"
            detail={p.owe.length ? p.owe.map(a => a.name).join(', ') : 'No cards yet'}
            amount={-p.oweTotal}
          />
          <div className="flex items-baseline justify-between border-t border-line-strong mt-2 pt-2">
            <span className="text-sm font-medium text-ink">Available now</span>
            <span className={`figure-display text-xl ${p.availableNow < 0 ? 'text-negative' : 'text-ink'}`}>
              {formatCurrency(p.availableNow)}
            </span>
          </div>
          <p className="text-caption text-ink-muted mt-1">
            {p.hasCash
              ? <>Card spending is already counted, so paying a card does not change this.</>
              : <span className="text-caution">
                  This is just your card balance until you add a chequing account — add one on the
                  Investments screen with type Cash.
                </span>}
          </p>
        </section>

        {/* What is still to happen before the horizon. */}
        <section>
          <Row
            icon={ArrowUpRight}
            label="Coming in"
            detail={comingInDetail(p)}
            amount={p.comingInTotal}
          />
          <Row
            icon={ArrowDownRight}
            label="Coming out"
            detail={p.comingOut.length ? `${p.comingOut.length} due before ${horizonLabel}` : `Nothing due before ${horizonLabel}`}
            amount={-p.comingOutTotal}
          />
          <div className="flex items-baseline justify-between border-t border-line-strong mt-2 pt-2">
            <span className="text-sm font-medium text-ink">Expected by {horizonLabel}</span>
            <span className={`figure-display text-xl ${p.expectedByHorizon < 0 ? 'text-negative' : 'text-ink'}`}>
              {formatCurrency(p.expectedByHorizon)}
            </span>
          </div>
          <p className="text-caption text-ink-muted mt-1">
            Assumes everything owed to you arrives. It is not spendable until it does.
          </p>
        </section>
      </div>

      {/* Outstanding reimbursements, by age — the shape is the information. */}
      {p.owedToYou.length > 0 && (
        <div className="mt-5 pt-4 border-t border-line">
          <p className="label-micro mb-2">Owed to you</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {p.owedToYou.map(b => (
              <span key={b.label} className="text-caption text-ink-secondary">
                {b.label}: <span className="money text-ink">{formatCurrency(b.amount)}</span>
                <span className="text-ink-muted"> ({b.count})</span>
              </span>
            ))}
          </div>
          {p.owedToYou.some(b => b.label === 'Over 3 months') && (
            <p className="text-caption text-caution mt-2">
              Some of this has been outstanding for over three months. Worth chasing or writing off —
              either way it stops sitting in a number you are counting on.
            </p>
          )}
        </div>
      )}

      {/* A position is only as current as its stalest input. */}
      {(p.oldestAsOf || p.undatedAccounts.length > 0) && (
        <p className="text-caption text-ink-muted mt-4 flex items-start gap-1.5">
          <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {p.undatedAccounts.length > 0
            ? <>No date on {p.undatedAccounts.join(', ')} — update the balance on the Investments screen and it will be stamped.</>
            : <>Balances last confirmed {format(parseISO(p.oldestAsOf!), 'd MMM yyyy')}. Card balances are typed, not synced, so they are only as current as your last update.</>}
        </p>
      )}
    </div>
  );
}

function comingInDetail(p: Position): string {
  const parts: string[] = [];
  if (p.owedToYouTotal > 0) parts.push('owed to you');
  if (p.incomingOneOffs.length) {
    parts.push(p.incomingOneOffs.length === 1 ? p.incomingOneOffs[0].label : `${p.incomingOneOffs.length} one-offs`);
  }
  return parts.length ? parts.join(' · ') : 'Nothing expected';
}

function Row({ icon: Icon, label, detail, amount }: {
  icon: typeof Wallet; label: string; detail: string; amount: number;
}) {
  return (
    <div className="flex items-baseline justify-between h-row">
      <span className="flex items-center gap-2 min-w-0">
        <Icon className="w-3.5 h-3.5 text-ink-muted shrink-0" />
        <span className="text-sm text-ink">{label}</span>
        <span className="text-caption text-ink-muted truncate">{detail}</span>
      </span>
      <span className={`money text-sm ${amount < 0 ? 'text-negative' : 'text-ink-secondary'}`}>
        {formatCurrency(amount)}
      </span>
    </div>
  );
}

/** Shown in place of the panel when there is nothing to compute from. */
export function PositionEmpty() {
  return (
    <div className="bg-surface rounded-container border border-line p-5">
      <h2 className="text-lg font-semibold text-ink mb-1 flex items-center gap-2">
        <Wallet className="w-4 h-4 text-ink-muted" />Where your money stands
      </h2>
      <p className="text-sm text-ink-secondary mb-3">
        Add your chequing account and your credit cards and this becomes one number:
        what you can actually spend.
      </p>
      <ul className="text-caption text-ink-muted space-y-1.5">
        <li className="flex gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            <strong className="text-ink-secondary">Chequing:</strong> Investments → add an account
            with type <em>Cash</em>. Its balance is stamped with the date you entered it.
          </span>
        </li>
        <li className="flex gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            <strong className="text-ink-secondary">Cards:</strong> Debts → add each card with type
            <em> Credit Card</em>, using its <em>current</em> balance, not the statement balance.
          </span>
        </li>
      </ul>
      <p className="text-caption text-ink-muted mt-3">
        Do not record card payments as transactions. Your purchases are already counted on the day
        you made them, so a payment would count them twice.
      </p>
    </div>
  );
}
