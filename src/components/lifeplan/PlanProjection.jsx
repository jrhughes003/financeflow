import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, Bar, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { formatCurrency } from '../../utils/calculations';
import { Card, Stat } from './ui';

const COLORS = { liquid: '#2563eb', home: '#8b5cf6', debt: '#ef4444', net: '#0f172a', spend: '#f59e0b', tax: '#64748b', income: '#16a34a' };
const money = v => formatCurrency(Math.round(v));
const compact = v => `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1000000 ? `${(Math.abs(v) / 1000000).toFixed(1)}M` : `${Math.round(Math.abs(v) / 1000)}k`}`;

function ChartTooltip({ active, payload, label, rows, todayDollars }) {
  if (!active || !payload?.length) return null;
  const row = rows.find(r => r.year === label);
  if (!row) return null;
  const d = v => (todayDollars ? v / row.inflationIndex : v);
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-xs space-y-0.5">
      <p className="font-semibold text-gray-800 mb-1">{row.year} · age {row.ages.me}{row.ages.partner !== undefined && ` / ${row.ages.partner}`}</p>
      <p className="text-gray-600">Income: {money(d(row.income))}</p>
      <p className="text-gray-600">Tax: −{money(d(row.tax))} ({Math.round(row.averageTaxRate * 100)}%)</p>
      <p className="text-gray-600">Spending: −{money(d(row.spending.total))}</p>
      <p className="text-gray-800 font-medium pt-1">Savings & investments: {money(d(row.balances.liquid))}</p>
      {row.homeValue > 0 && <p className="text-gray-600">Home equity: {money(d(row.homeValue - row.mortgage))}</p>}
      {(row.mortgage > 0 || row.otherDebt > 0) && <p className="text-gray-600">Debt: −{money(d(row.mortgage + row.otherDebt))}</p>}
      <p className="text-gray-900 font-semibold">Net worth: {money(d(row.netWorth))}</p>
      {row.events.length > 0 && <p className="text-blue-700 pt-1">{row.events.map(e => e.name).join(', ')}</p>}
      {row.shortfall > 0 && <p className="text-red-600">Short {money(row.shortfall)} this year</p>}
    </div>
  );
}

export default function PlanProjection({ plan, result }) {
  const [todayDollars, setTodayDollars] = useState(true);
  const [showTable, setShowTable] = useState(false);

  const rows = result.rows || [];
  const data = useMemo(() => rows.map(r => {
    const d = v => (todayDollars ? v / r.inflationIndex : v);
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

  if (result.needsSetup) {
    return <Card><p className="text-sm text-gray-400 text-center py-8">Add your birth year in Setup to see the projection.</p></Card>;
  }

  const me = plan.people.find(p => p.id === 'me');
  const retireYear = Number(me.birthYear) + Number(me.retireAge || 65);
  const ret = result.retirementRow;
  const fin = result.finalRow;
  const dv = (row, v) => (row && todayDollars ? v / row.inflationIndex : v);
  const lifetimeTax = rows.reduce((s, r) => s + (todayDollars ? r.tax / r.inflationIndex : r.tax), 0);
  const eventYears = rows.filter(r => r.events.length);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs font-medium">
          {[[true, "Today's dollars"], [false, 'Future dollars']].map(([val, label]) => (
            <button key={label} onClick={() => setTodayDollars(val)}
              className={`px-3 py-1.5 rounded-md transition-colors ${todayDollars === val ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">
          {todayDollars ? 'Adjusted for inflation, so amounts are comparable with money today.' : 'Actual dollar amounts in each future year.'}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={`At retirement (${retireYear})`} value={ret ? money(dv(ret, ret.netWorth)) : '—'} sub={ret ? `${money(dv(ret, ret.balances.liquid))} in savings` : 'Beyond the plan window'} accent="text-blue-700" />
        <Stat label={`At age ${plan.assumptions.endAge}`} value={fin ? money(dv(fin, fin.netWorth)) : '—'} sub={fin ? `${money(dv(fin, fin.balances.liquid))} in savings` : null} />
        <Stat label="Lifetime tax" value={money(lifetimeTax)} sub="Income tax + CPP/EI over the plan" accent="text-gray-700" />
        <Stat
          label="Status"
          value={result.firstShortfall ? `Runs short ${result.firstShortfall.year}` : 'Holds up'}
          sub={result.firstShortfall ? `age ${result.firstShortfall.year - Number(me.birthYear)}` : `through age ${plan.assumptions.endAge}`}
          accent={result.firstShortfall ? 'text-amber-700' : 'text-green-700'}
        />
      </div>

      <Card title="Net worth over time" subtitle="Savings and investments, plus home equity, less debts.">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={55} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            {retireYear && <ReferenceLine x={retireYear} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'retirement', fontSize: 10, fill: '#64748b', position: 'insideTopRight' }} />}
            <Tooltip content={<ChartTooltip rows={rows} todayDollars={todayDollars} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area dataKey="liquid" name="Savings & investments" stackId="a" stroke="none" fill={COLORS.liquid} fillOpacity={0.6} isAnimationActive={false} />
            <Area dataKey="homeEquity" name="Home equity" stackId="a" stroke="none" fill={COLORS.home} fillOpacity={0.6} isAnimationActive={false} />
            <Area dataKey="debt" name="Other debt" stroke="none" fill={COLORS.debt} fillOpacity={0.5} isAnimationActive={false} />
            <Line dataKey="netWorth" name="Net worth" stroke={COLORS.net} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        {eventYears.length > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            Planned: {eventYears.slice(0, 6).map(r => `${r.events.map(e => e.name).join(', ')} (${r.year})`).join(' · ')}{eventYears.length > 6 ? ' …' : ''}
          </p>
        )}
      </Card>

      <Card title="Money in and out each year" subtitle="Income, what tax takes, and what you spend.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }} stackOffset="sign">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={55} />
            <ReferenceLine y={0} stroke="#94a3b8" />
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
        actions={<button onClick={() => setShowTable(s => !s)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">{showTable ? 'Hide table' : 'Show table'}</button>}
      >
        {showTable && (
          <div className="overflow-auto max-h-[28rem]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  {['Year', 'Age', 'Income', 'Tax', 'Spending', 'Saved / drawn', 'Savings', 'Home', 'Debt', 'Net worth'].map(h => (
                    <th key={h} className={`py-2 font-medium ${h === 'Year' || h === 'Age' ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const d = v => (todayDollars ? v / r.inflationIndex : v);
                  // Money set aside out of your own pocket (investments +
                  // RRSP/FHSA contributions, less the employer's match) minus what was drawn.
                  const netSaved = r.invested + r.contributions - r.employerMatch - r.withdrawals;
                  return (
                    <tr key={r.year} className={`border-b border-gray-50 ${r.shortfall > 0 ? 'bg-red-50/50' : ''}`}>
                      <td className="py-1.5 text-gray-700">{r.year}{r.events.length > 0 && <span className="ml-1 text-xs text-blue-600" title={r.events.map(e => e.name).join(', ')}>●</span>}</td>
                      <td className="py-1.5 text-gray-500">{r.ages.me}</td>
                      <td className="py-1.5 text-right text-gray-700">{money(d(r.income))}</td>
                      <td className="py-1.5 text-right text-gray-500">{money(d(r.tax))}</td>
                      <td className="py-1.5 text-right text-gray-500">{money(d(r.spending.total))}</td>
                      <td className={`py-1.5 text-right ${netSaved >= 0 ? 'text-green-700' : 'text-amber-700'}`}>{netSaved >= 0 ? '+' : '−'}{money(Math.abs(d(netSaved)))}</td>
                      <td className="py-1.5 text-right text-gray-700">{money(d(r.balances.liquid))}</td>
                      <td className="py-1.5 text-right text-gray-500">{r.homeValue ? money(d(r.homeValue)) : '—'}</td>
                      <td className="py-1.5 text-right text-gray-500">{r.mortgage + r.otherDebt ? money(d(r.mortgage + r.otherDebt)) : '—'}</td>
                      <td className="py-1.5 text-right font-semibold text-gray-900">{money(d(r.netWorth))}</td>
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
