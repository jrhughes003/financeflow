import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Tags } from 'lucide-react';
import { useGetCategory } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { getTagBreakdown } from '../../utils/habits';

const fmt = d => format(parseISO(d.slice(0, 10)), 'MMM d, yyyy');

// Spending per tag — cuts across categories (e.g. everything for "vacation").
// Hidden entirely when the user hasn't tagged anything.
export default function TagsPanel({ transactions, month, year }) {
  const getCategory = useGetCategory();
  const [scope, setScope] = useState('month'); // 'month' | 'all'
  const allTime = useMemo(() => getTagBreakdown(transactions), [transactions]);
  const monthly = useMemo(() => getTagBreakdown(transactions, { month, year }), [transactions, month, year]);

  if (!allTime.length) return null;
  const rows = scope === 'month' ? monthly : allTime;
  const max = Math.max(...rows.map(r => r.total), 1);

  return (
    <div className="bg-surface rounded-container border border-line p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Tags className="w-4 h-4 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">Spending by Tag</h2>
        </div>
        <div className="flex bg-surface-hover rounded-control p-0.5 text-caption font-medium">
          {[['month', format(new Date(year, month, 1), 'MMM yyyy')], ['all', 'All time']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setScope(val)}
              className={`px-3 py-1.5 rounded-control transition-colors ${scope === val ? 'bg-surface  text-accent' : 'text-ink-muted hover:text-ink-secondary'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted text-center py-4">No tagged spending this month.</p>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 10).map(r => (
            <div key={r.tag}>
              <div className="flex justify-between items-baseline text-sm mb-1">
                <span className="text-ink font-medium">#{r.tag}</span>
                <span className="text-ink font-semibold">{formatCurrency(r.total)}</span>
              </div>
              <div className="h-2 bg-surface-hover rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(r.total / max) * 100}%` }} />
              </div>
              <p className="text-caption text-ink-muted mt-1">
                {r.count} transaction{r.count > 1 ? 's' : ''} · mostly {getCategory(r.topCategory).name}
                {' · '}{r.firstDate.slice(0, 10) === r.lastDate.slice(0, 10) ? fmt(r.firstDate) : `${fmt(r.firstDate)} – ${fmt(r.lastDate)}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
