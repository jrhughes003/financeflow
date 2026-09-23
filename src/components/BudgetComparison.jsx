import React, { useState } from 'react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import * as chart from './ui/chartTheme';
import { useFinancial } from '../context/FinancialContext';
import { Card, PageLede, Stat, Money } from './ui';
import { getBudgetStatus, getMonthlyTrend, getConsistentlyOverBudget, formatCurrency } from '../utils/calculations';
import { useGetCategory } from '../context/FinancialContext';

function StatusBadge({ status }) {
  if (status === 'danger') return <span className="px-2 py-0.5 bg-negative-tint text-negative rounded-full text-caption font-medium">Over Budget</span>;
  if (status === 'warning') return <span className="px-2 py-0.5 bg-caution-tint text-caution rounded-full text-caption font-medium">Approaching</span>;
  return <span className="px-2 py-0.5 bg-positive-tint text-positive rounded-full text-caption font-medium">On Track</span>;
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
    Budget: Math.round(s.effectiveBudget),
    Actual: Math.round(s.actual),
  }));

  // Rollover moves the line a category is judged against, so every figure here
  // uses the effective budget. Showing the nominal amount beside an
  // effective-budget percentage reads as a bug (spent $260 of $300 — 158% used).
  const anyCarry = statuses.some(s => Math.abs(s.carry) >= 0.01);
  const totalBudget = statuses.reduce((s, b) => s + b.effectiveBudget, 0);
  const totalActual = statuses.reduce((s, b) => s + b.actual, 0);
  const totalVariance = totalBudget - totalActual;

  // Identify consistently overspent categories (over budget 2+ of the last 3
  // months). Batched: computes each month's statuses once instead of 3× per budget.
  const consistentlyOver = getConsistentlyOverBudget(budgets, transactions, month, year);

  const changeMonth = (delta) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-control hover:bg-surface-hover text-ink-secondary">‹</button>
        <span className="font-semibold text-ink-secondary min-w-32 text-center">{format(new Date(year, month, 1), 'MMMM yyyy')}</span>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-control hover:bg-surface-hover text-ink-secondary">›</button>
      </div>

      {/* Summary totals */}
      <Card>
        <PageLede
          label="Spent this month"
          supporting={(
            <>
              <Stat label={anyCarry ? 'Budget after rollover' : 'Budget'}><Money value={totalBudget} /></Stat>
              <Stat label={totalVariance >= 0 ? 'Remaining' : 'Over budget'}>
                <Money value={Math.abs(totalVariance)} className={totalVariance >= 0 ? 'text-positive' : 'text-negative'} />
              </Stat>
            </>
          )}
        >
          <Money value={totalActual} size="display" />
          {totalBudget > 0 && (
            <p className="text-caption text-ink-muted mt-2">
              {Math.round((totalActual / totalBudget) * 100)}% of budget used
            </p>
          )}
        </PageLede>
      </Card>

      {/* Bar chart */}
      {chartData.length > 0 && (
        <div className="bg-surface rounded-container border border-line p-5">
          <h2 className="text-lg font-semibold text-ink mb-4">Budget vs Actual</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid {...chart.grid} />
              <XAxis dataKey="name" {...chart.xAxis} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
              <Tooltip {...chart.tooltip} formatter={v => formatCurrency(v)} />
              <Legend />
              <Bar dataKey="Budget" fill={chart.SERIES.primary} radius={[4,4,0,0]} />
              <Bar dataKey="Actual" fill={chart.SERIES.secondary} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Consistently overspent alert */}
      {consistentlyOver.length > 0 && (
        <div className="bg-negative-tint border border-negative rounded-container p-4">
          <p className="text-sm font-semibold text-negative mb-1">Consistently Over Budget</p>
          <p className="text-sm text-negative">These categories have exceeded budget 2+ of the last 3 months:</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {consistentlyOver.map(b => (
              <span key={b.id} className="px-2.5 py-1 bg-negative-tint text-negative rounded-full text-caption font-medium">{getCategory(b.category).name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Detail table */}
      <div className="bg-surface rounded-container border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-sunk border-b border-line">
                {[['category','Category'],['budget', anyCarry ? 'Budget (after rollover)' : 'Budget'],['actual','Actual'],['variance','Variance'],['percentUsed','% Used'],['status','Status']].map(([f, label]) => (
                  <th key={f} onClick={() => handleSort(f)} className="label-micro font-medium py-2 px-3 text-left cursor-pointer hover:text-ink select-none">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => {
                const cat = getCategory(s.category);
                const rowBg = s.status === 'danger' ? 'bg-negative-tint' : s.status === 'warning' ? 'bg-caution-tint' : '';
                return (
                  <tr key={s.category} className={`border-b border-line-faint ${rowBg}`}>
                    <td className="px-3 h-row">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                        <span className="font-medium text-ink">{cat.name}</span>
                      </div>
                    </td>
                    <td className="px-3 h-row text-ink-secondary">
                      {formatCurrency(s.effectiveBudget)}
                      {Math.abs(s.carry) >= 0.01 && (
                        <span className="block text-caption text-ink-muted">
                          {formatCurrency(s.budget)} {s.carry > 0 ? '+' : '−'} {formatCurrency(Math.abs(s.carry))} rolled over
                        </span>
                      )}
                    </td>
                    <td className="px-3 h-row font-medium text-ink">{formatCurrency(s.actual)}</td>
                    <td className={`px-4 py-3 font-semibold ${s.variance >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {s.variance >= 0 ? '+' : ''}{formatCurrency(s.variance)}
                    </td>
                    <td className="px-3 h-row text-ink-secondary">{s.percentUsed.toFixed(0)}%</td>
                    <td className="px-3 h-row"><StatusBadge status={s.status} /></td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="bg-surface-sunk font-semibold border-t-2 border-line-strong">
                <td className="px-3 h-row text-ink">Totals</td>
                <td className="px-3 h-row text-ink">{formatCurrency(totalBudget)}</td>
                <td className="px-3 h-row text-ink">{formatCurrency(totalActual)}</td>
                <td className={`px-4 py-3 ${totalVariance >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {totalVariance >= 0 ? '+' : ''}{formatCurrency(totalVariance)}
                </td>
                <td className="px-3 h-row text-ink-secondary">{totalBudget > 0 ? ((totalActual / totalBudget) * 100).toFixed(0) : 0}%</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly trend table */}
      <div className="bg-surface rounded-container border border-line p-5">
        <h2 className="text-lg font-semibold text-ink mb-4">6-Month Spending Trend by Category</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-caption">
            <thead>
              <tr className="bg-surface-sunk">
                <th className="px-3 py-2 text-left font-semibold text-ink-muted">Category</th>
                {trend.map(m => <th key={m.label} className="px-3 py-2 text-right font-semibold text-ink-muted">{m.label.split(' ')[0]}</th>)}
              </tr>
            </thead>
            <tbody>
              {budgets.map(b => {
                const cat = getCategory(b.category);
                return (
                  <tr key={b.id} className="border-t border-line-faint">
                    <td className="px-3 py-2 font-medium text-ink-secondary">{cat.name}</td>
                    {trend.map(m => {
                      const amt = m[b.category] || 0;
                      const over = amt > b.amount && b.amount > 0;
                      return (
                        <td key={m.label} className={`px-3 py-2 text-right ${over ? 'text-negative font-semibold' : 'text-ink-secondary'}`}>
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
