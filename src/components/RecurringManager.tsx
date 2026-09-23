import React, { useMemo } from 'react';
import { RefreshCw, Plus, Trash2, Check, Power } from 'lucide-react';
import { format } from 'date-fns';
import { useFinancial, useGetCategory } from '../context/FinancialContext';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { detectRecurringCandidates, isTemplateDue, postTemplate } from '../utils/recurring';
import { formatCurrency, toMonthlyAmount } from '../utils/calculations';
import { Card, PageLede, Stat, Money } from './ui';

const FREQ_LABELS = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', annual: 'Yearly' };

export default function RecurringManager() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const { transactions, recurringTemplates = [] } = state;
  const getCategory = useGetCategory();
  const today = format(new Date(), 'yyyy-MM-dd');

  // Suggestions from history, minus merchants the user already templated.
  const templatedMerchants = useMemo(
    () => new Set(recurringTemplates.map(t => (t.merchant || '').toLowerCase())),
    [recurringTemplates],
  );
  const candidates = useMemo(
    () => detectRecurringCandidates(transactions).filter(c => !templatedMerchants.has((c.merchant || '').toLowerCase())),
    [transactions, templatedMerchants],
  );

  const dueTemplates = recurringTemplates.filter(t => isTemplateDue(t, today));

  // What the tracked charges add up to in a month, whatever their cadence.
  const monthlyRecurring = recurringTemplates
    .filter(t => t.active !== false)
    .reduce((sum, t) => sum + toMonthlyAmount(Number(t.amount) || 0, t.frequency), 0);

  const addTemplate = (candidate) => {
    dispatch({
      type: 'ADD_RECURRING_TEMPLATE',
      payload: {
        id: `rt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        merchant: candidate.merchant,
        amount: candidate.amount,
        category: candidate.category,
        frequency: candidate.frequency,
        nextDate: candidate.nextDate,
        active: true,
      },
    });
  };

  const post = (template) => {
    const { transaction, template: updated } = postTemplate(template, today);
    dispatch({ type: 'ADD_TRANSACTION', payload: transaction });
    dispatch({ type: 'UPDATE_RECURRING_TEMPLATE', payload: updated });
  };

  const postAllDue = () => dueTemplates.forEach(post);

  const toggleActive = (t) =>
    dispatch({ type: 'UPDATE_RECURRING_TEMPLATE', payload: { ...t, active: t.active === false ? true : false } });

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Due banner */}
      {dueTemplates.length > 0 && (
        <div className="bg-accent-tint border border-accent rounded-container p-4 flex items-center justify-between">
          <p className="text-sm text-accent-ink">
            <strong>{dueTemplates.length}</strong> recurring {dueTemplates.length === 1 ? 'transaction is' : 'transactions are'} due to be posted.
          </p>
          <button onClick={postAllDue} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">
            Post all due
          </button>
        </div>
      )}

      <Card>
        <PageLede
          label="Recurring, per month"
          supporting={(
            <>
              <Stat label="Templates">{recurringTemplates.length}</Stat>
              <Stat label="Due now">{dueTemplates.length}</Stat>
              <Stat label="Detected, not yet tracked">{candidates.length}</Stat>
            </>
          )}
        >
          <Money value={monthlyRecurring} size="display" />
          <p className="text-caption text-ink-muted mt-2">
            <Money value={monthlyRecurring * 12} size="caption" className="text-ink-secondary" /> a year
          </p>
        </PageLede>
      </Card>

      {/* Active templates */}
      <div className="bg-surface rounded-container border border-line p-5">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw className="w-4 h-4 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">Recurring Templates</h2>
        </div>
        {recurringTemplates.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-4">No recurring templates yet. Add one from the detected charges below.</p>
        ) : (
          <div className="space-y-2">
            {recurringTemplates.map(t => {
              const due = isTemplateDue(t, today);
              const inactive = t.active === false;
              return (
                <div key={t.id} className={`flex items-center justify-between border rounded-container p-3 ${inactive ? 'border-line opacity-60' : 'border-line'}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCategory(t.category).color }} />
                    <div>
                      <p className="font-medium text-ink text-sm">{t.merchant}</p>
                      <p className="text-caption text-ink-muted">
                        {formatCurrency(t.amount)} · {FREQ_LABELS[t.frequency] || t.frequency} · next {t.nextDate}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {due && !inactive && (
                      <button onClick={() => post(t)} className="flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-ink-inverse text-caption rounded-control font-medium">
                        <Check className="w-3 h-3" /> Post
                      </button>
                    )}
                    <button onClick={() => toggleActive(t)} title={inactive ? 'Resume' : 'Pause'} className="p-1.5 text-ink-muted hover:text-ink-secondary hover:bg-surface-hover rounded-control">
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeItem({ type: 'recurring', item: t })} aria-label={`Delete recurring charge ${t.merchant}`} title={`Delete ${t.merchant}`} className="p-1.5 text-ink-muted hover:text-negative hover:bg-negative-tint rounded-control">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detected candidates */}
      <div className="bg-surface rounded-container border border-line p-5">
        <h2 className="text-lg font-semibold text-ink mb-1">Detected Recurring Charges</h2>
        <p className="text-sm text-ink-muted mb-4">Found in your transaction history. Add any as a template to track and auto-post.</p>
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-4">No new recurring patterns detected.</p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c, i) => (
              <div key={`${c.merchant}-${i}`} className="flex items-center justify-between border border-line rounded-container p-3">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCategory(c.category).color }} />
                  <div>
                    <p className="font-medium text-ink text-sm">{c.merchant}</p>
                    <p className="text-caption text-ink-muted">
                      ~{formatCurrency(c.amount)} · {FREQ_LABELS[c.frequency] || c.frequency} · seen {c.occurrences}×
                    </p>
                  </div>
                </div>
                <button onClick={() => addTemplate(c)} className="flex items-center gap-1 px-2.5 py-1.5 border border-accent text-accent hover:bg-accent-tint text-caption rounded-control font-medium">
                  <Plus className="w-3 h-3" /> Add template
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
