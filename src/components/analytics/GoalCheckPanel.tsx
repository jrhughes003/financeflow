import React, { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { useFinancial } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { getGoalStatuses } from '../../utils/planning';
import { Panel, KeyValue, Badge } from '../ui';
import type { BadgeTone } from '../ui';

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  on_track:  { label: 'On track',       tone: 'positive' },
  behind:    { label: 'Behind',         tone: 'caution' },
  stalled:   { label: 'Stalled',        tone: 'negative' },
  past_due:  { label: 'Past target',    tone: 'negative' },
  no_target: { label: 'No target date', tone: 'neutral' },
  reached:   { label: 'Reached',        tone: 'positive' },
};
const ORDER = ['stalled', 'past_due', 'behind', 'no_target', 'on_track', 'reached'];
const fmtMonth = (d: string): string => format(parseISO(d), 'MMM yyyy');

type GoalStatus = ReturnType<typeof getGoalStatuses>[number];

// The status already implies which of these are set — 'on_track' cannot happen
// without a target date — but getGoalStatuses returns one object rather than a
// union, so the checker cannot see that. Rendering a dash beats asserting
// non-null and being wrong on some path nobody thought about.
const money = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : formatCurrency(n));
const month = (d: string | null | undefined): string => (d === null || d === undefined ? '—' : fmtMonth(d));

function summary(s: GoalStatus): string {
  const paceText = s.paceSource === 'actual'
    ? `You're putting in about ${money(s.pace)}/mo (from your savings transactions)`
    : `Planned ${money(s.planned)}/mo (no savings transactions logged for this goal yet)`;
  switch (s.status) {
    case 'reached': return 'Target reached. 🎉';
    case 'on_track': return `${paceText}; ${money(s.required)}/mo is enough to reach it by ${month(s.targetDate)}. At this pace: ${month(s.projectedDate)}.`;
    case 'behind': return `${paceText}, but ${money(s.required)}/mo is needed to reach it by ${month(s.targetDate)} — ${money(s.shortfall)}/mo short. At this pace you'd finish ${month(s.projectedDate)}, ${s.monthsLate} month${s.monthsLate === 1 ? '' : 's'} late.`;
    case 'stalled': return s.targetDate
      ? `No contributions are going in. ${money(s.required)}/mo would still reach it by ${month(s.targetDate)}.`
      : 'No contributions are going in and there is no target date.';
    case 'past_due': return `The target date (${month(s.targetDate)}) has passed with ${money(s.remaining)} still to go.${s.projectedDate ? ` At the current pace it finishes ${month(s.projectedDate)}.` : ''}`;
    case 'no_target': return `${paceText}. At this pace you'll reach it around ${month(s.projectedDate)}.`;
    default: return '';
  }
}

export default function GoalCheckPanel({ className = 'col-span-12' }: { className?: string }) {
  const { state } = useFinancial();
  const { savings_goals = [], transactions } = state;
  const statuses = useMemo(
    () => getGoalStatuses(savings_goals, transactions).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)),
    [savings_goals, transactions],
  );
  const shortfall = statuses
    .filter(s => s.status === 'behind')
    .reduce((t, s) => t + (s.shortfall ?? 0), 0);

  return (
    <Panel
      title="Goal Check"
      meta={statuses.length ? `${statuses.length} GOAL${statuses.length > 1 ? 'S' : ''}` : undefined}
      className={className}
    >
      <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">Your real savings pace vs. what each goal needs to hit its target date</p>
      {shortfall > 0 && (
        <KeyValue label="Needed to get back on track" strong>
          <span className="text-caution">+{formatCurrency(shortfall)}</span><span className="text-ink-muted">/mo</span>
        </KeyValue>
      )}

      {statuses.length === 0 ? (
        <p className="font-sans text-sm text-ink-muted p-3">No savings goals yet — add one on the Goals page to track it here.</p>
      ) : (
        <ul>
          {statuses.map(s => {
            const st = STATUS[s.status];
            return (
              <li key={s.goal.id} className="px-2.5 py-1.5 border-b border-line last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex-1 min-w-0 truncate text-caption uppercase tracking-[0.03em] text-ink">{s.goal.name}</p>
                  <Badge tone={st.tone} className="shrink-0">{st.label}</Badge>
                </div>
                <div className="h-1.5 bg-line my-1" role="presentation">
                  <div className="h-full" style={{ width: `${s.percent}%`, backgroundColor: s.goal.color || 'var(--c-data-1)' }} />
                </div>
                <div className="flex justify-between text-caption text-ink-muted">
                  <span>{formatCurrency(s.currentAmount)} of {formatCurrency(s.goal.targetAmount)}</span>
                  <span>{Math.round(s.percent)}%</span>
                </div>
                <p className="font-sans text-caption text-ink-secondary mt-0.5">{summary(s)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
