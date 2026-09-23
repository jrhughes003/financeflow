import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, Bar, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import * as chart from '../ui/chartTheme';
import { PageLede, Stat as UiStat } from '../ui';
import { formatCurrency } from '../../utils/calculations';
import type { LifePlan } from '../../types/lifeplan';
import type { PlanOutcome, PlanRow } from '../../types/projection';
import { needsSetup } from '../../types/projection';
import { Card, Stat } from './ui';

const COLORS = { liquid: 'var(--c-data-1)', home: 'var(--c-data-5)', debt: 'var(--c-negative)', net: '#0f172a', spend: 'var(--c-caution)', tax: '#64748b', income: '#16a34a' };
const money = (v: number): string => formatCurrency(Math.round(v));
const compact = (v: number): string => `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1000000 ? `${(Math.abs(v) / 1000000).toFixed(1)}M` : `${Math.round(Math.abs(v) / 1000)}k`}`;

interface ChartTooltipProps {
  /** Recharts fills these three in; the two below are passed at the call site. */
  active?: boolean;
  payload?: unknown[];
  label?: string | number;
  rows: PlanRow[];
  todayDollars: boolean;
}

function ChartTooltip({ active, payload, label, rows, todayDollars }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = rows.find(r => r.year === label);
  if (!row) return null;
  const d = (v: number) => (todayDollars ? v / row.inflationIndex : v);
  return (
    <div className="bg-surface border border-line-strong rounded-control p-3 text-caption space-y-0.5">
      <p className="font-semibold text-ink mb-1">{row.year} · age {row.ages.me}{row.ages.partner !== undefined && ` / ${row.ages.partner}`}</p>
      <p className="text-ink-secondary">Income: {money(d(row.income))}</p>
      <p className="text-ink-secondary">Tax: −{money(d(row.tax))} ({Math.round(row.averageTaxRate * 100)}%)</p>
      <p className="text-ink-secondary">Spending: −{money(d(row.spending.total))}</p>
      <p className="text-ink font-medium pt-1">Savings & investments: {money(d(row.balances.liquid))}</p>
      {row.homeValue > 0 && <p className="text-ink-secondary">Home equity: {money(d(row.homeValue - row.mortgage))}</p>}
      {(row.mortgage > 0 || row.otherDebt > 0) && <p className="text-ink-secondary">Debt: −{money(d(row.mortgage + row.otherDebt))}</p>}
      <p className="text-ink font-semibold">Net worth: {money(d(row.netWorth))}</p>
      {row.events.length > 0 && <p className="text-accent-ink pt-1">{row.events.map(e => e.name).join(', ')}</p>}
      {row.shortfall > 0 && <p className="text-negative">Short {money(row.shortfall)} this year</p>}
    </div>
  );
}

export default function PlanProjection({ plan, result }: { plan: LifePlan; result: PlanOutcome }) {
  const [todayDollars, setTodayDollars] = useState(true);
  const [showTable, setShowTable] = useState(false);

  // There are no rows on the needs-setup marker, and the hooks below run
  // before the early return that handles it.
  const resultRows = needsSetup(result) ? undefined : result.rows;
  // Memoised so the empty fallback keeps one identity; a new [] each render
  // would re-run the mapping below every time.
  const rows = useMemo(() => resultRows || [], [resultRows]);
  const data = useMemo(() => rows.map(r => {
    const d = (v: number) => (todayDollars ? v / r.inflationIndex : v);
    return {
      year: r.year,
      age: r.ages.me,
      liquid: Math.round(d(r.balances.liquid)),
      homeEquity: Math.round(d(Math.max(0, r.homeValue - r.mortgage))),
      debt: -Math.round(d(r.otherDebt)),
      netWorth: Math.round(d(r.netWorth)),
      income: Math.round(d(r.income)),
      tax: -Math.round(d(r.tax)),
      spending: -Math.round(d(r.spending.total)),
    };
  }), [rows, todayDollars]);

  if (needsSetup(result)) {
    return <Card><p className="text-sm text-ink-muted text-center py-8">Add your birth year in Setup to see the projection.</p></Card>;
  }

  const me = plan.people.find(p => p.id === 'me');
  const retireYear = Number(me?.birthYear) + Number(me?.retireAge || 65);
  const ret = result.retirementRow;
  const fin = result.finalRow;
  const dv = (row: PlanRow | null, v: number) => (row && todayDollars ? v / row.inflationIndex : v);
  const lifetimeTax = rows.reduce((s, r) => s + (todayDollars ? r.tax / r.inflationIndex : r.tax), 0);
  const eventYears = rows.filter(r => r.events.length);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex bg-surface-hover rounded-control p-0.5 text-caption font-medium">
          {([[true, "Today's dollars"], [false, 'Future dollars']] as const).map(([val, label]) => (
            <button key={label} onClick={() => setTodayDollars(val)}
              className={`px-3 py-1.5 rounded-control transition-colors ${todayDollars === val ? 'bg-surface  text-accent' : 'text-ink-muted hover:text-ink-secondary'}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-caption text-ink-muted">
          {todayDollars ? 'Adjusted for inflation, so amounts are comparable with money today.' : 'Actual dollar amounts in each future year.'}
        </p>
      </div>

      <Card>
        <PageLede
          label={`Net worth at retirement (${retireYear})`}
          supporting={(
            <>
              <UiStat label={`At age ${plan.assumptions.endAge}`}
                hint={fin ? `${money(dv(fin, fin.balances.liquid))} in savings` : null}>
                {fin ? money(dv(fin, fin.netWorth)) : '—'}
              </UiStat>
              <UiStat label="Lifetime tax" hint="Income tax + CPP/EI">
                {money(lifetimeTax)}
              </UiStat>
              <UiStat label="Status"
                hint={result.firstShortfall ? `age ${result.firstShortfall.year - Number(me?.birthYear)}` : `through age ${plan.assumptions.endAge}`}>
                <span className={result.firstShortfall ? 'text-caution' : 'text-positive'}>
                  {result.firstShortfall ? `Runs short ${result.firstShortfall.year}` : 'Holds up'}
                </span>
              </UiStat>
            </>
          )}
        >
          <span className="figure-display">{ret ? money(dv(ret, ret.netWorth)) : '—'}</span>
          <p className="text-caption text-ink-muted mt-2">
            {ret ? `${money(dv(ret, ret.balances.liquid))} of it in savings` : 'Beyond the plan window'}
          </p>
        </PageLede>
      </Card>

      <Card title="Net worth over time" subtitle="Savings and investments, plus home equity, less debts.">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid {...chart.grid} />
            <XAxis dataKey="year" {...chart.xAxis} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis {...chart.yAxis} tick={{ fontSize: 11 }} tickFormatter={compact} width={55} />
            <ReferenceLine y={0} stroke="var(--c-ink-muted)" />
            {retireYear && <ReferenceLine x={retireYear} stroke="var(--c-ink-muted)" strokeDasharray="4 4" label={{ value: 'retirement', fontSize: 10, fill: '#64748b', position: 'insideTopRight' }} />}
            <Tooltip content={<ChartTooltip rows={rows} todayDollars={todayDollars} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area dataKey="liquid" name="Savings & investments" stackId="a" stroke="none" fill={COLORS.liquid} fillOpacity={0.6} isAnimationActive={false} />
            <Area dataKey="homeEquity" name="Home equity" stackId="a" stroke="none" fill={COLORS.home} fillOpacity={0.6} isAnimationActive={false} />
            <Area dataKey="debt" name="Other debt" stroke="none" fill={COLORS.debt} fillOpacity={0.5} isAnimationActive={false} />
            <Line dataKey="netWorth" name="Net worth" stroke={COLORS.net} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        {eventYears.length > 0 && (
          <p className="text-caption text-ink-muted mt-2">
            Planned: {eventYears.slice(0, 6).map(r => `${r.events.map(e => e.name).join(', ')} (${r.year})`).join(' · ')}{eventYears.length > 6 ? ' …' : ''}
          </p>
        )}
      </Card>

      <Card title="Money in and out each year" subtitle="Income, what tax takes, and what you spend.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }} stackOffset="sign">
            <CartesianGrid {...chart.grid} />
            <XAxis dataKey="year" {...chart.xAxis} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis {...chart.yAxis} tick={{ fontSize: 11 }} tickFormatter={compact} width={55} />
            <ReferenceLine y={0} stroke="var(--c-ink-muted)" />
            <Tooltip content={<ChartTooltip rows={rows} todayDollars={todayDollars} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" name="Income" fill={COLORS.income} stackId="b" isAnimationActive={false} />
            <Bar dataKey="tax" name="Tax" fill={COLORS.tax} stackId="c" isAnimationActive={false} />
            <Bar dataKey="spending" name="Spending" fill={COLORS.spend} stackId="c" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card
        title="Year by year"
        subtitle={`${rows.length} years, starting ${result.startYm}. ${todayDollars ? "In today's dollars." : 'In future dollars.'}`}
        actions={<button onClick={() => setShowTable(s => !s)} className="text-caption text-accent hover:text-accent-ink font-medium">{showTable ? 'Hide table' : 'Show table'}</button>}
      >
        {showTable && (
          <div className="overflow-auto max-h-[28rem]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-caption text-ink-muted border-b border-line">
                  {['Year', 'Age', 'Income', 'Tax', 'Spending', 'Saved / drawn', 'Savings', 'Home', 'Debt', 'Net worth'].map(h => (
                    <th key={h} className={`py-2 font-medium ${h === 'Year' || h === 'Age' ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const d = (v: number) => (todayDollars ? v / r.inflationIndex : v);
                  // Money set aside out of your own pocket (investments +
                  // RRSP/FHSA contributions, less the employer's match) minus what was drawn.
                  const netSaved = r.invested + r.contributions - r.employerMatch - r.withdrawals;
                  return (
                    <tr key={r.year} className={`border-b border-line-faint ${r.shortfall > 0 ? 'bg-negative-tint/50' : ''}`}>
                      <td className="py-1.5 text-ink-secondary">{r.year}{r.events.length > 0 && <span className="ml-1 text-caption text-accent" title={r.events.map(e => e.name).join(', ')}>●</span>}</td>
                      <td className="py-1.5 text-ink-muted">{r.ages.me}</td>
                      <td className="py-1.5 text-right text-ink-secondary">{money(d(r.income))}</td>
                      <td className="py-1.5 text-right text-ink-muted">{money(d(r.tax))}</td>
                      <td className="py-1.5 text-right text-ink-muted">{money(d(r.spending.total))}</td>
                      <td className={`py-1.5 text-right ${netSaved >= 0 ? 'text-positive' : 'text-caution'}`}>{netSaved >= 0 ? '+' : '−'}{money(Math.abs(d(netSaved)))}</td>
                      <td className="py-1.5 text-right text-ink-secondary">{money(d(r.balances.liquid))}</td>
                      <td className="py-1.5 text-right text-ink-muted">{r.homeValue ? money(d(r.homeValue)) : '—'}</td>
                      <td className="py-1.5 text-right text-ink-muted">{r.mortgage + r.otherDebt ? money(d(r.mortgage + r.otherDebt)) : '—'}</td>
                      <td className="py-1.5 text-right font-semibold text-ink">{money(d(r.netWorth))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
