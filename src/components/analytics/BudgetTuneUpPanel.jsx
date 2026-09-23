import React, { useMemo } from 'react';
import { Scale, ArrowRight } from 'lucide-react';
import { useFinancial, useGetCategory } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { getBudgetSuggestions, applyBudgetSuggestion } from '../../utils/planning';
import { DEFAULT_FLEX } from '../../utils/constants';

const NONE = [];
const TYPE = {
  raise: { label: 'Too tight', cls: 'bg-negative-tint text-negative' },
  lower: { label: 'Too loose', cls: 'bg-sky-50 text-sky-700' },
  add: { label: 'No budget', cls: 'bg-surface-hover text-ink-secondary' },
};
const FREQ = { quarterly: 'every 3 months', semiannual: 'every 6 months', annual: 'yearly' };
const dismissKey = s => `${s.category}:${s.type}:${s.suggested}`;

function explain(s) {
  const range = `${formatCurrency(s.low)}–${formatCurrency(s.high)}`;
  if (s.type === 'raise') return `Over the limit in ${s.overMonths} of the last ${s.months} months; a typical month is ${range}. A budget you can actually hit is more useful than one you always miss — or use Save Money to bring spending down instead.`;
  if (s.type === 'lower') return `Even your biggest month stayed well under it; a typical month is ${range}. Lowering it frees ${formatCurrency(s.freed)}/mo to assign elsewhere.`;
  return `You spend on this in most months (typically ${range}) but it isn't budgeted.`;
}

// Periodic bills are smoothed into the suggestion; say so, and nudge rollover
// so the monthly share actually accumulates until the bill arrives.
function billNote(s) {
  if (!s.billShare) return null;
  const list = s.bills.map(b => `${b.merchant} (${formatCurrency(b.amount)} ${FREQ[b.frequency]})`).join(', ');
  return `Includes ${formatCurrency(s.billShare)}/mo toward ${list}.${s.rollover ? '' : ' Turn on rollover for this budget so that share builds up for the bill month.'}`;
}

export default function BudgetTuneUpPanel() {
  const { state, dispatch } = useFinancial();
  const { transactions, budgets } = state;
  const getCategory = useGetCategory();
  const dismissed = state.settings?.dismissedBudgetTips || NONE;

  const { recurringTemplates = [] } = state;
  const result = useMemo(() => getBudgetSuggestions(budgets, transactions, { recurringTemplates }), [budgets, transactions, recurringTemplates]);
  const suggestions = result.suggestions.map(s => ({ ...s, months: result.months })).filter(s => !dismissed.includes(dismissKey(s)));
  const freed = suggestions.filter(s => s.type === 'lower').reduce((t, s) => t + s.freed, 0);

  const apply = s => dispatch({ type: 'SET_BUDGET', payload: applyBudgetSuggestion(s, budgets, { defaultFlex: DEFAULT_FLEX }) });
  const dismiss = s => dispatch({ type: 'UPDATE_SETTINGS', payload: { dismissedBudgetTips: [...dismissed, dismissKey(s)] } });

  return (
    <div className="bg-surface rounded-container border border-line p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2">
          <Scale className="w-4 h-4 text-ink-muted mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-ink">Budget Tune-Up</h2>
            <p className="text-caption text-ink-muted mt-0.5">
              {result.insufficient
                ? 'Compares your budgets with how you actually spend.'
                : `Budgets compared with your last ${result.months} full months of spending. Suggestions cover a typical month (75th percentile).`}
            </p>
          </div>
        </div>
        {freed > 0 && (
          <div className="text-right">
            <p className="text-caption text-ink-muted">Could free up</p>
            <p className="text-xl font-bold text-sky-700">{formatCurrency(freed)}<span className="text-sm font-medium text-ink-muted">/mo</span></p>
          </div>
        )}
      </div>

      {result.insufficient ? (
        <p className="text-sm text-ink-muted text-center py-6">Needs at least 3 full months of transactions to suggest realistic budgets.</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-ink-muted text-center py-6">Your budgets line up well with how you actually spend. Nothing to change.</p>
      ) : (
        <div className="space-y-3">
          {suggestions.map(s => {
            const cat = getCategory(s.category);
            const t = TYPE[s.type];
            return (
              <div key={dismissKey(s)} className="border border-line rounded-container p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm font-semibold text-ink">{cat.name}</span>
                    <span className={`text-caption font-medium px-2 py-0.5 rounded-full ${t.cls}`}>{t.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-ink-muted">{s.current ? formatCurrency(s.current) : 'None'}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-ink-muted" />
                    <span className="font-semibold text-ink">{formatCurrency(s.suggested)}/mo</span>
                  </div>
                </div>
                <p className="text-caption text-ink-muted mt-1.5">{explain(s)}</p>
                {billNote(s) && <p className="text-caption text-ink-secondary mt-1">{billNote(s)}</p>}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => apply(s)} className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-ink-inverse text-caption font-medium rounded-control">
                    {s.type === 'add' ? `Set ${formatCurrency(s.suggested)} budget` : `Change to ${formatCurrency(s.suggested)}`}
                  </button>
                  <button onClick={() => dismiss(s)} className="px-3 py-1.5 border border-line-strong text-ink-secondary text-caption rounded-control hover:bg-surface-sunk">Dismiss</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
