/*
 * Estimating what a category will cost by the end of the month.
 *
 * The model this replaces had three problems, all of which showed up on the
 * same screen: five days into October it forecast $938 of dining out against
 * $64.79 actually spent, and nothing on the page explained how.
 *
 *   It treated every day as interchangeable. Spending is not uniform across
 *   the week — one real ledger averages $18.99 on a Monday and $56.39 on a
 *   Wednesday — so "you are five days in" says little until you know *which*
 *   five. A month that opens Thu–Fri–Sat–Sun–Mon has already spent its
 *   expensive days; one that opens on a Monday has not.
 *
 *   It averaged the last three months flat, so a category trending down for
 *   two months was forecast from a number it had already left behind.
 *
 *   It weighted this month's evidence by elapsed/daysInMonth. That is not a
 *   measure of confidence, it is a measure of the calendar: at day 5 it put
 *   16% weight on what you had actually done and 84% on history, and would
 *   have done so whether you had three transactions or three hundred.
 *
 * What replaces it keeps the same shape — blend what you are doing with what
 * you usually do — but measures both properly, and reports its inputs so the
 * number can be argued with.
 */

import type { Money } from '../../types/domain';

/** Sunday-first, matching Date.prototype.getDay. */
export type WeekdayProfile = readonly [number, number, number, number, number, number, number];

export const EMPTY_PROFILE: WeekdayProfile = [0, 0, 0, 0, 0, 0, 0];

/**
 * How much a month of history still counts after one further month has passed.
 *
 * 0.6 puts roughly half the weight on the most recent month of three, which
 * tracks a changing habit without letting one unusual month dictate the
 * forecast. It is a judgement, not a fitted parameter, and it is here as a
 * named constant so it can be argued with rather than discovered.
 */
export const RECENCY_DECAY = 0.6;

/**
 * How many days of the current month it takes to match the pull of history.
 *
 * The weight on what you have actually done this month is
 * elapsed / (elapsed + PRIOR_STRENGTH_DAYS): half at day 5, two thirds at
 * day 10, three quarters at day 15.
 *
 * The old elapsed/daysInMonth gave a fifth of the weight at day 6 and nearly
 * all of it at day 30, which reads as confidence but is only the calendar —
 * and it meant an early month could spend at a third of its usual rate
 * through its most expensive days and barely move the forecast.
 *
 * It was ten days, which proved too slow in use: six days into a month spent
 * at 0.36x of a $1,100 dining habit, it still forecast $733 more against a
 * pace of $270, and an over-budget warning for a month that was on track. A
 * deliberate cutback is exactly the case a budget exists for, and a forecast
 * that refuses to believe it for two weeks is no help. Five days still gives
 * history at least half the say until day 5, so one quiet weekend cannot
 * swing it alone.
 */
export const PRIOR_STRENGTH_DAYS = 5;

/**
 * Weights for `count` months, most recent first, summing to 1.
 *
 * Exponential decay rather than a window, so adding a fourth month of history
 * never causes a step change in the forecast.
 */
export function recencyWeights(count: number, decay = RECENCY_DECAY): number[] {
  if (count <= 0) return [];
  const raw = Array.from({ length: count }, (_, i) => decay ** i);
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map(w => w / total);
}

/** One month's totals for a category, split by the weekday each fell on. */
export interface MonthWeekdayTotals {
  /** Spend on each weekday within the month, Sunday first. */
  byWeekday: readonly number[];
  /** How many of each weekday the month contained, Sunday first. */
  dayCounts: readonly number[];
}

/**
 * Average spend per weekday, recency-weighted across months.
 *
 * Per *occurrence* of that weekday, not per month, so a month containing five
 * Fridays does not inflate the Friday figure.
 *
 * A weekday nothing is known about falls back to the overall daily average
 * rather than zero. Zero would claim you never spend on a Tuesday, which from
 * two months of data is a sampling accident, not a habit.
 */
export function weekdayProfile(months: MonthWeekdayTotals[], decay = RECENCY_DECAY): WeekdayProfile {
  if (!months.length) return EMPTY_PROFILE;
  const weights = recencyWeights(months.length, decay);

  const spend = new Array(7).fill(0);
  const days = new Array(7).fill(0);
  months.forEach((m, i) => {
    const w = weights[i];
    for (let d = 0; d < 7; d++) {
      spend[d] += w * (m.byWeekday[d] || 0);
      days[d] += w * (m.dayCounts[d] || 0);
    }
  });

  const totalSpend = spend.reduce((a, b) => a + b, 0);
  const totalDays = days.reduce((a, b) => a + b, 0);
  const overall = totalDays > 0 ? totalSpend / totalDays : 0;

  return spend.map((s, d) => (days[d] > 0 ? s / days[d] : overall)) as unknown as WeekdayProfile;
}

/** Sum of the profile over a specific run of dates. */
export function expectedOver(dates: Date[], profile: WeekdayProfile): Money {
  return dates.reduce((sum, d) => sum + (profile[d.getDay()] || 0), 0);
}

/** Every date in a month, from `from` to `to` inclusive (1-based days). */
export function datesIn(year: number, month: number, from: number, to: number): Date[] {
  const out: Date[] = [];
  for (let d = from; d <= to; d++) out.push(new Date(year, month, d));
  return out;
}

export interface PaceInput {
  /** Discretionary spend so far this month, for one category. */
  actual: Money;
  /** The days that have already happened, including today. */
  elapsedDates: Date[];
  /** The days still to come. */
  remainingDates: Date[];
  profile: WeekdayProfile;
  /** How many months of history the profile was built from. */
  historyMonths: number;
  priorStrengthDays?: number;
}

export interface PaceResult {
  /** What the profile says the elapsed days should have cost. */
  expectedSoFar: Money;
  /** What the profile says the rest of the month will cost at your usual rate. */
  expectedRest: Money;
  /** actual / expectedSoFar. Above 1 means spending faster than usual. */
  observedRatio: number | null;
  /** The ratio actually applied to the rest of the month, after shrinkage. */
  appliedRatio: number;
  /** Weight given to this month's evidence. */
  weight: number;
  /** The forecast for the remaining days. */
  remaining: Money;
  /** Straight-line from this month only, for display beside the blend. */
  paceOnly: Money;
  /** Pure history, ignoring this month, for display beside the blend. */
  historyOnly: Money;
}

/**
 * Forecast the rest of the month for one category.
 *
 * The estimate is a *ratio against your own pattern* rather than a daily rate:
 * "you are running at 34% of normal" survives a lopsided opening week, where
 * "you are spending $12.96 a day" does not.
 *
 * With no history there is no pattern to compare against, so it falls back to
 * a straight line from this month — which is all the information there is.
 */
export function forecastRemaining(input: PaceInput): PaceResult {
  const {
    actual, elapsedDates, remainingDates, profile, historyMonths,
    priorStrengthDays = PRIOR_STRENGTH_DAYS,
  } = input;

  const expectedSoFar = expectedOver(elapsedDates, profile);
  const expectedRest = expectedOver(remainingDates, profile);
  const elapsed = elapsedDates.length;

  const paceOnly = elapsed > 0 ? (actual / elapsed) * remainingDates.length : 0;
  const historyOnly = expectedRest;

  if (!historyMonths || expectedSoFar <= 0) {
    // Nothing to compare against. Straight line, and say so by reporting a
    // null ratio rather than a fabricated 1.
    return {
      expectedSoFar, expectedRest, observedRatio: null, appliedRatio: 1,
      weight: 1, remaining: paceOnly, paceOnly, historyOnly,
    };
  }

  const observedRatio = actual / expectedSoFar;
  const weight = elapsed / (elapsed + priorStrengthDays);
  // Shrink toward 1 — "you will spend like you usually do" — by however much
  // of the month is still unobserved.
  const appliedRatio = weight * observedRatio + (1 - weight) * 1;

  return {
    expectedSoFar,
    expectedRest,
    observedRatio,
    appliedRatio,
    weight,
    remaining: expectedRest * appliedRatio,
    paceOnly,
    historyOnly,
  };
}
