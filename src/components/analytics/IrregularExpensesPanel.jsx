import React, { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CalendarRange, AlertCircle } from 'lucide-react';
import { useFinancial, useGetCategory } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { detectIrregularExpenses } from '../../utils/insights';

const BILL_COLOR = '#2563eb';
const SEASON_COLOR = '#f59e0b';
const FREQ = { quarterly: 'Every 3 months', semiannual: 'Every 6 months', annual: 'Yearly' };
const fmt = d => format(parseISO(d), 'MMM d, yyyy');

function CalendarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  if (!m.bills.length && !m.seasonal.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-xs space-y-0.5 max-w-64">
      <p className="font-semibold text-gray-800 mb-1">{m.label}</p>
      {m.bills.map(b => <p key={b.id + b.date} className="text-gray-600">{b.merchant}: {formatCurrency(b.amount)}</p>)}
      {m.seasonal.map(s => <p key={s.id} className="text-gray-600">{s.categoryName} (seasonal): +{formatCurrency(s.expectedExtra)}</p>)}
    </div>
  );
}

// Quarterly/semiannual/annual bills and seasonal spikes, with a 12-month view
// and how much to set aside so they don't land as surprises.
export default function IrregularExpensesPanel() {
  const { state } = useFinancial();
  const { transactions, recurringTemplates = [] } = state;
  const getCategory = useGetCategory();
  const irr = useMemo(() => detectIrregularExpenses(transactions, { recurringTemplates }), [transactions, recurringTemplates]);

  const hasAny = irr.bills.length > 0 || irr.seasonal.length > 0;
  const chart = irr.calendar.map(m => ({
    ...m,
    seasonal: m.seasonal.map(s => ({ ...s, categoryName: getCategory(s.category).name })),
  }));
  const yearTotal = irr.calendar.reduce((s, m) => s + m.billTotal + m.seasonalTotal, 0);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2">
          <CalendarRange className="w-4 h-4 text-gray-500 mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-gray-900">Irregular & Annual Expenses</h2>
            <p className="text-xs text-gray-400 mt-0.5">Big charges that come back every few months or once a year, found in your history</p>
          </div>
        </div>
        {irr.bills.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-gray-500">Set aside</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(irr.monthlySetAside)}<span className="text-sm font-medium text-gray-400">/mo</span></p>
            <p className="text-xs text-gray-400">covers all of these long-term</p>
          </div>
        )}
      </div>

      {!hasAny ? (
        <p className="text-sm text-gray-400 text-center py-6">
          None found yet. Charges show up here once they've repeated — annual bills need about a year of history.
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-700 mb-3">
            About <span className="font-semibold">{formatCurrency(yearTotal)}</span> of irregular spending is expected over the next 12 months.
            {irr.bills.length > 0 && ' These bills are already included in the cash-flow outlook below.'}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chart} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickFormatter={l => l.split(' ')[0]} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
              <Tooltip cursor={{ fill: '#f8fafc' }} content={<CalendarTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="billTotal" name="Periodic bills" stackId="a" fill={BILL_COLOR} stroke="#fff" strokeWidth={1} isAnimationActive={false} />
              <Bar dataKey="seasonalTotal" name="Seasonal extra" stackId="a" fill={SEASON_COLOR} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>

          {irr.bills.length > 0 && (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left font-medium py-2">Bill</th>
                    <th className="text-left font-medium py-2">How often</th>
                    <th className="text-right font-medium py-2">Amount</th>
                    <th className="text-right font-medium py-2">Next due</th>
                    <th className="text-right font-medium py-2">Save to be ready</th>
                  </tr>
                </thead>
                <tbody>
                  {irr.bills.map(b => (
                    <tr key={b.id} className="border-b border-gray-50">
                      <td className="py-2">
                        <p className="text-gray-800">{b.merchant}</p>
                        <p className="text-xs text-gray-400">{getCategory(b.category).name} · last paid {fmt(b.lastDate)}</p>
                      </td>
                      <td className="py-2 text-gray-500">{FREQ[b.frequency]}</td>
                      <td className="py-2 text-right font-semibold text-gray-900">{formatCurrency(b.amount)}</td>
                      <td className="py-2 text-right">
                        {b.overdue
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700"><AlertCircle className="w-3.5 h-3.5" />Due {fmt(b.nextDate)}</span>
                          : <span className="text-gray-700">{fmt(b.nextDate)}</span>}
                      </td>
                      <td className="py-2 text-right text-gray-700">
                        {b.monthsUntil <= 0 ? 'Due this month' : b.monthsUntil === 1 ? 'Due next month' : `${formatCurrency(b.setAsidePerMonth)}/mo for ${b.monthsUntil} mo`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {irr.seasonal.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-semibold text-gray-700">Seasonal spikes</p>
              {irr.seasonal.map(s => (
                <div key={s.id} className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl p-3">
                  <span className="w-2.5 h-2.5 rounded-sm mt-1 shrink-0" style={{ backgroundColor: SEASON_COLOR }} />
                  <p className="text-sm text-gray-800">
                    <span className="font-semibold">{getCategory(s.category).name}</span> has spiked every {s.label.split(' ')[0]} ({s.years} years running — last time {formatCurrency(s.lastYearTotal)} vs a usual {formatCurrency(s.typical)}).
                    {' '}Expect about <span className="font-semibold">{formatCurrency(s.expectedExtra)} extra</span> in {s.label}
                    {s.monthsUntil > 0 && <> — {formatCurrency(s.expectedExtra / s.monthsUntil)}/mo from now covers it</>}.
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
