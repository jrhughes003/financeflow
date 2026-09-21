import React, { useState } from 'react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatCurrency } from '../../utils/calculations';
import { getCategoryDeltas } from '../../utils/insights';
import { useGetCategory } from '../../context/FinancialContext';

// Diverging pair: spending more vs spending less. Neutral text carries the sign too.
const UP_COLOR = '#f97316';
const DOWN_COLOR = '#0ea5e9';

const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatCurrency(Math.abs(v))}`;
const signedPct = p => (p === null ? 'new' : `${p > 0 ? '+' : ''}${Math.round(p)}%`);

export default function WhatChangedPanel({ transactions, month, year }) {
  const getCategory = useGetCategory();
  const [basis, setBasis] = useState('average'); // 'average' | 'previous'
  const { rows, totals, cutoffDay, historyMonths } = getCategoryDeltas(transactions, month, year);

  if (historyMonths === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">What Changed</h2>
        <p className="text-sm text-gray-400">Needs at least one earlier month of transactions to compare against.</p>
      </div>
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
  const HeadIcon = totalChange > 0 ? TrendingUp : totalChange < 0 ? TrendingDown : Minus;
  const riser = sorted.find(r => r[changeKey] > 0);
  const faller = sorted.find(r => r[changeKey] < 0);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">What Changed</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {cutoffDay
              ? `Month in progress — every month compared through day ${cutoffDay}`
              : format(new Date(year, month, 1), 'MMMM yyyy')}
          </p>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs font-medium">
          {[['average', 'vs usual'], ['previous', 'vs last month']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setBasis(val)}
              className={`px-3 py-1.5 rounded-md transition-colors ${basis === val ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Headline */}
      <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4 mb-4">
        <HeadIcon className="w-5 h-5 shrink-0 mt-0.5 text-gray-500" />
        <div>
          <p className="text-sm text-gray-800">
            You spent <span className="font-semibold">{formatCurrency(totals.current)}</span>
            {totalChange === 0
              ? <> — the same as {baseLabel}.</>
              : <>, <span className="font-semibold">{signed(totalChange)}</span>
                {totalPct !== null && <> ({signedPct(totalPct)})</>} compared with {baseLabel} ({formatCurrency(totals[baseKey])}).</>}
          </p>
          {(riser || faller) && (
            <p className="text-xs text-gray-500 mt-1">
              {riser && <>Biggest increase: <span className="font-medium text-gray-700">{getCategory(riser.category).name} {signed(riser[changeKey])}</span></>}
              {riser && faller && ' · '}
              {faller && <>Biggest drop: <span className="font-medium text-gray-700">{getCategory(faller.category).name} {signed(faller[changeKey])}</span></>}
            </p>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Diverging bars */}
        <div>
          {chartData.length === 0
            ? <p className="text-sm text-gray-400 text-center py-8">No changes to show.</p>
            : (
              <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 34 + 30)}>
                <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `${v < 0 ? '−' : ''}$${Math.abs(v)}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <ReferenceLine x={0} stroke="#94a3b8" />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    formatter={(v, _n, { payload }) => [`${signed(v)} (${signedPct(payload.row[pctKey])})`, `vs ${basis === 'average' ? 'usual' : 'last month'}`]}
                  />
                  <Bar dataKey="change" radius={4} barSize={18} isAnimationActive={false}>
                    {chartData.map(d => <Cell key={d.name} fill={d.change > 0 ? UP_COLOR : DOWN_COLOR} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          <div className="flex justify-center gap-4 text-xs text-gray-500 mt-1">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: UP_COLOR }} />Spent more</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: DOWN_COLOR }} />Spent less</span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="text-left font-medium py-2">Category</th>
                <th className="text-right font-medium py-2">This month</th>
                <th className="text-right font-medium py-2">{basis === 'average' ? 'Usual' : 'Last month'}</th>
                <th className="text-right font-medium py-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 10).map(r => {
                const cat = getCategory(r.category);
                return (
                  <tr key={r.category} className="border-b border-gray-50">
                    <td className="py-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                        <span className="text-gray-700">{cat.name}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-800">{formatCurrency(r.current)}</td>
                    <td className="py-2 text-right text-gray-500">{formatCurrency(r[baseKey])}</td>
                    <td className={`py-2 text-right font-medium ${r[changeKey] > 0 ? 'text-orange-600' : r[changeKey] < 0 ? 'text-sky-600' : 'text-gray-400'}`}>
                      {signed(r[changeKey])}
                      <span className="block text-xs font-normal text-gray-400">{r[baseKey] > 0 || r.current > 0 ? signedPct(r[pctKey]) : '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
