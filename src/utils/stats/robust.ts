// Robust statistics and a false-discovery-rate correction.
//
// The anomaly detection this app ships today is threshold-based: take the mean
// of a category's amounts, multiply it by a constant, flag anything above the
// line. Two things are wrong with that, and this module exists to fix both.
//
// 1. A mean is dragged by the outlier you are looking for. One $900 charge
//    among forty $40 ones lifts the mean by ~$21, which is more than half a
//    multiplier's worth of headroom — the charge helps hide itself, and the
//    bigger it is the better it hides. The median and the median absolute
//    deviation (MAD) do not have that failure mode: both are unchanged by
//    anything done to the largest 49% of the sample.
//
// 2. Screening hundreds of transactions with a per-transaction threshold
//    guarantees false alarms. At a 5% per-test threshold over 300 transactions
//    you expect ~15 flags from a ledger in which nothing whatsoever is unusual.
//    That is not a tuning problem, it is arithmetic, and the fix is to control
//    the *proportion of flags that are wrong* rather than the per-test error
//    rate. That is what benjaminiHochberg does, and it is the part of this
//    module that actually changes what the user sees.
//
// Everything here is pure: plain numbers in, plain numbers out, no dates, no
// money types, no I/O, no module state. Nothing rounds to cents — that belongs
// to the caller, after the statistics are done.

/**
 * Raw MAD -> standard deviation, for a normal distribution.
 *
 * Half the mass of a normal lies within 0.6745 sigma of its median
 * (0.6745 = Phi^-1(0.75)), so the *raw* median absolute deviation of a normal
 * sample estimates 0.6745 sigma, not sigma. 1.4826 = 1 / 0.6744897501960817
 * puts it back on sigma's scale.
 *
 * This is the constant people leave out, and then their thresholds are wrong in
 * the dangerous direction: an unscaled MAD is ~1.48x too small, so every z it
 * produces is ~1.48x too big, and a nominal "3 sigma" rule actually fires at
 * 2.02 sigma — two-sided p 0.043 instead of 0.0027, roughly 16x the false-alarm
 * rate you thought you had asked for.
 */
const MAD_TO_SIGMA = 1.4826;

/**
 * Mean absolute deviation -> standard deviation, for a normal distribution:
 * sqrt(pi / 2) = 1.2533. Used only as robustZ's fallback scale when the MAD is
 * exactly zero (see there for why that happens and why this is the lesser evil).
 */
const MEANAD_TO_SIGMA = 1.2533;

/**
 * Cap on |robustZ|, so the function's promise of a finite result holds even when
 * the scale estimate is a denormal number and the division overflows (a property
 * test found exactly that: xs = [0, 1e-323]). The specific value carries no
 * statistical meaning — the normal tail is already 0 to double precision beyond
 * |z| ~ 39 — it exists only so nothing downstream has to cope with Infinity.
 */
const Z_LIMIT = 1e6;

/** deviation / scale, kept finite when the scale is denormal (see {@link Z_LIMIT}). */
function boundedRatio(deviation: number, scale: number): number {
  const z = deviation / scale;
  return Number.isFinite(z) ? z : Math.sign(deviation) * Z_LIMIT;
}

/** Options for {@link mad}. */
export interface MadOptions {
  /**
   * Multiply by 1.4826 so the result estimates the standard deviation of a
   * normal distribution. On by default, because that is the only form
   * comparable to a z-score, and therefore the only form from which a p-value
   * means anything. Turn it off when the raw order statistic is what is wanted.
   */
  consistency?: boolean;
}

/** What {@link benjaminiHochberg} decided. */
export interface FdrResult {
  /**
   * Indices into the *original* pValues array, ascending. Not ranks: the
   * procedure sorts internally and maps back, because the caller's array order
   * is the only order it can join back to its own data.
   */
  discoveries: number[];
  /**
   * The largest p-value called a discovery — the effective threshold this run
   * used, which is what to show a user who asks "how sure are you?". Zero when
   * nothing was discovered.
   */
  criticalP: number;
}

/**
 * The middle value, interpolating between the two middle values when the sample
 * has an even length.
 *
 * Empty input returns 0 rather than NaN, matching `median` in utils/insights.ts:
 * callers here treat "no history" as "no signal", and a NaN would silently
 * poison every comparison downstream instead of failing where it was created.
 */
export function median(xs: number[]): number {
  if (!xs || !xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  // Even length: the average of the two middle values, so that [1,2,3,4] gives
  // 2.5. Taking either neighbour instead biases the estimate and breaks the
  // "median of a doubled sample is unchanged" property the tests assert.
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median absolute deviation: the median of |x - median(xs)|.
 *
 * This is the robust counterpart to the standard deviation. Where one added
 * outlier can move a standard deviation arbitrarily far, it cannot move the MAD
 * past the next order statistic of the bulk — which is the whole reason to
 * prefer it when the outliers are the thing being measured.
 *
 * @param xs sample
 * @param options `consistency` (default true) scales the result to a sigma estimate
 */
export function mad(xs: number[], { consistency = true }: MadOptions = {}): number {
  if (!xs || !xs.length) return 0;
  const centre = median(xs);
  const raw = median(xs.map(x => Math.abs(x - centre)));
  return consistency ? raw * MAD_TO_SIGMA : raw;
}

/** Mean of |x - median(xs)|. Internal: only robustZ's degenerate-scale fallback. */
function meanAbsoluteDeviation(xs: number[]): number {
  const centre = median(xs);
  return xs.reduce((total, x) => total + Math.abs(x - centre), 0) / xs.length;
}

/**
 * How unusual `x` is within `xs`, in robust standard deviations:
 * (x - median) / MAD. Interpret it like a z-score — the consistency scaling in
 * {@link mad} is what makes that legitimate.
 *
 * `x` is normally a member of `xs`, and should be: leaving it out would make the
 * scale depend on which point is being tested.
 *
 * The zero-MAD case is explicit, and it is ordinary in a ledger rather than
 * exotic: a $10.99 subscription charged twelve times has a MAD of exactly zero,
 * and so does any sample where more than half the values are identical. The
 * naive answer is +/-Infinity, which becomes p = 0, which becomes "infinitely
 * certain this is an anomaly" out of a sample that in fact said nothing about
 * spread. This function refuses to do that, in two steps:
 *
 *   1. Fall back to the mean absolute deviation (consistency-scaled). It is
 *      less robust — it does feel the outlier — but it is positive whenever the
 *      sample has any spread at all, and it yields a large finite z for the
 *      realistic case of "many identical amounts plus a few odd ones".
 *   2. If even that is zero, every value in the sample is identical. There is
 *      then no scale to speak of, so return 0: no evidence, not infinite
 *      evidence. A caller that wants to flag "$900 where every prior charge was
 *      exactly $40" should do it with an absolute magnitude rule, which is an
 *      honest statement about money, rather than dress it up as a p-value.
 *
 * Never returns NaN or +/-Infinity for finite `x`, which matters because the
 * value flows straight into {@link normalTwoSidedP} and then into a procedure
 * that sorts p-values.
 */
export function robustZ(x: number, xs: number[]): number {
  if (!xs || !xs.length || !Number.isFinite(x)) return 0;
  const deviation = x - median(xs);
  // Exactly at the centre: zero regardless of scale, and returning here keeps
  // the degenerate case from producing 0/0 = NaN.
  if (deviation === 0) return 0;
  const scale = mad(xs);
  if (scale > 0) return boundedRatio(deviation, scale);
  const fallback = meanAbsoluteDeviation(xs) * MEANAD_TO_SIGMA;
  return fallback > 0 ? boundedRatio(deviation, fallback) : 0;
}

// --- Normal tail ----------------------------------------------------------

// Abramowitz & Stegun 7.1.26, an approximation to erf(x) for x >= 0 with a
// stated maximum absolute error of 1.5e-7:
//
//   erf(x) = 1 - (a1 t + a2 t^2 + a3 t^3 + a4 t^4 + a5 t^5) e^(-x^2) + eps(x),
//   t = 1 / (1 + p x),   |eps(x)| <= 1.5e-7
//
// Worth knowing before trusting a small p-value: that error bound is
// *absolute*, so the formula says nothing useful about p-values below ~1e-7.
// Those come back as "very small" and should be read that way and no further. It
// does not matter to benjaminiHochberg, whose smallest critical value over a few
// hundred tests at q = 0.05 is ~1e-4, comfortably inside the accurate range.
const AS_P = 0.3275911;
const AS_A = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];

/**
 * erfc(x) for x >= 0, evaluated as that polynomial-times-exponential rather than
 * as 1 - erf(x). Algebraically identical; numerically it avoids cancelling two
 * near-equal numbers, so the tail stays positive and correctly ordered instead
 * of collapsing to 0 (or to a negative value) around x = 4.
 */
function erfcPositive(x: number): number {
  const t = 1 / (1 + AS_P * x);
  const poly = t * (AS_A[0] + t * (AS_A[1] + t * (AS_A[2] + t * (AS_A[3] + t * AS_A[4]))));
  return poly * Math.exp(-x * x);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Two-sided p-value for a z-score under the standard normal:
 * P(|Z| >= |z|) = erfc(|z| / sqrt(2)).
 *
 * Two-sided because an amount that is surprisingly *small* is also worth
 * knowing about (a missed payment, a partial charge), and because the
 * multiple-testing correction below assumes p-values that are uniform under the
 * null — which a one-sided p is not, once the side was chosen after seeing the
 * data.
 *
 * NaN in gives 1 (no evidence), +/-Infinity gives 0, and the result is clamped
 * to [0, 1] so the approximation can never hand BH a p-value outside its domain.
 */
export function normalTwoSidedP(z: number): number {
  if (Number.isNaN(z)) return 1;
  const a = Math.abs(z);
  if (!Number.isFinite(a)) return 0;
  return clamp01(erfcPositive(a / Math.SQRT2));
}

// --- Multiple testing -----------------------------------------------------

/** Non-finite or out-of-range p-values mean "no evidence", never "significant". */
function sanitizeP(p: number): number {
  return Number.isFinite(p) ? clamp01(p) : 1;
}

/**
 * Benjamini-Hochberg step-up procedure: which of these hypotheses can be called
 * discoveries while keeping the expected *proportion of false discoveries among
 * the discoveries* at or below `q`.
 *
 * Sort the p-values ascending, find the largest k with p_(k) <= (k/m) q, and
 * reject everything at or below that p-value. Note what that is not: it is not a
 * fixed threshold, and it is not Bonferroni (q/m for every test). It adapts —
 * the more real signal is present, the further out the threshold moves — which
 * is why it is never less powerful than Bonferroni on the same data while still
 * making a guarantee, just a different and more useful one.
 *
 * What the guarantee costs: ~q of what this returns is expected to be wrong, on
 * average over many ledgers. That is the right trade for "here are 4
 * transactions worth a look" and the wrong trade for anything irreversible.
 *
 * Assumption: BH controls FDR exactly under independence, and under positive
 * regression dependency (PRDS). Transactions scored against a shared
 * median/MAD are dependent, but positively so, which is the benign case;
 * arbitrary dependence would need Benjamini-Yekutieli (divide q by the harmonic
 * number H_m), which is far more conservative and is not implemented here.
 *
 * @param pValues one p-value per hypothesis, in the caller's own order
 * @param q target false-discovery rate, clamped to (0, 1]; q <= 0 discovers nothing
 */
export function benjaminiHochberg(pValues: number[], q = 0.05): FdrResult {
  const none: FdrResult = { discoveries: [], criticalP: 0 };
  const m = pValues ? pValues.length : 0;
  // `!(q > 0)` rather than `q <= 0` so a NaN level also discovers nothing,
  // instead of every comparison below being false and letting it through.
  if (!m || !(q > 0)) return none;
  const level = Math.min(1, q);

  const clean = pValues.map(sanitizeP);
  const ascending = [...clean].sort((a, b) => a - b);

  // Walk down from the largest rank and stop at the first k that passes: that is
  // what makes this step-up. Walking *up* and stopping at the first failure is
  // the classic misimplementation, and it throws away the whole point — a p of
  // 0.04 is a discovery when it sits at rank m of m, even though it fails every
  // threshold below that rank.
  let cut = 0;
  for (let k = m; k >= 1; k--) {
    if (ascending[k - 1] <= (k / m) * level) { cut = k; break; }
  }
  if (!cut) return none;

  const criticalP = ascending[cut - 1];
  // Selecting by value, not by rank, and from `clean` so the indices are the
  // caller's. Rank-based selection would split a tie arbitrarily, keeping one
  // transaction and dropping another with an identical p-value.
  const discoveries: number[] = [];
  clean.forEach((p, index) => { if (p <= criticalP) discoveries.push(index); });
  return { discoveries, criticalP };
}
