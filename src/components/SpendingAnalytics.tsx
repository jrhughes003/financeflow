import React, { useState } from 'react';
import { format } from 'date-fns';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar
} from 'recharts';
import * as chart from './ui/chartTheme';
import { useFinancial } from '../context/FinancialContext';
import {
  Panel, PanelGrid, KeyValue, Button, IconButton, Money, Badge,
} from './ui';
import {
  getSpendingByCategory, getMonthlyTrend, detectAnomalies,
  getBudgetHealthScore, getSpendingByDayOfWeek,
  getTransactionsForPeriod, formatCurrency
} from '../utils/calculations';
import { CATEGORIES, getAllCategories } from '../utils/categorization';
import { useGetCategory, useTaxonomy } from '../context/FinancialContext';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import WhatChangedPanel from './analytics/WhatChangedPanel';
import ForecastPanel from './analytics/ForecastPanel';
import SavingsPanel from './analytics/SavingsPanel';
import HabitsPanel from './analytics/HabitsPanel';
import PlanPanel from './analytics/PlanPanel';
import TagsPanel from './analytics/TagsPanel';
import { getSubcategoryBreakdown } from '../utils/habits';
import { topCategoriesByTrend, withRestSlice, REST_SLICE_ID } from '../utils/categorySelection';

// The section tabs read as a terminal's function-key row.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'habits', label: 'Habits' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'save', label: 'Save Money' },
  { id: 'plan', label: 'Plan' },
];

const COLORS = CATEGORIES.map(c => c.color);

/* A sub-table heading inside a panel: the same quiet bar a table header uses. */
function SubHead({ children }: { children: React.ReactNode }) {
  return <p className="label-micro px-2.5 h-[22px] leading-[22px] bg-surface-sunk border-b border-line">{children}</p>;
}

export default function SpendingAnalytics() {
  const { state } = useFinancial();
  const { transactions, budgets, customCategories = [], settings = {} } = state;
  const getCategory = useGetCategory();
  const taxonomy = useTaxonomy();
  const allCategories = getAllCategories(customCategories);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [drillCat, setDrillCat] = useState<string | null>(null);
  const [hiddenLines, setHiddenLines] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState('overview');

  const spending = getSpendingByCategory(transactions, month, year);
  const trend = getMonthlyTrend(transactions, 6);
  const anomalies = detectAnomalies(transactions, month, year, {
    minAverage: settings.anomalyMinAverage,
    multiplier: settings.anomalyMultiplier,
  });
  const health = getBudgetHealthScore(budgets, transactions, month, year, taxonomy);
  // Same month filter as everything else: timezone-safe, excludes exceptions and
  // savings transfers, and nets out repaid amounts on fronted purchases.
  const dow = getSpendingByDayOfWeek(getTransactionsForPeriod(transactions, month, year));

  // The nine largest categories, with the remainder gathered into one slice.
  // The rest-slice is not clickable: it stands for several categories, so
  // there is no single one to drill into.
  const pieData = withRestSlice(
    Object.entries(spending)
      .map(([id, value]) => ({ name: getCategory(id).name, value: Math.round(value), id, color: getCategory(id).color }))
      .sort((a, b) => b.value - a.value),
    9,
    (count, total) => ({ name: `Other (${count})`, value: total, id: REST_SLICE_ID, color: 'var(--c-ink-muted)' }),
  );

  // The six categories that actually account for the most spending, not the
  // first six in the source file. See topCategoriesByTrend.
  const majorCats = topCategoriesByTrend(allCategories, trend, 6);

  const changeMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  };

  // Category drill-down
  const drillData = drillCat ? (() => {
    const catTx = getTransactionsForPeriod(transactions, month, year).filter(t => t.category === drillCat);
    const merchants: Record<string, number> = {};
    catTx.forEach(t => { merchants[t.merchant] = (merchants[t.merchant] || 0) + t.amount; });
    return {
      transactions: catTx.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      merchants: Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 6),
      total: catTx.reduce((s, t) => s + t.amount, 0),
      subcategories: getSubcategoryBreakdown(catTx),
      avg: catTx.length ? catTx.reduce((s, t) => s + t.amount, 0) / catTx.length : 0,
    };
  })() : null;

  const monthLabel = format(new Date(year, month, 1), 'MMMM yyyy');

  return (
    <div className="space-y-2 animate-fade-in">
      {/* Section tabs: a function-key row */}
      <div className="flex flex-wrap border border-line bg-surface-sunk w-fit max-w-full">
        {TABS.map(({ id, label }, i) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`flex items-center gap-1.5 h-7 px-3 border-r border-line last:border-r-0 border-b-2 text-caption font-medium uppercase tracking-[0.06em] transition-colors ${tab === id ? 'bg-accent-tint text-accent-ink border-b-accent' : 'border-b-transparent text-ink-muted hover:bg-surface-hover hover:text-ink'}`}
          >
            <span aria-hidden="true" className="text-micro opacity-60">F{i + 1}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {tab === 'habits' && <HabitsPanel />}
      {tab === 'forecast' && <ForecastPanel />}
      {tab === 'save' && <SavingsPanel />}
      {tab === 'plan' && <PlanPanel />}

      {tab === 'overview' && <>
      {/* Period bar */}
      <div className="flex items-center gap-3">
        <div className="flex items-center border border-line-strong bg-surface">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => changeMonth(-1)} className="rounded-none" />
          <span className="px-2.5 h-6 leading-6 border-x border-line-strong text-sm font-medium text-ink uppercase tracking-[0.06em] min-w-[132px] text-center">{monthLabel}</span>
          <IconButton icon={ChevronRight} label="Next month" onClick={() => changeMonth(1)} className="rounded-none" />
        </div>
      </div>

      <PanelGrid className="grid-flow-row-dense">
        {/* Anomaly alerts */}
        {anomalies.length > 0 && (
          <Panel title="Anomalies" meta={`${anomalies.length} ACTIVE`} className="col-span-12">
            <ul>
              {anomalies.map((a, i) => (
                <li key={i} className="flex items-start gap-2.5 px-2.5 py-1.5 border-b border-line last:border-b-0">
                  <Badge tone="caution" className="shrink-0 w-12 justify-center mt-px">Spike</Badge>
                  <p className="font-sans text-[12.5px] leading-snug text-ink">{a.message}</p>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <WhatChangedPanel transactions={transactions} month={month} year={year} />

        {/* Pie chart */}
        <Panel
          title="Spending by Category"
          meta={monthLabel}
          actions={drillCat && <Button size="sm" variant="ghost" onClick={() => setDrillCat(null)}>Click slice to deselect</Button>}
          className="col-span-12 lg:col-span-6"
          bodyClassName="p-3"
        >
          {pieData.length === 0
            ? <p className="font-sans text-sm text-ink-muted text-center py-8">No spending data for this month.</p>
            : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={1}
                    stroke="var(--c-surface)"
                    dataKey="value"
                    // The rest-slice stands for several categories at once, so
                    // there is nothing to drill into; clicking it does nothing
                    // rather than opening an empty breakdown.
                    onClick={d => { if (d.id !== REST_SLICE_ID) setDrillCat(d.id === drillCat ? null : d.id); }}
                    cursor="pointer"
                  >
                    {pieData.map(entry => (
                      <Cell key={entry.id} fill={entry.color} opacity={drillCat && drillCat !== entry.id ? 0.4 : 1} />
                    ))}
                  </Pie>
                  <Tooltip {...chart.tooltip} formatter={v => formatCurrency(chart.asNumber(v))} />
                  <Legend
                    iconType="square"
                    iconSize={7}
                    wrapperStyle={{ fontSize: 10.5, fontFamily: 'var(--font-numeric)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
                    formatter={(value, entry) => `${value}: ${formatCurrency(chart.asNumber(entry?.payload?.value))}`}
                  />
                </PieChart>
              </ResponsiveContainer>
            )
          }
        </Panel>

        {/* Spending by day of week */}
        <Panel title="Spending by Day of Week" meta={monthLabel} className="col-span-12 lg:col-span-6" bodyClassName="p-3">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dow} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid {...chart.grid} />
              <XAxis dataKey="name" {...chart.xAxis} />
              <YAxis {...chart.yAxis} tickFormatter={chart.compactMoney} />
              <Tooltip {...chart.tooltip} formatter={v => formatCurrency(chart.asNumber(v))} />
              <Bar dataKey="total" fill={chart.SERIES.primary} name="Total Spent" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Category drill-down */}
        {drillCat && drillData && (
          <Panel
            title={`${getCategory(drillCat).name} — Deep Dive`}
            actions={<Button size="sm" variant="ghost" onClick={() => setDrillCat(null)}>✕ Close</Button>}
            className="col-span-12"
          >
            <div className="grid grid-cols-3 gap-px bg-line border-b border-line">
              <div className="bg-surface px-2.5 py-1.5">
                <p className="label-micro">Total spent</p>
                <Money value={drillData.total} size="lg" className="block mt-0.5" />
              </div>
              <div className="bg-surface px-2.5 py-1.5">
                <p className="label-micro">Transactions</p>
                <p className="text-xl font-medium text-ink mt-0.5">{drillData.transactions.length}</p>
              </div>
              <div className="bg-surface px-2.5 py-1.5">
                <p className="label-micro">Average</p>
                <Money value={drillData.avg} size="lg" className="block mt-0.5" />
              </div>
            </div>
            {/* Only worth showing when at least one transaction has a subcategory. */}
            {drillData.subcategories.some(sc => sc.name !== 'Unspecified') && (
              <div className="border-b border-line">
                <SubHead>By Subcategory</SubHead>
                {drillData.subcategories.map(sc => (
                  <div key={sc.name} className="flex items-center gap-3 h-row px-2.5 border-b border-line last:border-b-0">
                    <span className={`text-sm w-36 shrink-0 truncate ${sc.name === 'Unspecified' ? 'text-ink-muted italic' : 'text-ink-secondary'}`}>{sc.name}</span>
                    <div className="flex-1 h-1.5 bg-line">
                      <div className="h-full" style={{ width: `${sc.pct}%`, backgroundColor: getCategory(drillCat).color }} />
                    </div>
                    <span className="text-sm text-ink w-24 text-right">{formatCurrency(sc.total)}</span>
                    <span className="text-caption text-ink-muted w-24 text-right">{sc.count} tx · {sc.pct}%</span>
                  </div>
                ))}
              </div>
            )}
            <div className="grid lg:grid-cols-2 gap-px bg-line">
              <div className="bg-surface">
                <SubHead>Top Merchants</SubHead>
                {drillData.merchants.map(([merchant, amt]) => (
                  <div key={merchant} className="flex justify-between items-center gap-2 h-row px-2.5 border-b border-line last:border-b-0">
                    <span className="text-sm text-ink-secondary truncate">{merchant}</span>
                    <span className="text-sm text-ink">{formatCurrency(amt)}</span>
                  </div>
                ))}
              </div>
              <div className="bg-surface">
                <SubHead>Recent Transactions</SubHead>
                {drillData.transactions.slice(0, 6).map(t => (
                  <div key={t.id} className="flex items-center gap-2 h-row px-2.5 border-b border-line last:border-b-0">
                    <span className="text-caption text-ink-muted w-14 shrink-0">{format(new Date(t.date), 'MMM d')}</span>
                    <span className="flex-1 min-w-0 text-sm text-ink-secondary truncate">{t.merchant}</span>
                    <span className="text-sm text-ink">{formatCurrency(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        )}

        <TagsPanel transactions={transactions} month={month} year={year} />

        {/* Monthly trend line chart */}
        <Panel title="Spending Trends (6 months)" className="col-span-12 xl:col-span-8">
          <div className="flex flex-wrap gap-1 px-2.5 py-1.5 border-b border-line">
            {majorCats.map(cat => (
              <button
                key={cat.id}
                onClick={() => setHiddenLines(h => ({ ...h, [cat.id]: !h[cat.id] }))}
                aria-pressed={!hiddenLines[cat.id]}
                // The category colour stays, as a swatch; the label takes
                // --c-ink. Painting the label in the category colour on a wash
                // of that same colour put every one of these between 2.1:1 and
                // 3.8:1 — unreadable by construction, since a hue cannot
                // contrast with itself.
                className={`flex items-center gap-1.5 h-6 px-2 rounded-control text-micro uppercase tracking-[0.04em] font-medium border border-line-strong text-ink hover:bg-surface-hover transition-colors ${hiddenLines[cat.id] ? 'opacity-40' : ''}`}
              >
                <span className="w-[7px] h-[7px] shrink-0" style={{ backgroundColor: cat.color }} aria-hidden="true" />
                {cat.name}
              </button>
            ))}
          </div>
          <div className="p-3">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="label" {...chart.xAxis} />
                <YAxis {...chart.yAxis} tickFormatter={chart.compactMoney} />
                <Tooltip {...chart.tooltip} formatter={v => formatCurrency(chart.asNumber(v))} />
                {majorCats.map(cat => (
                  !hiddenLines[cat.id] && (
                    <Line
                      key={cat.id}
                      type="monotone"
                      dataKey={cat.id}
                      name={cat.name}
                      stroke={cat.color}
                      strokeWidth={1.5}
                      dot={{ r: 2 }}
                      activeDot={{ r: 4 }}
                    />
                  )
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Budget health */}
        <Panel title="Budget adherence — current month" className="col-span-12 xl:col-span-4">
          <KeyValue label="Grade" strong>
            <span className="text-xl font-semibold" style={{ color: health.color }}>{health.grade}</span>
          </KeyValue>
          <KeyValue label="On track" strong>{health.percent}%</KeyValue>
          <p className="font-sans text-sm text-ink-muted px-2.5 py-2">of budget categories are on track this month</p>
        </Panel>
      </PanelGrid>
      </>}
    </div>
  );
}
