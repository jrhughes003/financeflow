import type { TooltipProps } from 'recharts';
import React, { useMemo } from 'react';
import { format } from 'date-fns';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import * as chart from '../ui/chartTheme';
import { AlertTriangle, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useFinancial, useGetCategory, useTaxonomy } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { projectMonthEnd, forecastCashFlow } from '../../utils/insights';
import IrregularExpensesPanel from './IrregularExpensesPanel';
import { getIncomeSources } from '../../utils/accounts';


/*
 * A ratio needs a denominator worth dividing by.
 *
 * A lumpy category — one electronics purchase against a profile expecting two
 * dollars by the fifth — produces a true but useless "61.84x". The number is
 * arithmetically right and tells the reader nothing except that something
 * unusual happened, which the Expected column already says. Below the floor
 * there is no rate to compare against, and above the cap the exact multiple
 * stops carrying information.
 */
const RATIO_FLOOR = 15;   // dollars the profile must expect by now
const RATIO_CAP = 9.95;

type ForecastRow = { ratio: number | null; expectedSoFar: number };

function ratioText(c: ForecastRow): string {
  if (c.ratio === null || c.expectedSoFar < RATIO_FLOOR) return '—';
  return c.ratio >= RATIO_CAP ? '>10×' : `${c.ratio.toFixed(2)}×`;
}

function ratioTitle(c: ForecastRow): string {
  if (c.ratio === null) return 'No history to compare against';
  if (c.expectedSoFar < RATIO_FLOOR) {
    return `Too little usually spent by now (${formatCurrency(c.expectedSoFar)}) for a rate to mean much`;
  }
  return `Usually ${formatCurrency(c.expectedSoFar)} by this point in the month`;
}

const CONFIDENCE = {
  high:   { label: 'High confidence',   cls: 'bg-positive-tint text-positive' },
  medium: { label: 'Medium confidence', cls: 'bg-caution-tint text-caution' },
  low:    { label: 'Low confidence',    cls: 'bg-surface-hover text-ink-secondary' },
};

const STATUS = {
  over:  { label: 'Over budget', icon: AlertTriangle, cls: 'text-negative' },
  watch: { label: 'Close',       icon: AlertCircle,   cls: 'text-caution' },
  ok:    { label: 'On track',    icon: CheckCircle2,  cls: 'text-positive' },
};

/** One category's month-end projection, as projectMonthEnd returns it. */
type CategoryProjection = ReturnType<typeof projectMonthEnd>['categories'][number];

/** One month of the cash-flow forecast. */
type CashFlowRow = ReturnType<typeof forecastCashFlow>['rows'][number];

const LINE_COLOR = 'var(--c-data-1)';

function Stat({
  label, value, sub,
}: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-surface-sunk rounded-container p-3">
      <p className="text-caption text-ink-muted">{label}</p>
      <p className="text-lg font-bold text-ink">{value}</p>
      {sub && <p className="text-caption text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// How much can still be spent per day without exceeding the budget.
function allowanceText(w: CategoryProjection, daysLeft: number): string {
  // Only called for categories that have a budget, which is what puts them in
  // the warnings list in the first place.
  const left = (w.budget ?? 0) - w.actual - w.recurringRemaining;
  if (left <= 0) return 'Spent plus scheduled bills already reach the budget.';
  if (daysLeft <= 0) return '';
  return `Keep it under ${formatCurrency(left / daysLeft)}/day for the rest of the month to stay within budget.`;
}

function CashFlowTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as CashFlowRow;
  return (
    <div className="bg-surface border border-line-strong rounded-control p-3 text-caption space-y-0.5">
      <p className="font-semibold text-ink mb-1">{r.label}</p>
      <p className="text-ink-secondary">Income: {formatCurrency(r.income)}</p>
      <p className="text-ink-secondary">Scheduled bills: −{formatCurrency(r.fixed)}</p>
      {r.irregular > 0 && <p className="text-ink-secondary">Periodic bills due: −{formatCurrency(r.irregular)}</p>}
      <p className="text-ink-secondary">Typical spending: −{formatCurrency(r.discretionary)}</p>
      <p className="text-ink font-medium pt-1">Month net: {formatCurrency(r.net)}</p>
      <p className="text-ink font-medium">Running total: {formatCurrency(r.cumulative)}</p>
      <p className="text-ink-muted">Range: {formatCurrency(r.cumulativeRange[0])} to {formatCurrency(r.cumulativeRange[1])}</p>
    </div>
  );
}

export default function ForecastPanel() {
  const { state } = useFinancial();
  const taxonomy = useTaxonomy();
  const { transactions, budgets, recurringTemplates = [] } = state;
  const incomes = useMemo(() => getIncomeSources(state.incomes, state.investments), [state.incomes, state.investments]);
  const getCategory = useGetCategory();

  const p = useMemo(
    () => projectMonthEnd({ transactions, budgets, recurringTemplates, taxonomy }),
    [transactions, budgets, recurringTemplates, taxonomy],
  );
  const cf = useMemo(() => forecastCashFlow({ transactions, incomes, recurringTemplates }), [transactions, incomes, recurringTemplates]);
  const conf = CONFIDENCE[p.confidence as keyof typeof CONFIDENCE];
  const monthLabel = format(new Date(p.year, p.month, 1), 'MMMM');
  const t = p.totals;
  const barMax = Math.max(t.projected, t.budget, 1);
  const seg = (v: number): string => `${(v / barMax) * 100}%`;
  const last = cf.rows[cf.rows.length - 1];

  return (
    <div className="space-y-5">
      {/* Month-end projection */}
      <div className="bg-surface rounded-container border border-line p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{monthLabel} Month-End Projection</h2>
            <p className="text-caption text-ink-muted mt-0.5">
              Day {p.daysElapsed} of {p.daysInMonth} ·{' '}
              {p.historyMonths
                ? <>weighs this month against {p.historyMonths} month{p.historyMonths > 1 ? 's' : ''} of history, matched day-of-week for day-of-week</>
                : <>no earlier history, so this is a straight line from what you have spent</>}
            </p>
          </div>
          <span className={`text-caption font-medium px-2.5 py-1 rounded-full ${conf.cls}`}>{conf.label}</span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat label="Spent so far" value={formatCurrency(t.actual)} />
          <Stat label="Bills still scheduled" value={formatCurrency(t.recurringRemaining)} sub="Recurring & periodic bills" />
          <Stat label="Projected month-end" value={formatCurrency(t.projected)} />
          <Stat
            label="Budgeted"
            value={t.budget ? formatCurrency(t.budget) : '—'}
            sub={t.budget ? (t.projected > t.budget ? `${formatCurrency(t.projected - t.budget)} over` : `${formatCurrency(t.budget - t.projected)} to spare`) : 'No budgets set'}
          />
        </div>

        {/*
          The two reference points the projection sits between.

          Without them the number is unarguable: five days into a month the
          forecast is mostly history, and a reader comparing it against their
          own back-of-envelope pace has no way to see why the two differ. Each
          end is a projection in its own right, so they are directly
          comparable with the figure above.
        */}
        {p.historyMonths > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-4 text-caption">
            <span className="text-ink-muted">
              If you keep this month&apos;s rate:{' '}
              <span className="money text-ink-secondary">{formatCurrency(t.paceProjection)}</span>
            </span>
            <span className="text-ink-muted">
              If you spend like your last {p.historyMonths} month{p.historyMonths > 1 ? 's' : ''}:{' '}
              <span className="money text-ink-secondary">{formatCurrency(t.historyProjection)}</span>
            </span>
          </div>
        )}

        {/* Stacked progress: spent | scheduled | expected, with budget marker */}
        <div className="mb-2">
          <div className="relative h-4 bg-surface-hover rounded-full overflow-hidden flex gap-0.5">
            <div className="h-full bg-accent" style={{ width: seg(t.actual) }} title={`Spent ${formatCurrency(t.actual)}`} />
            <div className="h-full bg-accent" style={{ width: seg(t.recurringRemaining) }} title={`Scheduled ${formatCurrency(t.recurringRemaining)}`} />
            <div className="h-full bg-accent-tint" style={{ width: seg(t.discretionaryRemaining) }} title={`Expected ${formatCurrency(t.discretionaryRemaining)}`} />
            {t.budget > 0 && <div className="absolute top-0 bottom-0 w-0.5 bg-ink" style={{ left: seg(t.budget) }} title={`Budget ${formatCurrency(t.budget)}`} />}
          </div>
          <div className="flex flex-wrap gap-4 text-caption text-ink-muted mt-2">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent" />Spent</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent" />Scheduled bills</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent-tint" />Expected spending</span>
            {t.budget > 0 && <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-ink" />Total budget</span>}
          </div>
        </div>

        {/* Early warnings */}
        {p.warnings.length > 0 && (
          <div className="space-y-2 mt-4">
            {p.warnings.map(w => {
              const s = STATUS[w.status as keyof typeof STATUS];
              const Icon = s.icon;
              return (
                <div key={w.category} className={`flex items-start gap-3 rounded-container p-3 border ${w.status === 'over' ? 'bg-negative-tint border-negative' : 'bg-caution-tint border-caution'}`}>
                  <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${s.cls}`} />
                  <p className="text-sm text-ink">
                    <span className="font-semibold">{getCategory(w.category).name}</span>
                    {w.status === 'over'
                      ? <> is on pace for {formatCurrency(w.projected)}, <span className="font-semibold">{formatCurrency(w.overBy)} over</span> its {formatCurrency(w.budget ?? 0)} budget.</>
                      : <> is on pace for {formatCurrency(w.projected)}, close to its {formatCurrency(w.budget ?? 0)} budget.</>}
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
                <tr className="text-caption text-ink-muted border-b border-line">
                  <th className="text-left font-medium py-2">Category</th>
                  <th className="text-right font-medium py-2">Spent</th>
                  {/*
                    Spend so far against what this category usually costs by
                    this point, matched day for day. It is the number that
                    explains a surprising projection: 0.36x means the month has
                    run at a third of its usual rate *through the days that
                    have actually passed*, which a flat "day 5 of 31" cannot
                    tell you when those five days are the expensive ones.
                  */}
                  <th className="text-right font-medium py-2" title="Spent so far, against what this category usually costs by now">vs usual</th>
                  <th className="text-right font-medium py-2">+ Scheduled</th>
                  <th className="text-right font-medium py-2">+ Expected</th>
                  <th className="text-right font-medium py-2" title="Blend of this month's pace and your usual months; the range below is those two ends">Projected</th>
                  <th className="text-right font-medium py-2">Budget</th>
                  <th className="text-right font-medium py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {p.categories.map(c => {
                  const cat = getCategory(c.category);
                  const s = STATUS[c.status as keyof typeof STATUS];
                  const Icon = s?.icon;
                  return (
                    <tr key={c.category} className="border-b border-line-faint">
                      <td className="py-2">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                          <span className="text-ink-secondary">{cat.name}</span>
                        </span>
                      </td>
                      <td className="py-2 text-right text-ink-secondary">{formatCurrency(c.actual)}</td>
                      <td className="py-2 text-right text-ink-muted" title={ratioTitle(c)}>
                        {ratioText(c)}
                      </td>
                      <td className="py-2 text-right text-ink-muted">{c.recurringRemaining ? formatCurrency(c.recurringRemaining) : '—'}</td>
                      <td className="py-2 text-right text-ink-muted">{formatCurrency(c.discretionaryRemaining)}</td>
                      {/*
                        The same two ends as the totals above, per category, so a
                        projection that sits far from your own pace shows why:
                        the low end is this month's rate carried forward, the
                        high end is your usual months.
                      */}
                      <td className="py-2 text-right">
                        <div className="font-semibold text-ink">{formatCurrency(c.projected)}</div>
                        {p.historyMonths > 0 && c.paceProjection !== c.historyProjection && (
                          <div
                            className="text-caption text-ink-muted money"
                            title={`At this month's rate: ${formatCurrency(c.paceProjection)} · Like your last ${p.historyMonths} month${p.historyMonths > 1 ? 's' : ''}: ${formatCurrency(c.historyProjection)}`}
                          >
                            {formatCurrency(Math.min(c.paceProjection, c.historyProjection))}–{formatCurrency(Math.max(c.paceProjection, c.historyProjection))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right text-ink-muted">{c.budget ? formatCurrency(c.budget) : '—'}</td>
                      <td className="py-2 text-right">
                        {s
                          ? <span className={`inline-flex items-center gap-1 text-caption font-medium ${s.cls}`}><Icon className="w-3.5 h-3.5" />{s.label}</span>
                          : <span className="text-caption text-ink-muted">No budget</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {p.categories.length === 0 && <p className="text-sm text-ink-muted text-center py-6">No spending recorded yet this month.</p>}
      </div>

      <IrregularExpensesPanel />

      {/* Cash-flow outlook */}
      <div className="bg-surface rounded-container border border-line p-5">
        <h2 className="text-lg font-semibold text-ink">Cash-Flow Outlook — Next {cf.rows.length} Months</h2>
        <p className="text-caption text-ink-muted mt-0.5 mb-4">
          Projected savings built up over time: income minus scheduled and periodic bills minus your typical spending
          ({formatCurrency(cf.discretionaryAverage)}/mo, usually {formatCurrency(cf.discretionaryRange[0])}–{formatCurrency(cf.discretionaryRange[1])}).
        </p>

        {cf.income === 0 ? (
          <div className="flex items-start gap-3 bg-accent-tint border border-accent rounded-container p-3">
            <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <p className="text-sm text-accent-ink">Add your income sources on the Income page to see a cash-flow forecast.</p>
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
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="label" {...chart.xAxis} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`} />
                <ReferenceLine y={0} stroke="var(--c-ink-muted)" />
                <Tooltip content={<CashFlowTooltip />} />
                <Area dataKey="cumulativeRange" stroke="none" fill={LINE_COLOR} fillOpacity={0.12} name="Likely range" isAnimationActive={false} />
                <Line dataKey="cumulative" stroke={LINE_COLOR} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} name="Projected savings" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 text-caption text-ink-muted mt-1">
              <span className="flex items-center gap-1.5"><span className="w-4 h-0.5" style={{ backgroundColor: LINE_COLOR }} />Projected savings (running total)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: LINE_COLOR, opacity: 0.2 }} />Likely range</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
