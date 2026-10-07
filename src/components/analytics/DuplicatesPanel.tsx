import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useFinancial, useGetCategory } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { detectDuplicateCharges } from '../../utils/insights';
import { Panel, Badge, Button } from '../ui';

// Stable empty array — see BudgetTuneUpPanel.
const NONE: string[] = [];
const fmtDate = (d: string): string => format(parseISO(d.slice(0, 10)), 'MMM d');

type Duplicate = ReturnType<typeof detectDuplicateCharges>[number];

// Possible double charges, with "keep both" (remembered) and a two-step delete.
export default function DuplicatesPanel({ className = 'col-span-12' }: { className?: string }) {
  const { state, dispatch } = useFinancial();
  const getCategory = useGetCategory();
  const dismissed = state.settings?.dismissedDuplicates || NONE;
  const [confirming, setConfirming] = useState<string | null>(null);

  const duplicates = useMemo(
    () => detectDuplicateCharges(state.transactions, { dismissed }),
    [state.transactions, dismissed],
  );

  if (!duplicates.length) return null;

  const keepBoth = (key: string): void => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { dismissedDuplicates: [...dismissed, key] } });
  };
  const removeSecond = (d: Duplicate): void => {
    dispatch({ type: 'DELETE_TRANSACTION', payload: d.second.id });
    setConfirming(null);
  };
  const total = duplicates.reduce((s, d) => s + d.amount, 0);

  return (
    <Panel
      title="Possible Double Charges"
      meta={<span className="text-negative">{duplicates.length} to review · {formatCurrency(total)}</span>}
      className={className}
    >
      <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">Same merchant and exact amount within a couple of days (last 90 days). Check your statement, then dispute or remove the extra entry.</p>
      <ul>
        {duplicates.map(d => {
          const cat = getCategory(d.category);
          return (
            <li key={d.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1 border-b border-line last:border-b-0 hover:bg-surface-hover">
              <Badge tone="negative" className="shrink-0 w-12 justify-center">Dup?</Badge>
              <div className="flex-1 min-w-48">
                <p className="text-sm text-ink">{d.merchant} · <span className="text-negative">{formatCurrency(d.amount)}</span></p>
                <p className="text-caption text-ink-muted">
                  {cat.name} · charged {fmtDate(d.first.date)}
                  {d.daysApart === 0 ? ' twice' : ` and ${fmtDate(d.second.date)}`}
                </p>
              </div>
              {confirming === d.key ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-caption text-ink-muted">Delete the {fmtDate(d.second.date)} entry?</span>
                  <Button size="sm" variant="danger" className="border-current" onClick={() => removeSecond(d)}>Delete</Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>Cancel</Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => keepBoth(d.key)}>Keep both</Button>
                  <Button size="sm" variant="danger" onClick={() => setConfirming(d.key)}>Remove duplicate</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
