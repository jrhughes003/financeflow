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
import { Plus, Trash2, TriangleAlert, Wallet, Info } from 'lucide-react';
import * as chart from './ui/chartTheme';
import { useFinancial } from '../context/FinancialContext';
import { buildCashFlow } from '../utils/cashPlan';
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

  const flow = useMemo(() => buildCashFlow({
    today,
    months,
    plan,
    incomes: state.incomes || [],
    recurringTemplates: state.recurringTemplates || [],
    monthlyDiscretionary,
  }), [today, months, plan, state.incomes, state.recurringTemplates, monthlyDiscretionary]);

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Cash Flow</h1>
        <p className="text-caption text-ink-muted mt-0.5">
          A running balance, day by day. Add what you know is coming and see where it gets tight.
        </p>
      </div>

      {/* Opening balance — without it the line is a change, not a balance. */}
      <div className="bg-surface rounded-container border border-line p-5">
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <label htmlFor="cash-opening" className="label-micro block mb-1.5">Balance today</label>
            <input
              id="cash-opening"
              type="number"
              value={plan.openingBalance ?? ''}
              onChange={e => save({ openingBalance: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder="$0"
              className="w-40 h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent money"
            />
          </div>
          <div>
            <span className="label-micro block mb-1.5">Look ahead</span>
            <div className="flex gap-1">
              {HORIZONS.map(m => (
                <button
                  key={m}
                  onClick={() => setMonths(m)}
                  className={`h-9 px-3 rounded-control text-sm border transition-colors ${
                    months === m
                      ? 'bg-accent-tint border-accent text-accent-ink font-medium'
                      : 'border-line-strong text-ink-secondary hover:bg-surface-hover'
                  }`}
                >
                  {m} mo
                </button>
              ))}
            </div>
          </div>
        </div>

        {plan.openingBalance === undefined && (
          <p className="text-caption text-ink-muted mt-3 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Enter what your accounts hold today. Until then the line below shows the change from
            zero, not your balance.
          </p>
        )}
      </div>

      {/* The line, and the two numbers that matter on it. */}
      <div className="bg-surface rounded-container border border-line p-5">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          <Stat label="Lowest point" value={flow.lowest ? formatCurrency(flow.lowest.balance) : '—'}
            sub={flow.lowest ? format(parseISO(flow.lowest.date), 'd MMM yyyy') : undefined}
            tone={flow.lowest && flow.lowest.balance < 0 ? 'negative' : 'normal'} />
          <Stat label={`Balance in ${months} month${months > 1 ? 's' : ''}`} value={formatCurrency(flow.endingBalance)}
            tone={flow.endingBalance < 0 ? 'negative' : 'normal'} />
          <Stat label="Dated items" value={String(items.length)} sub="You added these" />
        </div>

        {dipsNegative && (
          <div className="flex items-start gap-2 bg-negative-tint border border-negative rounded-container p-3 mb-4">
            <TriangleAlert className="w-4 h-4 text-negative mt-0.5 shrink-0" />
            <p className="text-sm text-ink">
              Goes below zero on{' '}
              <span className="font-semibold">{format(parseISO(flow.firstNegative!), 'd MMMM')}</span>
              {flow.lowest && <>, bottoming at <span className="money font-semibold">{formatCurrency(flow.lowest.balance)}</span></>}.
            </p>
          </div>
        )}

        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
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

        {flow.smoothedIncomes.length > 0 && (
          <p className="text-caption text-ink-muted mt-3 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {flow.smoothedIncomes.join(' and ')} {flow.smoothedIncomes.length > 1 ? 'have' : 'has'} no
            payday set, so {flow.smoothedIncomes.length > 1 ? 'they are' : 'it is'} spread evenly
            across the month rather than landing on a date. That flattens the dips between paydays —
            set a date on the Income screen to see them.
          </p>
        )}
      </div>

      {/* Dated items. */}
      <div className="bg-surface rounded-container border border-line p-5">
        <h2 className="text-lg font-semibold text-ink mb-1 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-ink-muted" />What&apos;s coming
        </h2>
        <p className="text-caption text-ink-muted mb-4">
          Planning only — nothing here is added to your transactions. Recurring bills and income you
          have already set up are included in the line above automatically.
        </p>

        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-[10rem]">
            <label htmlFor="cp-label" className="label-micro block mb-1.5">What</label>
            <input id="cp-label" value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
              placeholder="Tuition, bonus, car repair…"
              className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label htmlFor="cp-kind" className="label-micro block mb-1.5">Direction</label>
            <select id="cp-kind" value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as 'in' | 'out' }))}
              className="h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink focus:outline-none focus:border-accent">
              <option value="out">Payment</option>
              <option value="in">Money in</option>
            </select>
          </div>
          <div>
            <label htmlFor="cp-amount" className="label-micro block mb-1.5">Amount</label>
            <input id="cp-amount" type="number" value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))}
              placeholder="$0"
              className="w-28 h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent money" />
          </div>
          <div>
            <label htmlFor="cp-date" className="label-micro block mb-1.5">Date</label>
            <input id="cp-date" type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}
              className="h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink focus:outline-none focus:border-accent" />
          </div>
          <button onClick={addItem}
            className="h-9 px-3 inline-flex items-center gap-1.5 bg-accent text-ink-inverse rounded-control text-sm font-medium hover:bg-accent-hover">
            <Plus className="w-3.5 h-3.5" />Add
          </button>
        </div>

        {items.length === 0
          ? <p className="text-sm text-ink-muted py-4 text-center">Nothing added yet.</p>
          : (
            <ul>
              {items.map(item => (
                <li key={item.id} className="flex items-center gap-3 h-row border-b border-line-faint last:border-0">
                  <span className="text-caption text-ink-muted w-24 shrink-0">{format(parseISO(item.date), 'd MMM yyyy')}</span>
                  <span className="text-sm text-ink flex-1">{item.label}</span>
                  <span className={`money text-sm font-medium ${item.kind === 'in' ? 'text-positive' : 'text-negative'}`}>
                    {item.kind === 'in' ? '+' : '−'}{formatCurrency(item.amount)}
                  </span>
                  <button onClick={() => removeItem(item.id)} aria-label={`Remove ${item.label}`}
                    className="p-1.5 text-ink-muted hover:text-negative hover:bg-negative-tint rounded-control">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone = 'normal' }: {
  label: string; value: string; sub?: string; tone?: 'normal' | 'negative';
}) {
  return (
    <div className="bg-surface-sunk rounded-container p-3">
      <p className="text-caption text-ink-muted">{label}</p>
      <p className={`text-xl font-semibold money ${tone === 'negative' ? 'text-negative' : 'text-ink'}`}>{value}</p>
      {sub && <p className="text-caption text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}
