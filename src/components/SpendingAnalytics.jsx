import React, { useState } from 'react';
import { format } from 'date-fns';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar
} from 'recharts';
import * as chart from './ui/chartTheme';
import { useFinancial } from '../context/FinancialContext';
import { Stat, Money } from './ui';
import {
  getSpendingByCategory, getMonthlyTrend, detectAnomalies,
  getBudgetHealthScore, getSpendingByDayOfWeek,
  getTransactionsForPeriod, formatCurrency
} from '../utils/calculations';
import { CATEGORIES, getAllCategories } from '../utils/categorization';
import { useGetCategory } from '../context/FinancialContext';
import { AlertTriangle, LayoutGrid, CalendarClock, PiggyBank, CalendarDays, ClipboardList } from 'lucide-react';
import WhatChangedPanel from './analytics/WhatChangedPanel';
import ForecastPanel from './analytics/ForecastPanel';
import SavingsPanel from './analytics/SavingsPanel';
import HabitsPanel from './analytics/HabitsPanel';
import PlanPanel from './analytics/PlanPanel';
import TagsPanel from './analytics/TagsPanel';
import { getSubcategoryBreakdown } from '../utils/habits';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'habits', label: 'Habits', icon: CalendarDays },
  { id: 'forecast', label: 'Forecast', icon: CalendarClock },
  { id: 'save', label: 'Save Money', icon: PiggyBank },
  { id: 'plan', label: 'Plan', icon: ClipboardList },
];

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
  const [tab, setTab] = useState('overview');

  const spending = getSpendingByCategory(transactions, month, year);
  const trend = getMonthlyTrend(transactions, 6);
  const anomalies = detectAnomalies(transactions, month, year, {
    minAverage: settings.anomalyMinAverage,
    multiplier: settings.anomalyMultiplier,
  });
  const health = getBudgetHealthScore(budgets, transactions, month, year);
  // Same month filter as everything else: timezone-safe, excludes exceptions and
  // savings transfers, and nets out repaid amounts on fronted purchases.
  const dow = getSpendingByDayOfWeek(getTransactionsForPeriod(transactions, month, year));

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
      subcategories: getSubcategoryBreakdown(catTx),
      avg: catTx.length ? catTx.reduce((s, t) => s + t.amount, 0) / catTx.length : 0,
    };
  })() : null;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Section tabs */}
      <div className="flex flex-wrap bg-surface-hover rounded-container p-1 w-fit max-w-full">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-control text-sm font-medium transition-colors ${tab === id ? 'bg-surface  text-accent' : 'text-ink-muted hover:text-ink-secondary'}`}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'habits' && <HabitsPanel />}
      {tab === 'forecast' && <ForecastPanel />}
      {tab === 'save' && <SavingsPanel />}
      {tab === 'plan' && <PlanPanel />}

      {tab === 'overview' && <>
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-control hover:bg-surface-hover text-ink-secondary">‹</button>
        <span className="font-semibold text-ink-secondary min-w-32 text-center">{format(new Date(year, month, 1), 'MMMM yyyy')}</span>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-control hover:bg-surface-hover text-ink-secondary">›</button>
      </div>

      {/* Anomaly alerts */}
      {anomalies.length > 0 && (
        <div className="space-y-2">
          {anomalies.map((a, i) => (
            <div key={i} className="flex items-start gap-3 bg-caution-tint border border-caution rounded-container p-3">
              <AlertTriangle className="w-4 h-4 text-caution shrink-0 mt-0.5" />
              <p className="text-sm text-caution">{a.message}</p>
            </div>
          ))}
        </div>
      )}

      <WhatChangedPanel transactions={transactions} month={month} year={year} />

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Pie chart */}
        <div className="bg-surface rounded-container border border-line p-5">
          <h2 className="text-lg font-semibold text-ink mb-4">Spending by Category</h2>
          {pieData.length === 0
            ? <p className="text-sm text-ink-muted text-center py-8">No spending data for this month.</p>
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
                    {pieData.map(entry => (
                      <Cell key={entry.id} fill={entry.color} opacity={drillCat && drillCat !== entry.id ? 0.4 : 1} />
                    ))}
                  </Pie>
                  <Tooltip {...chart.tooltip} formatter={v => formatCurrency(v)} />
                  <Legend formatter={(value, entry) => `${value}: ${formatCurrency(entry.payload.value)}`} />
                </PieChart>
              </ResponsiveContainer>
            )
          }
          {drillCat && <p className="text-caption text-center text-accent mt-1 cursor-pointer" onClick={() => setDrillCat(null)}>Click slice to deselect</p>}
        </div>

        {/* Spending by day of week */}
        <div className="bg-surface rounded-container border border-line p-5">
          <h2 className="text-lg font-semibold text-ink mb-4">Spending by Day of Week</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dow} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid {...chart.grid} />
              <XAxis dataKey="name" {...chart.xAxis} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
              <Tooltip {...chart.tooltip} formatter={v => formatCurrency(v)} />
              <Bar dataKey="total" fill={chart.SERIES.primary} radius={[4,4,0,0]} name="Total Spent" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Category drill-down */}
      {drillCat && drillData && (
        <div className="bg-surface rounded-container border border-line p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-ink">{getCategory(drillCat).name} — Deep Dive</h2>
            <button onClick={() => setDrillCat(null)} className="text-caption text-ink-muted hover:text-ink-secondary">✕ Close</button>
          </div>
          <div className="flex flex-wrap gap-8 mb-5 pb-4 border-b border-line-faint">
            <Stat label="Total spent"><Money value={drillData.total} /></Stat>
            <Stat label="Transactions">{drillData.transactions.length}</Stat>
            <Stat label="Average"><Money value={drillData.avg} /></Stat>
          </div>
          {/* Only worth showing when at least one transaction has a subcategory. */}
          {drillData.subcategories.some(sc => sc.name !== 'Unspecified') && (
            <div className="mb-4">
              <p className="text-sm font-semibold text-ink-secondary mb-2">By Subcategory</p>
              <div className="space-y-2">
                {drillData.subcategories.map(sc => (
                  <div key={sc.name} className="flex items-center gap-3">
                    <span className={`text-sm w-36 shrink-0 truncate ${sc.name === 'Unspecified' ? 'text-ink-muted italic' : 'text-ink-secondary'}`}>{sc.name}</span>
                    <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${sc.pct}%`, backgroundColor: getCategory(drillCat).color }} />
                    </div>
                    <span className="text-sm font-semibold text-ink w-24 text-right">{formatCurrency(sc.total)}</span>
                    <span className="text-caption text-ink-muted w-20 text-right">{sc.count} tx · {sc.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-ink-secondary mb-2">Top Merchants</p>
              {drillData.merchants.map(([merchant, amt]) => (
                <div key={merchant} className="flex justify-between py-1.5 border-b border-line-faint">
                  <span className="text-sm text-ink-secondary">{merchant}</span>
                  <span className="text-sm font-semibold text-ink">{formatCurrency(amt)}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-secondary mb-2">Recent Transactions</p>
              {drillData.transactions.slice(0, 6).map(t => (
                <div key={t.id} className="flex justify-between py-1.5 border-b border-line-faint">
                  <div>
                    <p className="text-sm text-ink-secondary">{t.merchant}</p>
                    <p className="text-caption text-ink-muted">{format(new Date(t.date), 'MMM d')}</p>
                  </div>
                  <span className="text-sm font-semibold text-ink">{formatCurrency(t.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <TagsPanel transactions={transactions} month={month} year={year} />

      {/* Monthly trend line chart */}
      <div className="bg-surface rounded-container border border-line p-5">
        <h2 className="text-lg font-semibold text-ink mb-4">Spending Trends (6 months)</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {majorCats.map(cat => (
            <button
              key={cat.id}
              onClick={() => setHiddenLines(h => ({ ...h, [cat.id]: !h[cat.id] }))}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption font-medium border transition-colors ${hiddenLines[cat.id] ? 'opacity-40' : ''}`}
              style={{ borderColor: cat.color, color: cat.color, backgroundColor: cat.color + '15' }}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid {...chart.grid} />
            <XAxis dataKey="label" {...chart.xAxis} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
            <Tooltip {...chart.tooltip} formatter={v => formatCurrency(v)} />
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
      <div className="bg-surface rounded-container border border-line p-5">
        <h2 className="text-lg font-semibold text-ink mb-4">Budget adherence — current month</h2>
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-container flex items-center justify-center shrink-0" style={{ backgroundColor: health.color + '20' }}>
            <span className="text-4xl font-black" style={{ color: health.color }}>{health.grade}</span>
          </div>
          <div>
            <p className="text-2xl font-bold text-ink">{health.percent}%</p>
            <p className="text-sm text-ink-muted">of budget categories are on track this month</p>
          </div>
        </div>
      </div>
      </>}
    </div>
  );
}
