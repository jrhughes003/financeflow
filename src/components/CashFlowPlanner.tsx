/*
 * Short-term cash flow: a daily running balance, one to six months out.
 *
 * The question it answers is "when does this get tight", which the other two
 * forecasts skip. Plan Ahead is a decades-long question; the month-end
 * projection asks what this month will cost. Neither tells you that a balance
 * that ends April comfortably goes negative on the 12th, because a monthly
 * total cannot.
 *
 * Everything dated is placed on its day. Everything genuinely smooth — daily
 * spending, and pay with no known payday — is spread, and the page says which,
 * because smoothing a payday hides exactly the trough this exists to find.
 */

import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Plus, Trash2 } from 'lucide-react';
import * as chart from './ui/chartTheme';
import { useFinancial } from '../context/FinancialContext';
import { buildCashFlow } from '../utils/cashPlan';
import { buildPosition, hasPositionData } from '../utils/position';
import PositionPanel, { PositionEmpty } from './PositionPanel';
import { Panel, PanelGrid, Button, IconButton, Badge } from './ui';
import { formatCurrency } from '../utils/calculations';
import { projectMonthEnd } from '../utils/insights';
import { useTaxonomy } from '../context/FinancialContext';
import type { CashPlanItem } from '../types/domain';

const HORIZONS = [1, 2, 3, 6];

type Draft = { label: string; amount: string; date: string; kind: 'in' | 'out' };
const EMPTY_ITEM: Draft = { label: '', amount: '', date: '', kind: 'out' };

export default function CashFlowPlanner() {
  const { state, dispatch } = useFinancial();
  const taxonomy = useTaxonomy();
  const today = useMemo(() => new Date(), []);
  // Memoised because the `|| {}` would otherwise be a fresh object every
  // render, re-running the projection over ~180 days on every keystroke.
  const plan = useMemo(() => state.settings?.cashPlan || {}, [state.settings?.cashPlan]);
  const [months, setMonths] = useState(3);
  const [draft, setDraft] = useState<Draft>(EMPTY_ITEM);

  // Everyday spending comes from the existing month-end model rather than a
  // second estimate — two forecasts disagreeing about the same month is worse
  // than either being slightly wrong.
  const monthlyDiscretionary = useMemo(() => {
    const p = projectMonthEnd({
      transactions: state.transactions,
      budgets: state.budgets,
      recurringTemplates: state.recurringTemplates || [],
      today,
      taxonomy,
    });
    return p.totals.actual + p.totals.discretionaryRemaining;
  }, [state.transactions, state.budgets, state.recurringTemplates, today, taxonomy]);

  const horizon = useMemo(
    () => new Date(today.getFullYear(), today.getMonth() + months, today.getDate()),
    [today, months],
  );

  const knowsPosition = hasPositionData(state.investments || [], state.debts || []);
  const position = useMemo(() => buildPosition({
    today,
    horizon,
    investments: state.investments || [],
    debts: state.debts || [],
    transactions: state.transactions,
    incomes: state.incomes || [],
    recurringTemplates: state.recurringTemplates || [],
    plan,
  }), [today, horizon, state.investments, state.debts, state.transactions, state.incomes, state.recurringTemplates, plan]);

  /*
   * The projection starts from what you can actually spend, not from your
   * chequing balance.
   *
   * This matters more than it looks. Future spending in the line below is
   * mostly card spending, and card spending does not leave chequing on the day
   * it happens — it sits on the card until the card is paid. Starting from
   * chequing would deduct it twice over: once as it is forecast, again when
   * the card is cleared. Starting from cash minus current card balances is the
   * one figure where "spending leaves immediately" is already true, because
   * the cards' existing spend has been subtracted up front.
   *
   * A typed opening balance still wins, for the case where you want to ask
   * "what if I started from X".
   */
  const openingBalance = plan.openingBalance ?? (position.hasCash ? position.availableNow : 0);

  const flow = useMemo(() => buildCashFlow({
    today,
    months,
    plan: { ...plan, openingBalance },
    incomes: state.incomes || [],
    recurringTemplates: state.recurringTemplates || [],
    monthlyDiscretionary,
  }), [today, months, plan, openingBalance, state.incomes, state.recurringTemplates, monthlyDiscretionary]);

  const save = (next: Partial<typeof plan>) =>
    dispatch({ type: 'UPDATE_SETTINGS', payload: { cashPlan: { ...plan, ...next } } });

  const addItem = () => {
    const amount = Number(draft.amount);
    if (!draft.date || !Number.isFinite(amount) || amount === 0) return;
    const item: CashPlanItem = {
      id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: draft.label.trim() || (draft.kind === 'in' ? 'Money in' : 'Payment'),
      amount: Math.abs(amount),
      date: draft.date,
      kind: draft.kind,
    };
    save({ items: [...(plan.items || []), item] });
    setDraft(EMPTY_ITEM);
  };

  const removeItem = (id: string) =>
    save({ items: (plan.items || []).filter(i => i.id !== id) });

  const items = [...(plan.items || [])].sort((a, b) => a.date.localeCompare(b.date));
  const chartData = flow.days.map(d => ({ date: d.date, balance: d.balance }));
  const dipsNegative = flow.firstNegative !== null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="sr-only">Cash Flow</h1>
        <p className="font-sans text-caption text-ink-muted">
          A running balance, day by day. Add what you know is coming and see where it gets tight.
        </p>
      </div>

      <PanelGrid className="grid-flow-row-dense">
        {knowsPosition
          ? <PositionPanel position={position} horizon={horizon} className="col-span-12 xl:col-span-8" />
          : <PositionEmpty className="col-span-12 xl:col-span-8" />}

        {/* Opening balance — derived from the position unless overridden. */}
        <Panel title="Inputs" meta={`${months} MO`} className="col-span-12 xl:col-span-4">
          <div className="flex flex-wrap items-end gap-3 px-2.5 py-2 border-b border-line">
            <div>
              <label htmlFor="cash-opening" className="label-micro block mb-1">Balance today</label>
              <input
                id="cash-opening"
                type="number"
                value={plan.openingBalance ?? ''}
                onChange={e => save({ openingBalance: e.target.value === '' ? undefined : Number(e.target.value) })}
                // Shows what the projection is actually seeded with, which is not
                // availableNow when no cash account exists — promising a figure the
                // chart is not using is worse than showing none.
                placeholder={position.hasCash ? String(position.availableNow) : '$0'}
                className="w-36 h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent money"
              />
            </div>
            <div>
              <span className="label-micro block mb-1">Look ahead</span>
              <div className="flex border border-line-strong rounded-control">
                {HORIZONS.map(m => (
                  <button
                    key={m}
                    onClick={() => setMonths(m)}
                    aria-pressed={months === m}
                    className={`h-[26px] px-2.5 text-sm border-l border-line-strong first:border-l-0 transition-colors ${
                      months === m
                        ? 'bg-accent-tint text-accent-ink font-medium'
                        : 'text-ink-secondary hover:bg-surface-hover'
                    }`}
                  >
                    {m} mo
                  </button>
                ))}
              </div>
            </div>
          </div>

          {plan.openingBalance === undefined && (
            <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5">
              {knowsPosition
                ? <>Starting from your available balance above. Type a figure to override it — useful for
                    asking what would happen if you started from somewhere else.</>
                : <>Add a cash account and your cards, or type a starting balance. Until then the line
                    below shows the change from zero, not your balance.</>}
            </p>
          )}
        </Panel>

        {/* The line, and the two numbers that matter on it. */}
        <Panel
          title="Running balance"
          meta={`NEXT ${months} MO`}
          className="col-span-12"
        >
          <div className="grid grid-cols-3 gap-px bg-line border-b border-line">
            <Cell label="Lowest point" value={flow.lowest ? formatCurrency(flow.lowest.balance) : '—'}
              sub={flow.lowest ? format(parseISO(flow.lowest.date), 'd MMM yyyy') : undefined}
              tone={flow.lowest && flow.lowest.balance < 0 ? 'negative' : 'normal'} />
            <Cell label={`Balance in ${months} month${months > 1 ? 's' : ''}`} value={formatCurrency(flow.endingBalance)}
              tone={flow.endingBalance < 0 ? 'negative' : 'normal'} />
            <Cell label="Dated items" value={String(items.length)} sub="You added these" />
          </div>

          {dipsNegative && (
            <div className="flex items-start gap-2.5 px-2.5 py-1.5 border-b border-line">
              <Badge tone="negative" className="shrink-0 mt-px">Below 0</Badge>
              <p className="font-sans text-sm text-ink">
                Goes below zero on{' '}
                <span className="font-semibold">{format(parseISO(flow.firstNegative!), 'd MMMM')}</span>
                {flow.lowest && <>, bottoming at <span className="money font-semibold text-negative">{formatCurrency(flow.lowest.balance)}</span></>}.
              </p>
            </div>
          )}

          <div className="p-2">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis
                  dataKey="date" {...chart.xAxis}
                  tickFormatter={d => format(parseISO(d), 'd MMM')}
                  minTickGap={40}
                />
                <YAxis {...chart.yAxis} tickFormatter={chart.compactMoney} />
                <Tooltip
                  {...chart.tooltip}
                  labelFormatter={d => format(parseISO(String(d)), 'EEEE d MMMM')}
                  formatter={v => [formatCurrency(chart.asNumber(v)), 'Balance']}
                />
                {/* Zero is the line that matters; without it a dip is just a shape. */}
                <ReferenceLine y={0} stroke="var(--c-negative)" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="balance" stroke="var(--c-data-1)" fill="var(--c-accent-tint)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {flow.smoothedIncomes.length > 0 && (
            <div className="flex items-start gap-2.5 px-2.5 py-1.5 border-t border-line">
              <Badge tone="neutral" className="shrink-0 mt-px">Smoothed</Badge>
              <p className="font-sans text-caption text-ink-muted">
                {flow.smoothedIncomes.join(' and ')} {flow.smoothedIncomes.length > 1 ? 'have' : 'has'} no
                payday set, so {flow.smoothedIncomes.length > 1 ? 'they are' : 'it is'} spread evenly
                across the month rather than landing on a date. That flattens the dips between paydays —
                set a date on the Income screen to see them.
              </p>
            </div>
          )}
        </Panel>

        {/* Dated items. */}
        <Panel title="What's coming" meta={items.length ? `${items.length} ITEM${items.length === 1 ? '' : 'S'}` : undefined} className="col-span-12">
          <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">
            Planning only — nothing here is added to your transactions. Recurring bills and income you
            have already set up are included in the line above automatically.
          </p>

          <div className="flex flex-wrap items-end gap-2 px-2.5 py-2 border-b border-line bg-surface-sunk">
            <div className="flex-1 min-w-[10rem]">
              <label htmlFor="cp-label" className="label-micro block mb-1">What</label>
              <input id="cp-label" value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                placeholder="Tuition, bonus, car repair…"
                className="w-full h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label htmlFor="cp-kind" className="label-micro block mb-1">Direction</label>
              <select id="cp-kind" value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as 'in' | 'out' }))}
                className="h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink focus:outline-none focus:border-accent">
                <option value="out">Payment</option>
                <option value="in">Money in</option>
              </select>
            </div>
            <div>
              <label htmlFor="cp-amount" className="label-micro block mb-1">Amount</label>
              <input id="cp-amount" type="number" value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))}
                placeholder="$0"
                className="w-28 h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent money" />
            </div>
            <div>
              <label htmlFor="cp-date" className="label-micro block mb-1">Date</label>
              <input id="cp-date" type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}
                className="h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink focus:outline-none focus:border-accent" />
            </div>
            <Button variant="primary" icon={Plus} onClick={addItem}>Add</Button>
          </div>

          {items.length === 0
            ? <p className="font-sans text-sm text-ink-muted p-3">Nothing added yet.</p>
            : (
              <ul>
                {items.map(item => (
                  <li key={item.id} className="flex items-center gap-3 h-row px-2.5 border-b border-line last:border-0 hover:bg-surface-hover">
                    <span className="text-caption text-ink-muted w-24 shrink-0">{format(parseISO(item.date), 'd MMM yyyy')}</span>
                    <span className="text-sm text-ink flex-1 min-w-0 truncate">{item.label}</span>
                    <span className={`money text-sm font-medium ${item.kind === 'in' ? 'text-positive' : 'text-negative'}`}>
                      {item.kind === 'in' ? '+' : '−'}{formatCurrency(item.amount)}
                    </span>
                    <IconButton icon={Trash2} label={`Remove ${item.label}`} variant="danger" onClick={() => removeItem(item.id)} />
                  </li>
                ))}
              </ul>
            )}
        </Panel>
      </PanelGrid>
    </div>
  );
}

/* A compact figure cell, as in the Dashboard's strip. */
function Cell({ label, value, sub, tone = 'normal' }: {
  label: string; value: string; sub?: string; tone?: 'normal' | 'negative';
}) {
  return (
    <div className="bg-surface px-2.5 py-1.5">
      <p className="label-micro">{label}</p>
      <p className={`text-xl font-medium money mt-0.5 ${tone === 'negative' ? 'text-negative' : 'text-ink'}`}>{value}</p>
      {sub && <p className="text-caption text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}
