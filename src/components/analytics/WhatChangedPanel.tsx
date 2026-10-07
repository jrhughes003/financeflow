import type { PeriodPanelProps } from '../../types/navigation';
import React, { useState } from 'react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import * as chart from '../ui/chartTheme';
import { formatCurrency } from '../../utils/calculations';
import { getCategoryDeltas } from '../../utils/insights';
import { useGetCategory } from '../../context/FinancialContext';
import { Panel, CategoryMark } from '../ui';

// Diverging pair: spending more vs spending less. Neutral text carries the sign too.
const UP_COLOR = 'var(--c-data-2)';
const DOWN_COLOR = 'var(--c-data-3)';

const signed = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatCurrency(Math.abs(v))}`;
const signedPct = (p: number | null): string => (p === null ? 'new' : `${p > 0 ? '+' : ''}${Math.round(p)}%`);

export default function WhatChangedPanel({
  transactions, month, year, className = 'col-span-12',
}: PeriodPanelProps & { className?: string }) {
  const getCategory = useGetCategory();
  const [basis, setBasis] = useState('average'); // 'average' | 'previous'
  const { rows, totals, cutoffDay, historyMonths } = getCategoryDeltas(transactions, month, year);

  if (historyMonths === 0) {
    return (
      <Panel title="What Changed" className={className}>
        <p className="font-sans text-sm text-ink-muted p-3">Needs at least one earlier month of transactions to compare against.</p>
      </Panel>
    );
  }

  const changeKey = basis === 'average' ? 'changeVsAverage' : 'changeVsPrevious';
  const pctKey = basis === 'average' ? 'pctVsAverage' : 'pctVsPrevious';
  const baseKey = basis === 'average' ? 'average' : 'previous';
  const baseLabel = basis === 'average' ? `your ${historyMonths}-month average` : 'last month';

  const sorted = [...rows].sort((a, b) => Math.abs(b[changeKey]) - Math.abs(a[changeKey]));
  const chartData = sorted
    .filter(r => r[changeKey] !== 0)
    .slice(0, 8)
    .map(r => ({ name: getCategory(r.category).name, change: r[changeKey], row: r }));

  const totalChange = totals[changeKey];
  const totalPct = totals[pctKey];
  const riser = sorted.find(r => r[changeKey] > 0);
  const faller = sorted.find(r => r[changeKey] < 0);

  return (
    <Panel
      title="What Changed"
      className={className}
      meta={cutoffDay
        ? `Month in progress — every month compared through day ${cutoffDay}`
        : format(new Date(year, month, 1), 'MMMM yyyy')}
      actions={(
        <span className="flex border border-line-strong">
          {[['average', 'vs usual'], ['previous', 'vs last month']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setBasis(val)}
              aria-pressed={basis === val}
              className={`h-[18px] px-1.5 text-micro uppercase tracking-[0.06em] border-r border-line-strong last:border-r-0 transition-colors ${basis === val ? 'bg-accent-tint text-accent-ink' : 'text-ink-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </span>
      )}
    >
      {/* Headline */}
      <div className="px-2.5 py-1.5 border-b border-line">
        <p className="font-sans text-[12.5px] leading-snug text-ink">
          You spent <span className="font-semibold">{formatCurrency(totals.current)}</span>
          {totalChange === 0
            ? <> — the same as {baseLabel}.</>
            : <>, <span className={`font-semibold ${totalChange > 0 ? 'text-caution' : 'text-info'}`}>{signed(totalChange)}</span>
              {totalPct !== null && <> ({signedPct(totalPct)})</>} compared with {baseLabel} ({formatCurrency(totals[baseKey])}).</>}
        </p>
        {(riser || faller) && (
          <p className="text-caption text-ink-muted mt-0.5 uppercase tracking-[0.03em]">
            {riser && <>Biggest increase: <span className="text-ink-secondary">{getCategory(riser.category).name} {signed(riser[changeKey])}</span></>}
            {riser && faller && ' · '}
            {faller && <>Biggest drop: <span className="text-ink-secondary">{getCategory(faller.category).name} {signed(faller[changeKey])}</span></>}
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-px bg-line">
        {/* Diverging bars */}
        <div className="bg-surface p-3">
          {chartData.length === 0
            ? <p className="font-sans text-sm text-ink-muted text-center py-8">No changes to show.</p>
            : (
              <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 26 + 30)}>
                <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid {...chart.grid} horizontal={false} vertical />
                  <XAxis type="number" {...chart.xAxis} tickFormatter={v => `${v < 0 ? '−' : ''}${chart.compactMoney(Math.abs(v))}`} />
                  <YAxis {...chart.yAxis} type="category" dataKey="name" width={110} />
                  <ReferenceLine x={0} stroke="var(--c-line-strong)" />
                  <Tooltip
                    {...chart.tooltip}
                    formatter={(v, _n, { payload }) => [`${signed(chart.asNumber(v))} (${signedPct(payload.row[pctKey])})`, `vs ${basis === 'average' ? 'usual' : 'last month'}`]}
                  />
                  <Bar dataKey="change" barSize={14} isAnimationActive={false}>
                    {chartData.map(d => <Cell key={d.name} fill={d.change > 0 ? UP_COLOR : DOWN_COLOR} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          <div className="flex justify-center gap-4 text-micro uppercase tracking-[0.06em] text-ink-muted mt-1">
            <span className="flex items-center gap-1.5"><span className="w-[7px] h-[7px]" style={{ backgroundColor: UP_COLOR }} aria-hidden="true" />Spent more</span>
            <span className="flex items-center gap-1.5"><span className="w-[7px] h-[7px]" style={{ backgroundColor: DOWN_COLOR }} aria-hidden="true" />Spent less</span>
          </div>
        </div>

        {/* Table */}
        <div className="bg-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="label-micro">
                <th scope="col" className="text-left font-medium h-[22px] px-2.5 border-b border-line bg-surface-sunk">Category</th>
                <th scope="col" className="text-right font-medium px-2.5 border-b border-line bg-surface-sunk">This month</th>
                <th scope="col" className="text-right font-medium px-2.5 border-b border-line bg-surface-sunk">{basis === 'average' ? 'Usual' : 'Last month'}</th>
                <th scope="col" className="text-right font-medium px-2.5 border-b border-line bg-surface-sunk">Change</th>
                <th scope="col" className="text-right font-medium px-2.5 border-b border-line bg-surface-sunk"><span className="sr-only">Change percent</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 10).map(r => {
                const cat = getCategory(r.category);
                return (
                  <tr key={r.category} className="hover:bg-surface-hover">
                    <td className="h-row px-2.5 border-b border-line text-ink-secondary">
                      <CategoryMark color={cat.color} name={cat.name} />
                    </td>
                    <td className="px-2.5 border-b border-line text-right text-ink whitespace-nowrap">{formatCurrency(r.current)}</td>
                    <td className="px-2.5 border-b border-line text-right text-ink-muted whitespace-nowrap">{formatCurrency(r[baseKey])}</td>
                    <td className={`px-2.5 border-b border-line text-right whitespace-nowrap ${r[changeKey] > 0 ? 'text-caution' : r[changeKey] < 0 ? 'text-info' : 'text-ink-muted'}`}>
                      {signed(r[changeKey])}
                    </td>
                    <td className="px-2.5 border-b border-line text-right text-caption text-ink-muted whitespace-nowrap">
                      {r[baseKey] > 0 || r.current > 0 ? signedPct(r[pctKey]) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}
