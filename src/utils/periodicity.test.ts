// Tests for autocorrelation-based period detection.
//
// Two things are being pinned here, and the second matters more than the first.
// One: the cadences the app cares about are found, including on the three messy
// shapes that defeat the gap-bucketing detectors in recurring.ts and insights.ts
// — a skipped month, a few days of drift, and an unrelated charge at the same
// merchant. Two: nothing is found in data that has no pattern in it. A detector
// that always answers is worse than no detector, so the non-periodic cases are
// asserted hard, over many seeds, and with the fixtures that produced the
// documented confidence numbers left in place.
//
// Every random fixture is seeded, so a failure reproduces exactly.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  detectPeriod, periodLabel, isoToDayIndex, dayIndexToIso,
} from './periodicity';
import type { PeriodLabel } from './periodicity';
import type { IsoDate, RecurringFrequency } from '../types/domain';

// --- helpers ----------------------------------------------------------------

/** Explicit unwrap: a bare `!` would hide which fixture broke. */
function dayIndex(date: IsoDate): number {
  const idx = isoToDayIndex(date);
  if (idx === null) throw new Error(`unreachable: ${date} did not parse`);
  return idx;
}

function detected(dates: IsoDate[], options?: Parameters<typeof detectPeriod>[1]) {
  const result = detectPeriod(dates, options);
  if (!result) throw new Error(`expected a detection for ${JSON.stringify(dates)}`);
  return result;
}

/** `count` dates `step` days apart. */
function everyNDays(start: IsoDate, step: number, count: number): IsoDate[] {
  const base = dayIndex(start);
  return Array.from({ length: count }, (_, i) => dayIndexToIso(base + i * step));
}

/**
 * `count` dates on the same day of each month, offset by `jitter(i)` days.
 * Built from calendar months rather than a 30-day step, which is the whole point:
 * the gaps it produces are 28, 30 and 31, never a constant.
 */
function everyMonth(
  start: IsoDate, count: number, jitter: (i: number) => number = () => 0,
): IsoDate[] {
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  const day = start.slice(8, 10);
  return Array.from({ length: count }, (_, i) => {
    const total = month - 1 + i;
    const y = year + Math.floor(total / 12);
    const m = (total % 12) + 1;
    return dayIndexToIso(dayIndex(`${y}-${String(m).padStart(2, '0')}-${day}`) + jitter(i));
  });
}

/** mulberry32: a seeded PRNG, so "random" fixtures are reproducible fixtures. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDates(seed: number, count: number, spanDays: number, start = '2024-01-01'): IsoDate[] {
  const random = seeded(seed);
  const base = dayIndex(start);
  return Array.from({ length: count }, () => dayIndexToIso(base + Math.floor(random() * spanDays)));
}

// --- date arithmetic --------------------------------------------------------

describe('day index conversion', () => {
  it('agrees with UTC-based arithmetic across a century, without parsing a date string', () => {
    // Date.UTC is the one Date path with no timezone in it, so it is a fair
    // oracle for the integer arithmetic the module uses instead.
    for (let index = -25000; index <= 25000; index += 7) {
      const iso = dayIndexToIso(index);
      const oracle = new Date(Date.UTC(1970, 0, 1 + index)).toISOString().slice(0, 10);
      expect(iso).toBe(oracle);
      expect(isoToDayIndex(iso)).toBe(index);
    }
  });

  it('round-trips every date fast-check can invent', () => {
    fc.assert(
      fc.property(fc.integer({ min: -40000, max: 40000 }), index => {
        expect(isoToDayIndex(dayIndexToIso(index))).toBe(index);
      }),
      { seed: 20260928, numRuns: 500 },
    );
  });

  it('anchors the epoch and handles leap days', () => {
    expect(dayIndex('1970-01-01')).toBe(0);
    expect(dayIndex('2024-02-29') - dayIndex('2024-02-28')).toBe(1);
    expect(dayIndex('2100-03-01') - dayIndex('2100-02-28')).toBe(1); // 2100 is not a leap year
  });

  it('rejects what it cannot use and truncates what it can', () => {
    expect(isoToDayIndex('')).toBeNull();
    expect(isoToDayIndex('not a date')).toBeNull();
    expect(isoToDayIndex('2026-13-01')).toBeNull();
    expect(isoToDayIndex('2026-00-10')).toBeNull();
    expect(isoToDayIndex('2026-02-30')).toBeNull(); // no such day
    expect(isoToDayIndex('2026-01-15T09:30:00Z')).toBe(dayIndex('2026-01-15'));
  });
});

// --- vocabulary -------------------------------------------------------------

describe('periodLabel', () => {
  it('names each cadence with a word the app already uses', () => {
    expect(periodLabel(7)).toBe('weekly');
    expect(periodLabel(14)).toBe('biweekly');
    expect(periodLabel(15.22)).toBe('semi-monthly');
    expect(periodLabel(30.44)).toBe('monthly');
    expect(periodLabel(91.31)).toBe('quarterly');
    expect(periodLabel(182.62)).toBe('semiannual');
    expect(periodLabel(365.25)).toBe('annual');
  });

  it('tolerates a rounded period', () => {
    expect(periodLabel(30)).toBe('monthly');
    expect(periodLabel(31)).toBe('monthly');
    expect(periodLabel(90)).toBe('quarterly');
    expect(periodLabel(365)).toBe('annual');
  });

  it('returns null rather than inventing a name for a cadence with none', () => {
    expect(periodLabel(0)).toBeNull();
    expect(periodLabel(3)).toBeNull();
    expect(periodLabel(45)).toBeNull();
    expect(periodLabel(250)).toBeNull();
  });

  it('stays assignable to the RecurringFrequency vocabulary it borrows', () => {
    const frequencies: RecurringFrequency[] = ['weekly', 'biweekly', 'monthly', 'annual'];
    const labels: PeriodLabel[] = frequencies;
    expect(labels).toEqual(frequencies);
  });
});

// --- clean cadences ---------------------------------------------------------

describe('detectPeriod on clean series', () => {
  it('detects weekly', () => {
    const result = detected(everyNDays('2026-01-05', 7, 12));
    expect(periodLabel(result.periodDays)).toBe('weekly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.occurrences).toBe(12);
    expect(result.nextExpected).toBe('2026-03-30');
    expect(result.method).toBe('autocorrelation');
  });

  it('detects biweekly', () => {
    const result = detected(everyNDays('2026-01-05', 14, 10));
    expect(periodLabel(result.periodDays)).toBe('biweekly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.nextExpected).toBe('2026-05-25');
  });

  it('detects monthly', () => {
    const result = detected(everyMonth('2026-01-15', 12));
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.nextExpected).toBe('2027-01-15');
  });

  it('detects semi-monthly, which is neither a fixed step nor a whole month', () => {
    const dates = Array.from({ length: 24 }, (_, i) => {
      const total = Math.floor(i / 2);
      const y = 2026 + Math.floor(total / 12);
      const m = String((total % 12) + 1).padStart(2, '0');
      return `${y}-${m}-${i % 2 === 0 ? '01' : '15'}`;
    });
    const result = detected(dates);
    expect(periodLabel(result.periodDays)).toBe('semi-monthly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects quarterly', () => {
    const result = detected(everyMonth('2024-02-08', 40).filter((_, i) => i % 3 === 0));
    expect(periodLabel(result.periodDays)).toBe('quarterly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.nextExpected).toBe('2027-08-08');
  });

  it('detects annual', () => {
    const result = detected(everyMonth('2018-03-10', 100).filter((_, i) => i % 12 === 0));
    expect(periodLabel(result.periodDays)).toBe('annual');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.nextExpected).toBe('2027-03-10');
  });

  it('picks the fundamental, not a harmonic: a weekly series is not biweekly', () => {
    // Every weekly series also repeats every 14, 21 and 28 days. The longer
    // cadence can only explain half the charges, which is what rules it out.
    const result = detected(everyNDays('2026-02-02', 7, 16));
    expect(periodLabel(result.periodDays)).toBe('weekly');
  });
});

// --- the cases gap bucketing gets wrong -------------------------------------

describe('detectPeriod on messy real-world series', () => {
  it('still calls a monthly series monthly when a month is skipped', () => {
    // The case that defeats both existing detectors: the April charge is missing,
    // so one gap reads 61 days. classifyPeriod() in insights.ts requires every
    // gap to agree and rejects the merchant outright; classifyFrequency() in
    // recurring.ts averages the gaps to ~36 days. Autocorrelation loses one slot
    // out of eight and keeps the cadence.
    const dates = everyMonth('2026-01-15', 8).filter(d => !d.startsWith('2026-04'));
    expect(dates).toHaveLength(7);

    const result = detected(dates);
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.occurrences).toBe(7);
    // The prediction still follows the grid, not the last charge plus 30 days.
    expect(result.nextExpected).toBe('2026-09-15');
  });

  it('survives two skipped months out of twelve', () => {
    const dates = everyMonth('2026-01-20', 12)
      .filter(d => !d.startsWith('2026-05') && !d.startsWith('2026-09'));
    const result = detected(dates);
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('still calls a monthly series monthly with +/-3 days of jitter', () => {
    const random = seeded(4);
    const jitter = (): number => Math.round(random() * 6) - 3;
    const dates = everyMonth('2026-01-15', 12, jitter);
    // Seeded, so these are the exact gaps under test: never a constant.
    // Offsets run the full +3..-3, including a 37-day gap between July and
    // August where one charge slips late and the next slips early.
    expect(dates).toEqual([
      '2026-01-18', '2026-02-14', '2026-03-13', '2026-04-12', '2026-05-13',
      '2026-06-15', '2026-07-12', '2026-08-18', '2026-09-16', '2026-10-16',
      '2026-11-17', '2026-12-14',
    ]);

    const result = detected(dates);
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('handles a bill on the 1st that drifts off weekends', () => {
    // Gaps of 28/31/30/33 — the average survives, the all-gaps-agree test does
    // not, which is precisely insights.ts's failure mode.
    const drift = [0, 2, 1, 0, 3, 0, 1, 2, 0, 0, 3, 1];
    const result = detected(everyMonth('2026-01-01', 12, i => drift[i]));
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('still calls a monthly series monthly with one extra one-off charge', () => {
    // An Amazon subscription plus a single unrelated Amazon purchase. The extra
    // date inserts a 16-day gap, which drags recurring.ts's average by a third of
    // a period; here it costs one occurrence out of eleven.
    const dates = [...everyMonth('2026-01-15', 10), '2026-03-02'];
    const result = detected(dates);
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.occurrences).toBe(11);
    expect(result.nextExpected).toBe('2026-11-15');
  });

  it('is not fooled into anchoring on the one-off, wherever it falls', () => {
    // The first date is the odd one out, so a detector that anchors on the first
    // occurrence would put every predicted slot two days off.
    const dates = ['2026-01-02', ...everyMonth('2026-01-20', 9)];
    const result = detected(dates);
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.nextExpected).toBe('2026-10-20');
  });
});

// --- non-periodic input -----------------------------------------------------

describe('detectPeriod on data with no pattern', () => {
  const seeds = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 20260928];

  it('returns null for random dates, on every seed', () => {
    for (const seed of seeds) {
      for (const [count, span] of [[6, 365], [9, 365], [12, 730], [16, 1460]] as const) {
        const dates = randomDates(seed, count, span);
        expect(detectPeriod(dates), `seed ${seed} count ${count} span ${span}`).toBeNull();
      }
    }
  });

  it('scores random dates far below the reporting floor even with the floor removed', () => {
    // The floor is what makes the assertion above pass, so assert the underlying
    // number too: with the gate opened, nothing random gets near a real cadence
    // (a real one scores 0.74 at its worst in this file).
    for (const seed of seeds) {
      for (const [count, span] of [[6, 365], [9, 365], [12, 730], [16, 1460]] as const) {
        const result = detectPeriod(randomDates(seed, count, span), { minConfidence: 0 });
        const confidence = result ? result.confidence : 0;
        expect(confidence, `seed ${seed} count ${count} span ${span}`).toBeLessThan(0.5);
      }
    }
  });

  it('holds up as a property, not just on the seeds that were tried', () => {
    const base = dayIndex('2024-01-01');
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 900 }), { minLength: 6, maxLength: 16 }),
        offsets => {
          const dates = offsets.map(o => dayIndexToIso(base + o));
          const result = detectPeriod(dates, { minConfidence: 0 });
          // 0.6 is the threshold recommended for user-visible detections; no
          // arrangement of unrelated dates may reach it.
          expect(result ? result.confidence : 0).toBeLessThan(0.6);
        },
      ),
      { seed: 20260928, numRuns: 400 },
    );
  });

  it('returns null for a run of consecutive days', () => {
    // Daily spending is not a cadence this module models, and a weekly grid can
    // only place one day in seven, so it must decline rather than answer 'weekly'.
    expect(detectPeriod(everyNDays('2026-03-01', 1, 21))).toBeNull();
  });

  it('returns null for two clusters with nothing periodic between them', () => {
    expect(detectPeriod([
      '2026-01-03', '2026-01-04', '2026-01-09',
      '2026-07-18', '2026-07-21', '2026-07-22',
    ])).toBeNull();
  });
});

// --- short and degenerate input ---------------------------------------------

describe('detectPeriod on short or degenerate input', () => {
  it('returns null for empty input', () => {
    expect(detectPeriod([])).toBeNull();
  });

  it('treats a missing list as empty, the way the other detectors do', () => {
    // recurring.ts guards `transactions || []` for the same reason: the callers
    // are still .js in places, where undefined does arrive.
    expect(detectPeriod(undefined as unknown as IsoDate[])).toBeNull();
    expect(detectPeriod(null as unknown as IsoDate[])).toBeNull();
  });

  it('returns null for a single date', () => {
    expect(detectPeriod(['2026-01-15'])).toBeNull();
  });

  it('returns null for a single date repeated', () => {
    expect(detectPeriod(['2026-01-15', '2026-01-15', '2026-01-15'])).toBeNull();
  });

  it('returns null for two occurrences, because one gap is not a pattern', () => {
    // The honest answer: two dates are perfectly periodic by construction, so
    // there is nothing to be confident about and the default refuses to guess.
    expect(detectPeriod(['2026-01-15', '2026-02-15'])).toBeNull();
    expect(detectPeriod(['2026-01-15', '2026-01-22'])).toBeNull();
  });

  it('caps a two-occurrence guess at a third, when one is asked for explicitly', () => {
    const result = detected(
      ['2026-01-15', '2026-02-15'],
      { minOccurrences: 2, minConfidence: 0 },
    );
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.method).toBe('single-gap');
    expect(result.confidence).toBeLessThanOrEqual(1 / 3);
    expect(result.nextExpected).toBe('2026-03-15');
  });

  it('honours a raised minOccurrences', () => {
    const dates = everyMonth('2026-01-15', 5);
    expect(detectPeriod(dates, { minOccurrences: 6 })).toBeNull();
    expect(detected(dates, { minOccurrences: 5 }).occurrences).toBe(5);
  });

  it('honours a raised minConfidence', () => {
    const dates = [...everyMonth('2026-01-15', 10), '2026-03-02'];
    expect(detected(dates).confidence).toBeLessThan(0.9);
    expect(detectPeriod(dates, { minConfidence: 0.9 })).toBeNull();
  });

  it('collapses duplicate dates instead of counting them as denser spending', () => {
    const dates = everyMonth('2026-01-15', 6);
    const withDuplicates = [...dates, ...dates.slice(0, 3)];
    const result = detected(withDuplicates);
    expect(result.occurrences).toBe(6);
    expect(result).toEqual(detected(dates));
  });

  it('sorts internally and does not mutate the caller array', () => {
    const shuffled = ['2026-04-15', '2026-01-15', '2026-06-15', '2026-03-15', '2026-02-15', '2026-05-15'];
    const before = [...shuffled];
    const result = detected(shuffled);
    expect(shuffled).toEqual(before);
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.nextExpected).toBe('2026-07-15');
    expect(result).toEqual(detected(everyMonth('2026-01-15', 6)));
  });

  it('drops entries it cannot parse rather than skewing the series', () => {
    const dates = [...everyMonth('2026-01-15', 6), '', 'yesterday', '2026-02-31'];
    const result = detected(dates);
    expect(result.occurrences).toBe(6);
    expect(periodLabel(result.periodDays)).toBe('monthly');
  });

  it('is deterministic: the same input gives the same answer', () => {
    const dates = everyMonth('2026-01-15', 9, i => (i % 3) - 1);
    expect(detectPeriod(dates)).toEqual(detectPeriod(dates));
  });
});

// --- nextExpected -----------------------------------------------------------

describe('nextExpected', () => {
  it('crosses a month boundary on the day of the month, not on day + 30', () => {
    const result = detected(everyMonth('2025-10-20', 6)); // last charge 2026-03-20
    expect(result.nextExpected).toBe('2026-04-20');
  });

  it('crosses a year boundary', () => {
    const result = detected(everyMonth('2025-08-12', 6));
    expect(result.nextExpected).toBe('2026-02-12');
    expect(detected(everyNDays('2025-12-04', 7, 8)).nextExpected).toBe('2026-01-29');
  });

  it('clamps into a short month the way a bank does', () => {
    // A bill on the 31st posts on the 28th in February and returns to the 31st
    // afterwards. Adding 30 days instead would walk the prediction backwards
    // through the calendar one month at a time.
    const dates = ['2025-10-31', '2025-11-30', '2025-12-31', '2026-01-31', '2026-02-28', '2026-03-31'];
    const result = detected(dates);
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.nextExpected).toBe('2026-04-30');
  });

  it('survives a leap day', () => {
    const result = detected(['2023-12-29', '2024-01-29', '2024-02-29', '2024-03-29', '2024-04-29']);
    expect(result.nextExpected).toBe('2024-05-29');
  });

  it('skips forward past an injected today, and never reads the clock itself', () => {
    const dates = everyMonth('2025-09-20', 6); // last occurrence 2026-02-20
    expect(detected(dates).nextExpected).toBe('2026-03-20');
    // `today` only moves the prediction forward; it never changes the cadence.
    expect(detected(dates, { today: '2026-02-25' }).nextExpected).toBe('2026-03-20');
    expect(detected(dates, { today: '2026-05-01' }).nextExpected).toBe('2026-05-20');
    expect(detected(dates, { today: '2026-05-20' }).nextExpected).toBe('2026-06-20');
    // A past `today` is ignored rather than rewinding the prediction.
    expect(detected(dates, { today: '2020-01-01' }).nextExpected).toBe('2026-03-20');
    // Nothing above depended on the real date, which is the point: there is no
    // new Date() inside the module, so these results are fixed forever.
    expect(detected(dates, { today: dayIndexToIso(dayIndex('2030-01-01')) }).nextExpected)
      .toBe('2030-01-20');
  });

  it('predicts one step past the last occurrence for every cadence', () => {
    expect(detected(everyNDays('2026-01-06', 7, 10)).nextExpected).toBe('2026-03-17');
    expect(detected(everyNDays('2026-01-06', 14, 8)).nextExpected).toBe('2026-04-28');
    expect(detected(everyMonth('2024-01-09', 40).filter((_, i) => i % 3 === 0)).nextExpected)
      .toBe('2027-07-09');
    expect(detected(everyMonth('2016-06-22', 130).filter((_, i) => i % 12 === 0)).nextExpected)
      .toBe('2027-06-22');
  });
});

// --- long histories ---------------------------------------------------------

describe('detectPeriod on long histories', () => {
  it('does not drift over ten years of monthly charges', () => {
    // The reason the grid steps by calendar months: 120 steps of a nominal 30.44
    // days would land 50-odd days away from the 15th by the end.
    const dates = everyMonth('2016-01-15', 120);
    const result = detected(dates);
    expect(periodLabel(result.periodDays)).toBe('monthly');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.nextExpected).toBe('2026-01-15');
  });

  it('handles ten years of weekly charges quickly', () => {
    const dates = everyNDays('2016-01-04', 7, 520);
    const started = Date.now();
    const result = detected(dates);
    expect(periodLabel(result.periodDays)).toBe('weekly');
    expect(result.occurrences).toBe(520);
    // Guards the anchor-deduplication and the moving matcher: the naive version
    // of both is quadratic and takes seconds on this input.
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
