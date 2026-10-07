import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { useFinancial, useGetCategory, useTaxonomy } from '../context/FinancialContext';
import {
  getTotalIncome, getTransactionsForPeriod, getBudgetStatus, getSavingsRate,
  detectAnomalies, formatCurrency,
} from '../utils/calculations';
import { getOwedSummary } from '../utils/reimbursements';
import { getIncomeSources, getInvestmentsValue } from '../utils/accounts';
import {
  projectMonthEnd, detectDuplicateCharges, templateOccurrences, detectIrregularExpenses, isFixedTransaction,
} from '../utils/insights';
import { rollUp } from '../utils/categoryTree';
import { paydaysBetween } from '../utils/cashPlan';
import { isTemplateDue } from '../utils/recurring';
import { getFinancialHealth } from '../utils/healthScore';
import { compactMoney } from './ui/chartTheme';
import {
  Panel, PanelGrid, KeyValue, IconButton, Button, Money, Meter, CategoryMark,
} from './ui';
import type { BudgetStatus } from '../types/analysis';
import type { Transaction } from '../types/domain';
import type { PageId } from '../types/navigation';

// The dashboard is a terminal screen: every panel answers one question, and
// together they answer "how is this month going, and does anything need me?"
// without a scroll on a laptop.
//
//   Month       the figures: spent, budget, pace, forecast, income
//   Spend       the same, over time, against the budget line and last month
//   Net worth   where the money sits
//   Budgets     each category against how far through the month we are
//   Signals     everything that wants attention, in one list
//   Ledger, Upcoming, Goals

// Both handlers are optional because the component renders their controls only
// when it has them; App always supplies both.
interface DashboardProps {
  onQuickAdd?: () => void;
  onNavigate?: (page: PageId) => void;
}

const NONE: string[] = [];

/** Running total of spending by day of month: index 0 is the end of the 1st. */
function cumulativeByDay(transactions: Transaction[], month: number, year: number): number[] {
  const days = new Date(year, month + 1, 0).getDate();
  const daily = new Array<number>(days).fill(0);
  getTransactionsForPeriod(transactions, month, year).forEach(t => {
    const day = Number(t.date.slice(8, 10));
    if (day >= 1 && day <= days) daily[day - 1] += t.amount;
  });
  let run = 0;
  return daily.map(v => (run += v));
}

const pct = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const signedMoney = (v: number): string => `${v >= 0 ? '+' : '−'}${formatCurrency(Math.abs(v))}`;

/* ------------------------------------------------------------------------ */

/** A round axis step that gives three or four gridlines under `max`. */
function niceStep(max: number): number {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
}

// Cumulative spend, drawn by hand rather than with Recharts: four lines and a
// grid, and it has to stretch to whatever height the panel row settles at.
function SpendChart({
  days, actual, previous, budget, paceStart, forecast, today,
}: {
  days: number;
  /** Through today (or the whole month, for a past one). */
  actual: number[];
  previous: number[];
  budget: number;
  /** Where the pace line starts: bills already posted count from day one. */
  paceStart: number;
  forecast: number | null;
  /** Day of month the actual line ends on; 0 for a future month. */
  today: number;
}) {
  const top = Math.max(budget, forecast ?? 0, ...actual, ...previous, 1) * 1.08;
  const step = niceStep(top);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  const W = 600;
  const H = 200;
  const x = (day: number) => ((day - 1) / Math.max(days - 1, 1)) * W;
  const y = (v: number) => H - (v / top) * H;
  const yPct = (v: number) => `${(y(v) / H) * 100}%`;
  const line = (values: number[]) => values.map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  // Last month may be shorter or longer; stretch it onto this month's axis so
  // "by the same point" lines up.
  const prev = previous.map((v, i) => `${(((i) / Math.max(previous.length - 1, 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const end = actual.length ? actual[actual.length - 1] : 0;

  return (
    <div className="relative flex-1 min-h-[180px] ml-11 mr-3 mt-3 mb-6">
      {ticks.map(v => (
        <span key={v} className="absolute -left-11 w-9 text-right text-[10px] text-ink-muted -translate-y-1/2" style={{ top: yPct(v) }}>
          {compactMoney(v)}
        </span>
      ))}
      {[1, 15, days].map(d => (
        <span key={d} className="absolute -bottom-5 text-[10px] text-ink-muted -translate-x-1/2" style={{ left: `${(x(d) / W) * 100}%` }}>
          {String(d).padStart(2, '0')}
        </span>
      ))}
      {today > 0 && today < days && (
        <span className="absolute -bottom-5 text-[10px] text-accent-ink -translate-x-1/2 bg-surface px-0.5" style={{ left: `${(x(today) / W) * 100}%` }}>
          {String(today).padStart(2, '0')}
        </span>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible"
        role="img" aria-label={`Spending to date ${formatCurrency(end)} against a budget of ${formatCurrency(budget)}`}
      >
        {ticks.map(v => (
          <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--c-line-strong)' : 'var(--c-line)'} vectorEffect="non-scaling-stroke" />
        ))}
        {today > 0 && today < days && (
          <line x1={x(today)} x2={x(today)} y1="0" y2={H} stroke="var(--c-line-strong)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        )}
        {budget > 0 && (
          <>
            <line x1="0" x2={W} y1={y(budget)} y2={y(budget)} stroke="var(--c-negative)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2={W} y1={y(paceStart)} y2={y(budget)} stroke="var(--c-caution)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
          </>
        )}
        {previous.length > 0 && (
          <polyline points={prev} fill="none" stroke="var(--c-ink-muted)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
        )}
        {forecast !== null && today > 0 && (
          <line x1={x(today)} y1={y(end)} x2={W} y2={y(forecast)} stroke="var(--c-accent)" strokeWidth="1.25" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        )}
        {actual.length > 0 && (
          <polyline points={line(actual)} fill="none" stroke="var(--c-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {budget > 0 && (
        <span className="absolute right-0 text-[10px] text-negative -translate-y-full pb-0.5" style={{ top: yPct(budget) }}>
          BUDGET {compactMoney(budget)}
        </span>
      )}
    </div>
  );
}

function Swatch({ className, dashed = false }: { className: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block w-2.5 align-middle mr-1 ${dashed ? `h-0 border-t border-dashed ${className}` : `h-0.5 ${className}`}`}
    />
  );
}

/* ------------------------------------------------------------------------ */

type Tone = 'positive' | 'negative' | 'caution' | 'info' | 'accent';

const TAG_TONES: Record<Tone, string> = {
  positive: 'text-positive', negative: 'text-negative', caution: 'text-caution', info: 'text-info', accent: 'text-accent-ink',
};

interface Signal {
  key: string;
  tag: string;
  tone: Tone;
  text: React.ReactNode;
  go?: PageId;
}

/**
 * Where a budget should be by today.
 *
 * Bills that have already posted (rent on the 1st, a subscription) count in
 * full — nobody pays rent a thirtieth at a time — and only what is left of the
 * budget is spread across the month. Without this, Housing reads as "89% used
 * on day 6, running hot" every single month.
 */
function expectedByToday(item: BudgetStatus, fixed: number, elapsedPct: number): number {
  const posted = Math.min(fixed, item.effectiveBudget);
  return posted + Math.max(0, item.effectiveBudget - posted) * (elapsedPct / 100);
}

/** Hot when the discretionary part is well ahead of the calendar, warm when a bit ahead. */
function budgetFlag(
  item: BudgetStatus, fixed: number, elapsedPct: number, inProgress: boolean,
): { label: string; tone: Tone } | null {
  if (item.actual > item.effectiveBudget) return { label: 'OVER', tone: 'negative' };
  if (!inProgress || elapsedPct <= 0) return null;
  const room = item.effectiveBudget - Math.min(fixed, item.effectiveBudget);
  if (room <= 0) return null;
  const usedPct = (Math.max(0, item.actual - fixed) / room) * 100;
  const ratio = usedPct / elapsedPct;
  if (ratio >= 1.5 && usedPct >= 40) return { label: 'HOT', tone: 'negative' };
  if (ratio >= 1.2 && usedPct >= 25) return { label: 'WARM', tone: 'caution' };
  return null;
}

export default function Dashboard({ onQuickAdd, onNavigate }: DashboardProps) {
  const { state } = useFinancial();
  const taxonomy = useTaxonomy();
  const getCategory = useGetCategory();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const {
    transactions, budgets, incomes, savings_goals, investments, debts, recurringTemplates = [],
  } = state;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrent = month === now.getMonth() && year === now.getFullYear();
  const isFuture = new Date(year, month, 1) > now;
  const dayOfMonth = isCurrent ? now.getDate() : isFuture ? 0 : daysInMonth;
  const elapsedPct = (dayOfMonth / daysInMonth) * 100;
  const prevDate = new Date(year, month - 1, 1);

  const incomeSources = getIncomeSources(incomes, investments);
  const totalIncome = getTotalIncome(incomeSources);
  const savingsRate = getSavingsRate(incomeSources, transactions, month, year);
  const budgetStatuses = getBudgetStatus(budgets, transactions, month, year, taxonomy).filter(b => b.budget > 0);
  const budgetTotal = budgetStatuses.reduce((s, b) => s + b.effectiveBudget, 0);
  const owed = getOwedSummary(transactions);
  const monthTx = getTransactionsForPeriod(transactions, month, year);

  const cumulative = useMemo(() => cumulativeByDay(transactions, month, year), [transactions, month, year]);
  const previous = useMemo(
    () => cumulativeByDay(transactions, prevDate.getMonth(), prevDate.getFullYear()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, month, year],
  );
  const actual = cumulative.slice(0, dayOfMonth);
  const spent = cumulative[daysInMonth - 1] ?? 0;
  const spentToDate = actual.length ? actual[actual.length - 1] : 0;
  const prevAtSameDay = dayOfMonth > 0 ? previous[Math.min(dayOfMonth, previous.length) - 1] ?? 0 : 0;
  const vsPrev = prevAtSameDay > 0 ? ((spentToDate - prevAtSameDay) / prevAtSameDay) * 100 : null;

  // Bills already posted this month, rolled into the same rows the budgets
  // use, so pace can treat them as due on the day they landed.
  const fixedByRow = useMemo(() => {
    const billIds = detectIrregularExpenses(transactions, { recurringTemplates }).billTransactionIds;
    const raw: Record<string, number> = {};
    getTransactionsForPeriod(transactions, month, year)
      .filter(t => isFixedTransaction(t, recurringTemplates, billIds))
      .forEach(t => { raw[t.category] = (raw[t.category] || 0) + t.amount; });
    return rollUp(raw, taxonomy.categories, taxonomy.parentOverrides);
  }, [transactions, recurringTemplates, month, year, taxonomy]);
  const fixedFor = (item: BudgetStatus): number => fixedByRow[item.category] || 0;
  const fixedTotal = budgetStatuses.reduce((s, b) => s + Math.min(fixedFor(b), b.effectiveBudget), 0);
  const pace = budgetStatuses.reduce((s, b) => s + expectedByToday(b, fixedFor(b), elapsedPct), 0);

  // The month-end projection only means something for the month in progress.
  const projection = useMemo(
    () => (isCurrent ? projectMonthEnd({ transactions, budgets, recurringTemplates, taxonomy }) : null),
    [isCurrent, transactions, budgets, recurringTemplates, taxonomy],
  );
  const forecast = projection ? projection.totals.projected : null;

  const investmentsValue = getInvestmentsValue(investments);
  const goalsValue = savings_goals.reduce((s, g) => s + g.currentAmount, 0);
  const debtsValue = debts.reduce((s, d) => s + d.balance, 0);
  const netWorth = investmentsValue + goalsValue - debtsValue;
  const health = useMemo(() => getFinancialHealth(state), [state]);

  const dismissed = state.settings?.dismissedDuplicates || NONE;
  const duplicates = useMemo(() => detectDuplicateCharges(transactions, { dismissed }), [transactions, dismissed]);
  const anomalies = detectAnomalies(transactions, month, year);

  const recent = [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);

  // What is coming in and going out over the next fortnight, from the
  // recurring charges and the pay schedule. Always from today.
  const upcoming = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = addDays(start, 14);
    const from = format(start, 'yyyy-MM-dd');
    const to = format(end, 'yyyy-MM-dd');
    const rows: { key: string; date: string; name: string; amount: number }[] = [];
    recurringTemplates.filter(t => t.active !== false).forEach(t => {
      templateOccurrences(t, from, to).forEach(d => rows.push({ key: `${t.id}-${d}`, date: d, name: t.merchant, amount: -t.amount }));
    });
    incomeSources.forEach(inc => {
      if (!inc.date) return;
      paydaysBetween(inc, inc.date, start, end).forEach(d => rows.push({
        key: `${inc.id}-${d}`, date: d, name: inc.name || inc.source || 'Income', amount: inc.amount,
      }));
    });
    return rows.sort((a, b) => a.date.localeCompare(b.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurringTemplates, incomes, investments]);
  const upcomingNet = upcoming.reduce((s, r) => s + r.amount, 0);

  // Everything that wants attention, most consequential first.
  const signals: Signal[] = [];
  const today = new Date();
  const dueCount = recurringTemplates.filter(t => isTemplateDue(t, format(today, 'yyyy-MM-dd'))).length;
  if (projection && forecast !== null && budgetTotal > 0) {
    const diff = forecast - budgetTotal;
    signals.push(diff > 0
      ? { key: 'fcst', tag: 'FCST', tone: 'negative', go: 'analytics', text: <>Month-end forecast {formatCurrency(forecast)}, which is {formatCurrency(diff)} over the {formatCurrency(budgetTotal)} budget.</> }
      : { key: 'fcst', tag: 'FCST', tone: 'positive', go: 'analytics', text: <>Month-end forecast {formatCurrency(forecast)}, {formatCurrency(-diff)} under budget.</> });
  }
  budgetStatuses.filter(b => b.actual > b.effectiveBudget).forEach(b => signals.push({
    key: `over-${b.category}`, tag: 'OVER', tone: 'negative', go: 'budget',
    text: <>{getCategory(b.category).name} is {formatCurrency(b.actual - b.effectiveBudget)} over its {formatCurrency(b.effectiveBudget)} budget.</>,
  }));
  (projection?.warnings ?? [])
    .filter(w => w.budget && !budgetStatuses.some(b => b.category === w.category && b.actual > b.effectiveBudget))
    .slice(0, 3)
    .forEach(w => signals.push({
      key: `pace-${w.category}`, tag: 'PACE', tone: 'caution', go: 'budget',
      text: <>{getCategory(w.category).name} is heading for {formatCurrency(w.projected)} against {formatCurrency(w.budget ?? 0)}.</>,
    }));
  anomalies.forEach(a => signals.push({
    key: `spike-${a.category}`, tag: 'SPIKE', tone: 'caution', go: 'analytics',
    text: <>{getCategory(a.category).name}: {a.message}</>,
  }));
  duplicates.slice(0, 2).forEach(d => signals.push({
    key: `dup-${d.key}`, tag: 'DUP?', tone: 'info', go: 'analytics',
    text: <>{d.merchant} {formatCurrency(d.amount)} charged twice{d.daysApart === 0 ? ' on the same day' : `, ${d.daysApart} day${d.daysApart > 1 ? 's' : ''} apart`} ({format(new Date(`${d.second.date.slice(0, 10)}T00:00:00`), 'MMM d')}).</>,
  }));
  if (owed.outstanding > 0) {
    signals.push({
      key: 'owed', tag: 'OWED', tone: 'accent', go: 'owed',
      text: <>{formatCurrency(owed.outstanding)} still owed to you across {owed.openCount} purchase{owed.openCount > 1 ? 's' : ''}{owed.open[0]?.ageDays >= 30 ? <>; the oldest since {format(new Date(`${owed.oldestOpenDate}T00:00:00`), 'MMM d')}</> : null}.</>,
    });
  }
  if (dueCount > 0) {
    signals.push({
      key: 'due', tag: 'DUE', tone: 'caution', go: 'recurring',
      text: <>{dueCount} recurring charge{dueCount > 1 ? 's are' : ' is'} due to post.</>,
    });
  }

  const changeMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  };

  const monthCode = format(new Date(year, month, 1), 'MMM yyyy').toUpperCase();
  const prevCode = format(prevDate, 'MMM').toUpperCase();
  const toneFor = (v: number) => (v > 0 ? 'text-negative' : v < 0 ? 'text-positive' : 'text-ink-muted');

  return (
    <div className="animate-fade-in space-y-2">
      {/* Period bar */}
      <div className="flex flex-wrap items-center gap-3 text-caption text-ink-muted">
        <div className="flex items-center border border-line-strong bg-surface">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => changeMonth(-1)} className="rounded-none" />
          <span className="px-2.5 h-6 leading-6 border-x border-line-strong text-sm font-medium text-ink tracking-[0.06em] min-w-[96px] text-center">{monthCode}</span>
          <IconButton icon={ChevronRight} label="Next month" onClick={() => changeMonth(1)} className="rounded-none" />
        </div>
        <span>
          {isCurrent ? `DAY ${dayOfMonth} / ${daysInMonth} · ${elapsedPct.toFixed(1)}% ELAPSED` : isFuture ? 'NOT STARTED' : 'CLOSED MONTH'}
        </span>
        {!isCurrent && (
          <button onClick={() => { setMonth(now.getMonth()); setYear(now.getFullYear()); }} className="text-accent-ink hover:underline">
            BACK TO {format(now, 'MMM yyyy').toUpperCase()}
          </button>
        )}
      </div>

      <PanelGrid className="grid-flow-row-dense">
        {/* Month */}
        <Panel title="Month" meta={isCurrent ? 'MTD' : monthCode} className="col-span-12 md:col-span-5 xl:col-span-3">
          <KeyValue
            label="Spent this month"
            strong
            delta={vsPrev === null ? undefined : `${pct(vsPrev)} VS ${prevCode}`}
            deltaClassName={vsPrev === null ? undefined : toneFor(vsPrev)}
          >
            <Money value={spent} size="sm" />
          </KeyValue>
          <KeyValue label="Budget" delta={budgetTotal > 0 ? `${((spent / budgetTotal) * 100).toFixed(1)}% USED` : 'NOT SET'}>
            <Money value={budgetTotal} size="sm" />
          </KeyValue>
          {isCurrent && budgetTotal > 0 && (
            <KeyValue label={`Pace (day ${dayOfMonth})`} delta={signedMoney(spentToDate - pace)} deltaClassName={toneFor(spentToDate - pace)}
              title="Bills already posted, plus the rest of the budget spread evenly across the month">
              <Money value={pace} size="sm" />
            </KeyValue>
          )}
          {forecast !== null && (
            <KeyValue
              label="Forecast"
              delta={budgetTotal > 0 ? `${signedMoney(forecast - budgetTotal)}` : projection?.confidence.toUpperCase()}
              deltaClassName={budgetTotal > 0 ? toneFor(forecast - budgetTotal) : 'text-ink-muted'}
              title={projection ? `${projection.confidence} confidence · ${projection.historyMonths} months of history` : undefined}
            >
              <Money value={forecast} size="sm" />
            </KeyValue>
          )}
          <KeyValue label="Income" delta="MONTHLY"><Money value={totalIncome} size="sm" /></KeyValue>
          <KeyValue label="Save rate" delta={savingsRate < 0 ? 'NEGATIVE' : ''} deltaClassName="text-negative">
            {savingsRate.toFixed(1)}%
          </KeyValue>
          {owed.outstanding > 0 && (
            <KeyValue label="Owed to me" delta={`${owed.openCount} OPEN`} deltaClassName="text-caution">
              <Money value={owed.outstanding} size="sm" />
            </KeyValue>
          )}
          <KeyValue label="Transactions" delta={monthTx.length ? `AVG ${formatCurrency(spent / monthTx.length)}` : ''}>
            {monthTx.length}
          </KeyValue>
        </Panel>

        {/* Spend over time */}
        <Panel
          title="Cumulative spend"
          className="col-span-12 md:col-span-7 xl:col-span-6"
          bodyClassName="flex flex-col"
          meta={(
            <span className="flex gap-3">
              <span><Swatch className="bg-accent" />{format(new Date(year, month, 1), 'MMM')}</span>
              {forecast !== null && <span><Swatch className="border-accent" dashed />FCST</span>}
              {budgetTotal > 0 && <span><Swatch className="bg-caution" />BUDGET PACE</span>}
              <span><Swatch className="bg-ink-muted" />{prevCode}</span>
            </span>
          )}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border-b border-line">
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Spent</p>
              <Money value={spentToDate} size="lg" className="block mt-0.5" />
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">vs pace</p>
              <p className={`text-xl font-medium mt-0.5 ${budgetTotal > 0 && dayOfMonth > 0 ? toneFor(spentToDate - pace) : 'text-ink-muted'}`}>
                {budgetTotal > 0 && dayOfMonth > 0 ? signedMoney(spentToDate - pace) : '—'}
              </p>
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">vs {prevCode} day {Math.max(dayOfMonth, 1)}</p>
              <p className={`text-xl font-medium mt-0.5 ${vsPrev === null ? 'text-ink-muted' : toneFor(vsPrev)}`}>
                {vsPrev === null ? '—' : pct(vsPrev)}
              </p>
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Forecast</p>
              {forecast !== null
                ? <Money value={forecast} size="lg" className="block mt-0.5" />
                : <p className="text-xl font-medium mt-0.5 text-ink-muted">—</p>}
            </div>
          </div>
          <SpendChart
            days={daysInMonth}
            actual={actual}
            previous={previous}
            budget={budgetTotal}
            paceStart={isCurrent ? fixedTotal : 0}
            forecast={forecast}
            today={dayOfMonth}
          />
        </Panel>

        {/* Net worth */}
        <Panel title="Net worth" meta={`${investments.length} ACCT · ${debts.length} DEBT`} className="col-span-12 md:col-span-5 xl:col-span-3">
          <div className="px-2.5 py-2 border-b border-line">
            <Money value={netWorth} size="lg" className={netWorth < 0 ? 'text-negative' : ''} />
            <p className="text-caption text-ink-muted mt-0.5">
              ASSETS <Money value={investmentsValue + goalsValue} size="caption" className="text-ink-secondary" /> · LIAB <Money value={debtsValue} size="caption" className="text-ink-secondary" />
            </p>
          </div>
          {[
            { label: 'Investments', value: investmentsValue, bar: 'bg-info' },
            { label: 'Savings goals', value: goalsValue, bar: 'bg-positive' },
            { label: 'Debts', value: -debtsValue, bar: 'bg-negative' },
          ].map(r => (
            <KeyValue
              key={r.label}
              label={<><span className={`inline-block w-[7px] h-[7px] mr-2 ${r.bar}`} aria-hidden="true" />{r.label}</>}
              delta={netWorth !== 0 ? `${((r.value / Math.abs(netWorth)) * 100).toFixed(1)}%` : ''}
            >
              <Money value={r.value} size="sm" className={r.value < 0 ? 'text-negative' : ''} />
            </KeyValue>
          ))}
          {investmentsValue + goalsValue + debtsValue > 0 && (
            <div className="flex h-1.5 gap-px m-2.5" role="presentation">
              <span className="bg-info" style={{ flex: investmentsValue }} />
              <span className="bg-positive" style={{ flex: goalsValue }} />
              <span className="bg-negative" style={{ flex: debtsValue }} />
            </div>
          )}
        </Panel>

        {/* Budgets */}
        <Panel
          title="Budgets"
          meta={budgetStatuses.length
            ? `${budgetStatuses.filter(b => !budgetFlag(b, fixedFor(b), elapsedPct, isCurrent)).length} / ${budgetStatuses.length} ON PACE${isCurrent ? ' · TICK = WHERE YOU SHOULD BE' : ''}`
            : undefined}
          actions={onNavigate && <Button size="sm" variant="ghost" onClick={() => onNavigate('budget')}>Manage</Button>}
          className="col-span-12 xl:col-span-7"
        >
          {budgetStatuses.length === 0 ? (
            <p className="font-sans text-sm text-ink-muted p-3">No budgets set yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="label-micro text-left">
                    <th scope="col" className="font-medium h-[22px] px-2.5 border-b border-line">Category</th>
                    <th scope="col" className="font-medium px-2.5 border-b border-line text-right">Spent</th>
                    <th scope="col" className="font-medium px-2.5 border-b border-line text-right">Budget</th>
                    <th scope="col" className="font-medium px-2.5 border-b border-line text-right">Used</th>
                    <th scope="col" className="font-medium px-2.5 border-b border-line text-right">Left</th>
                    <th scope="col" className="font-medium px-2.5 border-b border-line w-[30%]">Progress</th>
                    <th scope="col" className="border-b border-line w-12"><span className="sr-only">Status</span></th>
                  </tr>
                </thead>
                <tbody>
                  {budgetStatuses.map(item => {
                    const cat = getCategory(item.category);
                    const flag = budgetFlag(item, fixedFor(item), elapsedPct, isCurrent);
                    return (
                      <tr key={item.category} className="hover:bg-surface-hover">
                        <td className="h-row px-2.5 border-b border-line text-ink-secondary">
                          <CategoryMark color={cat.color} name={cat.name} />
                        </td>
                        <td className="px-2.5 border-b border-line text-right"><Money value={item.actual} size="sm" /></td>
                        <td className="px-2.5 border-b border-line text-right"><Money value={item.effectiveBudget} size="sm" className="text-ink-muted" /></td>
                        <td className={`px-2.5 border-b border-line text-right ${flag ? TAG_TONES[flag.tone] : 'text-ink'}`}>{item.percentUsed.toFixed(0)}%</td>
                        <td className="px-2.5 border-b border-line text-right">
                          <Money value={item.variance} size="sm" className={item.variance < 0 ? 'text-negative' : ''} />
                        </td>
                        <td className="px-2.5 border-b border-line">
                          <Meter
                            value={item.actual}
                            max={item.effectiveBudget}
                            tone={flag?.tone === 'caution' ? 'caution' : flag ? 'negative' : 'accent'}
                            marker={isCurrent && item.effectiveBudget > 0
                              ? (expectedByToday(item, fixedFor(item), elapsedPct) / item.effectiveBudget) * 100
                              : undefined}
                          />
                        </td>
                        <td className={`px-2.5 border-b border-line text-[10px] tracking-[0.06em] ${flag ? TAG_TONES[flag.tone] : ''}`}>{flag?.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="h-row px-2.5">TOTAL</td>
                    <td className="px-2.5 text-right"><Money value={budgetStatuses.reduce((s, b) => s + b.actual, 0)} size="sm" /></td>
                    <td className="px-2.5 text-right"><Money value={budgetTotal} size="sm" className="text-ink-muted" /></td>
                    <td className="px-2.5 text-right">{budgetTotal > 0 ? ((budgetStatuses.reduce((s, b) => s + b.actual, 0) / budgetTotal) * 100).toFixed(0) : 0}%</td>
                    <td className="px-2.5 text-right"><Money value={budgetStatuses.reduce((s, b) => s + b.variance, 0)} size="sm" /></td>
                    <td className="px-2.5">
                      <Meter value={budgetStatuses.reduce((s, b) => s + b.actual, 0)} max={budgetTotal} tone="neutral" marker={isCurrent && budgetTotal > 0 ? (pace / budgetTotal) * 100 : undefined} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Panel>

        {/* Signals */}
        <Panel title="Signals" meta={`${signals.length} ACTIVE`} className="col-span-12 md:col-span-7 xl:col-span-5">
          {signals.length === 0 ? (
            <p className="font-sans text-sm text-ink-muted p-3">Nothing needs your attention.</p>
          ) : (
            <ul>
              {signals.map(s => {
                const body = (
                  <>
                    <span className={`shrink-0 w-12 text-center border border-current text-[10px] leading-[14px] tracking-[0.06em] mt-px ${TAG_TONES[s.tone]}`}>{s.tag}</span>
                    <span className="font-sans text-[12.5px] leading-snug text-ink">{s.text}</span>
                  </>
                );
                return (
                  <li key={s.key} className="border-b border-line last:border-b-0">
                    {s.go && onNavigate ? (
                      <button onClick={() => onNavigate(s.go as PageId)} className="w-full flex items-start gap-2.5 px-2.5 py-1.5 text-left hover:bg-surface-hover">
                        {body}
                      </button>
                    ) : (
                      <div className="flex items-start gap-2.5 px-2.5 py-1.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Ledger */}
        <Panel
          title="Ledger"
          meta={`LAST ${recent.length} · ${monthTx.length} IN ${format(new Date(year, month, 1), 'MMM').toUpperCase()}`}
          actions={onNavigate && <Button size="sm" variant="ghost" onClick={() => onNavigate('transactions')}>View all</Button>}
          className="col-span-12 xl:col-span-6"
        >
          {recent.length === 0 ? (
            <p className="font-sans text-sm text-ink-muted p-3">
              Nothing recorded yet. <button onClick={onQuickAdd} className="text-accent-ink underline underline-offset-2">Add a transaction</button>.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="label-micro text-left">
                    <th scope="col" className="font-medium h-[22px] px-2.5 border-b border-line w-16">Date</th>
                    <th scope="col" className="font-medium px-2.5 border-b border-line">Merchant</th>
                    <th scope="col" className="font-medium px-2.5 border-b border-line hidden sm:table-cell">Category</th>
                    <th scope="col" className="font-medium px-2.5 border-b border-line text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map(t => {
                    const cat = getCategory(t.category);
                    const isSaving = t.kind === 'savings';
                    return (
                      <tr key={t.id} className="hover:bg-surface-hover">
                        <td className="h-row px-2.5 border-b border-line text-ink-muted">{format(new Date(`${t.date.slice(0, 10)}T00:00:00`), 'MM/dd')}</td>
                        <td className="px-2.5 border-b border-line text-ink max-w-0 w-full truncate">{t.merchant}</td>
                        <td className="px-2.5 border-b border-line text-ink-secondary hidden sm:table-cell whitespace-nowrap">
                          {/* A transfer to a goal isn't spending, whatever category it carries. */}
                          {isSaving
                            ? <CategoryMark color="var(--c-positive)" name="Savings" />
                            : <CategoryMark color={cat.color} name={cat.name} />}
                        </td>
                        <td className="px-2.5 border-b border-line text-right">
                          {isSaving
                            ? <Money value={t.amount} size="sm" signed className="text-positive" />
                            : <Money value={-t.amount} size="sm" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* Upcoming */}
        <Panel title="Upcoming" meta="NEXT 14D" className="col-span-12 md:col-span-6 xl:col-span-3">
          {upcoming.length === 0 ? (
            <p className="font-sans text-sm text-ink-muted p-3">No recurring charges or paydays in the next two weeks.</p>
          ) : (
            <>
              {upcoming.slice(0, 8).map(r => (
                <div key={r.key} className="flex items-center gap-2 h-row px-2.5 border-b border-line">
                  <span className="w-11 text-ink-muted">{format(new Date(`${r.date}T00:00:00`), 'MM/dd')}</span>
                  <span className="flex-1 min-w-0 truncate text-ink-secondary">{r.name}</span>
                  <Money value={r.amount} size="sm" signed className={r.amount > 0 ? 'text-positive' : ''} />
                </div>
              ))}
              {upcoming.length > 8 && <p className="px-2.5 h-row leading-6 text-caption text-ink-muted border-b border-line">+{upcoming.length - 8} MORE</p>}
              <KeyValue label="Net 14 days" strong>
                <Money value={upcomingNet} size="sm" signed colour />
              </KeyValue>
            </>
          )}
        </Panel>

        {/* Goals */}
        <Panel
          title="Goals"
          meta={savings_goals.length ? formatCurrency(goalsValue) : undefined}
          className="col-span-12 md:col-span-6 xl:col-span-3"
        >
          {savings_goals.length === 0 && <p className="font-sans text-sm text-ink-muted p-3">No goals set yet.</p>}
          {savings_goals.map(g => {
            const done = g.targetAmount > 0 ? Math.min((g.currentAmount / g.targetAmount) * 100, 100) : 0;
            return (
              <div key={g.id} className="px-2.5 py-1.5 border-b border-line">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 truncate text-caption uppercase tracking-[0.03em] text-ink">{g.name}</span>
                  <span className="text-ink-secondary">{done.toFixed(0)}%</span>
                </div>
                <Meter value={g.currentAmount} max={g.targetAmount} tone="positive" className="my-1" />
                <div className="flex justify-between text-caption text-ink-muted">
                  <span><Money value={g.currentAmount} size="caption" decimals={0} /> / <Money value={g.targetAmount} size="caption" decimals={0} /></span>
                  {g.targetDate && <span>BY {format(new Date(`${g.targetDate.slice(0, 10)}T00:00:00`), 'MMM yy').toUpperCase()}</span>}
                </div>
              </div>
            );
          })}
          <KeyValue label="Health score" strong>
            <span style={{ color: health.color }}>
              {health.score === null ? 'N/A' : `${Math.round(health.score)} ${health.label.toUpperCase()}`}
            </span>
          </KeyValue>
        </Panel>
      </PanelGrid>
    </div>
  );
}
