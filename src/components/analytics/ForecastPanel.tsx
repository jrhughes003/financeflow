import type { TooltipProps } from 'recharts';
import React, { useMemo } from 'react';
import { format } from 'date-fns';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import * as chart from '../ui/chartTheme';
import { Panel, PanelGrid, Badge, CategoryMark } from '../ui';
import type { BadgeTone } from '../ui';
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

const CONFIDENCE: Record<string, { label: string; tone: BadgeTone }> = {
  high:   { label: 'High confidence',   tone: 'positive' },
  medium: { label: 'Medium confidence', tone: 'caution' },
  low:    { label: 'Low confidence',    tone: 'neutral' },
};

const STATUS: Record<string, { label: string; tone: BadgeTone } | undefined> = {
  over:  { label: 'Over budget', tone: 'negative' },
  watch: { label: 'Close',       tone: 'caution' },
  ok:    { label: 'On track',    tone: 'positive' },
};

/** One category's month-end projection, as projectMonthEnd returns it. */
type CategoryProjection = ReturnType<typeof projectMonthEnd>['categories'][number];

/** One month of the cash-flow forecast. */
type CashFlowRow = ReturnType<typeof forecastCashFlow>['rows'][number];

const LINE_COLOR = 'var(--c-data-1)';

/* One cell of a figure strip: label, figure, and an optional line of context. */
function FigureCell({
  label, value, sub, subClassName = 'text-ink-muted',
}: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; subClassName?: string }) {
  return (
    <div className="bg-surface px-2.5 py-1.5">
      <p className="label-micro">{label}</p>
      <p className="text-xl font-medium text-ink mt-0.5 money">{value}</p>
      {sub && <p className={`text-caption mt-0.5 ${subClassName}`}>{sub}</p>}
    </div>
  );
}

const TH = 'font-medium h-[22px] px-2.5 border-b border-line bg-surface-sunk whitespace-nowrap';
const TD = 'h-row px-2.5 border-b border-line';

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
    <div className="bg-surface border border-line shadow-overlay px-2 py-1.5 text-caption space-y-0.5">
      <p className="label-micro mb-1">{r.label}</p>
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
  const conf = CONFIDENCE[p.confidence] ?? CONFIDENCE.low;
  const monthLabel = format(new Date(p.year, p.month, 1), 'MMMM');
  const t = p.totals;
  const barMax = Math.max(t.projected, t.budget, 1);
  const seg = (v: number): string => `${(v / barMax) * 100}%`;
  const last = cf.rows[cf.rows.length - 1];

  return (
    <PanelGrid className="grid-flow-row-dense">
      {/* Month-end projection */}
      <Panel
        title={`${monthLabel} Month-End Projection`}
        meta={`Day ${p.daysElapsed} / ${p.daysInMonth}`}
        actions={<Badge tone={conf.tone}>{conf.label}</Badge>}
        className="col-span-12"
      >
        <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">
          Day {p.daysElapsed} of {p.daysInMonth} ·{' '}
          {p.historyMonths
            ? <>weighs this month against {p.historyMonths} month{p.historyMonths > 1 ? 's' : ''} of history, matched day-of-week for day-of-week</>
            : <>no earlier history, so this is a straight line from what you have spent</>}
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border-b border-line">
          <FigureCell label="Spent so far" value={formatCurrency(t.actual)} />
          <FigureCell label="Bills still scheduled" value={formatCurrency(t.recurringRemaining)} sub="Recurring & periodic bills" />
          <FigureCell label="Projected month-end" value={formatCurrency(t.projected)} />
          <FigureCell
            label="Budgeted"
            value={t.budget ? formatCurrency(t.budget) : '—'}
            sub={t.budget ? (t.projected > t.budget ? `${formatCurrency(t.projected - t.budget)} over` : `${formatCurrency(t.budget - t.projected)} to spare`) : 'No budgets set'}
            subClassName={t.budget ? (t.projected > t.budget ? 'text-negative' : 'text-positive') : undefined}
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
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-2.5 py-1.5 border-b border-line text-caption">
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
        <div className="px-2.5 py-2 border-b border-line">
          <div className="relative h-2 bg-line flex gap-px">
            <div className="h-full bg-accent" style={{ width: seg(t.actual) }} title={`Spent ${formatCurrency(t.actual)}`} />
            <div className="h-full bg-accent opacity-60" style={{ width: seg(t.recurringRemaining) }} title={`Scheduled ${formatCurrency(t.recurringRemaining)}`} />
            <div className="h-full bg-accent-tint" style={{ width: seg(t.discretionaryRemaining) }} title={`Expected ${formatCurrency(t.discretionaryRemaining)}`} />
            {t.budget > 0 && <div className="absolute -top-[3px] -bottom-[3px] w-px bg-ink" style={{ left: seg(t.budget) }} title={`Budget ${formatCurrency(t.budget)}`} />}
          </div>
          <div className="flex flex-wrap gap-4 text-micro uppercase tracking-[0.06em] text-ink-muted mt-2">
            <span className="flex items-center gap-1.5"><span className="w-[7px] h-[7px] bg-accent" aria-hidden="true" />Spent</span>
            <span className="flex items-center gap-1.5"><span className="w-[7px] h-[7px] bg-accent opacity-60" aria-hidden="true" />Scheduled bills</span>
            <span className="flex items-center gap-1.5"><span className="w-[7px] h-[7px] bg-accent-tint border border-line-strong" aria-hidden="true" />Expected spending</span>
            {t.budget > 0 && <span className="flex items-center gap-1.5"><span className="w-px h-2.5 bg-ink" aria-hidden="true" />Total budget</span>}
          </div>
        </div>

        {/* Early warnings */}
        {p.warnings.length > 0 && (
          <ul className="border-b border-line">
            {p.warnings.map(w => {
              const s = STATUS[w.status];
              return (
                <li key={w.category} className="flex items-start gap-2.5 px-2.5 py-1.5 border-b border-line last:border-b-0">
                  <Badge tone={s?.tone ?? 'caution'} className="shrink-0 w-12 justify-center mt-px">{w.status === 'over' ? 'Over' : 'Pace'}</Badge>
                  <p className="font-sans text-[12.5px] leading-snug text-ink">
                    <span className="font-semibold">{getCategory(w.category).name}</span>
                    {w.status === 'over'
                      ? <> is on pace for {formatCurrency(w.projected)}, <span className="font-semibold">{formatCurrency(w.overBy)} over</span> its {formatCurrency(w.budget ?? 0)} budget.</>
                      : <> is on pace for {formatCurrency(w.projected)}, close to its {formatCurrency(w.budget ?? 0)} budget.</>}
                    {' '}{allowanceText(w, p.daysInMonth - p.daysElapsed)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {/* Per-category table */}
        {p.categories.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="label-micro">
                  <th scope="col" className={`${TH} text-left`}>Category</th>
                  <th scope="col" className={`${TH} text-right`}>Spent</th>
                  {/*
                    Spend so far against what this category usually costs by
                    this point, matched day for day. It is the number that
                    explains a surprising projection: 0.36x means the month has
                    run at a third of its usual rate *through the days that
                    have actually passed*, which a flat "day 5 of 31" cannot
                    tell you when those five days are the expensive ones.
                  */}
                  <th scope="col" className={`${TH} text-right`} title="Spent so far, against what this category usually costs by now">vs usual</th>
                  <th scope="col" className={`${TH} text-right`}>+ Scheduled</th>
                  <th scope="col" className={`${TH} text-right`}>+ Expected</th>
                  <th scope="col" className={`${TH} text-right`} title="Blend of this month's pace and your usual months; the range below is those two ends">Projected</th>
                  <th scope="col" className={`${TH} text-right`}>Budget</th>
                  <th scope="col" className={`${TH} text-right`}>Status</th>
                </tr>
              </thead>
              <tbody>
                {p.categories.map(c => {
                  const cat = getCategory(c.category);
                  const s = STATUS[c.status];
                  return (
                    <tr key={c.category} className="hover:bg-surface-hover">
                      <td className={`${TD} text-ink-secondary`}>
                        <CategoryMark color={cat.color} name={cat.name} />
                      </td>
                      <td className={`${TD} text-right text-ink-secondary whitespace-nowrap`}>{formatCurrency(c.actual)}</td>
                      <td className={`${TD} text-right text-ink-muted whitespace-nowrap`} title={ratioTitle(c)}>
                        {ratioText(c)}
                      </td>
                      <td className={`${TD} text-right text-ink-muted whitespace-nowrap`}>{c.recurringRemaining ? formatCurrency(c.recurringRemaining) : '—'}</td>
                      <td className={`${TD} text-right text-ink-muted whitespace-nowrap`}>{formatCurrency(c.discretionaryRemaining)}</td>
                      {/*
                        The same two ends as the totals above, per category, so a
                        projection that sits far from your own pace shows why:
                        the low end is this month's rate carried forward, the
                        high end is your usual months.
                      */}
                      <td className={`${TD} text-right whitespace-nowrap py-0.5`}>
                        <div className="font-semibold text-ink">{formatCurrency(c.projected)}</div>
                        {p.historyMonths > 0 && c.paceProjection !== c.historyProjection && (
                          <div
                            className="text-micro text-ink-muted money"
                            title={`At this month's rate: ${formatCurrency(c.paceProjection)} · Like your last ${p.historyMonths} month${p.historyMonths > 1 ? 's' : ''}: ${formatCurrency(c.historyProjection)}`}
                          >
                            {formatCurrency(Math.min(c.paceProjection, c.historyProjection))}–{formatCurrency(Math.max(c.paceProjection, c.historyProjection))}
                          </div>
                        )}
                      </td>
                      <td className={`${TD} text-right text-ink-muted whitespace-nowrap`}>{c.budget ? formatCurrency(c.budget) : '—'}</td>
                      <td className={`${TD} text-right whitespace-nowrap`}>
                        {s
                          ? <Badge tone={s.tone}>{s.label}</Badge>
                          : <span className="text-caption text-ink-muted">No budget</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {p.categories.length === 0 && <p className="font-sans text-sm text-ink-muted p-3">No spending recorded yet this month.</p>}
      </Panel>

      <IrregularExpensesPanel />

      {/* Cash-flow outlook */}
      <Panel title={`Cash-Flow Outlook — Next ${cf.rows.length} Months`} className="col-span-12">
        <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">
          Projected savings built up over time: income minus scheduled and periodic bills minus your typical spending
          ({formatCurrency(cf.discretionaryAverage)}/mo, usually {formatCurrency(cf.discretionaryRange[0])}–{formatCurrency(cf.discretionaryRange[1])}).
        </p>

        {cf.income === 0 ? (
          <div className="flex items-start gap-2.5 px-2.5 py-1.5">
            <Badge tone="accent" className="shrink-0 w-12 justify-center mt-px">Info</Badge>
            <p className="font-sans text-[12.5px] leading-snug text-ink">Add your income sources on the Income page to see a cash-flow forecast.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-px bg-line border-b border-line">
              <FigureCell label="Monthly income" value={formatCurrency(cf.income)} />
              <FigureCell label={`Saved by ${last.label}`} value={formatCurrency(last.cumulative)} sub={`Range ${formatCurrency(last.cumulativeRange[0])} to ${formatCurrency(last.cumulativeRange[1])}`} />
              <FigureCell label="Typical monthly net" value={formatCurrency(cf.rows[0].net)} sub={cf.historyMonths ? `From ${cf.historyMonths} months of history` : 'No spending history yet'} />
            </div>
            <div className="p-3">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={cf.rows} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid {...chart.grid} />
                  <XAxis dataKey="label" {...chart.xAxis} />
                  <YAxis {...chart.yAxis} tickFormatter={v => `${v < 0 ? '−' : ''}${chart.compactMoney(Math.abs(v))}`} />
                  <ReferenceLine y={0} stroke="var(--c-line-strong)" />
                  <Tooltip content={<CashFlowTooltip />} />
                  <Area dataKey="cumulativeRange" stroke="none" fill={LINE_COLOR} fillOpacity={0.12} name="Likely range" isAnimationActive={false} />
                  <Line dataKey="cumulative" stroke={LINE_COLOR} strokeWidth={1.5} dot={{ r: 2.5 }} activeDot={{ r: 4 }} name="Projected savings" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 text-micro uppercase tracking-[0.06em] text-ink-muted mt-1">
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: LINE_COLOR }} aria-hidden="true" />Projected savings (running total)</span>
                <span className="flex items-center gap-1.5"><span className="w-[7px] h-[7px]" style={{ backgroundColor: LINE_COLOR, opacity: 0.2 }} aria-hidden="true" />Likely range</span>
              </div>
            </div>
          </>
        )}
      </Panel>
    </PanelGrid>
  );
}
