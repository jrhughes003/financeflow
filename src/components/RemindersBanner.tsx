// The reminders strip above every page. In-app only, by choice: nothing pops
// up outside the window.

import React, { useMemo, useState } from 'react';
import { Bell, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import { buildReminders, pruneDismissed } from '../utils/reminders';
import type { PageId } from '../types/navigation';

const TONE: Record<string, string> = {
  overdue: 'text-negative', bill: 'text-caution', owed: 'text-accent-ink', 'stale-balance': 'text-ink-secondary',
};

export default function RemindersBanner({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { state, dispatch } = useFinancial();
  const [expanded, setExpanded] = useState(false);
  const dismissed = state.settings?.dismissedReminders;
  const reminders = useMemo(
    () => buildReminders(state, new Date(), dismissed),
    // Recomputed when the records it reads change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.recurringTemplates, state.transactions, state.investments, dismissed],
  );

  if (reminders.length === 0) return null;

  const dismiss = (id: string) => dispatch({
    type: 'UPDATE_SETTINGS',
    payload: { dismissedReminders: pruneDismissed([...(dismissed || []), id], new Date()) },
  });

  const shown = expanded ? reminders : reminders.slice(0, 2);

  return (
    <section aria-label="Reminders" className="mb-2 bg-surface border border-line">
      <ul>
        {shown.map((r, i) => (
          <li key={r.id} className="flex items-center gap-2 px-2.5 min-h-[26px] border-b border-line last:border-b-0">
            {i === 0
              ? <Bell className="w-3.5 h-3.5 shrink-0 text-caution" aria-hidden="true" />
              : <span className="w-3.5 shrink-0" aria-hidden="true" />}
            <button onClick={() => onNavigate(r.go)} className={`flex-1 text-left font-sans text-[12.5px] leading-snug py-1 hover:underline ${TONE[r.kind]}`}>
              {r.text}
            </button>
            <button onClick={() => dismiss(r.id)} aria-label="Dismiss reminder" title="Dismiss" className="w-5 h-5 inline-flex items-center justify-center text-ink-muted hover:text-ink">
              <X className="w-3 h-3" />
            </button>
          </li>
        ))}
      </ul>
      {reminders.length > 2 && (
        <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-center gap-1 h-[20px] border-t border-line text-micro uppercase tracking-[0.06em] text-ink-muted hover:text-ink">
          {expanded ? <>Fewer <ChevronUp className="w-3 h-3" /></> : <>{reminders.length - 2} more <ChevronDown className="w-3 h-3" /></>}
        </button>
      )}
    </section>
  );
}
