import React from 'react';
import { format } from 'date-fns';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { AlertTriangle, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useFinancial, useGetCategory } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { projectMonthEnd, forecastCashFlow } from '../../utils/insights';

const CONFIDENCE = {
  high:   { label: 'High confidence',   cls: 'bg-green-50 text-green-700' },
  medium: { label: 'Medium confidence', cls: 'bg-yellow-50 text-yellow-700' },
  low:    { label: 'Low confidence',    cls: 'bg-gray-100 text-gray-600' },
};

const STATUS = {
  over:  { label: 'Over budget', icon: AlertTriangle, cls: 'text-red-600' },
  watch: { label: 'Close',       icon: AlertCircle,   cls: 'text-yellow-600' },
  ok:    { label: 'On track',    icon: CheckCircle2,  cls: 'text-green-600' },
};

const LINE_COLOR = '#3b82f6';

function Stat({ label, value, sub }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// How much can still be spent per day without exceeding the budget.
function allowanceText(w, daysLeft) {
  const left = w.budget - w.actual - w.recurringRemaining;
  if (left <= 0) return 'Spent plus scheduled bills already reach the budget.';
  if (daysLeft <= 0) return '';
  return `Keep it under ${formatCurrency(left / daysLeft)}/day for the rest of the month to stay within budget.`;
}

function CashFlowTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-xs space-y-0.5">
      <p className="font-semibold text-gray-800 mb-1">{r.label}</p>
      <p className="text-gray-600">Income: {formatCurrency(r.income)}</p>
      <p className="text-gray-600">Scheduled bills: −{formatCurrency(r.fixed)}</p>
      <p className="text-gray-600">Typical spending: −{formatCurrency(r.discretionary)}</p>
      <p className="text-gray-800 font-medium pt-1">Month net: {formatCurrency(r.net)}</p>
      <p className="text-gray-800 font-medium">Running total: {formatCurrency(r.cumulative)}</p>
      <p className="text-gray-400">Range: {formatCurrency(r.cumulativeRange[0])} to {formatCurrency(r.cumulativeRange[1])}</p>
    </div>
  );
}

export default function ForecastPanel() {
  const { state } = useFinancial();
  const { transactions, budgets, incomes, recurringTemplates = [] } = state;
  const getCategory = useGetCategory();

  const p = projectMonthEnd({ transactions, budgets, recurringTemplates });
  const cf = forecastCashFlow({ transactions, incomes, recurringTemplates });
  const conf = CONFIDENCE[p.confidence];
  const monthLabel = format(new Date(p.year, p.month, 1), 'MMMM');
  const t = p.totals;
  const barMax = Math.max(t.projected, t.budget, 1);
  const seg = v => `${(v / barMax) * 100}%`;
  const last = cf.rows[cf.rows.length - 1];

  return (
    <div className="space-y-6">
      {/* Month-end projection */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{monthLabel} Month-End Projection</h2>
            <p className="text-xs text-gray-400 mt-0.5">Day {p.daysElapsed} of {p.daysInMonth} · based on your pace, scheduled bills, and {p.historyMonths ? `${p.historyMonths} month${p.historyMonths > 1 ? 's' : ''} of history` : 'no earlier history'}</p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${conf.cls}`}>{conf.label}</span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat label="Spent so far" value={formatCurrency(t.actual)} />
          <Stat label="Bills still scheduled" value={formatCurrency(t.recurringRemaining)} sub="From recurring templates" />
          <Stat label="Projected month-end" value={formatCurrency(t.projected)} />
          <Stat
            label="Budgeted"
            value={t.budget ? formatCurrency(t.budget) : '—'}
            sub={t.budget ? (t.projected > t.budget ? `${formatCurrency(t.projected - t.budget)} over` : `${formatCurrency(t.budget - t.projected)} to spare`) : 'No budgets set'}
          />
        </div>

        {/* Stacked progress: spent | scheduled | expected, with budget marker */}
        <div className="mb-2">
          <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden flex gap-0.5">
            <div className="h-full bg-blue-600" style={{ width: seg(t.actual) }} title={`Spent ${formatCurrency(t.actual)}`} />
            <div className="h-full bg-blue-400" style={{ width: seg(t.recurringRemaining) }} title={`Scheduled ${formatCurrency(t.recurringRemaining)}`} />
            <div className="h-full bg-blue-200" style={{ width: seg(t.discretionaryRemaining) }} title={`Expected ${formatCurrency(t.discretionaryRemaining)}`} />
            {t.budget > 0 && <div className="absolute top-0 bottom-0 w-0.5 bg-gray-800" style={{ left: seg(t.budget) }} title={`Budget ${formatCurrency(t.budget)}`} />}
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-gray-500 mt-2">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-600" />Spent</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400" />Scheduled bills</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-200" />Expected spending</span>
            {t.budget > 0 && <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-gray-800" />Total budget</span>}
          </div>
        </div>

        {/* Early warnings */}
        {p.warnings.length > 0 && (
          <div className="space-y-2 mt-4">
            {p.warnings.map(w => {
              const s = STATUS[w.status];
              const Icon = s.icon;
              return (
                <div key={w.category} className={`flex items-start gap-3 rounded-xl p-3 border ${w.status === 'over' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
                  <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${s.cls}`} />
                  <p className="text-sm text-gray-800">
                    <span className="font-semibold">{getCategory(w.category).name}</span>
                    {w.status === 'over'
                      ? <> is on pace for {formatCurrency(w.projected)}, <span className="font-semibold">{formatCurrency(w.overBy)} over</span> its {formatCurrency(w.budget)} budget.</>
                      : <> is on pace for {formatCurrency(w.projected)}, close to its {formatCurrency(w.budget)} budget.</>}
                    {' '}{allowanceText(w, p.daysInMonth - p.daysElapsed)}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Per-category table */}
        {p.categories.length > 0 && (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left font-medium py-2">Category</th>
                  <th className="text-right font-medium py-2">Spent</th>
                  <th className="text-right font-medium py-2">+ Scheduled</th>
                  <th className="text-right font-medium py-2">+ Expected</th>
                  <th className="text-right font-medium py-2">Projected</th>
                  <th className="text-right font-medium py-2">Budget</th>
                  <th className="text-right font-medium py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {p.categories.map(c => {
                  const cat = getCategory(c.category);
                  const s = STATUS[c.status];
                  const Icon = s?.icon;
                  return (
                    <tr key={c.category} className="border-b border-gray-50">
                      <td className="py-2">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                          <span className="text-gray-700">{cat.name}</span>
                        </span>
                      </td>
                      <td className="py-2 text-right text-gray-700">{formatCurrency(c.actual)}</td>
                      <td className="py-2 text-right text-gray-500">{c.recurringRemaining ? formatCurrency(c.recurringRemaining) : '—'}</td>
                      <td className="py-2 text-right text-gray-500">{formatCurrency(c.discretionaryRemaining)}</td>
                      <td className="py-2 text-right font-semibold text-gray-900">{formatCurrency(c.projected)}</td>
                      <td className="py-2 text-right text-gray-500">{c.budget ? formatCurrency(c.budget) : '—'}</td>
                      <td className="py-2 text-right">
                        {s
                          ? <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.cls}`}><Icon className="w-3.5 h-3.5" />{s.label}</span>
                          : <span className="text-xs text-gray-300">No budget</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {p.categories.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No spending recorded yet this month.</p>}
      </div>

      {/* Cash-flow outlook */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900">Cash-Flow Outlook — Next {cf.rows.length} Months</h2>
        <p className="text-xs text-gray-400 mt-0.5 mb-4">
          Projected savings built up over time: income minus scheduled bills minus your typical spending
          ({formatCurrency(cf.discretionaryAverage)}/mo, usually {formatCurrency(cf.discretionaryRange[0])}–{formatCurrency(cf.discretionaryRange[1])}).
        </p>

        {cf.income === 0 ? (
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-3">
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800">Add your income sources on the Income page to see a cash-flow forecast.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              <Stat label="Monthly income" value={formatCurrency(cf.income)} />
              <Stat label={`Saved by ${last.label}`} value={formatCurrency(last.cumulative)} sub={`Range ${formatCurrency(last.cumulativeRange[0])} to ${formatCurrency(last.cumulativeRange[1])}`} />
              <Stat label="Typical monthly net" value={formatCurrency(cf.rows[0].net)} sub={cf.historyMonths ? `From ${cf.historyMonths} months of history` : 'No spending history yet'} />
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={cf.rows} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Tooltip content={<CashFlowTooltip />} />
                <Area dataKey="cumulativeRange" stroke="none" fill={LINE_COLOR} fillOpacity={0.12} name="Likely range" isAnimationActive={false} />
                <Line dataKey="cumulative" stroke={LINE_COLOR} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Projected savings" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 text-xs text-gray-500 mt-1">
              <span className="flex items-center gap-1.5"><span className="w-4 h-0.5" style={{ backgroundColor: LINE_COLOR }} />Projected savings (running total)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: LINE_COLOR, opacity: 0.2 }} />Likely range</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
