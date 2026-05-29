import React, { useState } from 'react';
import { format } from 'date-fns';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar
} from 'recharts';
import { useFinancial } from '../context/FinancialContext';
import {
  getSpendingByCategory, getMonthlyTrend, detectAnomalies,
  getBudgetHealthScore, getSpendingByDayOfWeek, getTopMerchants,
  getTransactionsForPeriod, formatCurrency
} from '../utils/calculations';
import { CATEGORIES, getAllCategories, getCategoryById } from '../utils/categorization';
import { useGetCategory } from '../context/FinancialContext';
import { AlertTriangle } from 'lucide-react';

const COLORS = CATEGORIES.map(c => c.color);

export default function SpendingAnalytics() {
  const { state } = useFinancial();
  const { transactions, budgets, customCategories = [], settings = {} } = state;
  const getCategory = useGetCategory();
  const allCategories = getAllCategories(customCategories);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [drillCat, setDrillCat] = useState(null);
  const [hiddenLines, setHiddenLines] = useState({});

  const spending = getSpendingByCategory(transactions, month, year);
  const trend = getMonthlyTrend(transactions, 6);
  const anomalies = detectAnomalies(transactions, month, year, {
    minAverage: settings.anomalyMinAverage,
    multiplier: settings.anomalyMultiplier,
  });
  const health = getBudgetHealthScore(budgets, transactions, month, year);
  const dow = getSpendingByDayOfWeek(transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === month && d.getFullYear() === year;
  }));

  // Pie data
  const pieData = Object.entries(spending)
    .map(([id, value]) => ({ name: getCategory(id).name, value: Math.round(value), id, color: getCategory(id).color }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 9);

  // Major categories for line chart
  const majorCats = allCategories.filter(c => trend.some(m => m[c.id] > 0)).slice(0, 6);

  const changeMonth = (delta) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  };

  // Category drill-down
  const drillData = drillCat ? (() => {
    const catTx = getTransactionsForPeriod(transactions, month, year).filter(t => t.category === drillCat);
    const merchants = {};
    catTx.forEach(t => { merchants[t.merchant] = (merchants[t.merchant] || 0) + t.amount; });
    return {
      transactions: catTx.sort((a, b) => new Date(b.date) - new Date(a.date)),
      merchants: Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 6),
      total: catTx.reduce((s, t) => s + t.amount, 0),
      avg: catTx.length ? catTx.reduce((s, t) => s + t.amount, 0) / catTx.length : 0,
    };
  })() : null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-lg hover:bg-gray-200 text-gray-600">‹</button>
        <span className="font-semibold text-gray-700 min-w-32 text-center">{format(new Date(year, month, 1), 'MMMM yyyy')}</span>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-lg hover:bg-gray-200 text-gray-600">›</button>
      </div>

      {/* Anomaly alerts */}
      {anomalies.length > 0 && (
        <div className="space-y-2">
          {anomalies.map((a, i) => (
            <div key={i} className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-800">{a.message}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Pie chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Spending by Category</h2>
          {pieData.length === 0
            ? <p className="text-sm text-gray-400 text-center py-8">No spending data for this month.</p>
            : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    onClick={d => setDrillCat(d.id === drillCat ? null : d.id)}
                    cursor="pointer"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={entry.id} fill={entry.color} opacity={drillCat && drillCat !== entry.id ? 0.4 : 1} />
                    ))}
                  </Pie>
                  <Tooltip formatter={v => formatCurrency(v)} />
                  <Legend formatter={(value, entry) => `${value}: ${formatCurrency(entry.payload.value)}`} />
                </PieChart>
              </ResponsiveContainer>
            )
          }
          {drillCat && <p className="text-xs text-center text-blue-600 mt-1 cursor-pointer" onClick={() => setDrillCat(null)}>Click slice to deselect</p>}
        </div>

        {/* Spending by day of week */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Spending by Day of Week</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dow} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={v => formatCurrency(v)} />
              <Bar dataKey="total" fill="#3b82f6" radius={[4,4,0,0]} name="Total Spent" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Category drill-down */}
      {drillCat && drillData && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">{getCategory(drillCat).name} — Deep Dive</h2>
            <button onClick={() => setDrillCat(null)} className="text-xs text-gray-400 hover:text-gray-600">✕ Close</button>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Total Spent</p>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(drillData.total)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Transactions</p>
              <p className="text-lg font-bold text-gray-900">{drillData.transactions.length}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Avg per Tx</p>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(drillData.avg)}</p>
            </div>
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Top Merchants</p>
              {drillData.merchants.map(([merchant, amt]) => (
                <div key={merchant} className="flex justify-between py-1.5 border-b border-gray-50">
                  <span className="text-sm text-gray-700">{merchant}</span>
                  <span className="text-sm font-semibold text-gray-800">{formatCurrency(amt)}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Recent Transactions</p>
              {drillData.transactions.slice(0, 6).map(t => (
                <div key={t.id} className="flex justify-between py-1.5 border-b border-gray-50">
                  <div>
                    <p className="text-sm text-gray-700">{t.merchant}</p>
                    <p className="text-xs text-gray-400">{format(new Date(t.date), 'MMM d')}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-800">{formatCurrency(t.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Monthly trend line chart */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Spending Trends (6 months)</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {majorCats.map(cat => (
            <button
              key={cat.id}
              onClick={() => setHiddenLines(h => ({ ...h, [cat.id]: !h[cat.id] }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${hiddenLines[cat.id] ? 'opacity-40' : ''}`}
              style={{ borderColor: cat.color, color: cat.color, backgroundColor: cat.color + '15' }}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
            <Tooltip formatter={v => formatCurrency(v)} />
            {majorCats.map(cat => (
              !hiddenLines[cat.id] && (
                <Line
                  key={cat.id}
                  type="monotone"
                  dataKey={cat.id}
                  name={cat.name}
                  stroke={cat.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              )
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Budget health trend */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Budget Health Score — Current Month</h2>
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: health.color + '20' }}>
            <span className="text-4xl font-black" style={{ color: health.color }}>{health.grade}</span>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{health.percent}%</p>
            <p className="text-sm text-gray-500">of budget categories are on track this month</p>
          </div>
        </div>
      </div>
    </div>
  );
}
