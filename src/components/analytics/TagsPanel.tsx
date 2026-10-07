import type { PeriodPanelProps } from '../../types/navigation';
import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useGetCategory } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { getTagBreakdown } from '../../utils/habits';
import { Panel, Meter } from '../ui';

const fmt = (d: string): string => format(parseISO(d.slice(0, 10)), 'MMM d, yyyy');

// Spending per tag — cuts across categories (e.g. everything for "vacation").
// Hidden entirely when the user hasn't tagged anything.
export default function TagsPanel({
  transactions, month, year, className = 'col-span-12',
}: PeriodPanelProps & { className?: string }) {
  const getCategory = useGetCategory();
  const [scope, setScope] = useState('month'); // 'month' | 'all'
  const allTime = useMemo(() => getTagBreakdown(transactions), [transactions]);
  const monthly = useMemo(() => getTagBreakdown(transactions, { month, year }), [transactions, month, year]);

  if (!allTime.length) return null;
  const rows = scope === 'month' ? monthly : allTime;
  const max = Math.max(...rows.map(r => r.total), 1);

  return (
    <Panel
      title="Spending by Tag"
      className={className}
      meta={rows.length ? `${rows.length} TAG${rows.length > 1 ? 'S' : ''}` : undefined}
      actions={(
        <span className="flex border border-line-strong">
          {[['month', format(new Date(year, month, 1), 'MMM yyyy')], ['all', 'All time']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setScope(val)}
              aria-pressed={scope === val}
              className={`h-[18px] px-1.5 text-micro uppercase tracking-[0.06em] border-r border-line-strong last:border-r-0 transition-colors ${scope === val ? 'bg-accent-tint text-accent-ink' : 'text-ink-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </span>
      )}
    >
      {rows.length === 0 ? (
        <p className="font-sans text-sm text-ink-muted p-3">No tagged spending this month.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="label-micro text-left">
                <th scope="col" className="font-medium h-[22px] px-2.5 border-b border-line bg-surface-sunk">Tag</th>
                <th scope="col" className="font-medium px-2.5 border-b border-line bg-surface-sunk text-right">Spent</th>
                <th scope="col" className="font-medium px-2.5 border-b border-line bg-surface-sunk w-[20%] hidden sm:table-cell"><span className="sr-only">Share</span></th>
                <th scope="col" className="font-medium px-2.5 border-b border-line bg-surface-sunk">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map(r => (
                <tr key={r.tag} className="hover:bg-surface-hover">
                  <td className="h-row px-2.5 border-b border-line text-ink font-medium whitespace-nowrap">#{r.tag}</td>
                  <td className="px-2.5 border-b border-line text-right text-ink whitespace-nowrap">{formatCurrency(r.total)}</td>
                  <td className="px-2.5 border-b border-line hidden sm:table-cell">
                    <Meter value={r.total} max={max} />
                  </td>
                  <td className="px-2.5 border-b border-line text-caption text-ink-muted">
                    {r.count} transaction{r.count > 1 ? 's' : ''} · mostly {getCategory(r.topCategory).name}
                    {' · '}{r.firstDate.slice(0, 10) === r.lastDate.slice(0, 10) ? fmt(r.firstDate) : `${fmt(r.firstDate)} – ${fmt(r.lastDate)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
