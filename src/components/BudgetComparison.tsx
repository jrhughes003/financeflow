import React, { useState } from 'react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import * as chart from './ui/chartTheme';
import { useFinancial, useTaxonomy } from '../context/FinancialContext';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Panel, PanelGrid, IconButton, Money, Badge, CategoryMark, Table, Th, Td, Tr,
} from './ui';
import {
  getBudgetStatus, getMonthlyTrend, getConsistentlyOverBudget, formatCurrency,
  getOutsideBudgetSpending, monthsOfHistory, budgetAmountFor, isOutsideBudget,
} from '../utils/calculations';
import { rollUp } from '../utils/categoryTree';
import { getTripStatuses } from '../utils/trips';
import { useGetCategory } from '../context/FinancialContext';
import type { BudgetStatusName } from '../types/analysis';

/** The columns the detail table can sort on. */
type SortField = 'category' | 'budget' | 'actual' | 'variance' | 'percentUsed' | 'status';

function StatusBadge({ status }: { status: BudgetStatusName }) {
  if (status === 'danger') return <Badge tone="negative">Over Budget</Badge>;
  if (status === 'warning') return <Badge tone="caution">Approaching</Badge>;
  return <Badge tone="positive">On Track</Badge>;
}

export default function BudgetComparison() {
  const { state } = useFinancial();
  const taxonomy = useTaxonomy();
  const { transactions, budgets } = state;
  const getCategory = useGetCategory();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [sortField, setSortField] = useState<SortField>('category');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const statuses = getBudgetStatus(budgets, transactions, month, year, taxonomy);
  // Back to the first transaction, so the history the categories were
  // migrated across is all visible here — not just the last six months.
  // Rolled up to group level, the level budgets are set at.
  const trend = getMonthlyTrend(transactions, Math.max(6, monthsOfHistory(transactions))).map((p) => {
    const raw: Record<string, number> = {};
    for (const [k, v] of Object.entries(p)) {
      if (!['month', 'year', 'label', 'total'].includes(k) && typeof v === 'number') raw[k] = v;
    }
    return { ...p, ...rollUp(raw, taxonomy.categories, taxonomy.parentOverrides) };
  });
  // Spending deliberately kept out of monthly budgets (travel): shown on its
  // own line, never added to the regular-spending total.
  const outside = getOutsideBudgetSpending(transactions, month, year, taxonomy);
  const budgetedIds = new Set(budgets.map(b => b.category));
  const outsideIds = [...new Set([
    ...taxonomy.categories.filter(c => c.outsideBudget && !c.retired && !budgetedIds.has(c.id)).map(c => c.id),
    ...Object.keys(outside).filter(id => !budgetedIds.has(id)),
  ])].filter(id => isOutsideBudget(id, taxonomy));
  const outsideTotal = outsideIds.reduce((s, id) => s + (outside[id] || 0), 0);
  const trips = getTripStatuses(state.settings?.trips, transactions, state.settings?.lifePlan);

  // Sort
  const sorted = [...statuses].sort((a, b) => {
    let va: string | number = a[sortField], vb: string | number = b[sortField];
    if (sortField === 'category') { va = getCategory(a.category).name; vb = getCategory(b.category).name; }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (f: SortField) => {
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
  const consistentlyOver = getConsistentlyOverBudget(budgets, transactions, month, year, taxonomy);

  const changeMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  };

  const columns: [SortField, string][] = [
    ['category', 'Category'], ['budget', anyCarry ? 'Budget (after rollover)' : 'Budget'], ['actual', 'Actual'],
    ['variance', 'Variance'], ['percentUsed', '% Used'], ['status', 'Status'],
  ];
  const isNumeric = (f: SortField) => f !== 'category' && f !== 'status';

  return (
    <div className="space-y-2 animate-fade-in">
      {/* Month selector */}
      <div className="flex flex-wrap items-center gap-3 text-caption text-ink-muted">
        <div className="flex items-center border border-line-strong bg-surface">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => changeMonth(-1)} className="rounded-none" />
          <span className="px-2.5 h-6 leading-6 border-x border-line-strong text-sm font-medium text-ink tracking-[0.06em] min-w-[128px] text-center uppercase">
            {format(new Date(year, month, 1), 'MMMM yyyy')}
          </span>
          <IconButton icon={ChevronRight} label="Next month" onClick={() => changeMonth(1)} className="rounded-none" />
        </div>
        <span>{statuses.length} BUDGETS</span>
      </div>

      <PanelGrid className="grid-flow-row-dense">
        {/* Summary totals */}
        <Panel title="Budget vs actual" meta={format(new Date(year, month, 1), 'MMM yyyy').toUpperCase()} className="col-span-12">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line">
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Regular spending</p>
              <Money value={totalActual} size="lg" className="block mt-0.5" />
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">{anyCarry ? 'Budget after rollover' : 'Budget'}</p>
              <Money value={totalBudget} size="lg" className="block mt-0.5" />
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">{totalVariance >= 0 ? 'Remaining' : 'Over budget'}</p>
              <Money value={Math.abs(totalVariance)} size="lg" className={`block mt-0.5 ${totalVariance >= 0 ? 'text-positive' : 'text-negative'}`} />
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Used</p>
              <p className="text-xl font-medium mt-0.5 text-ink">
                {totalBudget > 0 ? `${Math.round((totalActual / totalBudget) * 100)}%` : '—'}
              </p>
              {totalBudget > 0 && (
                <p className="text-caption text-ink-muted mt-0.5">
                  {Math.round((totalActual / totalBudget) * 100)}% of budget used
                </p>
              )}
            </div>
          </div>
          {outsideIds.length > 0 && (
            <div className="border-t border-line">
              {outsideIds.map((id) => {
                const cat = getCategory(id);
                return (
                  <div key={id} className="flex items-center justify-between h-row px-2.5 border-b border-line last:border-b-0">
                    <span className="flex items-center gap-2 text-sm text-ink-secondary">
                      <CategoryMark color={cat.color} name={cat.name} />
                      <span className="text-caption text-ink-muted">outside monthly budget</span>
                    </span>
                    <Money value={outside[id] || 0} size="sm" />
                  </div>
                );
              })}
              {outsideIds.length > 1 && (
                <div className="flex items-center justify-between h-row px-2.5 text-caption text-ink-muted">
                  <span>Outside budget, total</span><Money value={outsideTotal} size="sm" />
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* Trips: counted against the trip's budget, not a month's */}
        {trips.length > 0 && (
          <Panel title="Trips" meta={`${trips.length} TRIP${trips.length === 1 ? '' : 'S'}`} className="col-span-12">
            <Table>
              <thead>
                <tr><Th>Trip</Th><Th>Dates</Th><Th numeric>Spent (your share)</Th><Th numeric>Trip budget</Th><Th numeric>Remaining</Th></tr>
              </thead>
              <tbody>
                {trips.map(t => (
                  <Tr key={t.trip.id}>
                    <Td className="text-ink">{t.trip.name} <span className="text-caption text-ink-muted">#{t.trip.tag}</span></Td>
                    <Td className="text-caption text-ink-muted">{t.firstDate ? `${t.firstDate} – ${t.lastDate}` : 'nothing tagged yet'}</Td>
                    <Td numeric><Money value={t.spent} size="sm" /></Td>
                    <Td numeric className="text-ink-secondary">
                      {t.budget === null ? '—' : <>{formatCurrency(t.budget)}{t.budgetSource === 'lifePlan' && <span className="text-caption text-ink-muted"> (Plan Ahead)</span>}</>}
                    </Td>
                    <Td numeric>{t.budget === null ? '—' : <Money value={t.budget - t.spent} size="sm" signed colour />}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}

        {/* Bar chart */}
        {chartData.length > 0 && (
          <Panel
            title="Budget vs Actual"
            className={`col-span-12 ${consistentlyOver.length > 0 ? 'xl:col-span-8' : ''}`}
            bodyClassName="px-1 pt-2"
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="name" {...chart.xAxis} />
                <YAxis {...chart.yAxis} tickFormatter={chart.compactMoney} />
                <Tooltip {...chart.tooltip} formatter={v => formatCurrency(chart.asNumber(v))} />
                <Legend wrapperStyle={chart.legend.wrapperStyle} iconSize={chart.legend.iconSize} />
                <Bar dataKey="Budget" fill={chart.SERIES.primary} />
                <Bar dataKey="Actual" fill={chart.SERIES.secondary} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        )}

        {/* Consistently overspent */}
        {consistentlyOver.length > 0 && (
          <Panel
            title="Consistently Over Budget"
            meta={`${consistentlyOver.length} CAT`}
            className={`col-span-12 ${chartData.length > 0 ? 'xl:col-span-4' : ''}`}
          >
            <p className="font-sans text-sm text-ink-muted px-2.5 py-1.5 border-b border-line">These categories have exceeded budget 2+ of the last 3 months:</p>
            {consistentlyOver.map(b => {
              const cat = getCategory(b.category);
              return (
                <div key={b.id} className="flex items-center gap-2.5 h-row px-2.5 border-b border-line">
                  <span className="shrink-0 w-12 text-center border border-current text-[10px] leading-[14px] tracking-[0.06em] text-negative">OVER</span>
                  <CategoryMark color={cat.color} name={cat.name} className="text-sm text-ink" />
                </div>
              );
            })}
          </Panel>
        )}

        {/* Detail table */}
        <Panel title="By category" meta={`SORT ${sortField.toUpperCase()} ${sortDir.toUpperCase()}`} className="col-span-12">
          <Table>
            <thead>
              <tr>
                {columns.map(([f, label]) => (
                  <React.Fragment key={f}>
                    <Th
                      numeric={isNumeric(f)}
                      onClick={() => handleSort(f)}
                      className={`cursor-pointer select-none hover:text-ink ${sortField === f ? 'text-ink' : ''}`}
                    >
                      {label}
                      {sortField === f && <span aria-hidden="true" className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </Th>
                    {f === 'budget' && anyCarry && <Th numeric className="hidden md:table-cell">Rolled over</Th>}
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => {
                const cat = getCategory(s.category);
                const hasCarry = Math.abs(s.carry) >= 0.01;
                return (
                  <Tr key={s.category}>
                    <Td className="text-ink"><CategoryMark color={cat.color} name={cat.name} /></Td>
                    <Td numeric><Money value={s.effectiveBudget} size="sm" className="text-ink-secondary" /></Td>
                    {anyCarry && (
                      <Td numeric className="hidden md:table-cell text-caption text-ink-muted">
                        {hasCarry ? `${formatCurrency(s.budget)} ${s.carry > 0 ? '+' : '−'} ${formatCurrency(Math.abs(s.carry))} rolled over` : '—'}
                      </Td>
                    )}
                    <Td numeric><Money value={s.actual} size="sm" /></Td>
                    <Td numeric><Money value={s.variance} size="sm" signed colour /></Td>
                    <Td numeric className={s.status === 'danger' ? 'text-negative' : s.status === 'warning' ? 'text-caution' : 'text-ink-secondary'}>
                      {s.percentUsed.toFixed(0)}%
                    </Td>
                    <Td><StatusBadge status={s.status} /></Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold bg-surface-sunk">
                <td className="h-row px-2.5 text-ink">Totals</td>
                <td className="px-2.5 text-right"><Money value={totalBudget} size="sm" /></td>
                {anyCarry && <td className="hidden md:table-cell" />}
                <td className="px-2.5 text-right"><Money value={totalActual} size="sm" /></td>
                <td className="px-2.5 text-right"><Money value={totalVariance} size="sm" signed colour /></td>
                <td className="px-2.5 text-right text-ink-secondary">{totalBudget > 0 ? ((totalActual / totalBudget) * 100).toFixed(0) : 0}%</td>
                <td />
              </tr>
            </tfoot>
          </Table>
        </Panel>

        {/* Monthly trend table */}
        <Panel title="Spending Trend by Category" meta="RED = OVER BUDGET" className="col-span-12" bodyClassName="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Category</Th>
                {trend.map(m => <Th key={m.label} numeric>{m.label.split(' ')[0]}</Th>)}
              </tr>
            </thead>
            <tbody>
              {budgets.map(b => {
                const cat = getCategory(b.category);
                return (
                  <Tr key={b.id}>
                    <Td className="text-ink-secondary"><CategoryMark color={cat.color} name={cat.name} /></Td>
                    {trend.map(m => {
                      // A trend row carries `label` beside the category totals, so its
                      // index signature admits a string; a category key is always a number.
                      const amt = (m[b.category] as number) || 0;
                      const limit = budgetAmountFor(b, m.month, m.year);
                      const over = amt > limit && limit > 0;
                      return (
                        <Td key={m.label} numeric className={over ? 'text-negative font-semibold' : 'text-ink-secondary'}>
                          {amt > 0 ? formatCurrency(amt) : '—'}
                        </Td>
                      );
                    })}
                  </Tr>
                );
              })}
              {outsideIds.map((id) => {
                const cat = getCategory(id);
                return (
                  <Tr key={`outside-${id}`}>
                    <Td className="text-ink-muted"><CategoryMark color={cat.color} name={`${cat.name} (outside budget)`} /></Td>
                    {trend.map(m => {
                      const amt = (m[id] as number) || 0;
                      return <Td key={m.label} numeric className="text-ink-muted">{amt > 0 ? formatCurrency(amt) : '—'}</Td>;
                    })}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Panel>
      </PanelGrid>
    </div>
  );
}
