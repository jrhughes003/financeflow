import type { LucideIcon } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import * as chart from '../ui/chartTheme';
import { Flame, Check } from 'lucide-react';
import { useFinancial } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { getSpendingCalendar, getMonthRhythm, getPurchaseSizeBreakdown } from '../../utils/habits';
import { percentile } from '../../utils/planning';

// Sequential single-hue ramp (light → dark) for daily spend.
const RAMP = ['#dbeafe', '#93c5fd', '#60a5fa', 'var(--c-data-1)', '#1d4ed8'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COUNT_COLOR = 'var(--c-ink-muted)';
const SPEND_COLOR = 'var(--c-data-1)';

function Stat({
  label, value, sub, icon: Icon,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="bg-surface-sunk rounded-container p-3">
      <p className="text-caption text-ink-muted flex items-center gap-1">{Icon && <Icon className="w-3.5 h-3.5" />}{label}</p>
      <p className="text-lg font-bold text-ink">{value}</p>
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

  return (
    <div className="space-y-5">
      {/* Calendar */}
      <div className="bg-surface rounded-container border border-line p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Spending Calendar</h2>
            <p className="text-caption text-ink-muted mt-0.5">Everyday spending per day — scheduled bills and periodic charges aren't counted</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => changeMonth(-1)} className="p-1.5 rounded-control hover:bg-surface-hover text-ink-secondary">‹</button>
            <span className="font-semibold text-ink-secondary text-sm min-w-28 text-center">{format(new Date(year, month, 1), 'MMMM yyyy')}</span>
            <button onClick={() => changeMonth(1)} className="p-1.5 rounded-control hover:bg-surface-hover text-ink-secondary">›</button>
          </div>
        </div>

        {!cal.hasData ? (
          <p className="text-sm text-ink-muted text-center py-10">No transactions recorded in {format(new Date(year, month, 1), 'MMMM yyyy')}.</p>
        ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="grid grid-cols-7 gap-1.5 text-center">
              {WEEKDAYS.map(w => <div key={w} className="text-caption text-ink-muted pb-1">{w}</div>)}
              {Array.from({ length: leading }, (_, i) => <div key={`pad${i}`} />)}
              {cal.days.map(d => {
                const noSpend = !d.future && d.total === 0;
                const bg = d.future ? '#f8fafc' : noSpend ? '#ffffff' : step(d.total);
                const dark = !d.future && !noSpend && RAMP.indexOf(bg) >= 3;
                const tip = d.future
                  ? format(parseISO(d.date), 'EEE MMM d')
                  : `${format(parseISO(d.date), 'EEE MMM d')}: ${noSpend ? 'no everyday spending' : `${formatCurrency(d.total)} across ${d.count} purchase${d.count > 1 ? 's' : ''}`}${d.fixedTotal ? ` (+${formatCurrency(d.fixedTotal)} bills)` : ''}`;
                return (
                  <div
                    key={d.date}
                    title={tip}
                    className={`rounded-control h-14 flex flex-col items-center justify-center border ${noSpend ? 'border-positive' : 'border-transparent'} ${d.future ? 'border-dashed border-line-strong' : ''}`}
                    style={{ backgroundColor: bg }}
                  >
                    <span className={`text-caption ${dark ? 'text-ink-inverse/80' : d.future || noSpend ? 'text-ink-muted' : 'text-ink-secondary'}`}>{d.day}</span>
                    {noSpend
                      ? <Check className="w-3.5 h-3.5 text-positive" />
                      : !d.future && <span className={`text-caption font-semibold ${dark ? 'text-ink-inverse' : 'text-ink'}`}>${Math.round(d.total)}</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-caption text-ink-muted mt-3">
              <span className="flex items-center gap-1">Less {RAMP.map(c => <span key={c} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />)} More</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border border-positive bg-surface flex items-center justify-center"><Check className="w-2.5 h-2.5 text-positive" /></span>No-spend day</span>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 content-start">
            <Stat label="No-spend days" value={`${cal.noSpendDays} of ${cal.elapsedDays}`} sub={isCurrentMonth ? 'so far this month' : null} />
            <Stat
              icon={Flame}
              label={isCurrentMonth ? 'Current streak' : 'Longest streak'}
              value={`${isCurrentMonth ? cal.currentStreak : cal.longestStreak} day${(isCurrentMonth ? cal.currentStreak : cal.longestStreak) === 1 ? '' : 's'}`}
              sub={isCurrentMonth ? `Longest this month: ${cal.longestStreak}` : null}
            />
            <Stat label="Average spending day" value={formatCurrency(cal.avgPerSpendDay)} sub={`${cal.spendDays} days with purchases`} />
            <Stat
              label="Biggest day"
              value={cal.biggestDay ? formatCurrency(cal.biggestDay.total) : '—'}
              sub={cal.biggestDay ? format(parseISO(cal.biggestDay.date), 'EEEE, MMM d') : null}
            />
          </div>
        </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Month rhythm */}
        <div className="bg-surface rounded-container border border-line p-5">
          <h2 className="text-lg font-semibold text-ink">Month Rhythm</h2>
          <p className="text-caption text-ink-muted mt-0.5 mb-3">Average everyday spending per day{rhythm.months ? `, last ${rhythm.months} month${rhythm.months > 1 ? 's' : ''}` : ''}</p>
          {rhythm.months === 0 ? (
            <p className="text-sm text-ink-muted text-center py-8">Needs at least one full month of history.</p>
          ) : (
            <>
              <p className="text-sm text-ink-secondary mb-3">
                {rhythm.earlyVsLatePct === null || Math.abs(rhythm.earlyVsLatePct) < 15
                  ? 'Your spending is fairly even across the month.'
                  : rhythm.earlyVsLatePct > 0
                    ? <>You spend <span className="font-semibold">{rhythm.earlyVsLatePct}% more per day</span> in the first 10 days than at the end of the month — a common "just got paid" pattern.</>
                    : <>You spend <span className="font-semibold">{Math.abs(rhythm.earlyVsLatePct)}% more per day</span> at the end of the month than in the first 10 days.</>}
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={rhythm.segments} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid {...chart.grid} />
                  <XAxis dataKey="label" {...chart.xAxis} tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <Tooltip cursor={{ fill: 'var(--c-surface-hover)' }} formatter={v => [`${formatCurrency(chart.asNumber(v))}/day`, 'Average']} />
                  <Bar dataKey="perDay" fill={SPEND_COLOR} radius={[4, 4, 0, 0]} barSize={48} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
              {early > 0 && late > 0 && (rhythm.earlyVsLatePct ?? 0) > 15 && (
                <p className="text-caption text-ink-muted mt-2">
                  If the first 10 days matched your late-month pace, you'd spend about {formatCurrency((early - late) * 10)} less a month.
                </p>
              )}
            </>
          )}
        </div>

        {/* Purchase sizes */}
        <div className="bg-surface rounded-container border border-line p-5">
          <h2 className="text-lg font-semibold text-ink">Purchase Sizes</h2>
          <p className="text-caption text-ink-muted mt-0.5 mb-3">Last {sizes.days} days · {sizes.count} purchases · {formatCurrency(sizes.total)}</p>
          {sizes.count === 0 ? (
            <p className="text-sm text-ink-muted text-center py-8">No purchases in the last {sizes.days} days.</p>
          ) : (
            <>
              <p className="text-sm text-ink-secondary mb-3">
                {bigSpendPct >= 40
                  ? <>Big purchases ($100+) are only <span className="font-semibold">{bigCountPct}%</span> of transactions but <span className="font-semibold">{bigSpendPct}%</span> of spending — pausing before large buys matters most.</>
                  : <>Purchases under $25 add up: <span className="font-semibold">{smallCount}</span> of them totalled <span className="font-semibold">{formatCurrency(smallSpend)}</span>.</>}
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={sizes.buckets} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid {...chart.grid} />
                  <XAxis dataKey="label" {...chart.xAxis} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                  <Tooltip
                    cursor={{ fill: 'var(--c-surface-hover)' }}
                    formatter={(v, name, { payload }) => [
                      name === 'Share of purchases' ? `${v}% (${payload.count})` : `${v}% (${formatCurrency(payload.total)})`,
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="countPct" name="Share of purchases" fill={COUNT_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="totalPct" name="Share of spending" fill={SPEND_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
