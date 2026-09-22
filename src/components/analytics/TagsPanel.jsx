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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Tags className="w-4 h-4 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-900">Spending by Tag</h2>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs font-medium">
          {[['month', format(new Date(year, month, 1), 'MMM yyyy')], ['all', 'All time']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setScope(val)}
              className={`px-3 py-1.5 rounded-md transition-colors ${scope === val ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No tagged spending this month.</p>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 10).map(r => (
            <div key={r.tag}>
              <div className="flex justify-between items-baseline text-sm mb-1">
                <span className="text-gray-800 font-medium">#{r.tag}</span>
                <span className="text-gray-900 font-semibold">{formatCurrency(r.total)}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${(r.total / max) * 100}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-1">
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
