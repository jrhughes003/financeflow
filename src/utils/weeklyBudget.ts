/*
 * The month's budget, cut into weeks.
 *
 * A monthly budget only says "don't pass this by the 31st", which is no help
 * on the 4th: a big first weekend looks fine against a month-sized number and
 * the shortfall turns up in week four. Cutting the budget into weekly
 * allowances makes the overspend visible in the week it happens.
 *
 * Two choices shape the numbers:
 *
 *   Bills are taken off the top. Rent on the 1st is not week one's spending,
 *   and charging it there would make every first week look blown. What is left
 *   after bills (posted, plus those still due this month) is the money the
 *   weeks share.
 *
 *   Allowances rebalance. Each week gets an even per-day share of what is left
 *   at its start, so an overspent week shrinks every week after it and an
 *   underspent one gives them room. A static even split would keep showing the
 *   week-three allowance you no longer have.
 */

import type { Money } from '../types/domain';

/** Sunday = 0, as Date.prototype.getDay. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type WeekStatus = 'closed' | 'current' | 'upcoming';

export interface WeekSlice {
  /** First and last day of month in the week, 1-based and inclusive. */
  start: number;
  end: number;
  days: number;
  status: WeekStatus;
  /** What this week may spend: an even share of what was left when it began. */
  allowance: Money;
  /** The same week's share if the month were split evenly and never rebalanced. */
  plan: Money;
  /** Discretionary spending dated in the week. */
  spent: Money;
  /** Bills that posted in the week. Shown, but not charged to the allowance. */
  bills: Money;
}

export interface WeeklyBudget {
  weeks: WeekSlice[];
  /** Budget left for the weeks once this month's bills are taken off. */
  discretionaryBudget: Money;
  /** Bills posted this month plus those still due. */
  bills: Money;
  /** Index of the week containing today, or null outside the current month. */
  current: number | null;
  /**
   * Plan to date minus spending to date, at the start of the current week:
   * positive is money banked from earlier weeks, negative is an overspend
   * the rest of the month now has to absorb.
   */
  carryIn: Money;
}

export interface WeeklyBudgetInput {
  year: number;
  month: number;
  /** Total monthly budget, bills included. */
  budget: Money;
  /** This month's spending; `fixed` marks bills and recurring charges. */
  transactions: { date: string; amount: Money; fixed: boolean }[];
  /** Bills expected to post after today and before the month ends. */
  billsDue: Money;
  /** Day of month it is today: 0 before the month starts, past the end once it's closed. */
  today: number;
  /**
   * Monday by default, so a weekend falls in one week rather than across two:
   * it is usually the most expensive stretch, and split, it can hide.
   */
  weekStartsOn?: Weekday;
}

/** A partial week at either end of the month shorter than this joins its neighbour. */
export const MIN_EDGE_WEEK_DAYS = 3;

/**
 * Calendar weeks of the month, clipped to its first and last days.
 *
 * A month starting on a Sunday would otherwise open with a one-day "week",
 * whose allowance is too small to mean anything, so short stubs at either end
 * are folded into the week next to them.
 */
export function weeksOfMonth(year: number, month: number, weekStartsOn: Weekday = 1): { start: number; end: number }[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const out: { start: number; end: number }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    if (d === 1 || new Date(year, month, d).getDay() === weekStartsOn) out.push({ start: d, end: d });
    out[out.length - 1].end = d;
  }
  const length = (w: { start: number; end: number }) => w.end - w.start + 1;
  if (out.length > 1 && length(out[0]) < MIN_EDGE_WEEK_DAYS) out[1].start = out.shift()!.start;
  if (out.length > 1 && length(out[out.length - 1]) < MIN_EDGE_WEEK_DAYS) out[out.length - 2].end = out.pop()!.end;
  return out;
}

export function buildWeeklyBudget(input: WeeklyBudgetInput): WeeklyBudget {
  const {
    year, month, budget, transactions, billsDue, today, weekStartsOn = 1,
  } = input;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const spentByDay = new Array<number>(daysInMonth + 1).fill(0);
  const billsByDay = new Array<number>(daysInMonth + 1).fill(0);
  let billsPosted = 0;
  transactions.forEach(t => {
    const day = Number(t.date.slice(8, 10));
    if (!(day >= 1 && day <= daysInMonth)) return;
    if (t.fixed) {
      billsByDay[day] += t.amount;
      billsPosted += t.amount;
    } else {
      spentByDay[day] += t.amount;
    }
  });
  const sum = (arr: number[], from: number, to: number) => arr.slice(from, to + 1).reduce((a, b) => a + b, 0);

  const bills = billsPosted + Math.max(0, billsDue);
  const discretionaryBudget = Math.max(0, budget - bills);

  let left = discretionaryBudget;
  let current: number | null = null;
  let carryIn = 0;
  const weeks = weeksOfMonth(year, month, weekStartsOn).map(({ start, end }, i): WeekSlice => {
    const days = end - start + 1;
    const status: WeekStatus = today > end ? 'closed' : today >= start ? 'current' : 'upcoming';
    const allowance = (Math.max(0, left) * days) / (daysInMonth - start + 1);
    const plan = (discretionaryBudget * days) / daysInMonth;
    const spent = sum(spentByDay, start, end);

    if (status === 'current') {
      current = i;
      carryIn = (discretionaryBudget * (start - 1)) / daysInMonth - sum(spentByDay, 1, start - 1);
    }
    // What the weeks after this one inherit. A closed week passes on what it
    // actually spent. The current one is assumed to spend its allowance, or
    // what it has already spent if that's more, and an upcoming one its allowance.
    left -= status === 'closed' ? spent : status === 'current' ? Math.max(spent, allowance) : allowance;

    return {
      start, end, days, status, allowance, plan, spent, bills: sum(billsByDay, start, end),
    };
  });

  return { weeks, discretionaryBudget, bills, current, carryIn };
}
