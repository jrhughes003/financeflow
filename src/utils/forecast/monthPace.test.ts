/*
 * The month-end forecast.
 *
 * The case that prompted all of this is the last block: five days into
 * October, $64.79 of dining out against a history averaging about $1,165 a
 * month, and a forecast of $938. The old model could not do better because it
 * did not know those five days were Thu/Fri/Sat/Sun/Mon — an above-average
 * stretch — and because it weighted the evidence by the calendar rather than
 * by how much of it there was.
 */

import { describe, expect, it } from 'vitest';
import {
  recencyWeights, weekdayProfile, expectedOver, datesIn, forecastRemaining,
  EMPTY_PROFILE, RECENCY_DECAY, PRIOR_STRENGTH_DAYS, type WeekdayProfile,
} from './monthPace';

describe('recencyWeights', () => {
  it('sums to one', () => {
    for (const n of [1, 2, 3, 6, 12]) {
      expect(recencyWeights(n).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
  });

  it('puts the most weight on the most recent month', () => {
    const w = recencyWeights(3);
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[1]).toBeGreaterThan(w[2]);
  });

  it('gives a single month all of it', () => {
    expect(recencyWeights(1)).toEqual([1]);
  });

  it('handles nothing', () => {
    expect(recencyWeights(0)).toEqual([]);
  });

  it('falls back to a flat average at decay 1', () => {
    expect(recencyWeights(4, 1)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('weights the newest month at about half of three', () => {
    // The documented intent of RECENCY_DECAY, pinned so changing the constant
    // is a deliberate act rather than a drift.
    const [newest] = recencyWeights(3, RECENCY_DECAY);
    expect(newest).toBeGreaterThan(0.45);
    expect(newest).toBeLessThan(0.55);
  });
});

describe('weekdayProfile', () => {
  // Four weeks: $70 every Wednesday, $7 every other day.
  const evenMonth = {
    byWeekday: [28, 28, 28, 280, 28, 28, 28], // Sun..Sat, Wed = index 3
    dayCounts: [4, 4, 4, 4, 4, 4, 4],
  };

  it('averages per occurrence of the weekday, not per month', () => {
    const p = weekdayProfile([evenMonth]);
    expect(p[3]).toBeCloseTo(70, 6); // Wednesday
    expect(p[0]).toBeCloseTo(7, 6);
  });

  it('does not let a month with five Fridays inflate Friday', () => {
    // Same $7/Friday rate, but one month had five of them.
    const four = { byWeekday: [0, 0, 0, 0, 0, 28, 0], dayCounts: [4, 4, 4, 4, 4, 4, 4] };
    const five = { byWeekday: [0, 0, 0, 0, 0, 35, 0], dayCounts: [4, 4, 4, 4, 4, 5, 4] };
    expect(weekdayProfile([four, five])[5]).toBeCloseTo(7, 6);
  });

  it('weights recent months more', () => {
    const quiet = { byWeekday: [0, 0, 0, 0, 0, 0, 0], dayCounts: [4, 4, 4, 4, 4, 4, 4] };
    const busy = { byWeekday: [40, 40, 40, 40, 40, 40, 40], dayCounts: [4, 4, 4, 4, 4, 4, 4] };
    // Most recent first: quiet month leading should pull the profile down
    // below the flat mean of 5.
    const recentQuiet = weekdayProfile([quiet, busy]);
    const recentBusy = weekdayProfile([busy, quiet]);
    expect(recentQuiet[0]).toBeLessThan(5);
    expect(recentBusy[0]).toBeGreaterThan(5);
  });

  it('falls back to the overall average for a weekday never seen', () => {
    // No Tuesdays recorded. Claiming $0 would say "you never spend on a
    // Tuesday", which from a short history is a sampling accident.
    const m = { byWeekday: [10, 10, 0, 10, 10, 10, 10], dayCounts: [4, 4, 0, 4, 4, 4, 4] };
    const p = weekdayProfile([m]);
    expect(p[2]).toBeGreaterThan(0);
    expect(p[2]).toBeCloseTo(2.5, 6); // 60 spend / 24 days
  });

  it('returns zeroes for no history', () => {
    expect(weekdayProfile([])).toEqual(EMPTY_PROFILE);
  });
});

describe('expectedOver and datesIn', () => {
  it('values a run of days by the weekday they fall on', () => {
    const profile = [1, 2, 3, 4, 5, 6, 7] as unknown as WeekdayProfile;
    // 1 Oct 2026 is a Thursday (getDay() === 4).
    const dates = datesIn(2026, 9, 1, 3); // Thu, Fri, Sat
    expect(dates.map(d => d.getDay())).toEqual([4, 5, 6]);
    expect(expectedOver(dates, profile)).toBe(5 + 6 + 7);
  });

  it('counts every day of the month exactly once', () => {
    expect(datesIn(2026, 9, 1, 31)).toHaveLength(31);
    expect(datesIn(2026, 1, 1, 28)).toHaveLength(28);
  });

  it('returns nothing when the range is empty', () => {
    expect(datesIn(2026, 9, 32, 31)).toEqual([]);
    expect(expectedOver([], [1, 1, 1, 1, 1, 1, 1] as unknown as WeekdayProfile)).toBe(0);
  });
});

describe('forecastRemaining', () => {
  const flat = [10, 10, 10, 10, 10, 10, 10] as unknown as WeekdayProfile;

  it('leaves the forecast at the usual rate when spending is exactly normal', () => {
    const r = forecastRemaining({
      actual: 50, // 5 days x $10
      elapsedDates: datesIn(2026, 9, 1, 5),
      remainingDates: datesIn(2026, 9, 6, 31),
      profile: flat,
      historyMonths: 3,
    });
    expect(r.observedRatio).toBeCloseTo(1, 6);
    expect(r.appliedRatio).toBeCloseTo(1, 6);
    expect(r.remaining).toBeCloseTo(260, 6); // 26 days x $10
  });

  it('moves the forecast toward, but not all the way to, the observed rate', () => {
    const r = forecastRemaining({
      actual: 25, // half the usual
      elapsedDates: datesIn(2026, 9, 1, 5),
      remainingDates: datesIn(2026, 9, 6, 31),
      profile: flat,
      historyMonths: 3,
    });
    expect(r.observedRatio).toBeCloseTo(0.5, 6);
    // Shrunk toward 1 by the unobserved part of the month.
    expect(r.appliedRatio).toBeGreaterThan(0.5);
    expect(r.appliedRatio).toBeLessThan(1);
    expect(r.remaining).toBeGreaterThan(r.paceOnly);
    expect(r.remaining).toBeLessThan(r.historyOnly);
  });

  it('trusts this month more as more of it passes', () => {
    const at = (day: number) => forecastRemaining({
      actual: 10 * day * 0.5, // consistently half the usual rate
      elapsedDates: datesIn(2026, 9, 1, day),
      remainingDates: datesIn(2026, 9, day + 1, 31),
      profile: flat,
      historyMonths: 3,
    });
    expect(at(5).weight).toBeLessThan(at(15).weight);
    expect(at(15).weight).toBeLessThan(at(25).weight);
    // and the applied ratio converges on what is actually happening
    expect(at(25).appliedRatio).toBeLessThan(at(5).appliedRatio);
  });

  it('reaches half weight at the documented number of days', () => {
    const r = forecastRemaining({
      actual: 0,
      elapsedDates: datesIn(2026, 9, 1, PRIOR_STRENGTH_DAYS),
      remainingDates: datesIn(2026, 9, PRIOR_STRENGTH_DAYS + 1, 31),
      profile: flat,
      historyMonths: 3,
    });
    expect(r.weight).toBeCloseTo(0.5, 6);
  });

  it('knows an expensive opening stretch from a cheap one', () => {
    // $100 on weekends, $10 on weekdays.
    const weekendHeavy = [100, 10, 10, 10, 10, 10, 100] as unknown as WeekdayProfile;
    // 3-5 Oct 2026 is Sat, Sun, Mon.
    const overWeekend = forecastRemaining({
      actual: 60, elapsedDates: datesIn(2026, 9, 3, 5),
      remainingDates: datesIn(2026, 9, 6, 31), profile: weekendHeavy, historyMonths: 3,
    });
    // 5-7 Oct 2026 is Mon, Tue, Wed.
    const overWeekdays = forecastRemaining({
      actual: 60, elapsedDates: datesIn(2026, 9, 5, 7),
      remainingDates: datesIn(2026, 9, 8, 31), profile: weekendHeavy, historyMonths: 3,
    });
    // The same $60 is a shortfall across a weekend and an overspend across
    // three weekdays. A uniform model would call them identical.
    expect(overWeekend.observedRatio).toBeLessThan(1);
    expect(overWeekdays.observedRatio).toBeGreaterThan(1);
  });

  it('falls back to a straight line with no history', () => {
    const r = forecastRemaining({
      actual: 50,
      elapsedDates: datesIn(2026, 9, 1, 5),
      remainingDates: datesIn(2026, 9, 6, 31),
      profile: EMPTY_PROFILE,
      historyMonths: 0,
    });
    expect(r.observedRatio).toBeNull();
    expect(r.remaining).toBeCloseTo(260, 6); // $10/day x 26
  });

  it('does not divide by zero when the profile expects nothing', () => {
    const r = forecastRemaining({
      actual: 30,
      elapsedDates: datesIn(2026, 9, 1, 5),
      remainingDates: datesIn(2026, 9, 6, 31),
      profile: EMPTY_PROFILE,
      historyMonths: 3,
    });
    expect(Number.isFinite(r.remaining)).toBe(true);
    expect(r.observedRatio).toBeNull();
  });

  it('handles the last day of the month', () => {
    const r = forecastRemaining({
      actual: 310,
      elapsedDates: datesIn(2026, 9, 1, 31),
      remainingDates: [],
      profile: flat,
      historyMonths: 3,
    });
    expect(r.remaining).toBe(0);
  });

  it('projects upward for a category running hot', () => {
    const r = forecastRemaining({
      actual: 150, // triple the usual 5-day rate
      elapsedDates: datesIn(2026, 9, 1, 5),
      remainingDates: datesIn(2026, 9, 6, 31),
      profile: flat,
      historyMonths: 3,
    });
    expect(r.observedRatio).toBeCloseTo(3, 6);
    expect(r.remaining).toBeGreaterThan(r.historyOnly);
  });
});

describe('the October dining-out case', () => {
  // The real shape: a profile averaging ~$37.98/day overall, weighted toward
  // Wednesday and Sunday, and a month opening Thu/Fri/Sat/Sun/Mon.
  const profile = [52.23, 18.99, 20.02, 56.39, 44.80, 35.19, 36.86] as unknown as WeekdayProfile;
  const result = forecastRemaining({
    actual: 64.79,
    elapsedDates: datesIn(2026, 9, 1, 5),
    remainingDates: datesIn(2026, 9, 6, 31),
    profile,
    historyMonths: 3,
  });

  it('sees that the elapsed days were above average', () => {
    // Five average days would be ~$190; these five profile higher still.
    expect(result.expectedSoFar).toBeGreaterThan(180);
  });

  it('reports the month running at about a third of its usual rate', () => {
    expect(result.observedRatio).toBeGreaterThan(0.3);
    expect(result.observedRatio).toBeLessThan(0.4);
  });

  it('lands well below the old uniform-day forecast', () => {
    // The old model projected $938 on these inputs by treating all days alike
    // and weighting the month by the calendar.
    expect(64.79 + result.remaining).toBeLessThan(900);
  });

  it('still lands above the naive pace, because five days is thin evidence', () => {
    expect(64.79 + result.remaining).toBeGreaterThan(64.79 + result.paceOnly);
  });
});
