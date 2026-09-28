// Period detection by autocorrelation over an occurrence series.
//
// WHY this exists alongside the two gap-bucketing detectors already in the tree:
// classifyFrequency() in recurring.ts averages the gaps between consecutive
// charges and asks which nominal cadence that average lands within 25% of, and
// classifyPeriod() in insights.ts is stricter still — *every* gap has to fall in
// the same bucket. Both read the series one adjacent pair at a time, so a single
// bad pair rewrites the answer, and real bank data supplies bad pairs:
//
//   * A skipped or missed month turns two 30-day gaps into one 61-day gap.
//     insights.ts rejects the merchant outright; recurring.ts pulls the average
//     to ~40 days and calls a monthly bill irregular.
//   * A subscription billed on the 1st drifts off weekends, so the gaps read
//     28/31/30/33. The average survives that; the all-gaps-agree test does not.
//   * One extra purchase at the same merchant inserts a 2-day gap, which drags
//     recurring.ts's average down by a large fraction of a period.
//
// Autocorrelation asks a different question: across the *whole* series, how well
// does "repeats every P days" line up with what was observed? A missing
// occurrence then costs one slot out of many rather than destroying the
// estimate, and a spurious occurrence costs one occurrence out of many. That is
// also why `confidence` is worth returning at all: it is the share of the series
// the cadence actually explains, so a caller can tell "eleven of twelve months,
// one skipped" from "three charges that happen to be a month apart". A detector
// that always returns something tells you nothing.
//
// Calendar months are not a fixed number of days, and a fixed lag cannot
// represent one. That is handled in two separate places:
//   1. The integer lag is only ever used to *nominate* a cadence, and it
//      correlates occurrences one period apart — never N periods apart — so the
//      error to absorb is one month's variation (28..31 days against a mean of
//      30.44) and not N months of accumulated drift. The per-cadence
//      `tolerance` covers exactly that.
//   2. Everything that has to be exact — the predicted grid that `confidence` is
//      measured against, and `nextExpected` — steps by whole calendar months
//      through addCivilMonths(), so a bill on the 31st stays on the 31st (clamped
//      in short months, which is how banks post it) and nothing drifts, however
//      long the history.
//
// Pure and deterministic: no I/O, and "today" is an injected parameter rather
// than a new Date() read inside, so every result here is reproducible.

import type { IsoDate, IncomeFrequency, RecurringFrequency } from '../types/domain';

/**
 * A cadence name, drawn from the vocabulary the app already uses rather than a
 * new one: RecurringFrequency in src/types/domain.ts covers weekly / biweekly /
 * monthly / annual, `Period['frequency']` in src/utils/insights.ts adds
 * quarterly and semiannual, and 'semi-monthly' is IncomeFrequency's. The
 * detector can find cadences RecurringFrequency deliberately has no word for
 * ("there is no semi-monthly cadence here"), so a caller that needs a
 * RecurringFrequency has to narrow rather than assume.
 */
export type PeriodLabel =
  | RecurringFrequency
  | Extract<IncomeFrequency, 'semi-monthly'>
  | 'quarterly'
  | 'semiannual';

/** How a result was reached. See `method` on PeriodDetection. */
export type DetectionMethod = 'autocorrelation' | 'single-gap';

export interface PeriodDetection {
  /**
   * The nominal length of the detected cadence in days — 30.44 for monthly, not
   * 30, because the mean calendar month is 30.44 days and pretending otherwise
   * is the bug this module exists to avoid. Pass it to periodLabel() for a name;
   * it identifies the cadence, it does not measure this particular series.
   */
  periodDays: number;
  /**
   * 0..1: how much of the series the cadence explains. Falls with every skipped
   * slot, every occurrence the cadence cannot place, and every day of jitter,
   * and is capped until the pattern has repeated often enough to mean anything.
   * Non-periodic input scores near zero.
   */
  confidence: number;
  /** Distinct occurrence dates considered, after duplicates were collapsed. */
  occurrences: number;
  /**
   * The next date the pattern predicts: the first grid date strictly after the
   * last occurrence, or after `today` when that was supplied and is later.
   */
  nextExpected: IsoDate;
  /**
   * 'single-gap' when there were only two occurrences — one gap is not a
   * pattern, so the period is a guess and `confidence` is capped accordingly.
   */
  method: DetectionMethod;
}

export interface DetectPeriodOptions {
  /**
   * Fewer occurrences than this and nothing is returned. Three is the floor
   * worth reporting: two dates are perfectly periodic by construction, so the
   * default refuses rather than flattering a single gap.
   */
  minOccurrences?: number;
  /** Results below this confidence come back as null instead. */
  minConfidence?: number;
  /** `YYYY-MM-DD`. Only moves `nextExpected` past slots already gone. */
  today?: IsoDate;
}

interface Cadence {
  label: PeriodLabel;
  /** Nominal days; also the integer autocorrelation lag once rounded. */
  days: number;
  /** Whole calendar months per period, or 0 when the cadence is days-based. */
  months: number;
  /** True for the one cadence that is half a calendar month. */
  halfMonth?: boolean;
  /** Days a date may stray from its predicted slot and still count. */
  tolerance: number;
}

// Ordered shortest-first, which is also the tie-break order: when two cadences
// explain a series equally well the shorter one is the fundamental and the
// longer one is its harmonic (every weekly series also repeats every 28 days).
//
// Tolerances differ per cadence because jitter does not come in one size. A week
// has to stay tight or a ±3-day window would cover the entire timeline and match
// anything; a monthly slot needs ±5 to absorb February *and* a bill that slides
// off a weekend; the long cadences get more because a yearly renewal really does
// move by a week or two.
const CADENCES: Cadence[] = [
  { label: 'weekly', days: 7, months: 0, tolerance: 1 },
  { label: 'biweekly', days: 14, months: 0, tolerance: 2 },
  { label: 'semi-monthly', days: 15.22, months: 0, halfMonth: true, tolerance: 3 },
  { label: 'monthly', days: 30.44, months: 1, tolerance: 5 },
  { label: 'quarterly', days: 91.31, months: 3, tolerance: 7 },
  { label: 'semiannual', days: 182.62, months: 6, tolerance: 10 },
  { label: 'annual', days: 365.25, months: 12, tolerance: 14 },
];

/** Days added to the monthly anchor for semi-monthly's mid-month twin. */
const SEMI_MONTHLY_OFFSET = 15;

/** A lag explaining fewer than this share of the pairs it could isn't a cadence. */
const ACF_MIN = 0.3;

/** Repeats needed before `confidence` is allowed to reach 1. */
const REPEATS_FOR_FULL_EVIDENCE = 3;

/** How much of the score average jitter can eat, at the tolerance limit. */
const JITTER_WEIGHT = 0.3;

/**
 * Default floor for reporting anything at all.
 *
 * Set from measurement rather than taste. Over 3,000 sets of 5–16 uniformly
 * random dates (spans of two months to four years), scored with the floor
 * removed: 99.1% came in under 0.3, 99.6% under 0.4, and 3 of the 3,000 got past
 * 0.5, the highest at 0.56 — five dates whose gaps ran 12/8/6/7, which reads as a
 * weekly bill with a miss to a human eye too. Real cadences, even ugly ones, sit
 * well above: 1.0 clean, 0.93 with ±3 days of jitter, 0.82 with a skipped month,
 * 0.74 with an unrelated charge mixed in. 0.5 separates the two populations with
 * room on both sides. Raise it toward 0.6 wherever a false positive is expensive
 * — anything shown to the user as a subscription — and note that a
 * three-occurrence series cannot exceed 0.67 however clean it looks.
 */
const MIN_CONFIDENCE = 0.5;

/** Loop guard on grid generation: enough for 11 years of weekly slots. */
const SLOT_GUARD = 600;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
const roundTo2 = (n: number): number => Math.round(n * 100) / 100;

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysInMonth = (year: number, month: number): number =>
  (month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1]);

/** A calendar date taken apart, so month arithmetic never needs a Date. */
interface Civil {
  year: number;
  /** 1-12, as written, not zero-based like Date. */
  month: number;
  day: number;
}

// Hinnant's days-from-civil: shift the year so the leap day lands at the end of a
// 400-year era, and the era arithmetic comes out exact in integers.
function dayIndexFromCivil({ year, month, day }: Civil): number {
  const shifted = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

// The exact inverse, by the same era arithmetic.
function civilFromDayIndex(index: number): Civil {
  const z = Math.round(index) + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460)
    + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (yearOfEra * 365 + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

// Add whole calendar months, clamping into short months (Jan 31 + 1 -> Feb 28).
// The timezone-free equivalent of addMonths() from date-fns, and the reason a
// monthly grid can run for ten years without drifting off the anchor's day of the
// month the way anchor + k * 30 would.
function addCivilMonths({ year, month, day }: Civil, months: number): Civil {
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return { year: y, month: m, day: Math.min(day, daysInMonth(y, m)) };
}

/**
 * `YYYY-MM-DD` to a count of days since 1970-01-01, or null if unparseable.
 *
 * Integer arithmetic rather than `new Date(string)`. domain.ts is explicit that
 * dates here are compared as strings "to avoid the timezone shift that parsing to
 * Date would introduce", and a detector is the wrong place to reintroduce it:
 * west of UTC a parsed midnight lands on the previous day, which would shift
 * every occurrence by one and every prediction with it. A longer string is
 * accepted and truncated, matching how insights.ts slices stored dates.
 */
export function isoToDayIndex(date: IsoDate): number | null {
  const parts = ISO_DATE.exec(date || '');
  if (!parts) return null;
  const civil = { year: Number(parts[1]), month: Number(parts[2]), day: Number(parts[3]) };
  if (civil.month < 1 || civil.month > 12 || civil.day < 1) return null;
  if (civil.day > daysInMonth(civil.year, civil.month)) return null;
  return dayIndexFromCivil(civil);
}

/** The inverse of isoToDayIndex: a day count back to `YYYY-MM-DD`. */
export function dayIndexToIso(index: number): IsoDate {
  const { year, month, day } = civilFromDayIndex(index);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * The app's name for a cadence of roughly this many days, or null when no
 * existing name fits. Tolerant because callers round: 30, 30.44 and 31 are all
 * monthly.
 */
export function periodLabel(periodDays: number): PeriodLabel | null {
  let best: Cadence | null = null;
  let bestGap = Infinity;
  for (const cadence of CADENCES) {
    const gap = Math.abs(periodDays - cadence.days);
    // Relative, so ±4 days is close to a month and nothing is close to a year.
    if (gap <= cadence.days * 0.15 && gap < bestGap) {
      best = cadence;
      bestGap = gap;
    }
  }
  return best ? best.label : null;
}

interface Occurrence {
  /** Days since epoch, so day arithmetic never touches a Date. */
  idx: number;
  /** The same date in calendar parts, for the month arithmetic. */
  civil: Civil;
}

// Sort (callers pass whatever order the ledger had), drop anything unparseable,
// and collapse duplicate days: two charges on one day are one occurrence of a
// cadence, and counting them twice makes the series look denser than it is.
function normalizeDates(dates: IsoDate[]): Occurrence[] {
  const byIndex = new Map<number, Occurrence>();
  for (const date of dates || []) {
    const idx = isoToDayIndex(date);
    if (idx === null) continue;
    if (!byIndex.has(idx)) byIndex.set(idx, { idx, civil: civilFromDayIndex(idx) });
  }
  return [...byIndex.values()].sort((a, b) => a.idx - b.idx);
}

/**
 * Normalized autocorrelation of the impulse train at `lag`, with one copy
 * dilated by ±tolerance so a date that slipped a few days still correlates.
 *
 * The denominator counts only occurrences whose partner slot falls inside the
 * observed window: past the end of the data absence is not evidence, and
 * counting it would make every long cadence look weak.
 */
function autocorrelation(
  impulse: Uint8Array, offsets: number[], lag: number, tolerance: number,
): number {
  const span = impulse.length - 1;
  let matched = 0;
  let possible = 0;
  for (const offset of offsets) {
    const center = offset + lag;
    if (center > span) continue;
    possible++;
    for (let d = -tolerance; d <= tolerance; d++) {
      const probe = center + d;
      if (probe >= 0 && probe <= span && impulse[probe]) {
        matched++;
        break;
      }
    }
  }
  return possible > 0 ? matched / possible : 0;
}

// The day index of slot `k` of a cadence anchored on one occurrence. Month-based
// cadences step through the calendar; only the genuinely day-based ones multiply.
function slotIndex(cadence: Cadence, anchor: Occurrence, k: number): number {
  if (cadence.halfMonth) {
    // Semi-monthly is the one cadence that is neither a fixed number of days nor
    // a whole number of months. Model it as the anchor's day of the month plus a
    // mid-month twin: a real "1st and 15th" pattern then lands within a day or
    // two of its slots, where a flat 15.22-day step walks off by four.
    const whole = Math.floor(k / 2);
    const half = (k - whole * 2) * SEMI_MONTHLY_OFFSET;
    return dayIndexFromCivil(addCivilMonths(anchor.civil, whole)) + half;
  }
  if (cadence.months > 0) {
    return dayIndexFromCivil(addCivilMonths(anchor.civil, cadence.months * k));
  }
  return anchor.idx + cadence.days * k;
}

// Every slot of an anchored cadence inside [fromIdx, toIdx], ascending.
function cadenceSlots(
  cadence: Cadence, anchor: Occurrence, fromIdx: number, toIdx: number,
): number[] {
  const back: number[] = [];
  for (let k = -1; k >= -SLOT_GUARD; k--) {
    const idx = slotIndex(cadence, anchor, k);
    if (idx < fromIdx) break;
    if (idx <= toIdx) back.push(idx);
  }
  const forward: number[] = [];
  for (let k = 0; k <= SLOT_GUARD; k++) {
    const idx = slotIndex(cadence, anchor, k);
    if (idx > toIdx) break;
    if (idx >= fromIdx) forward.push(idx);
  }
  return [...back.reverse(), ...forward];
}

// Two anchors that would generate the same grid need scoring only once: a
// month-based cadence is fixed by the anchor's day of the month, a days-based one
// by its offset modulo the period. Without this, a decade of weekly history would
// score 500-odd identical grids per cadence.
function anchorPhase(cadence: Cadence, anchor: Occurrence): string {
  if (cadence.months > 0 || cadence.halfMonth) return `d${anchor.civil.day}`;
  const lag = Math.round(cadence.days);
  return String(((anchor.idx % lag) + lag) % lag);
}

interface Fit {
  /** Predicted slots an occurrence landed on — the evidence behind the score. */
  hits: number;
  /** 0..1, how well this anchored cadence explains the series. */
  score: number;
}

/**
 * Score an anchored cadence against the series: build the grid it predicts
 * between the first and last occurrence, match each slot to the nearest unused
 * occurrence within tolerance, and combine what fit.
 *
 * Both terms are needed, and each rules out a different wrong answer. Coverage
 * alone would rank "every 7 days" top on any series at all, because a 7-day grid
 * with any tolerance covers the whole timeline. Precision alone would rank the
 * harmonics top, because "every 3 months" sits perfectly on a monthly series —
 * it just ignores two thirds of it.
 */
function fitCadence(
  cadence: Cadence, occurrences: Occurrence[], anchor: Occurrence,
): Fit | null {
  // The window reaches a tolerance past both ends of the data, because the first
  // and last occurrences are as jittered as the rest: a series that starts three
  // days late would otherwise have its own first charge fall outside the grid and
  // be counted as noise. Nothing is given away by it — a period is always more
  // than twice a tolerance, so each added slot is still within reach of the
  // extreme occurrence, and an unmatched one costs coverage as usual.
  const firstIdx = occurrences[0].idx - cadence.tolerance;
  const lastIdx = occurrences[occurrences.length - 1].idx + cadence.tolerance;
  const slots = cadenceSlots(cadence, anchor, firstIdx, lastIdx);
  if (slots.length < 2) return null;

  // Both lists ascend and the tolerance is well under half a period, so `from`
  // only ever moves forward: once a date is behind the current slot's window it
  // is behind every later one too. That keeps a decade of weekly history linear
  // rather than quadratic.
  let from = 0;
  let hits = 0;
  let deviation = 0;
  for (const slot of slots) {
    while (from < occurrences.length && occurrences[from].idx < slot - cadence.tolerance) from++;
    let bestOcc = -1;
    let bestDev = Infinity;
    for (let i = from; i < occurrences.length; i++) {
      const dev = occurrences[i].idx - slot;
      if (dev > cadence.tolerance) break; // ascending: nothing closer further on
      if (Math.abs(dev) < bestDev) {
        bestDev = Math.abs(dev);
        bestOcc = i;
      }
    }
    if (bestOcc >= 0) {
      // Claimed, so the next slot cannot reuse it — two slots sharing one date
      // would let a cadence twice too fast score a perfect fit.
      from = bestOcc + 1;
      hits++;
      deviation += bestDev;
    }
  }
  if (hits < 2) return null;

  const coverage = hits / slots.length;
  const precision = hits / occurrences.length;
  // Jitter is a tiebreaker, not a veto: a bill that wanders inside its window is
  // still that bill, so it can cost at most JITTER_WEIGHT of the score.
  const jitter = deviation / hits / cadence.tolerance;

  // Correct both terms for what unrelated dates would have scored anyway.
  //
  // Without this the short cadences flatter themselves: a weekly grid with a
  // ±1-day window covers 3 days in 7, so 43% of *any* dates land on it, and six
  // random dates in two months come out looking weekly. The windows cover
  // `chance` of the timeline, so that is the hit rate to beat; rescaling the
  // headroom above it is the same chance correction as Cohen's kappa. A perfect
  // fit still scores 1, and a fit no better than coincidence scores 0 — which
  // matters more here than the top of the range, because this module's whole
  // claim is that it stays quiet on data with no pattern in it.
  const windowShare = Math.min(1, (cadence.tolerance * 2 + 1) / cadence.days);
  const chanceCoverage = Math.min(1, (occurrences.length * windowShare) / slots.length);
  const adjusted = (value: number, chance: number): number =>
    (chance >= 1 ? 0 : Math.max(0, (value - chance) / (1 - chance)));
  // Precision is squared, coverage is not, because the two failures are not
  // symmetric. A missed slot has an innocent explanation — a payment was skipped,
  // the series started mid-history — so it costs proportionally. An occurrence
  // the grid cannot place means the merchant also charges on unrelated days,
  // which is exactly what a coincidental fit looks like: with a wide window and a
  // long period, a handful of unrelated dates will always line up somewhere. That
  // is the one failure mode that has to be expensive, so it is charged twice.
  return {
    hits,
    score: adjusted(coverage, chanceCoverage)
      * adjusted(precision, windowShare) ** 2
      * (1 - JITTER_WEIGHT * jitter),
  };
}

/**
 * Detect the cadence of a list of occurrence dates, or null when there is no
 * periodicity worth reporting.
 *
 * @param dates `YYYY-MM-DD` strings in any order; duplicates and unparseable
 *   entries are dropped.
 * @returns the cadence, how much of the series it explains, and the date it
 *   predicts next — or null when the series is too short, or too irregular to
 *   clear `minConfidence`.
 */
export function detectPeriod(
  dates: IsoDate[],
  { minOccurrences = 3, minConfidence = MIN_CONFIDENCE, today }: DetectPeriodOptions = {},
): PeriodDetection | null {
  const occurrences = normalizeDates(dates);
  if (occurrences.length < 2 || occurrences.length < minOccurrences) return null;

  const firstIdx = occurrences[0].idx;
  const lastIdx = occurrences[occurrences.length - 1].idx;
  const span = lastIdx - firstIdx;

  // The impulse series: one sample per day from the first occurrence to the
  // last, 1 where something happened. Sampling per day rather than per gap is
  // the whole point — a missing occurrence becomes a zero among many samples
  // instead of a gap of the wrong size.
  const impulse = new Uint8Array(span + 1);
  const offsets = occurrences.map(o => o.idx - firstIdx);
  for (const offset of offsets) impulse[offset] = 1;

  let best: { cadence: Cadence; anchor: Occurrence; fit: Fit } | null = null;
  for (const cadence of CADENCES) {
    const lag = Math.round(cadence.days);
    if (lag > span) continue; // not one full period observed; nothing to correlate
    if (autocorrelation(impulse, offsets, lag, cadence.tolerance) < ACF_MIN) continue;

    // The peak nominates the cadence; the phase still has to be found, and it
    // cannot be assumed to be the first occurrence — that one may be the one-off
    // purchase. So every occurrence is tried as the anchor and the best grid
    // wins, minus the ones that would redraw a grid already tried.
    const tried = new Set<string>();
    for (const anchor of occurrences) {
      const phase = anchorPhase(cadence, anchor);
      if (tried.has(phase)) continue;
      tried.add(phase);
      const fit = fitCadence(cadence, occurrences, anchor);
      if (!fit) continue;
      if (!best || fit.score > best.fit.score + 1e-9) best = { cadence, anchor, fit };
    }
  }
  if (!best) return null;

  // Confidence is the fit discounted by how much evidence stands behind it. Two
  // dates are perfectly periodic by construction and three nearly so, so without
  // this term the module's loudest answers would be its weakest ones.
  const repeats = best.fit.hits - 1;
  const evidence = Math.min(1, repeats / REPEATS_FOR_FULL_EVIDENCE);
  const confidence = roundTo2(best.fit.score * evidence);
  if (confidence < minConfidence) return null;

  const todayIdx = today ? isoToDayIndex(today) : null;
  const after = todayIdx !== null && todayIdx > lastIdx ? todayIdx : lastIdx;
  const { cadence, anchor } = best;
  // One whole period past `after` always contains a slot, so this is never
  // empty; the tolerance covers February against the nominal length.
  const upcoming = cadenceSlots(
    cadence, anchor, after + 1, after + Math.ceil(cadence.days) + cadence.tolerance + 1,
  );

  return {
    periodDays: cadence.days,
    confidence,
    occurrences: occurrences.length,
    nextExpected: dayIndexToIso(upcoming[0]),
    method: occurrences.length === 2 ? 'single-gap' : 'autocorrelation',
  };
}
