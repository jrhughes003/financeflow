import React, { useMemo } from 'react';
import { useFinancial, useGetCategory } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { getBudgetSuggestions, applyBudgetSuggestion } from '../../utils/planning';
import { DEFAULT_FLEX } from '../../utils/constants';
import {
  Panel, KeyValue, Badge, Button, CategoryMark,
} from '../ui';
import type { BadgeTone } from '../ui';

// A stable empty array, so a settings object without the key does not hand a
// fresh [] to useMemo on every render.
const NONE: string[] = [];

/**
 * A suggestion as this panel uses it.
 *
 * `months` belongs to the result wrapper rather than to each suggestion — how
 * many months of history the whole set was drawn from — and the component
 * copies it onto each one so the copy can say "in 4 of the last 6 months".
 */
type Suggestion = ReturnType<typeof getBudgetSuggestions>['suggestions'][number] & { months: number };
const TYPE: Record<Suggestion['type'], { label: string; tone: BadgeTone }> = {
  raise: { label: 'Too tight', tone: 'negative' },
  lower: { label: 'Too loose', tone: 'neutral' },
  add: { label: 'No budget', tone: 'neutral' },
};
const FREQ: Record<string, string> = { quarterly: 'every 3 months', semiannual: 'every 6 months', annual: 'yearly' };
const dismissKey = (s: Suggestion): string => `${s.category}:${s.type}:${s.suggested}`;

function explain(s: Suggestion): string {
  const range = `${formatCurrency(s.low)}–${formatCurrency(s.high)}`;
  if (s.type === 'raise') return `Over the limit in ${s.overMonths} of the last ${s.months} months; a typical month is ${range}. A budget you can actually hit is more useful than one you always miss — or use Save Money to bring spending down instead.`;
  if (s.type === 'lower') return `Even your biggest month stayed well under it; a typical month is ${range}. Lowering it frees ${formatCurrency(s.freed ?? 0)}/mo to assign elsewhere.`;
  return `You spend on this in most months (typically ${range}) but it isn't budgeted.`;
}

// Periodic bills are smoothed into the suggestion; say so, and nudge rollover
// so the monthly share actually accumulates until the bill arrives.
function billNote(s: Suggestion): string | null {
  if (!s.billShare) return null;
  const list = s.bills.map((b: Suggestion['bills'][number]) => `${b.merchant} (${formatCurrency(b.amount)} ${FREQ[b.frequency]})`).join(', ');
  return `Includes ${formatCurrency(s.billShare)}/mo toward ${list}.${s.rollover ? '' : ' Turn on rollover for this budget so that share builds up for the bill month.'}`;
}

export default function BudgetTuneUpPanel({ className = 'col-span-12' }: { className?: string }) {
  const { state, dispatch } = useFinancial();
  const { transactions, budgets } = state;
  const getCategory = useGetCategory();
  const dismissed = state.settings?.dismissedBudgetTips || NONE;

  const { recurringTemplates = [] } = state;
  const result = useMemo(() => getBudgetSuggestions(budgets, transactions, { recurringTemplates }), [budgets, transactions, recurringTemplates]);
  const suggestions = result.suggestions.map(s => ({ ...s, months: result.months })).filter(s => !dismissed.includes(dismissKey(s)));
  const freed = suggestions
    .filter(s => s.type === 'lower')
    .reduce((t, s) => t + (s.freed ?? 0), 0);

  const apply = (s: Suggestion) => dispatch({ type: 'SET_BUDGET', payload: applyBudgetSuggestion(s, budgets, { defaultFlex: DEFAULT_FLEX }) });
  const dismiss = (s: Suggestion) => dispatch({ type: 'UPDATE_SETTINGS', payload: { dismissedBudgetTips: [...dismissed, dismissKey(s)] } });

  return (
    <Panel
      title="Budget Tune-Up"
      meta={!result.insufficient && suggestions.length ? `${suggestions.length} SUGGESTION${suggestions.length > 1 ? 'S' : ''}` : undefined}
      className={className}
    >
      <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">
        {result.insufficient
          ? 'Compares your budgets with how you actually spend.'
          : `Budgets compared with your last ${result.months} full months of spending. Suggestions cover a typical month (75th percentile).`}
      </p>
      {freed > 0 && (
        <KeyValue label="Could free up" strong>
          <span className="text-info">{formatCurrency(freed)}</span><span className="text-ink-muted">/mo</span>
        </KeyValue>
      )}

      {result.insufficient ? (
        <p className="font-sans text-sm text-ink-muted p-3">Needs at least 3 full months of transactions to suggest realistic budgets.</p>
      ) : suggestions.length === 0 ? (
        <p className="font-sans text-sm text-ink-muted p-3">Your budgets line up well with how you actually spend. Nothing to change.</p>
      ) : (
        <ul>
          {suggestions.map(s => {
            const cat = getCategory(s.category);
            const t = TYPE[s.type];
            const note = billNote(s);
            return (
              <li key={dismissKey(s)} className="px-2.5 py-1.5 border-b border-line last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <CategoryMark color={cat.color} name={cat.name} className="text-sm text-ink font-medium" />
                    <Badge tone={t.tone}>{t.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm whitespace-nowrap">
                    <span className="text-ink-muted">{s.current ? formatCurrency(s.current) : 'None'}</span>
                    <span className="text-ink-muted" aria-hidden="true">→</span>
                    <span className="font-semibold text-ink">{formatCurrency(s.suggested)}/mo</span>
                  </div>
                </div>
                <p className="font-sans text-caption text-ink-muted mt-1">{explain(s)}</p>
                {note && <p className="font-sans text-caption text-ink-secondary mt-0.5">{note}</p>}
                <div className="flex gap-1.5 mt-1.5">
                  <Button size="sm" variant="primary" onClick={() => apply(s)}>
                    {s.type === 'add' ? `Set ${formatCurrency(s.suggested)} budget` : `Change to ${formatCurrency(s.suggested)}`}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => dismiss(s)}>Dismiss</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
