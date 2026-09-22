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
    <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
            <CopyX className="w-4 h-4 text-red-500" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Possible Double Charges</h2>
            <p className="text-xs text-gray-400 mt-0.5">Same merchant and exact amount within a couple of days (last 90 days). Check your statement, then dispute or remove the extra entry.</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-red-600">{formatCurrency(total)}</p>
          <p className="text-xs text-gray-400">{duplicates.length} to review</p>
        </div>
      </div>

      <div className="space-y-2">
        {duplicates.map(d => {
          const cat = getCategory(d.category);
          return (
            <div key={d.key} className="flex flex-wrap items-center gap-3 border border-gray-100 rounded-xl p-3">
              <div className="flex-1 min-w-48">
                <p className="text-sm font-semibold text-gray-900">{d.merchant} · {formatCurrency(d.amount)}</p>
                <p className="text-xs text-gray-500">
                  {cat.name} · charged {fmtDate(d.first.date)}
                  {d.daysApart === 0 ? ' twice' : ` and ${fmtDate(d.second.date)}`}
                </p>
              </div>
              {confirming === d.key ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Delete the {fmtDate(d.second.date)} entry?</span>
                  <button onClick={() => removeSecond(d)} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg">Delete</button>
                  <button onClick={() => setConfirming(null)} className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded-lg hover:bg-gray-50">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => keepBoth(d.key)} className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50">Keep both</button>
                  <button onClick={() => setConfirming(d.key)} className="px-3 py-1.5 border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50">Remove duplicate</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
