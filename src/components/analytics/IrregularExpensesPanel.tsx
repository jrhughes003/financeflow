import * as chart from '../ui/chartTheme';
import type { TooltipProps } from 'recharts';
import React, { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useFinancial, useGetCategory } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { detectIrregularExpenses } from '../../utils/insights';
import { Panel, Badge, CategoryMark } from '../ui';

const BILL_COLOR = 'var(--c-data-1)';
const SEASON_COLOR = 'var(--c-caution)';
const FREQ: Record<string, string> = { quarterly: 'Every 3 months', semiannual: 'Every 6 months', annual: 'Yearly' };
const fmt = (d: string): string => format(parseISO(d), 'MMM d, yyyy');

const TH = 'font-medium h-[22px] px-2.5 border-b border-line bg-surface-sunk whitespace-nowrap';
const TD = 'h-row px-2.5 border-b border-line';

/** One month of the calendar series, as built below. */
type CalendarMonth = {
  label: string;
  bills: { id: string; date: string; merchant: string; amount: number }[];
  seasonal: { id: string; categoryName: string; expectedExtra: number }[];
};

function CalendarTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload as CalendarMonth;
  if (!m.bills.length && !m.seasonal.length) return null;
  return (
    <div className="bg-surface border border-line shadow-overlay px-2 py-1.5 text-caption space-y-0.5 max-w-64">
      <p className="label-micro mb-1">{m.label}</p>
      {m.bills.map((b: CalendarMonth['bills'][number]) => <p key={b.id + b.date} className="text-ink-secondary">{b.merchant}: {formatCurrency(b.amount)}</p>)}
      {m.seasonal.map((s: CalendarMonth['seasonal'][number]) => <p key={s.id} className="text-ink-secondary">{s.categoryName} (seasonal): +{formatCurrency(s.expectedExtra)}</p>)}
    </div>
  );
}

// Quarterly/semiannual/annual bills and seasonal spikes, with a 12-month view
// and how much to set aside so they don't land as surprises.
export default function IrregularExpensesPanel({ className = 'col-span-12' }: { className?: string }) {
  const { state } = useFinancial();
  const { transactions, recurringTemplates = [] } = state;
  const getCategory = useGetCategory();
  const irr = useMemo(() => detectIrregularExpenses(transactions, { recurringTemplates }), [transactions, recurringTemplates]);

  const hasAny = irr.bills.length > 0 || irr.seasonal.length > 0;
  const series = irr.calendar.map(m => ({
    ...m,
    seasonal: m.seasonal.map(s => ({ ...s, categoryName: getCategory(s.category).name })),
  }));
  const yearTotal = irr.calendar.reduce((s, m) => s + m.billTotal + m.seasonalTotal, 0);

  return (
    <Panel
      title="Irregular & Annual Expenses"
      meta={hasAny ? `${irr.bills.length} BILLS · ${irr.seasonal.length} SEASONAL` : undefined}
      className={className}
    >
      <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">Big charges that come back every few months or once a year, found in your history</p>

      {!hasAny ? (
        <p className="font-sans text-sm text-ink-muted p-3">
          None found yet. Charges show up here once they've repeated — annual bills need about a year of history.
        </p>
      ) : (
        <>
          <div className={`grid ${irr.bills.length > 0 ? 'grid-cols-2' : 'grid-cols-1'} gap-px bg-line border-b border-line`}>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Next 12 months</p>
              <p className="text-xl font-medium text-ink mt-0.5 money">{formatCurrency(yearTotal)}</p>
            </div>
            {irr.bills.length > 0 && (
              <div className="bg-surface px-2.5 py-1.5">
                <p className="label-micro">Set aside</p>
                <p className="text-xl font-medium text-ink mt-0.5 money">{formatCurrency(irr.monthlySetAside)}<span className="text-sm text-ink-muted">/mo</span></p>
                <p className="text-caption text-ink-muted mt-0.5">covers all of these long-term</p>
              </div>
            )}
          </div>
          <p className="font-sans text-sm text-ink-secondary px-2.5 py-1.5 border-b border-line">
            About <span className="font-semibold">{formatCurrency(yearTotal)}</span> of irregular spending is expected over the next 12 months.
            {irr.bills.length > 0 && ' These bills are already included in the cash-flow outlook below.'}
          </p>
          <div className="p-3 border-b border-line">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={series} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="label" {...chart.xAxis} tickFormatter={l => l.split(' ')[0]} />
                <YAxis {...chart.yAxis} tickFormatter={chart.compactMoney} />
                <Tooltip cursor={{ fill: 'var(--c-surface-hover)' }} content={<CalendarTooltip />} />
                <Legend iconType="square" iconSize={7} wrapperStyle={{ fontSize: 10.5, fontFamily: 'var(--font-numeric)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 6 }} />
                <Bar dataKey="billTotal" name="Periodic bills" stackId="a" fill={BILL_COLOR} stroke="var(--c-surface)" strokeWidth={1} isAnimationActive={false} />
                <Bar dataKey="seasonalTotal" name="Seasonal extra" stackId="a" fill={SEASON_COLOR} stroke="var(--c-surface)" strokeWidth={1} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {irr.bills.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="label-micro">
                    <th scope="col" className={`${TH} text-left`}>Bill</th>
                    <th scope="col" className={`${TH} text-left`}>Category</th>
                    <th scope="col" className={`${TH} text-left`}>How often</th>
                    <th scope="col" className={`${TH} text-right`}>Amount</th>
                    <th scope="col" className={`${TH} text-right`}>Next due</th>
                    <th scope="col" className={`${TH} text-right`}>Save to be ready</th>
                  </tr>
                </thead>
                <tbody>
                  {irr.bills.map(b => {
                    const cat = getCategory(b.category);
                    return (
                      <tr key={b.id} className="hover:bg-surface-hover">
                        <td className={`${TD} text-ink`}>{b.merchant}</td>
                        <td className={`${TD} text-ink-secondary`}>
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <CategoryMark color={cat.color} name={cat.name} />
                            <span className="text-caption text-ink-muted">· last paid {fmt(b.lastDate)}</span>
                          </span>
                        </td>
                        <td className={`${TD} text-ink-muted whitespace-nowrap`}>{FREQ[b.frequency]}</td>
                        <td className={`${TD} text-right text-ink whitespace-nowrap`}>{formatCurrency(b.amount)}</td>
                        <td className={`${TD} text-right whitespace-nowrap`}>
                          {b.overdue
                            ? <span className="inline-flex items-center gap-1.5 text-caution"><Badge tone="caution">Due</Badge>Due {fmt(b.nextDate)}</span>
                            : <span className="text-ink-secondary">{fmt(b.nextDate)}</span>}
                        </td>
                        <td className={`${TD} text-right text-ink-secondary whitespace-nowrap`}>
                          {b.monthsUntil <= 0 ? 'Due this month' : b.monthsUntil === 1 ? 'Due next month' : `${formatCurrency(b.setAsidePerMonth)}/mo for ${b.monthsUntil} mo`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {irr.seasonal.length > 0 && (
            <div>
              <p className="label-micro px-2.5 h-[22px] leading-[22px] bg-surface-sunk border-b border-line">Seasonal spikes</p>
              <ul>
                {irr.seasonal.map(s => (
                  <li key={s.id} className="flex items-start gap-2.5 px-2.5 py-1.5 border-b border-line last:border-b-0">
                    <Badge tone="caution" className="shrink-0 w-12 justify-center mt-px">Season</Badge>
                    <p className="font-sans text-[12.5px] leading-snug text-ink">
                      <span className="font-semibold">{getCategory(s.category).name}</span> has spiked every {s.label.split(' ')[0]} ({s.years} years running — last time {formatCurrency(s.lastYearTotal)} vs a usual {formatCurrency(s.typical)}).
                      {' '}Expect about <span className="font-semibold">{formatCurrency(s.expectedExtra)} extra</span> in {s.label}
                      {s.monthsUntil > 0 && <> — {formatCurrency(s.expectedExtra / s.monthsUntil)}/mo from now covers it</>}.
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
