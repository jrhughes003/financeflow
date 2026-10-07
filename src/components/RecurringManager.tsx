import React, { useMemo } from 'react';
import { Plus, Trash2, Check, Power } from 'lucide-react';
import { format } from 'date-fns';
import { useFinancial, useGetCategory } from '../context/FinancialContext';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { detectRecurringCandidates, isTemplateDue, postTemplate } from '../utils/recurring';
import type { RecurringCandidate } from '../utils/recurring';
import { toMonthlyAmount } from '../utils/calculations';
import {
  Panel, PanelGrid, KeyValue, Money, Button, IconButton, Badge, CategoryMark, Table, Th, Td, Tr,
} from './ui';
import type { RecurringTemplate } from '../types/domain';

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

  const addTemplate = (candidate: RecurringCandidate) => {
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

  const post = (template: RecurringTemplate) => {
    const { transaction, template: updated } = postTemplate(template, today);
    dispatch({ type: 'ADD_TRANSACTION', payload: transaction });
    dispatch({ type: 'UPDATE_RECURRING_TEMPLATE', payload: updated });
  };

  const postAllDue = () => dueTemplates.forEach(post);

  const toggleActive = (t: RecurringTemplate) =>
    dispatch({ type: 'UPDATE_RECURRING_TEMPLATE', payload: { ...t, active: t.active === false ? true : false } });

  return (
    <div className="space-y-2 animate-fade-in">
      {/* Due: one signal row, like the dashboard's */}
      {dueTemplates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 px-2.5 py-1 bg-surface border border-line">
          <span className="shrink-0 w-12 text-center border border-current text-[10px] leading-[14px] tracking-[0.06em] text-caution">DUE</span>
          <p className="font-sans text-[12.5px] text-ink flex-1 min-w-0">
            <strong>{dueTemplates.length}</strong> recurring {dueTemplates.length === 1 ? 'transaction is' : 'transactions are'} due to be posted.
          </p>
          <Button size="sm" variant="primary" onClick={postAllDue}>Post all due</Button>
        </div>
      )}

      <PanelGrid className="grid-flow-row-dense">
        {/* The figure the page is about */}
        <Panel title="Recurring, per month" meta="ACTIVE" className="col-span-12 md:col-span-4 xl:col-span-3">
          <div className="px-2.5 py-2 border-b border-line">
            <Money value={monthlyRecurring} size="display" />
            <p className="text-caption text-ink-muted mt-1">
              <Money value={monthlyRecurring * 12} size="caption" className="text-ink-secondary" /> a year
            </p>
          </div>
          <KeyValue label="Templates">{recurringTemplates.length}</KeyValue>
          <KeyValue label="Due now">
            <span className={dueTemplates.length ? 'text-caution' : ''}>{dueTemplates.length}</span>
          </KeyValue>
          <KeyValue label="Detected, not yet tracked">{candidates.length}</KeyValue>
        </Panel>

        {/* Active templates */}
        <Panel
          title="Recurring Templates"
          meta={recurringTemplates.length ? `${recurringTemplates.filter(t => t.active !== false).length} / ${recurringTemplates.length} ACTIVE` : undefined}
          className="col-span-12 md:col-span-8 xl:col-span-9"
        >
          {recurringTemplates.length === 0 ? (
            <p className="font-sans text-sm text-ink-muted p-3">No recurring templates yet. Add one from the detected charges below.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Merchant</Th>
                  <Th numeric>Amount</Th>
                  <Th className="hidden sm:table-cell">Frequency</Th>
                  <Th>Next</Th>
                  <Th className="w-[1%]"><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {recurringTemplates.map(t => {
                  const due = isTemplateDue(t, today);
                  const inactive = t.active === false;
                  return (
                    <Tr key={t.id} className={inactive ? 'opacity-60' : ''}>
                      <Td className="max-w-0 w-full min-w-[9rem]">
                        <span className="flex items-center gap-2 min-w-0">
                          <CategoryMark color={getCategory(t.category).color} name={t.merchant} className="text-ink" />
                          {inactive && <Badge>Paused</Badge>}
                          {due && !inactive && <Badge tone="caution">Due</Badge>}
                        </span>
                      </Td>
                      <Td numeric><Money value={t.amount} size="sm" /></Td>
                      <Td className="hidden sm:table-cell text-ink-secondary whitespace-nowrap">{FREQ_LABELS[t.frequency] || t.frequency}</Td>
                      <Td className="text-ink-muted whitespace-nowrap">next {t.nextDate}</Td>
                      <Td className="pr-1.5">
                        <div className="flex items-center justify-end gap-px whitespace-nowrap">
                          {due && !inactive && (
                            <Button size="sm" variant="primary" icon={Check} onClick={() => post(t)} className="mr-1">Post</Button>
                          )}
                          <IconButton icon={Power} label={inactive ? 'Resume' : 'Pause'} onClick={() => toggleActive(t)} />
                          <button onClick={() => removeItem({ type: 'recurring', item: t })} aria-label={`Delete recurring charge ${t.merchant}`} title={`Delete ${t.merchant}`}
                            className="inline-flex items-center justify-center w-6 h-6 rounded-control text-ink-muted hover:text-negative hover:bg-negative-tint transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>

        {/* Detected candidates */}
        <Panel
          title="Detected Recurring Charges"
          meta={candidates.length ? `${candidates.length} FOUND` : undefined}
          className="col-span-12"
        >
          <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">Found in your transaction history. Add any as a template to track and auto-post.</p>
          {candidates.length === 0 ? (
            <p className="font-sans text-sm text-ink-muted p-3">No new recurring patterns detected.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Merchant</Th>
                  <Th numeric>Amount</Th>
                  <Th className="hidden sm:table-cell">Frequency</Th>
                  <Th numeric>Seen</Th>
                  <Th className="w-[1%]"><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <Tr key={`${c.merchant}-${i}`}>
                    <Td className="max-w-0 w-full min-w-[9rem]">
                      <CategoryMark color={getCategory(c.category).color} name={c.merchant} className="text-ink" />
                    </Td>
                    <Td numeric><span className="text-ink-muted">~</span><Money value={c.amount} size="sm" /></Td>
                    <Td className="hidden sm:table-cell text-ink-secondary whitespace-nowrap">{FREQ_LABELS[c.frequency] || c.frequency}</Td>
                    <Td numeric className="text-ink-secondary">{c.occurrences}×</Td>
                    <Td className="pr-1.5 text-right">
                      <Button size="sm" icon={Plus} onClick={() => addTemplate(c)}>Add template</Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </PanelGrid>
    </div>
  );
}

