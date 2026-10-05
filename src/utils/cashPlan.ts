/*
 * Short-term cash flow: will the balance hold up between now and month six?
 *
 * Distinct from Plan Ahead, which is a decades-long question answered with
 * Monte Carlo and tax brackets, and from the month-end projection, which
 * answers "what will this month cost". This one answers the question those two
 * skip: *when* does the money get tight. That is a question about days, not
 * months — a balance that ends April comfortably can still go negative on the
 * 12th, and a monthly total cannot show you that.
 *
 * So the projection is a daily running balance, and every input is placed on
 * the day it actually falls:
 *
 *   dated items you enter    on their date
 *   one-off income           on its date
 *   recurring bills          on each occurrence of the template
 *   recurring income         on its paydays if an anchor date is known,
 *                            otherwise spread evenly and flagged as smoothed
 *   everyday spending        spread evenly, because it genuinely is
 *
 * The smoothing is the part to be careful about. Spreading pay evenly across
 * the month hides exactly the trough this tool exists to find, so when an
 * income has no anchor date the result says so rather than drawing a confident
 * line. One date per income source turns the estimate into a schedule.
 */

import { addDays, addMonths, format, parseISO } from 'date-fns';
import type { CashPlan, Income, IsoDate, Money, RecurringTemplate } from '../types/domain';
import { toMonthlyAmount } from './calculations';


/** One thing happening on one day. */
export interface CashEvent {
  date: IsoDate;
  label: string;
  /** Positive in, negative out. */
  amount: Money;
  source: 'planned' | 'income' | 'bill' | 'everyday';
}

export interface CashDay {
  date: IsoDate;
  /** Balance at the end of this day. */
  balance: Money;
  /** Everything dated to this day, excluding the smoothed everyday spend. */
  events: CashEvent[];
  /** The smoothed portion applied today. */
  smoothed: Money;
}

export interface CashFlowResult {
  days: CashDay[];
  openingBalance: Money;
  endingBalance: Money;
  /** The worst day, which is the whole point of a daily projection. */
  lowest: { date: IsoDate; balance: Money } | null;
  /** The first day the balance goes below zero, if it ever does. */
  firstNegative: IsoDate | null;
  /**
   * Income sources with no anchor date, spread evenly instead of scheduled.
   * Named so the UI can say which ones, rather than a blanket disclaimer.
   */
  smoothedIncomes: string[];
  totals: { in: Money; out: Money };
}

const iso = (d: Date): IsoDate => format(d, 'yyyy-MM-dd');
const round = (n: number): Money => Math.round(n * 100) / 100;

/**
 * The days a recurring income pays out, derived from one known payday.
 *
 * Semi-monthly is the awkward one: it means twice a month, which is not a
 * fixed number of days. Anchored on the Nth, it pays the Nth and the Nth+15
 * clamped into the month, which is what "the 15th and the last day" amounts to
 * for the common case without hard-coding those two dates.
 */
export function paydaysBetween(
  income: Income,
  anchor: IsoDate,
  start: Date,
  end: Date,
): IsoDate[] {
  const out: IsoDate[] = [];
  const first = parseISO(anchor);
  const push = (d: Date) => { if (d >= start && d <= end) out.push(iso(d)); };

  switch (income.frequency) {
    case 'weekly':
    case 'biweekly': {
      const step = income.frequency === 'weekly' ? 7 : 14;
      // Walk back to before the window, then forward through it.
      let d = first;
      while (d > start) d = addDays(d, -step);
      for (; d <= end; d = addDays(d, step)) push(d);
      return out;
    }
    case 'monthly': {
      const day = first.getDate();
      for (let m = addMonths(start, -1); m <= end; m = addMonths(m, 1)) {
        push(clampDayOfMonth(m.getFullYear(), m.getMonth(), day));
      }
      return out;
    }
    case 'semi-monthly': {
      const day = first.getDate();
      for (let m = addMonths(start, -1); m <= end; m = addMonths(m, 1)) {
        push(clampDayOfMonth(m.getFullYear(), m.getMonth(), day));
        push(clampDayOfMonth(m.getFullYear(), m.getMonth(), day + 15));
      }
      return out;
    }
    case 'annual': {
      for (let y = start.getFullYear() - 1; y <= end.getFullYear(); y++) {
        push(clampDayOfMonth(y, first.getMonth(), first.getDate()));
      }
      return out;
    }
    default:
      return out; // 'once' is handled as a dated item, not a schedule
  }
}

/** The Nth of a month, pulled back to the last day when the month is short. */
function clampDayOfMonth(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

export interface CashFlowInput {
  today: Date;
  /** How far ahead to project, in months. */
  months: number;
  plan: CashPlan;
  incomes: Income[];
  recurringTemplates: RecurringTemplate[];
  /** Everyday discretionary spend per month, from the existing forecast. */
  monthlyDiscretionary: Money;
}

/**
 * A daily running balance over the horizon.
 *
 * Starts tomorrow, not today: today's spending has already happened and is in
 * the ledger, so projecting it again would double-count the day you are
 * standing on.
 */
export function buildCashFlow(input: CashFlowInput): CashFlowResult {
  const { today, months, plan, incomes, recurringTemplates, monthlyDiscretionary } = input;
  const start = addDays(today, 1);
  const end = addMonths(today, Math.max(1, Math.min(6, months)));

  const byDate = new Map<IsoDate, CashEvent[]>();
  const add = (date: IsoDate, event: CashEvent) => {
    if (date < iso(start) || date > iso(end)) return;
    const list = byDate.get(date) || [];
    list.push(event);
    byDate.set(date, list);
  };

  // Items the user put on the plan.
  for (const item of plan.items || []) {
    if (!item?.date || !Number.isFinite(Number(item.amount))) continue;
    add(item.date, {
      date: item.date,
      label: item.label || (item.kind === 'in' ? 'Money in' : 'Payment'),
      amount: item.kind === 'out' ? -Math.abs(Number(item.amount)) : Math.abs(Number(item.amount)),
      source: 'planned',
    });
  }

  // Income: one-offs are dated; recurring is scheduled when anchored and
  // smoothed when not.
  const smoothedIncomes: string[] = [];
  let smoothedMonthlyIncome = 0;
  for (const inc of incomes || []) {
    if (inc.frequency === 'once') {
      if (inc.date) {
        add(inc.date, { date: inc.date, label: inc.name || 'One-off income', amount: Math.abs(Number(inc.amount) || 0), source: 'income' });
      }
      continue;
    }
    const anchor = inc.date;
    if (anchor) {
      for (const day of paydaysBetween(inc, anchor, start, end)) {
        add(day, { date: day, label: inc.name || 'Income', amount: Math.abs(Number(inc.amount) || 0), source: 'income' });
      }
    } else {
      smoothedMonthlyIncome += toMonthlyAmount(Number(inc.amount) || 0, inc.frequency);
      smoothedIncomes.push(inc.name || 'Income');
    }
  }

  // Recurring bills, on each occurrence. An inactive template is a bill the
  // user has switched off, so it must not appear in a forward projection.
  for (const tpl of (recurringTemplates || []).filter(t => t && t.active !== false)) {
    for (const day of templateDays(tpl, start, end)) {
      add(day, { date: day, label: tpl.merchant || 'Bill', amount: -Math.abs(Number(tpl.amount) || 0), source: 'bill' });
    }
  }

  // Everyday spending and unanchored pay, spread per day.
  const perDaySmoothed = (smoothedMonthlyIncome - Math.max(0, monthlyDiscretionary)) / 30.44;

  const opening = Number(plan.openingBalance) || 0;
  let balance = opening;
  let totalIn = 0;
  let totalOut = 0;
  const days: CashDay[] = [];

  for (let d = start; d <= end; d = addDays(d, 1)) {
    const date = iso(d);
    const events = byDate.get(date) || [];
    for (const e of events) {
      balance += e.amount;
      if (e.amount >= 0) totalIn += e.amount; else totalOut -= e.amount;
    }
    balance += perDaySmoothed;
    if (perDaySmoothed >= 0) totalIn += perDaySmoothed; else totalOut -= perDaySmoothed;
    days.push({ date, balance: round(balance), events, smoothed: round(perDaySmoothed) });
  }

  const lowest = days.reduce<CashDay | null>(
    (worst, day) => (!worst || day.balance < worst.balance ? day : worst), null,
  );
  const firstNegative = days.find(day => day.balance < 0)?.date ?? null;

  return {
    days,
    openingBalance: round(opening),
    endingBalance: days.length ? days[days.length - 1].balance : round(opening),
    lowest: lowest ? { date: lowest.date, balance: lowest.balance } : null,
    firstNegative,
    smoothedIncomes,
    totals: { in: round(totalIn), out: round(totalOut) },
  };
}

/** Occurrences of a recurring template inside a window. */
function templateDays(tpl: RecurringTemplate, start: Date, end: Date): IsoDate[] {
  const out: IsoDate[] = [];
  if (!tpl.nextDate) return out;
  const startStr = iso(start);
  const endStr = iso(end);
  let d: IsoDate = tpl.nextDate;
  // Bounded: a corrupt frequency must not spin here.
  for (let guard = 0; d <= endStr && guard < 400; guard++) {
    if (d >= startStr) out.push(d);
    d = advance(d, tpl.frequency);
  }
  return out;
}

function advance(date: IsoDate, frequency: RecurringTemplate['frequency']): IsoDate {
  const d = parseISO(date);
  switch (frequency) {
    case 'weekly': return iso(addDays(d, 7));
    case 'biweekly': return iso(addDays(d, 14));
    case 'annual': return iso(addMonths(d, 12));
    case 'monthly':
    default: return iso(addMonths(d, 1));
  }
}
