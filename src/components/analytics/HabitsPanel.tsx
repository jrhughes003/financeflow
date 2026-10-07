import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import * as chart from '../ui/chartTheme';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFinancial } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { getSpendingCalendar, getMonthRhythm, getPurchaseSizeBreakdown } from '../../utils/habits';
import { percentile } from '../../utils/planning';
import { Panel, PanelGrid, IconButton } from '../ui';

// Sequential single-hue ramp (light → dark) for daily spend.
const RAMP = ['var(--c-ramp-1)', 'var(--c-ramp-2)', 'var(--c-ramp-3)', 'var(--c-ramp-4)', 'var(--c-ramp-5)'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COUNT_COLOR = 'var(--c-ink-muted)';
const SPEND_COLOR = 'var(--c-data-1)';

/* A labelled figure as a ruled row, with its context on a second line. */
function StatRow({
  label, value, sub,
}: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="px-2.5 py-1.5 border-b border-line">
      <div className="flex items-baseline gap-2">
        <span className="flex-1 min-w-0 truncate text-caption uppercase tracking-[0.03em] text-ink-secondary">{label}</span>
        <span className="text-sm font-medium text-ink whitespace-nowrap">{value}</span>
      </div>
      {sub && <p className="text-caption text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}

export default function HabitsPanel() {
  const { state } = useFinancial();
  const { transactions, recurringTemplates = [] } = state;
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const changeMonth = (delta: number): void => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  };

  const cal = useMemo(
    () => getSpendingCalendar(transactions, month, year, { recurringTemplates }),
    [transactions, recurringTemplates, month, year],
  );
  const rhythm = useMemo(() => getMonthRhythm(transactions, { recurringTemplates }), [transactions, recurringTemplates]);
  const sizes = useMemo(() => getPurchaseSizeBreakdown(transactions), [transactions]);

  // Color steps from the quintiles of this month's spending days.
  const spendTotals = cal.days.filter(d => !d.future && d.total > 0).map(d => d.total);
  const cuts = [0.2, 0.4, 0.6, 0.8].map(p => percentile(spendTotals, p));
  const step = (total: number): string => RAMP[cuts.filter(c => total > c).length];
  const leading = cal.days[0].weekday;
  const isCurrentMonth = month === now.getMonth() && year === now.getFullYear();

  const big = sizes.buckets.filter(b => b.min >= 100);
  const bigCountPct = big.reduce((s, b) => s + b.countPct, 0);
  const bigSpendPct = big.reduce((s, b) => s + b.totalPct, 0);
  const small = sizes.buckets.filter(b => b.max !== null && b.max <= 25);
  const smallSpend = small.reduce((s, b) => s + b.total, 0);
  const smallCount = small.reduce((s, b) => s + b.count, 0);

  const early = rhythm.segments[0].perDay;
  const late = rhythm.segments[2].perDay;
  const streak = isCurrentMonth ? cal.currentStreak : cal.longestStreak;

  return (
    <PanelGrid className="grid-flow-row-dense">
      {/* Calendar */}
      <Panel
        title="Spending Calendar"
        meta="Everyday spending per day — scheduled bills and periodic charges aren't counted"
        className="col-span-12"
        actions={(
          <span className="flex items-center border border-line-strong bg-surface">
            <IconButton icon={ChevronLeft} label="Previous month" onClick={() => changeMonth(-1)} className="rounded-none !w-5 !h-[18px]" />
            <span className="px-1.5 h-[18px] leading-[18px] border-x border-line-strong text-micro uppercase tracking-[0.06em] text-ink min-w-[104px] text-center">{format(new Date(year, month, 1), 'MMMM yyyy')}</span>
            <IconButton icon={ChevronRight} label="Next month" onClick={() => changeMonth(1)} className="rounded-none !w-5 !h-[18px]" />
          </span>
        )}
      >
        {!cal.hasData ? (
          <p className="font-sans text-sm text-ink-muted p-3">No transactions recorded in {format(new Date(year, month, 1), 'MMMM yyyy')}.</p>
        ) : (
        <div className="grid lg:grid-cols-3 gap-px bg-line">
          <div className="lg:col-span-2 bg-surface p-3">
            <div className="grid grid-cols-7 gap-px text-center">
              {WEEKDAYS.map(w => <div key={w} className="label-micro pb-1">{w}</div>)}
              {Array.from({ length: leading }, (_, i) => <div key={`pad${i}`} />)}
              {cal.days.map(d => {
                const noSpend = !d.future && d.total === 0;
                const bg = d.future ? 'var(--c-surface-sunk)' : noSpend ? 'var(--c-surface)' : step(d.total);
                // Steps 1–3 carry --c-ink, 4–5 --c-ink-inverse (see tokens.css
                // and contrast.test.ts). Keep this flip at index 3.
                const dark = !d.future && !noSpend && RAMP.indexOf(bg) >= 3;
                const tip = d.future
                  ? format(parseISO(d.date), 'EEE MMM d')
                  : `${format(parseISO(d.date), 'EEE MMM d')}: ${noSpend ? 'no everyday spending' : `${formatCurrency(d.total)} across ${d.count} purchase${d.count > 1 ? 's' : ''}`}${d.fixedTotal ? ` (+${formatCurrency(d.fixedTotal)} bills)` : ''}`;
                return (
                  <div
                    key={d.date}
                    title={tip}
                    className={`h-11 flex flex-col items-center justify-center border ${noSpend ? 'border-positive' : 'border-transparent'} ${d.future ? 'border-dashed border-line-strong' : ''}`}
                    style={{ backgroundColor: bg }}
                  >
                    {/*
                      On a coloured cell the day number is de-emphasised by
                      weight, not by colour. It used to drop to ink-secondary
                      (and ink-inverse/80 on the deep steps), but a mid-grey on
                      a mid-green cannot clear 4.5:1 at any ramp value — the
                      two are the same lightness, which is what makes grey a
                      good colour on a surface and a useless one on a fill.
                      ink-muted still applies on the uncoloured cells.
                    */}
                    <span className={`text-micro ${d.future || noSpend ? 'text-ink-muted' : dark ? 'text-ink-inverse font-light' : 'text-ink font-light'}`}>{d.day}</span>
                    {noSpend
                      ? <Check className="w-3 h-3 text-positive" />
                      : !d.future && <span className={`text-caption font-semibold ${dark ? 'text-ink-inverse' : 'text-ink'}`}>${Math.round(d.total)}</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-micro uppercase tracking-[0.06em] text-ink-muted mt-2">
              <span className="flex items-center gap-1">Less {RAMP.map(c => <span key={c} className="w-2.5 h-2.5" style={{ backgroundColor: c }} />)} More</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 border border-positive bg-surface flex items-center justify-center"><Check className="w-2 h-2 text-positive" /></span>No-spend day</span>
            </div>
          </div>

          <div className="bg-surface">
            <StatRow label="No-spend days" value={`${cal.noSpendDays} of ${cal.elapsedDays}`} sub={isCurrentMonth ? 'so far this month' : null} />
            <StatRow
              label={isCurrentMonth ? 'Current streak' : 'Longest streak'}
              value={`${streak} day${streak === 1 ? '' : 's'}`}
              sub={isCurrentMonth ? `Longest this month: ${cal.longestStreak}` : null}
            />
            <StatRow label="Average spending day" value={formatCurrency(cal.avgPerSpendDay)} sub={`${cal.spendDays} days with purchases`} />
            <StatRow
              label="Biggest day"
              value={cal.biggestDay ? formatCurrency(cal.biggestDay.total) : '—'}
              sub={cal.biggestDay ? format(parseISO(cal.biggestDay.date), 'EEEE, MMM d') : null}
            />
          </div>
        </div>
        )}
      </Panel>

      {/* Month rhythm */}
      <Panel
        title="Month Rhythm"
        meta={`Average everyday spending per day${rhythm.months ? `, last ${rhythm.months} month${rhythm.months > 1 ? 's' : ''}` : ''}`}
        className="col-span-12 lg:col-span-6"
      >
        {rhythm.months === 0 ? (
          <p className="font-sans text-sm text-ink-muted p-3">Needs at least one full month of history.</p>
        ) : (
          <>
            <p className="font-sans text-sm text-ink-secondary px-2.5 py-1.5 border-b border-line">
              {rhythm.earlyVsLatePct === null || Math.abs(rhythm.earlyVsLatePct) < 15
                ? 'Your spending is fairly even across the month.'
                : rhythm.earlyVsLatePct > 0
                  ? <>You spend <span className="font-semibold">{rhythm.earlyVsLatePct}% more per day</span> in the first 10 days than at the end of the month — a common "just got paid" pattern.</>
                  : <>You spend <span className="font-semibold">{Math.abs(rhythm.earlyVsLatePct)}% more per day</span> at the end of the month than in the first 10 days.</>}
            </p>
            <div className="p-3">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={rhythm.segments} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid {...chart.grid} />
                  <XAxis dataKey="label" {...chart.xAxis} />
                  <YAxis {...chart.yAxis} tickFormatter={chart.compactMoney} />
                  <Tooltip {...chart.tooltip} formatter={v => [`${formatCurrency(chart.asNumber(v))}/day`, 'Average']} />
                  <Bar dataKey="perDay" fill={SPEND_COLOR} barSize={48} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {early > 0 && late > 0 && (rhythm.earlyVsLatePct ?? 0) > 15 && (
              <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-t border-line">
                If the first 10 days matched your late-month pace, you'd spend about {formatCurrency((early - late) * 10)} less a month.
              </p>
            )}
          </>
        )}
      </Panel>

      {/* Purchase sizes */}
      <Panel
        title="Purchase Sizes"
        meta={`Last ${sizes.days} days · ${sizes.count} purchases · ${formatCurrency(sizes.total)}`}
        className="col-span-12 lg:col-span-6"
      >
        {sizes.count === 0 ? (
          <p className="font-sans text-sm text-ink-muted p-3">No purchases in the last {sizes.days} days.</p>
        ) : (
          <>
            <p className="font-sans text-sm text-ink-secondary px-2.5 py-1.5 border-b border-line">
              {bigSpendPct >= 40
                ? <>Big purchases ($100+) are only <span className="font-semibold">{bigCountPct}%</span> of transactions but <span className="font-semibold">{bigSpendPct}%</span> of spending — pausing before large buys matters most.</>
                : <>Purchases under $25 add up: <span className="font-semibold">{smallCount}</span> of them totalled <span className="font-semibold">{formatCurrency(smallSpend)}</span>.</>}
            </p>
            <div className="p-3">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={sizes.buckets} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid {...chart.grid} />
                  <XAxis dataKey="label" {...chart.xAxis} />
                  <YAxis {...chart.yAxis} tickFormatter={v => `${v}%`} />
                  <Tooltip
                    {...chart.tooltip}
                    formatter={(v, name, { payload }) => [
                      name === 'Share of purchases' ? `${v}% (${payload.count})` : `${v}% (${formatCurrency(payload.total)})`,
                      name,
                    ]}
                  />
                  <Legend iconType="square" iconSize={7} wrapperStyle={{ fontSize: 10.5, fontFamily: 'var(--font-numeric)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 6 }} />
                  <Bar dataKey="countPct" name="Share of purchases" fill={COUNT_COLOR} isAnimationActive={false} />
                  <Bar dataKey="totalPct" name="Share of spending" fill={SPEND_COLOR} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Panel>
    </PanelGrid>
  );
}
