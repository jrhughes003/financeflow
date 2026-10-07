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
 *
 * Rendered as a terminal <Panel>, so it belongs inside a <PanelGrid>; pass
 * `bordered` to stand it on its own.
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { formatCurrency } from '../utils/calculations';
import { Panel, Money, Badge } from './ui';
import type { Position } from '../utils/position';

export default function PositionPanel({
  position, horizon, className = 'col-span-12', bordered = false,
}: { position: Position; horizon: Date; className?: string; bordered?: boolean }) {
  const p = position;
  const horizonLabel = format(horizon, 'd MMM');

  return (
    <Panel title="Position" meta={`TO ${horizonLabel.toUpperCase()}`} className={className} bordered={bordered}>
      <div className="grid md:grid-cols-2 gap-px bg-line border-b border-line">
        {/* What you have, and what the cards are holding against it. */}
        <section className="bg-surface flex flex-col">
          <Row
            label="Have"
            detail={p.have.length ? p.have.map(a => a.name).join(', ') : 'No cash account yet'}
            amount={p.haveTotal}
          />
          <Row
            label="Owe"
            detail={p.owe.length ? p.owe.map(a => a.name).join(', ') : 'No cards yet'}
            amount={-p.oweTotal}
          />
          <Total label="Available now" amount={p.availableNow} />
          {p.hasCash ? (
            <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5">
              Card spending is already counted, so paying a card does not change this.
            </p>
          ) : (
            <div className="flex items-start gap-2.5 px-2.5 py-1.5">
              <Badge tone="caution" className="shrink-0 mt-px">No cash</Badge>
              <p className="font-sans text-caption text-caution">
                This is just your card balance until you add a chequing account — add one on the
                Investments screen with type Cash.
              </p>
            </div>
          )}
        </section>

        {/* What is still to happen before the horizon. */}
        <section className="bg-surface flex flex-col">
          <Row
            label="Coming in"
            detail={comingInDetail(p)}
            amount={p.comingInTotal}
          />
          <Row
            label="Coming out"
            detail={p.comingOut.length ? `${p.comingOut.length} due before ${horizonLabel}` : `Nothing due before ${horizonLabel}`}
            amount={-p.comingOutTotal}
          />
          <Total label={`Expected by ${horizonLabel}`} amount={p.expectedByHorizon} />
          <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5">
            Assumes everything owed to you arrives. It is not spendable until it does.
          </p>
        </section>
      </div>

      {/* Outstanding reimbursements, by age — the shape is the information. */}
      {p.owedToYou.length > 0 && (
        <div className="border-b border-line">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-2.5 py-1.5">
            <span className="label-micro">Owed to you</span>
            {p.owedToYou.map(b => (
              <span key={b.label} className="text-caption text-ink-secondary">
                {b.label}: <span className="money text-ink">{formatCurrency(b.amount)}</span>
                <span className="text-ink-muted"> ({b.count})</span>
              </span>
            ))}
          </div>
          {p.owedToYou.some(b => b.label === 'Over 3 months') && (
            <div className="flex items-start gap-2.5 px-2.5 py-1.5 border-t border-line">
              <Badge tone="caution" className="shrink-0 mt-px">Aged</Badge>
              <p className="font-sans text-caption text-ink">
                Some of this has been outstanding for over three months. Worth chasing or writing off —
                either way it stops sitting in a number you are counting on.
              </p>
            </div>
          )}
        </div>
      )}

      {/* A position is only as current as its stalest input. */}
      {(p.oldestAsOf || p.undatedAccounts.length > 0) && (
        <div className="flex items-start gap-2.5 px-2.5 py-1.5">
          <Badge tone={p.undatedAccounts.length > 0 ? 'caution' : 'neutral'} className="shrink-0 mt-px">As of</Badge>
          <p className="font-sans text-caption text-ink-muted">
            {p.undatedAccounts.length > 0
              ? <>No date on {p.undatedAccounts.join(', ')} — update the balance on the Investments screen and it will be stamped.</>
              : <>Balances last confirmed {format(parseISO(p.oldestAsOf!), 'd MMM yyyy')}. Card balances are typed, not synced, so they are only as current as your last update.</>}
          </p>
        </div>
      )}
    </Panel>
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

function Row({ label, detail, amount }: {
  label: string; detail: string; amount: number;
}) {
  return (
    <div className="flex items-center gap-2 h-row px-2.5 border-b border-line">
      <span className="w-20 shrink-0 text-caption uppercase tracking-[0.03em] text-ink-secondary">{label}</span>
      <span className="flex-1 min-w-0 text-caption text-ink-muted truncate">{detail}</span>
      <span className={`money text-sm whitespace-nowrap ${amount < 0 ? 'text-negative' : 'text-ink'}`}>
        {formatCurrency(amount)}
      </span>
    </div>
  );
}

function Total({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-2.5 py-1.5 border-b border-line">
      <span className="text-caption uppercase tracking-[0.03em] font-semibold text-ink">{label}</span>
      <Money value={amount} size="lg" className={amount < 0 ? 'text-negative' : 'text-ink'} />
    </div>
  );
}

/** Shown in place of the panel when there is nothing to compute from. */
export function PositionEmpty({ className = 'col-span-12', bordered = false }: { className?: string; bordered?: boolean }) {
  return (
    <Panel title="Where your money stands" className={className} bordered={bordered}>
      <p className="font-sans text-sm text-ink-secondary px-2.5 py-2 border-b border-line">
        Add your chequing account and your credit cards and this becomes one number:
        what you can actually spend.
      </p>
      <ul>
        <li className="flex items-start gap-2.5 px-2.5 py-1.5 border-b border-line">
          <span className="font-sans text-caption text-ink-muted">
            <strong className="text-ink-secondary">Chequing:</strong> Investments → add an account
            with type <em>Cash</em>. Its balance is stamped with the date you entered it.
          </span>
        </li>
        <li className="flex items-start gap-2.5 px-2.5 py-1.5 border-b border-line">
          <span className="font-sans text-caption text-ink-muted">
            <strong className="text-ink-secondary">Cards:</strong> Debts → add each card with type
            <em> Credit Card</em>, using its <em>current</em> balance, not the statement balance.
          </span>
        </li>
      </ul>
      <div className="flex items-start gap-2.5 px-2.5 py-1.5">
        <Badge tone="caution" className="shrink-0 mt-px">Note</Badge>
        <p className="font-sans text-caption text-ink-muted">
          Do not record card payments as transactions. Your purchases are already counted on the day
          you made them, so a payment would count them twice.
        </p>
      </div>
    </Panel>
  );
}
