import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, Bar, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import * as chart from '../ui/chartTheme';
import { Button, PanelGrid } from '../ui';
import { formatCurrency } from '../../utils/calculations';
import type { LifePlan } from '../../types/lifeplan';
import type { PlanOutcome, PlanRow } from '../../types/projection';
import { needsSetup } from '../../types/projection';
import { Card, Segmented } from './ui';

const COLORS = { liquid: 'var(--c-data-1)', home: 'var(--c-data-5)', debt: 'var(--c-negative)', net: 'var(--c-ink)', spend: 'var(--c-caution)', tax: 'var(--c-ink-muted)', income: 'var(--c-positive)' };
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
    <div className="bg-surface border border-line shadow-overlay px-2 py-1.5 text-caption space-y-0.5">
      <p className="label-micro mb-1">{row.year} · age {row.ages.me}{row.ages.partner !== undefined && ` / ${row.ages.partner}`}</p>
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

const TABLE_HEADS = ['Year', 'Age', 'Income', 'Tax', 'Spending', 'Saved / drawn', 'Savings', 'Home', 'Debt', 'Net worth'];

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
    return <Card><p className="font-sans text-sm text-ink-muted">Add your birth year in Setup to see the projection.</p></Card>;
  }

  const me = plan.people.find(p => p.id === 'me');
  const retireYear = Number(me?.birthYear) + Number(me?.retireAge || 65);
  const ret = result.retirementRow;
  const fin = result.finalRow;
  const dv = (row: PlanRow | null, v: number) => (row && todayDollars ? v / row.inflationIndex : v);
  const lifetimeTax = rows.reduce((s, r) => s + (todayDollars ? r.tax / r.inflationIndex : r.tax), 0);
  const eventYears = rows.filter(r => r.events.length);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          options={[[true, "Today's dollars"], [false, 'Future dollars']] as const}
          value={todayDollars}
          onChange={setTodayDollars}
        />
        <p className="font-sans text-caption text-ink-muted">
          {todayDollars ? 'Adjusted for inflation, so amounts are comparable with money today.' : 'Actual dollar amounts in each future year.'}
        </p>
      </div>

      {/* The figures: retirement, the end of the plan, tax, and whether it holds. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line">
        <div className="bg-surface px-2.5 py-1.5 col-span-2 lg:col-span-1">
          <p className="label-micro">Net worth at retirement ({retireYear})</p>
          <p className="figure-display mt-1">{ret ? money(dv(ret, ret.netWorth)) : '—'}</p>
          <p className="text-caption text-ink-muted mt-0.5">
            {ret ? `${money(dv(ret, ret.balances.liquid))} of it in savings` : 'Beyond the plan window'}
          </p>
        </div>
        <div className="bg-surface px-2.5 py-1.5">
          <p className="label-micro">At age {plan.assumptions.endAge}</p>
          <p className="text-xl font-medium text-ink mt-1">{fin ? money(dv(fin, fin.netWorth)) : '—'}</p>
          {fin && <p className="text-caption text-ink-muted mt-0.5">{money(dv(fin, fin.balances.liquid))} in savings</p>}
        </div>
        <div className="bg-surface px-2.5 py-1.5">
          <p className="label-micro">Lifetime tax</p>
          <p className="text-xl font-medium text-ink mt-1">{money(lifetimeTax)}</p>
          <p className="text-caption text-ink-muted mt-0.5">Income tax + CPP/EI</p>
        </div>
        <div className="bg-surface px-2.5 py-1.5 col-span-2 lg:col-span-1">
          <p className="label-micro">Status</p>
          <p className={`text-xl font-medium mt-1 ${result.firstShortfall ? 'text-caution' : 'text-positive'}`}>
            {result.firstShortfall ? `Runs short ${result.firstShortfall.year}` : 'Holds up'}
          </p>
          <p className="text-caption text-ink-muted mt-0.5">
            {result.firstShortfall ? `age ${result.firstShortfall.year - Number(me?.birthYear)}` : `through age ${plan.assumptions.endAge}`}
          </p>
        </div>
      </div>

      <PanelGrid className="grid-flow-row-dense">
        <Card title="Net worth over time" subtitle="Savings and investments, plus home equity, less debts." bordered={false} className="col-span-12 xl:col-span-7" flush>
          <div className="p-2">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="year" {...chart.xAxis} interval="preserveStartEnd" minTickGap={40} />
                <YAxis {...chart.yAxis} tickFormatter={compact} />
                <ReferenceLine y={0} stroke="var(--c-line-strong)" />
                {retireYear && <ReferenceLine x={retireYear} stroke="var(--c-ink-muted)" strokeDasharray="4 4" label={{ value: 'retirement', fontSize: 10, fill: 'var(--c-ink-muted)', position: 'insideTopRight' }} />}
                <Tooltip content={<ChartTooltip rows={rows} todayDollars={todayDollars} />} />
                <Legend wrapperStyle={chart.legend.wrapperStyle} iconSize={chart.legend.iconSize} />
                <Area dataKey="liquid" name="Savings & investments" stackId="a" stroke="none" fill={COLORS.liquid} fillOpacity={0.6} isAnimationActive={false} />
                <Area dataKey="homeEquity" name="Home equity" stackId="a" stroke="none" fill={COLORS.home} fillOpacity={0.6} isAnimationActive={false} />
                <Area dataKey="debt" name="Other debt" stroke="none" fill={COLORS.debt} fillOpacity={0.5} isAnimationActive={false} />
                <Line dataKey="netWorth" name="Net worth" stroke={COLORS.net} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {eventYears.length > 0 && (
            <p className="text-caption text-ink-muted px-2.5 py-1.5 border-t border-line">
              <span className="label-micro mr-2">Planned</span>
              {eventYears.slice(0, 6).map(r => `${r.events.map(e => e.name).join(', ')} (${r.year})`).join(' · ')}{eventYears.length > 6 ? ' …' : ''}
            </p>
          )}
        </Card>

        <Card title="Money in and out each year" subtitle="Income, what tax takes, and what you spend." bordered={false} className="col-span-12 xl:col-span-5" flush>
          <div className="p-2">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} stackOffset="sign">
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="year" {...chart.xAxis} interval="preserveStartEnd" minTickGap={40} />
                <YAxis {...chart.yAxis} tickFormatter={compact} />
                <ReferenceLine y={0} stroke="var(--c-line-strong)" />
                <Tooltip content={<ChartTooltip rows={rows} todayDollars={todayDollars} />} cursor={chart.tooltip.cursor} />
                <Legend wrapperStyle={chart.legend.wrapperStyle} iconSize={chart.legend.iconSize} />
                <Bar dataKey="income" name="Income" fill={COLORS.income} stackId="b" isAnimationActive={false} />
                <Bar dataKey="tax" name="Tax" fill={COLORS.tax} stackId="c" isAnimationActive={false} />
                <Bar dataKey="spending" name="Spending" fill={COLORS.spend} stackId="c" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          title="Year by year"
          subtitle={`${rows.length} years, starting ${result.startYm}. ${todayDollars ? "In today's dollars." : 'In future dollars.'}`}
          actions={<Button size="sm" variant="ghost" onClick={() => setShowTable(s => !s)}>{showTable ? 'Hide table' : 'Show table'}</Button>}
          bordered={false}
          className="col-span-12"
          flush
        >
          {showTable && (
            <div className="overflow-auto max-h-[28rem]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {TABLE_HEADS.map(h => (
                      <th key={h} scope="col" className={`label-micro font-medium h-[22px] px-2.5 border-b border-line bg-surface-sunk whitespace-nowrap ${h === 'Year' || h === 'Age' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const d = (v: number) => (todayDollars ? v / r.inflationIndex : v);
                    // Money set aside out of your own pocket (investments +
                    // RRSP/FHSA contributions, less the employer's match) minus what was drawn.
                    const netSaved = r.invested + r.contributions - r.employerMatch - r.withdrawals;
                    const cell = 'h-row px-2.5 border-b border-line whitespace-nowrap';
                    return (
                      <tr key={r.year} className={`hover:bg-surface-hover ${r.shortfall > 0 ? 'shadow-[inset_2px_0_0_var(--c-negative)]' : ''}`}>
                        <td className={`${cell} ${r.shortfall > 0 ? 'text-negative' : 'text-ink-secondary'}`}>
                          {r.year}
                          {r.events.length > 0 && <span className="inline-block w-[5px] h-[5px] ml-1.5 align-middle bg-accent" title={r.events.map(e => e.name).join(', ')} />}
                        </td>
                        <td className={`${cell} text-ink-muted`}>{r.ages.me}</td>
                        <td className={`${cell} text-right text-ink-secondary`}>{money(d(r.income))}</td>
                        <td className={`${cell} text-right text-ink-muted`}>{money(d(r.tax))}</td>
                        <td className={`${cell} text-right text-ink-muted`}>{money(d(r.spending.total))}</td>
                        <td className={`${cell} text-right ${netSaved >= 0 ? 'text-positive' : 'text-caution'}`}>{netSaved >= 0 ? '+' : '−'}{money(Math.abs(d(netSaved)))}</td>
                        <td className={`${cell} text-right text-ink-secondary`}>{money(d(r.balances.liquid))}</td>
                        <td className={`${cell} text-right text-ink-muted`}>{r.homeValue ? money(d(r.homeValue)) : '—'}</td>
                        <td className={`${cell} text-right text-ink-muted`}>{r.mortgage + r.otherDebt ? money(d(r.mortgage + r.otherDebt)) : '—'}</td>
                        <td className={`${cell} text-right font-semibold text-ink`}>{money(d(r.netWorth))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </PanelGrid>
    </div>
  );
}
