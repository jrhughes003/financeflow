import React, { useState } from 'react';
import { format, subMonths } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useFinancial } from '../context/FinancialContext';
import { getBudgetStatus, getMonthlyTrend, formatCurrency } from '../utils/calculations';
import { getCategoryById } from '../utils/categorization';
import { useGetCategory } from '../context/FinancialContext';

function StatusBadge({ status }) {
  if (status === 'danger') return <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-medium">Over Budget</span>;
  if (status === 'warning') return <span className="px-2 py-0.5 bg-yellow-100 text-yellow-600 rounded-full text-xs font-medium">Approaching</span>;
  return <span className="px-2 py-0.5 bg-green-100 text-green-600 rounded-full text-xs font-medium">On Track</span>;
}

export default function BudgetComparison() {
  const { state } = useFinancial();
  const { transactions, budgets } = state;
  const getCategory = useGetCategory();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [sortField, setSortField] = useState('category');
  const [sortDir, setSortDir] = useState('asc');

  const statuses = getBudgetStatus(budgets, transactions, month, year);
  const trend = getMonthlyTrend(transactions, 6);

  // Sort
  const sorted = [...statuses].sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (sortField === 'category') { va = getCategory(a.category).name; vb = getCategory(b.category).name; }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (f) => {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('asc'); }
  };

  const chartData = sorted.map(s => ({
    name: getCategory(s.category).name.split(' ')[0],
    Budget: Math.round(s.budget),
    Actual: Math.round(s.actual),
  }));

  const totalBudget = statuses.reduce((s, b) => s + b.budget, 0);
  const totalActual = statuses.reduce((s, b) => s + b.actual, 0);
  const totalVariance = totalBudget - totalActual;

  // Identify consistently overspent categories (over budget last 3 months)
  const consistentlyOver = budgets.filter(b => {
    let overCount = 0;
    for (let i = 1; i <= 3; i++) {
      const d = subMonths(new Date(year, month, 1), i);
      const st = getBudgetStatus([b], transactions, d.getMonth(), d.getFullYear());
      if (st[0]?.status === 'danger') overCount++;
    }
    return overCount >= 2;
  });

  const changeMonth = (delta) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-lg hover:bg-gray-200 text-gray-600">‹</button>
        <span className="font-semibold text-gray-700 min-w-32 text-center">{format(new Date(year, month, 1), 'MMMM yyyy')}</span>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-lg hover:bg-gray-200 text-gray-600">›</button>
      </div>

      {/* Summary totals */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Budget', value: formatCurrency(totalBudget), color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Total Actual', value: formatCurrency(totalActual), color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: totalVariance >= 0 ? 'Remaining' : 'Over Budget', value: formatCurrency(Math.abs(totalVariance)), color: totalVariance >= 0 ? 'text-green-600' : 'text-red-600', bg: totalVariance >= 0 ? 'bg-green-50' : 'bg-red-50' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4`}>
            <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Budget vs Actual</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={v => formatCurrency(v)} />
              <Legend />
              <Bar dataKey="Budget" fill="#3b82f6" radius={[4,4,0,0]} />
              <Bar dataKey="Actual" fill="#f97316" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Consistently overspent alert */}
      {consistentlyOver.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Consistently Over Budget</p>
          <p className="text-sm text-red-600">These categories have exceeded budget 2+ of the last 3 months:</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {consistentlyOver.map(b => (
              <span key={b.id} className="px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">{getCategory(b.category).name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Detail table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {[['category','Category'],['budget','Budget'],['actual','Actual'],['variance','Variance'],['percentUsed','% Used'],['status','Status']].map(([f, label]) => (
                  <th key={f} onClick={() => handleSort(f)} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => {
                const cat = getCategory(s.category);
                const rowBg = s.status === 'danger' ? 'bg-red-50' : s.status === 'warning' ? 'bg-yellow-50' : '';
                return (
                  <tr key={s.category} className={`border-b border-gray-50 ${rowBg}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                        <span className="font-medium text-gray-800">{cat.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatCurrency(s.budget)}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{formatCurrency(s.actual)}</td>
                    <td className={`px-4 py-3 font-semibold ${s.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {s.variance >= 0 ? '+' : ''}{formatCurrency(s.variance)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.percentUsed.toFixed(0)}%</td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                <td className="px-4 py-3 text-gray-800">Totals</td>
                <td className="px-4 py-3 text-gray-800">{formatCurrency(totalBudget)}</td>
                <td className="px-4 py-3 text-gray-800">{formatCurrency(totalActual)}</td>
                <td className={`px-4 py-3 ${totalVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {totalVariance >= 0 ? '+' : ''}{formatCurrency(totalVariance)}
                </td>
                <td className="px-4 py-3 text-gray-600">{totalBudget > 0 ? ((totalActual / totalBudget) * 100).toFixed(0) : 0}%</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly trend table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">6-Month Spending Trend by Category</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left font-semibold text-gray-500">Category</th>
                {trend.map(m => <th key={m.label} className="px-3 py-2 text-right font-semibold text-gray-500">{m.label.split(' ')[0]}</th>)}
              </tr>
            </thead>
            <tbody>
              {budgets.map(b => {
                const cat = getCategory(b.category);
                return (
                  <tr key={b.id} className="border-t border-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-700">{cat.name}</td>
                    {trend.map(m => {
                      const amt = m[b.category] || 0;
                      const over = amt > b.amount && b.amount > 0;
                      return (
                        <td key={m.label} className={`px-3 py-2 text-right ${over ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                          {amt > 0 ? formatCurrency(amt) : '—'}
                        </td>
                      );
                    })}
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
