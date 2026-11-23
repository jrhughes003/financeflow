import React, { useMemo } from 'react';
import { Plus, Trash2, Check, Power } from 'lucide-react';
import { format, addDays, parseISO, startOfWeek } from 'date-fns';
import { useFinancial, useGetCategory } from '../context/FinancialContext';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { detectRecurringCandidates, isTemplateDue, postTemplate, upcomingOccurrences } from '../utils/recurring';
import type { RecurringCandidate } from '../utils/recurring';
import { subscriptionAudit } from '../utils/subscriptions';
import { toMonthlyAmount, formatCurrency } from '../utils/calculations';

const formatCurrencyShort = (n: number): string => formatCurrency(Number(n) || 0).replace(/\.00$/, '');
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

  // The next 60 days of charges, grouped by week, so a heavy week (rent and
  // the car insurance together) is visible before it lands.
  const upcomingWeeks = useMemo(() => {
    const until = format(addDays(new Date(), 60), 'yyyy-MM-dd');
    const weeks = new Map<string, { start: string; items: ReturnType<typeof upcomingOccurrences>; total: number }>();
    for (const o of upcomingOccurrences(recurringTemplates, today, until)) {
      const start = format(startOfWeek(parseISO(o.date < today ? today : o.date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const w = weeks.get(start) ?? { start, items: [], total: 0 };
      w.items.push(o);
      w.total += Number(o.template.amount) || 0;
      weeks.set(start, w);
    }
    return [...weeks.values()];
  }, [recurringTemplates, today]);
  const heaviest = Math.max(0, ...upcomingWeeks.map(w => w.total));

  const audit = useMemo(() => subscriptionAudit(recurringTemplates, transactions), [recurringTemplates, transactions]);
  const notes = state.settings?.subscriptionNotes || {};
  const saveNote = (key: string, text: string) => {
    const trimmed = text.trim();
    if ((notes[key] || '') === trimmed) return;
    const next = { ...notes };
    if (trimmed) next[key] = trimmed; else delete next[key];
    dispatch({ type: 'UPDATE_SETTINGS', payload: { subscriptionNotes: next } });
  };

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

        {/* Subscription audit */}
        {audit.length > 0 && (
          <Panel
            title="Subscription audit"
            meta={`${formatCurrencyShort(audit.reduce((s, r) => s + r.annual, 0))} / YEAR`}
            className="col-span-12"
          >
            <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">
              Every active recurring charge by what it costs a year. Price changes are measured from your own ledger over the last year. Leave yourself a note ("still using?", "cancel after the season") and pause anything you&apos;ve cancelled.
            </p>
            <Table>
              <thead>
                <tr>
                  <Th>Merchant</Th>
                  <Th numeric>Per year</Th>
                  <Th numeric>Price change</Th>
                  <Th className="hidden md:table-cell">Last charged</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {audit.map(r => (
                  <Tr key={r.template.id}>
                    <Td className="max-w-0 w-[28%] min-w-[9rem]">
                      <CategoryMark color={getCategory(r.template.category).color} name={r.template.merchant} className="text-ink" />
                    </Td>
                    <Td numeric><Money value={r.annual} size="sm" /></Td>
                    <Td numeric className={r.priceChangePct === null ? 'text-ink-muted' : r.priceChangePct > 0 ? 'text-negative' : 'text-positive'}>
                      {r.priceChangePct === null ? '—' : (
                        <span title={r.firstSeen && r.lastCharged ? `${formatCurrency(r.firstSeen.amount)} on ${r.firstSeen.date} → ${formatCurrency(r.lastCharged.amount)} on ${r.lastCharged.date}` : ''}>
                          {r.priceChangePct > 0 ? '+' : ''}{r.priceChangePct}%
                        </span>
                      )}
                    </Td>
                    <Td className="hidden md:table-cell text-ink-secondary whitespace-nowrap">
                      {r.lastCharged ? `${r.lastCharged.date} · ${r.daysSinceCharged}d ago` : <span className="text-ink-muted">not in ledger yet</span>}
                    </Td>
                    <Td>
                      <input
                        type="text"
                        defaultValue={notes[r.key] || ''}
                        onBlur={e => saveNote(r.key, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        placeholder="Add a note…"
                        aria-label={`Note for ${r.template.merchant}`}
                        className="w-full h-6 px-1.5 bg-transparent border border-transparent hover:border-line focus:border-accent rounded-control text-caption text-ink placeholder:text-ink-muted focus:outline-none"
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}

        {/* The next 60 days */}
        {upcomingWeeks.length > 0 && (
          <Panel title="Next 60 days" meta={`${upcomingWeeks.reduce((n, w) => n + w.items.length, 0)} CHARGES`} className="col-span-12">
            <Table>
              <thead>
                <tr>
                  <Th>Week of</Th>
                  <Th>Charges</Th>
                  <Th numeric>Total</Th>
                  <Th className="w-[22%] min-w-[96px]"><span className="sr-only">Relative size</span></Th>
                </tr>
              </thead>
              <tbody>
                {upcomingWeeks.map(w => (
                  <Tr key={w.start}>
                    <Td className="whitespace-nowrap text-ink-secondary">{format(parseISO(w.start), 'd MMM')}</Td>
                    <Td className="text-caption text-ink-secondary">
                      {w.items.map((o, i) => (
                        <span key={`${o.template.id}-${o.date}`} className={o.date < today ? 'text-negative' : ''}>
                          {i > 0 && ' · '}{format(parseISO(o.date), 'EEE d')} {o.template.merchant} <span className="money">{formatCurrencyShort(o.template.amount)}</span>
                          {o.date < today && ' (overdue)'}
                        </span>
                      ))}
                    </Td>
                    <Td numeric><Money value={w.total} size="sm" /></Td>
                    <Td>
                      <div className="h-1.5 bg-surface-sunk">
                        <div className={`h-full ${w.total >= heaviest * 0.999 && upcomingWeeks.length > 1 ? 'bg-caution' : 'bg-accent'}`} style={{ width: `${heaviest > 0 ? (w.total / heaviest) * 100 : 0}%` }} />
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}

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

