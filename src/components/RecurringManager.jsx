import React, { useMemo } from 'react';
import { RefreshCw, Plus, Trash2, Check, Power } from 'lucide-react';
import { format } from 'date-fns';
import { useFinancial, useGetCategory } from '../context/FinancialContext';
import { detectRecurringCandidates, isTemplateDue, postTemplate } from '../utils/recurring';
import { formatCurrency } from '../utils/calculations';

const FREQ_LABELS = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', annual: 'Yearly' };

export default function RecurringManager() {
  const { state, dispatch } = useFinancial();
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
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-blue-800">
            <strong>{dueTemplates.length}</strong> recurring {dueTemplates.length === 1 ? 'transaction is' : 'transactions are'} due to be posted.
          </p>
          <button onClick={postAllDue} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium">
            Post all due
          </button>
        </div>
      )}

      {/* Active templates */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw className="w-4 h-4 text-purple-500" />
          <h2 className="text-base font-semibold text-gray-900">Recurring Templates</h2>
        </div>
        {recurringTemplates.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No recurring templates yet. Add one from the detected charges below.</p>
        ) : (
          <div className="space-y-2">
            {recurringTemplates.map(t => {
              const due = isTemplateDue(t, today);
              const inactive = t.active === false;
              return (
                <div key={t.id} className={`flex items-center justify-between border rounded-xl p-3 ${inactive ? 'border-gray-100 opacity-60' : 'border-gray-100'}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCategory(t.category).color }} />
                    <div>
                      <p className="font-medium text-gray-800 text-sm">{t.merchant}</p>
                      <p className="text-xs text-gray-400">
                        {formatCurrency(t.amount)} · {FREQ_LABELS[t.frequency] || t.frequency} · next {t.nextDate}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {due && !inactive && (
                      <button onClick={() => post(t)} className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg font-medium">
                        <Check className="w-3 h-3" /> Post
                      </button>
                    )}
                    <button onClick={() => toggleActive(t)} title={inactive ? 'Resume' : 'Pause'} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => dispatch({ type: 'DELETE_RECURRING_TEMPLATE', payload: t.id })} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
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
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Detected Recurring Charges</h2>
        <p className="text-sm text-gray-500 mb-4">Found in your transaction history. Add any as a template to track and auto-post.</p>
        {candidates.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No new recurring patterns detected.</p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c, i) => (
              <div key={`${c.merchant}-${i}`} className="flex items-center justify-between border border-gray-100 rounded-xl p-3">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCategory(c.category).color }} />
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{c.merchant}</p>
                    <p className="text-xs text-gray-400">
                      ~{formatCurrency(c.amount)} · {FREQ_LABELS[c.frequency] || c.frequency} · seen {c.occurrences}×
                    </p>
                  </div>
                </div>
                <button onClick={() => addTemplate(c)} className="flex items-center gap-1 px-2.5 py-1.5 border border-blue-200 text-blue-600 hover:bg-blue-50 text-xs rounded-lg font-medium">
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
