// Return-generating processes for the Monte Carlo.
//
// The original model drew one normal return per year, independently. That is
// the textbook starting point and it understates the two things that actually
// break retirement plans:
//
//   Fat tails — 2008 was about a five-sigma year under a normal distribution,
//   i.e. "once per several million years". Real return distributions have far
//   more mass in the tails than a normal does, so a normal model quietly
//   reports plans as safer than they are.
//
//   Sequence risk — the *order* of returns matters once you are withdrawing.
//   A bad decade at the start of retirement is survivable in an i.i.d. model,
//   where each year is drawn fresh, but poor years cluster in practice. A model
//   with no autocorrelation cannot express that, and cannot be asked about it.
//
// Two ways to address it are provided:
//
//   `studentT`  — a parametric model: Student-t innovations scaled to the
//                 requested volatility, with an AR(1) term for persistence.
//                 Self-contained, so it needs no market data.
//
//   `bootstrap` — resamples *blocks* of consecutive years from a real return
//                 series, which inherits that series' tails and its year-to-year
//                 structure without assuming any distribution. It needs a
//                 series to draw from, which the caller supplies; none is
//                 bundled, because inventing one would defeat the point.
//
// Every model consumes a vector of standard normal draws, which is what makes
// antithetic sampling possible: run the same path again with the signs flipped
// and the two are negatively correlated, so their average has less variance
// than two independent trials.

/** Standard normal via Box–Muller. */
/** A seeded uniform generator in [0, 1). mulberry32 in montecarlo.ts supplies it. */
export type Rng = () => number;

/** Which process generates the year-to-year returns. */
export type ReturnModel = 'studentT' | 'normal' | 'bootstrap';

export interface Interval {
  low: number;
  high: number;
}

export interface AnnualReturnsOptions {
  model?: ReturnModel;
  /** Arithmetic mean return, as a fraction — 0.06 is 6%. */
  mean?: number;
  /** Standard deviation, as a fraction. */
  sd?: number;
  /** Student-t degrees of freedom; lower means fatter tails. */
  df?: number;
  /** AR(1) persistence. 0 makes years independent. */
  phi?: number;
  /** One standard normal draw per year. Its length sets the horizon. */
  shocks?: number[];
  /** Chi-squared draws for the t tails, shared with the antithetic twin. */
  tailDraws?: number[];
  /** Historical returns to resample, for the bootstrap model. */
  series?: number[];
  blockYears?: number;
}

export function normal(rand: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A vector of standard normals, so a whole path can be negated at once. */
export function normalVector(rand: Rng, n: number): number[] {
  return Array.from({ length: n }, () => normal(rand));
}

/**
 * Chi-squared with `df` degrees of freedom, by summing squared normals.
 * Fine for the small integer df used here (t needs df > 2 for finite variance).
 */
export function chiSquared(rand: Rng, df: number): number {
  let total = 0;
  for (let i = 0; i < df; i += 1) {
    const z = normal(rand);
    total += z * z;
  }
  return total;
}

/**
 * Student-t innovations, standardised to unit variance so `sd` still means
 * what the user set. A t with df degrees of freedom has variance df/(df-2);
 * dividing by that factor keeps the requested volatility while moving mass
 * into the tails.
 */
export function standardisedT(z: number, chi2: number, df: number): number {
  const t = z / Math.sqrt(chi2 / df);
  return t / Math.sqrt(df / (df - 2));
}

/**
 * Build a function that maps a year index to that year's return.
 *
 * @param model      'normal' | 'studentT' | 'bootstrap'
 * @param mean       expected annual return, as a fraction
 * @param sd         annual volatility, as a fraction
 * @param df         t degrees of freedom — lower means fatter tails (default 5)
 * @param phi        AR(1) coefficient; positive values make good and bad runs
 *                   persist, which is the sequence risk the i.i.d. model misses
 * @param shocks     standard normal draws, one per year (negate for antithetic)
 * @param tailDraws  chi-squared draws, one per year; shared between a path and
 *                   its antithetic twin so only the sign of the shock flips
 * @param series     historical annual returns, for the bootstrap
 * @param blockYears length of the resampled blocks
 */
export function annualReturns({
  model = 'studentT', mean = 0.06, sd = 0.12, df = 5, phi = 0.15,
  shocks = [], tailDraws = [], series = [], blockYears = 5,
}: AnnualReturnsOptions = {}): number[] {
  const years = shocks.length;

  if (model === 'bootstrap') {
    if (!series.length) throw new Error('bootstrap needs a series of historical returns');
    // Blocks of consecutive years, so within a block the real ordering — and
    // therefore the clustering of good and bad years — is preserved.
    const out: number[] = [];
    let cursor = 0;
    while (out.length < years) {
      // The shock vector picks the starting year; wrapping keeps every start
      // equally likely (a circular block bootstrap).
      const u = normalCdf(shocks[cursor % Math.max(1, years)] || 0);
      const start = Math.floor(u * series.length) % series.length;
      for (let i = 0; i < blockYears && out.length < years; i += 1) {
        out.push(series[(start + i) % series.length]);
      }
      cursor += 1;
    }
    return out;
  }

  const out: number[] = [];
  let previous = mean;
  for (let y = 0; y < years; y += 1) {
    const z = shocks[y];
    const innovation = model === 'studentT'
      ? standardisedT(z, tailDraws[y] ?? df, df)
      : z;
    // AR(1) around the mean. Scaling the innovation by sqrt(1 - phi²) keeps the
    // unconditional variance equal to sd², so turning persistence on doesn't
    // silently change the volatility the user asked for.
    const shock = innovation * sd * Math.sqrt(1 - phi * phi);
    const value = mean + phi * (previous - mean) + shock;
    previous = value;
    out.push(Math.max(-0.95, value)); // a year cannot lose more than everything
  }
  return out;
}

/** Φ(z), via an Abramowitz–Stegun approximation. Used to turn a normal draw
 *  into a uniform for block selection, so one shock vector drives every model. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * Wilson score interval for a proportion.
 *
 * The plain normal approximation (p ± 1.96·√(p(1-p)/n)) misbehaves exactly
 * where these results live — near 0 or 1, and at the few-hundred trial counts
 * the app runs — where it can produce bounds outside [0, 1]. Wilson stays
 * inside and holds its coverage.
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): Interval {
  if (!n) return { low: 0, high: 0 };
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
  };
}
