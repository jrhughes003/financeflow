// Reminders: the few things with a date attached that are worth a nudge.
//
// Signals on the dashboard say how the month is going. These say what is
// about to happen or has been left too long: a bill landing in the next few
// days, a charge that should have been posted, money someone has owed for a
// month, a bank balance nobody has updated in a fortnight.
//
// Each reminder's id includes the date it is about, so dismissing "rent due
// 1 Dec" does not also silence rent due 1 Jan.

import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { AppState } from '../types/state';
import type { PageId } from '../types/navigation';
import { getOwedSummary } from './reimbursements';
import { LIQUID_TYPES } from './position';

export type ReminderKind = 'bill' | 'overdue' | 'owed' | 'stale-balance';

export interface Reminder {
  id: string;
  kind: ReminderKind;
  text: string;
  go: PageId;
  /** Sorts the list: lower is more pressing. */
  urgency: number;
}

/** How far ahead a bill is worth mentioning. */
export const BILL_LOOKAHEAD_DAYS = 3;
/** When an unpaid share starts to need chasing. */
export const OWED_AFTER_DAYS = 30;
/** When a typed-in bank balance is too old to plan from. */
export const STALE_BALANCE_DAYS = 14;

const money = (n: number): string => `$${(Math.round(n * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildReminders(state: AppState, today: Date, dismissed: string[] = []): Reminder[] {
  const todayStr = format(today, 'yyyy-MM-dd');
  const horizon = format(addDays(today, BILL_LOOKAHEAD_DAYS), 'yyyy-MM-dd');
  const out: Reminder[] = [];

  for (const t of state.recurringTemplates) {
    if (t.active === false || !t.nextDate) continue;
    if (t.nextDate < todayStr) {
      const days = differenceInCalendarDays(today, parseISO(t.nextDate));
      out.push({
        id: `overdue:${t.id}:${t.nextDate}`, kind: 'overdue', go: 'recurring', urgency: 0,
        text: `${t.merchant} (${money(t.amount)}) was due ${days} day${days === 1 ? '' : 's'} ago and hasn't been posted.`,
      });
    } else if (t.nextDate <= horizon) {
      const days = differenceInCalendarDays(parseISO(t.nextDate), today);
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : format(parseISO(t.nextDate), 'EEEE d MMM');
      out.push({
        id: `bill:${t.id}:${t.nextDate}`, kind: 'bill', go: 'recurring', urgency: 1 + days,
        text: `${t.merchant} ${money(t.amount)} is due ${when}.`,
      });
    }
  }

  for (const item of getOwedSummary(state.transactions, { today }).open) {
    if (item.ageDays < OWED_AFTER_DAYS) continue;
    out.push({
      id: `owed:${item.t.id}`, kind: 'owed', go: 'owed', urgency: 10,
      text: `${money(item.remaining)} still owed from ${item.t.merchant} on ${format(parseISO(item.t.date), 'd MMM')} — ${item.ageDays} days ago.`,
    });
  }

  for (const a of state.investments) {
    if (!LIQUID_TYPES.has(String(a.type))) continue;
    const age = a.asOfDate ? differenceInCalendarDays(today, parseISO(a.asOfDate)) : Infinity;
    if (age < STALE_BALANCE_DAYS) continue;
    out.push({
      // Keyed by the stale date, so updating the balance retires it for good.
      id: `stale:${a.id}:${a.asOfDate ?? 'none'}`, kind: 'stale-balance', go: 'accounts', urgency: 20,
      text: Number.isFinite(age)
        ? `${a.name}'s balance was last updated ${age} days ago. Cash Flow starts from it.`
        : `${a.name} has no balance date. Update it so Cash Flow starts from the right figure.`,
    });
  }

  const hidden = new Set(dismissed);
  return out.filter(r => !hidden.has(r.id)).sort((a, b) => a.urgency - b.urgency);
}

/**
 * Dismissed ids that can no longer match anything, dropped so the list in
 * settings does not grow forever. Bill and overdue ids carry a date; once the
 * date is well past, nothing will produce that id again.
 */
export function pruneDismissed(dismissed: string[], today: Date): string[] {
  const cutoff = format(addDays(today, -60), 'yyyy-MM-dd');
  return dismissed.filter(id => {
    const [kind, , date] = id.split(':');
    if ((kind === 'bill' || kind === 'overdue') && date) return date >= cutoff;
    return true;
  });
}
