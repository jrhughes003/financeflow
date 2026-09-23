import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CopyX } from 'lucide-react';
import { useFinancial, useGetCategory } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { detectDuplicateCharges } from '../../utils/insights';

const NONE = [];
const fmtDate = d => format(parseISO(d.slice(0, 10)), 'MMM d');

// Possible double charges, with "keep both" (remembered) and a two-step delete.
export default function DuplicatesPanel() {
  const { state, dispatch } = useFinancial();
  const getCategory = useGetCategory();
  const dismissed = state.settings?.dismissedDuplicates || NONE;
  const [confirming, setConfirming] = useState(null);

  const duplicates = useMemo(
    () => detectDuplicateCharges(state.transactions, { dismissed }),
    [state.transactions, dismissed],
  );

  if (!duplicates.length) return null;

  const keepBoth = key => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { dismissedDuplicates: [...dismissed, key] } });
  };
  const removeSecond = d => {
    dispatch({ type: 'DELETE_TRANSACTION', payload: d.second.id });
    setConfirming(null);
  };
  const total = duplicates.reduce((s, d) => s + d.amount, 0);

  return (
    <div className="bg-surface rounded-container border border-negative p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-control bg-negative-tint flex items-center justify-center shrink-0">
            <CopyX className="w-4 h-4 text-negative" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink">Possible Double Charges</h2>
            <p className="text-caption text-ink-muted mt-0.5">Same merchant and exact amount within a couple of days (last 90 days). Check your statement, then dispute or remove the extra entry.</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-negative">{formatCurrency(total)}</p>
          <p className="text-caption text-ink-muted">{duplicates.length} to review</p>
        </div>
      </div>

      <div className="space-y-2">
        {duplicates.map(d => {
          const cat = getCategory(d.category);
          return (
            <div key={d.key} className="flex flex-wrap items-center gap-3 border border-line rounded-container p-3">
              <div className="flex-1 min-w-48">
                <p className="text-sm font-semibold text-ink">{d.merchant} · {formatCurrency(d.amount)}</p>
                <p className="text-caption text-ink-muted">
                  {cat.name} · charged {fmtDate(d.first.date)}
                  {d.daysApart === 0 ? ' twice' : ` and ${fmtDate(d.second.date)}`}
                </p>
              </div>
              {confirming === d.key ? (
                <div className="flex items-center gap-2">
                  <span className="text-caption text-ink-muted">Delete the {fmtDate(d.second.date)} entry?</span>
                  <button onClick={() => removeSecond(d)} className="px-3 py-1.5 bg-negative hover:bg-negative text-ink-inverse text-caption font-medium rounded-control">Delete</button>
                  <button onClick={() => setConfirming(null)} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => keepBoth(d.key)} className="px-3 py-1.5 border border-line-strong text-ink-secondary text-caption font-medium rounded-control hover:bg-surface-sunk">Keep both</button>
                  <button onClick={() => setConfirming(d.key)} className="px-3 py-1.5 border border-negative text-negative text-caption font-medium rounded-control hover:bg-negative-tint">Remove duplicate</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
