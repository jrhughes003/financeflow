import React, { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Target, CheckCircle2, AlertTriangle, AlertCircle, PauseCircle, Clock } from 'lucide-react';
import { useFinancial } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { getGoalStatuses } from '../../utils/planning';

const STATUS = {
  on_track:  { label: 'On track',   icon: CheckCircle2,  cls: 'text-positive bg-positive-tint' },
  behind:    { label: 'Behind',     icon: AlertTriangle, cls: 'text-caution bg-caution-tint' },
  stalled:   { label: 'Stalled',    icon: PauseCircle,   cls: 'text-negative bg-negative-tint' },
  past_due:  { label: 'Past target', icon: Clock,        cls: 'text-negative bg-negative-tint' },
  no_target: { label: 'No target date', icon: AlertCircle, cls: 'text-ink-secondary bg-surface-hover' },
  reached:   { label: 'Reached',    icon: CheckCircle2,  cls: 'text-positive bg-positive-tint' },
};
const ORDER = ['stalled', 'past_due', 'behind', 'no_target', 'on_track', 'reached'];
const fmtMonth = d => format(parseISO(d), 'MMM yyyy');

function summary(s) {
  const paceText = s.paceSource === 'actual'
    ? `You're putting in about ${formatCurrency(s.pace)}/mo (from your savings transactions)`
    : `Planned ${formatCurrency(s.planned)}/mo (no savings transactions logged for this goal yet)`;
  switch (s.status) {
    case 'reached': return 'Target reached. 🎉';
    case 'on_track': return `${paceText}; ${formatCurrency(s.required)}/mo is enough to reach it by ${fmtMonth(s.targetDate)}. At this pace: ${fmtMonth(s.projectedDate)}.`;
    case 'behind': return `${paceText}, but ${formatCurrency(s.required)}/mo is needed to reach it by ${fmtMonth(s.targetDate)} — ${formatCurrency(s.shortfall)}/mo short. At this pace you'd finish ${fmtMonth(s.projectedDate)}, ${s.monthsLate} month${s.monthsLate === 1 ? '' : 's'} late.`;
    case 'stalled': return s.targetDate
      ? `No contributions are going in. ${formatCurrency(s.required)}/mo would still reach it by ${fmtMonth(s.targetDate)}.`
      : 'No contributions are going in and there is no target date.';
    case 'past_due': return `The target date (${fmtMonth(s.targetDate)}) has passed with ${formatCurrency(s.remaining)} still to go.${s.projectedDate ? ` At the current pace it finishes ${fmtMonth(s.projectedDate)}.` : ''}`;
    case 'no_target': return `${paceText}. At this pace you'll reach it around ${fmtMonth(s.projectedDate)}.`;
    default: return '';
  }
}

export default function GoalCheckPanel() {
  const { state } = useFinancial();
  const { savings_goals = [], transactions } = state;
  const statuses = useMemo(
    () => getGoalStatuses(savings_goals, transactions).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)),
    [savings_goals, transactions],
  );
  const shortfall = statuses.filter(s => s.status === 'behind').reduce((t, s) => t + s.shortfall, 0);

  return (
    <div className="bg-surface rounded-container border border-line p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2">
          <Target className="w-4 h-4 text-ink-muted mt-0.5" />
          <div>
            <h2 className="text-lg font-semibold text-ink">Goal Check</h2>
            <p className="text-caption text-ink-muted mt-0.5">Your real savings pace vs. what each goal needs to hit its target date</p>
          </div>
        </div>
        {shortfall > 0 && (
          <div className="text-right">
            <p className="text-caption text-ink-muted">Needed to get back on track</p>
            <p className="text-xl font-bold text-caution">+{formatCurrency(shortfall)}<span className="text-sm font-medium text-ink-muted">/mo</span></p>
          </div>
        )}
      </div>

      {statuses.length === 0 ? (
        <p className="text-sm text-ink-muted text-center py-6">No savings goals yet — add one on the Goals page to track it here.</p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {statuses.map(s => {
            const st = STATUS[s.status];
            const Icon = st.icon;
            return (
              <div key={s.goal.id} className="border border-line rounded-container p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold text-ink truncate">{s.goal.name}</p>
                  <span className={`inline-flex items-center gap-1 text-caption font-medium px-2 py-0.5 rounded-full shrink-0 ${st.cls}`}>
                    <Icon className="w-3.5 h-3.5" />{st.label}
                  </span>
                </div>
                <div className="h-2 bg-surface-hover rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${s.percent}%`, backgroundColor: s.goal.color || 'var(--c-data-1)' }} />
                </div>
                <div className="flex justify-between text-caption text-ink-muted mt-1 mb-2">
                  <span>{formatCurrency(s.currentAmount)} of {formatCurrency(s.goal.targetAmount)}</span>
                  <span>{Math.round(s.percent)}%</span>
                </div>
                <p className="text-caption text-ink-secondary">{summary(s)}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
