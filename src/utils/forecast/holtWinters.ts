// Holt-Winters exponential smoothing (additive) for a ledger series: monthly
// spend, monthly net, or a day-of-week pattern.
//
// Why this instead of an average. A trailing average answers "how much do I
// usually spend". It cannot answer "how much will I spend in December", because
// it has no notion of drift (the level is creeping up) or of shape (December is
// always worse). Holt-Winters carries three states instead of one — level,
// trend, and a seasonal index per position in the cycle. Additive rather than
// multiplicative because ledger seasonality reads as "December costs $400 more"
// rather than "December costs 1.3x", and because additive survives zeros and
// sign changes, which a net-cash series has.
//
//   Method: Holt (1957) / Winters (1960) additive triple exponential
//   smoothing, in the ETS(A,A,A) form of Hyndman & Athanasopoulos,
//   "Forecasting: Principles and Practice" (3rd ed.), ch. 8.
//
// Why the interval is not optional. A single number invites the reader to treat
// it as a fact. montecarlo.ts already takes this position for the long-range
// plan — a success rate ships with its Wilson interval — and a spend forecast
// deserves the same: the band is the answer, the point is only its midpoint.
//
// Why the degraded paths are the main event. A personal ledger holds 8-24
// months. Two full cycles is the minimum at which a seasonal index means
// anything, so at period 12 most callers will *not* get Holt-Winters. Rather
// than fit 12 seasonal indices to 14 points and draw a confident line through
// noise, the result says which method it actually used and why, so the caller
// can render "not enough history yet".
//
// Pure and deterministic: no dates, no I/O, no randomness. The caller supplies
// the series already aggregated, in chronological order, with no gaps — a
// missing month has to arrive as 0 or be interpolated by the caller, because
// nothing here can tell a zero-spend month from an absent one. Values come back
// unrounded; rounding to cents is the caller's job.

/** Which model actually produced the numbers. Never assume 'holt-winters'. */
export type ForecastMethod = 'holt-winters' | 'trend-only' | 'mean-only';

export interface SmoothingParams {
  /** Level smoothing. */
  alpha: number;
  /** Trend smoothing. */
  beta: number;
  /** Seasonal smoothing. Forced to 0 on the non-seasonal methods. */
  gamma: number;
}

export interface FitOptions extends Partial<SmoothingParams> {
  /** Observations per cycle: 12 for monthly-with-yearly-shape, 7 for day-of-week. */
  period: number;
}

interface FitCommon {
  /** How many observations the fit saw. */
  observations: number;
  period: number;
  /**
   * observations / period — how much of a cycle the history covers. Below 1 the
   * fit has never seen a full cycle, so its interval cannot include seasonal
   * variation and will be far too narrow; see forecastHoltWinters for the
   * measured size of that effect. Worth showing the user directly ("8 of the 24
   * months needed").
   */
  cyclesObserved: number;
  params: SmoothingParams;
  /** Final smoothed level: the de-seasonalised value at the last point. */
  level: number;
  /** Final per-step trend. 0 on the mean-only path. */
  trend: number;
  /** Seasonal index per cycle position, centred on 0. Empty when unseasonal. */
  seasonal: number[];
  /** One-step-ahead in-sample predictions, aligned with the input series. */
  fitted: number[];
  /** series[t] - fitted[t]. */
  residuals: number[];
  /** Sum of squared residuals — what optimiseHoltWinters minimises. */
  sse: number;
  /**
   * Residual standard deviation, which sets the width of the interval.
   * `null` means it could not be estimated (fewer than two usable residuals),
   * and a forecast built on it then carries no interval at all rather than a
   * zero-width one, which would read as certainty.
   */
  residualSd: number | null;
  /** null on the full method; on the others, a sentence fit to show a user. */
  degradedReason: string | null;
}

/** Level + trend + seasonality. Needs at least two full periods. */
export interface HoltWintersModel extends FitCommon {
  method: 'holt-winters';
  degradedReason: null;
}

/** Holt's linear method: level + trend, no seasonal shape. */
export interface TrendOnlyModel extends FitCommon {
  method: 'trend-only';
  degradedReason: string;
}

/** A flat mean. The honest answer when there is almost no history. */
export interface MeanOnlyModel extends FitCommon {
  method: 'mean-only';
  degradedReason: string;
}

/** Discriminated on `method`; check it before presenting a forecast. */
export type ForecastModel = HoltWintersModel | TrendOnlyModel | MeanOnlyModel;

export interface ForecastStep {
  /** 1-based steps ahead of the last observation. */
  step: number;
  point: number;
  /** null when the model could not estimate a residual spread. */
  lower: number | null;
  upper: number | null;
  /** Forecast standard error at this horizon. */
  sd: number | null;
}

export interface ForecastOptions {
  /** Normal quantile for the interval. 1.96 is the two-sided 95% default. */
  z?: number;
}

/** The grid searched by optimiseHoltWinters. Deliberately coarse. */
export interface SmoothingGrid {
  alpha: number[];
  beta: number[];
  gamma: number[];
}

export interface OptimiseOptions {
  period: number;
  grid?: Partial<SmoothingGrid>;
}

// Two full cycles: with one cycle, a seasonal index is just one observation's
// deviation from that cycle's mean, which is indistinguishable from noise. Two
// is the textbook minimum and still optimistic.
const MIN_CYCLES_FOR_SEASONAL = 2;

// Below this, a fitted slope is an artefact of two or three points. A flat mean
// is less wrong than extrapolating a line from noise.
const MIN_POINTS_FOR_TREND = 4;

const DEFAULT_PARAMS: SmoothingParams = { alpha: 0.3, beta: 0.1, gamma: 0.3 };

// 5 x 4 x 4 = 80 fits, each O(n) on a series of 8-48 points: microseconds.
//
// Why a grid and not gradient descent. The SSE surface over (alpha, beta, gamma)
// is non-convex with long flat valleys, so a descent needs a step size, a
// convergence test and a starting guess, and can still land in a different local
// optimum depending on all three. None of that buys anything at this data size:
// with 8-24 observations the parameters are barely identified, so the difference
// between alpha 0.30 and alpha 0.31 is fitting noise. A fixed grid is instead
// exhaustive over the range that matters, gives identical results on every
// machine and every run, and cannot fail to converge. If the series were long
// enough for that extra precision to be real — hundreds of points — the
// argument would flip.
const DEFAULT_GRID: SmoothingGrid = {
  // No 0: alpha 0 freezes the level, so the model ignores every observation
  // after initialisation and its interval never widens. That is not a fit.
  alpha: [0.1, 0.3, 0.5, 0.7, 0.9],
  // 0 is allowed and often wins: it holds the initial slope rather than chasing
  // it, which is usually right on a short, noisy ledger.
  beta: [0, 0.05, 0.1, 0.3],
  gamma: [0, 0.1, 0.3, 0.6],
};

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);

/**
 * Reject a series that is not entirely finite, naming the offending index.
 *
 * A single NaN in an exponential smoother is not a local problem: it enters the
 * level, the level feeds every later step, and the output is an array of NaN
 * that renders as an empty chart with no error reported anywhere. Throwing here
 * is the difference between "row 14 of your import is bad" and "the forecast is
 * blank and nobody knows why".
 */
function assertFiniteSeries(series: number[]): void {
  if (!Array.isArray(series)) throw new TypeError('holtWinters: series must be an array of numbers');
  for (let i = 0; i < series.length; i += 1) {
    const v = series[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new RangeError(`holtWinters: series[${i}] is ${String(v)}; every observation must be a finite number`);
    }
  }
}

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 2) {
    throw new RangeError(`holtWinters: period must be an integer of 2 or more, got ${String(period)}`);
  }
}

function assertUnitInterval(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`holtWinters: ${name} must be between 0 and 1, got ${String(value)}`);
  }
}

/** Which model the data can support, and the sentence explaining the choice. */
function classify(n: number, period: number): { method: ForecastMethod; reason: string } {
  if (n >= period * MIN_CYCLES_FOR_SEASONAL) return { method: 'holt-winters', reason: '' };
  if (n >= MIN_POINTS_FOR_TREND) {
    const short = `${n} observations is short of the ${period * MIN_CYCLES_FOR_SEASONAL} `
      + `(${MIN_CYCLES_FOR_SEASONAL} full periods of ${period}) needed to estimate a seasonal `
      + 'shape, so the forecast carries level and trend only.';
    // Under one full cycle the interval is not merely wide-open, it is actively
    // misleading, and the caller has to be told in words it can print.
    const blind = ` It is also under one full period, so the interval reflects only the ${n} `
      + 'observations seen and cannot include seasonal variation — treat it as a floor on the '
      + 'uncertainty, not a range.';
    return { method: 'trend-only', reason: n < period ? short + blind : short };
  }
  if (n === 0) {
    return {
      method: 'mean-only',
      reason: 'No observations: there is nothing to forecast from, so the forecast is a flat zero '
        + 'and carries no interval.',
    };
  }
  return {
    method: 'mean-only',
    reason: `${n} observation${n === 1 ? '' : 's'} is too few to estimate a direction `
      + `(${MIN_POINTS_FOR_TREND} needed), so the forecast is the mean, held flat.`,
  };
}

/**
 * Seasonal indices from the first full cycles, not zeros.
 *
 * Starting every index at 0 means the seasonal shape has to be learned through
 * gamma alone, which on two or three cycles it cannot do — the fit spends all
 * its data discovering what the initialisation could have told it. So: for each
 * complete cycle take each observation's deviation from that cycle's own mean,
 * and average position by position across cycles.
 *
 * Both the level *and* the trend have to come out of that deviation. Removing
 * the cycle mean alone is not enough: a series rising by 12 a month is already
 * 66 below its cycle mean in January and 66 above it in December, so a pure
 * trend would be recorded as a sawtooth "seasonal shape" of exactly that size.
 * (Measured: it put 34 of spurious mean-absolute seasonality on a trend-only
 * series, more than three times the noise.) Subtracting trendPerStep times the
 * position's distance from the cycle's midpoint removes it.
 *
 * Only the first MIN_CYCLES_FOR_SEASONAL cycles are used. Averaging over all of
 * them would let the end of the series set the starting state, which flatters
 * the in-sample residuals the interval is derived from.
 *
 * The indices are then centred to sum to zero, because an additive level and
 * seasonal are otherwise not separately identified: adding 5 to every index and
 * taking 5 off the level gives an identical fit.
 */
function initialSeasonal(series: number[], period: number, trendPerStep: number): number[] {
  const cycles = Math.min(MIN_CYCLES_FOR_SEASONAL, Math.floor(series.length / period));
  const midpoint = (period - 1) / 2;
  const perPosition: number[] = new Array(period).fill(0);
  for (let c = 0; c < cycles; c += 1) {
    const cycle = series.slice(c * period, (c + 1) * period);
    const cycleMean = mean(cycle);
    for (let i = 0; i < period; i += 1) {
      perPosition[i] += (cycle[i] - cycleMean - trendPerStep * (i - midpoint)) / cycles;
    }
  }
  const centre = mean(perPosition);
  return perPosition.map(v => v - centre);
}

/** Average slope per step between the first two cycles. */
function initialSeasonalTrend(series: number[], period: number): number {
  const first = mean(series.slice(0, period));
  const second = mean(series.slice(period, period * 2));
  return (second - first) / period;
}

/**
 * Ordinary least squares on (t, y), used to start the non-seasonal fit.
 *
 * The textbook Holt initialisation is level = y[0], trend = y[1] - y[0], which
 * on a six-point ledger series hands the whole forecast to the noise in two
 * observations. A regression line over what little there is starts the
 * recursion somewhere defensible.
 */
function olsInit(series: number[]): { level: number; trend: number } {
  const n = series.length;
  const meanT = (n - 1) / 2;
  const meanY = mean(series);
  let covariance = 0;
  let varianceT = 0;
  for (let t = 0; t < n; t += 1) {
    covariance += (t - meanT) * (series[t] - meanY);
    varianceT += (t - meanT) ** 2;
  }
  // No divide-by-zero guard, because there is nothing to guard against: this
  // runs only on the trend-only path, which needs MIN_POINTS_FOR_TREND points,
  // so t always spans at least four distinct values and varianceT > 0. A guard
  // here would be an untestable branch pretending to be caution.
  const slope = covariance / varianceT;
  // The level is the line's value one step *before* the first observation,
  // because the recursion's first prediction is level + trend.
  return { level: meanY + slope * (-1 - meanT), trend: slope };
}

interface RecursionResult {
  level: number;
  trend: number;
  seasonal: number[];
  fitted: number[];
  residuals: number[];
  sse: number;
}

/**
 * The additive recursion. With `seasonal` empty this is Holt's linear method;
 * with it populated it is Holt-Winters.
 *
 *   forecast_t = level + trend + seasonal[t mod m]
 *   level_t    = alpha (y_t - seasonal[t mod m]) + (1 - alpha)(level + trend)
 *   trend_t    = beta (level_t - level_{t-1}) + (1 - beta) trend
 *   seasonal_t = gamma (y_t - level_t) + (1 - gamma) seasonal[t mod m]
 *
 * The seasonal array is updated in place, so seasonal[t mod m] is always the
 * value last written one full cycle ago — the s_{t-m} of the textbook form.
 */
function runRecursion(
  series: number[],
  params: SmoothingParams,
  init: { level: number; trend: number; seasonal: number[] },
): RecursionResult {
  const { alpha, beta, gamma } = params;
  const seasonal = [...init.seasonal];
  const period = seasonal.length;
  let level = init.level;
  let trend = init.trend;
  const fitted: number[] = [];
  const residuals: number[] = [];
  let sse = 0;

  for (let t = 0; t < series.length; t += 1) {
    const s = period ? seasonal[t % period] : 0;
    const prediction = level + trend + s;
    const error = series[t] - prediction;
    fitted.push(prediction);
    residuals.push(error);
    sse += error * error;

    const previousLevel = level;
    level = alpha * (series[t] - s) + (1 - alpha) * (previousLevel + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
    if (period) seasonal[t % period] = gamma * (series[t] - level) + (1 - gamma) * s;
  }

  return { level, trend, seasonal, fitted, residuals, sse };
}

/**
 * Residual spread, skipping the warm-up.
 *
 * The first cycle's residuals are flattered by an initialisation computed from
 * those same points, so counting them would shrink the interval for a reason
 * that has nothing to do with how well the model predicts. They are dropped
 * when enough residuals remain to be worth anything.
 *
 * Divisor n-1 rather than n: the residual mean is not exactly zero, and on a
 * dozen residuals that difference is visible in the reported band. Returns null
 * rather than 0 when there is nothing to estimate from, because a zero-width
 * band reads as certainty, which is the opposite of the truth there.
 */
function residualSpread(residuals: number[], warmUp: number): number | null {
  const usable = residuals.length - warmUp >= MIN_CYCLES_FOR_SEASONAL
    ? residuals.slice(warmUp)
    : residuals;
  if (usable.length < 2) return null;
  const m = mean(usable);
  return Math.sqrt(sum(usable.map(r => (r - m) ** 2)) / (usable.length - 1));
}

/**
 * Fit an additive Holt-Winters model, degrading explicitly when the series is
 * too short to support one.
 *
 * Always check `method` on the result: 'trend-only' and 'mean-only' carry a
 * `degradedReason` written to be shown to a user.
 *
 * @throws RangeError if the series holds a non-finite value, if `period` is not
 *   an integer of 2 or more, or if a smoothing parameter is outside [0, 1].
 */
export function fitHoltWinters(series: number[], options: FitOptions): ForecastModel {
  assertFiniteSeries(series);
  const { period } = options;
  assertPeriod(period);
  const alpha = options.alpha ?? DEFAULT_PARAMS.alpha;
  const beta = options.beta ?? DEFAULT_PARAMS.beta;
  const gamma = options.gamma ?? DEFAULT_PARAMS.gamma;
  assertUnitInterval('alpha', alpha);
  assertUnitInterval('beta', beta);
  assertUnitInterval('gamma', gamma);

  const n = series.length;
  const { method, reason } = classify(n, period);

  if (method === 'mean-only') {
    // No recursion at all: with 0-3 points the only defensible statement is the
    // mean, and the smoothing parameters are reported as 0 because none was used.
    const level = mean(series);
    const residuals = series.map(v => v - level);
    return {
      method: 'mean-only',
      degradedReason: reason,
      observations: n,
      period,
      cyclesObserved: n / period,
      params: { alpha: 0, beta: 0, gamma: 0 },
      level,
      trend: 0,
      seasonal: [],
      fitted: series.map(() => level),
      residuals,
      sse: sum(residuals.map(r => r * r)),
      residualSd: residualSpread(residuals, 0),
    };
  }

  if (method === 'trend-only') {
    const init = olsInit(series);
    const run = runRecursion(series, { alpha, beta, gamma: 0 }, { ...init, seasonal: [] });
    return {
      method: 'trend-only',
      degradedReason: reason,
      observations: n,
      period,
      cyclesObserved: n / period,
      params: { alpha, beta, gamma: 0 },
      level: run.level,
      trend: run.trend,
      seasonal: [],
      fitted: run.fitted,
      residuals: run.residuals,
      sse: run.sse,
      // No seasonal state to warm up, so every residual counts.
      residualSd: residualSpread(run.residuals, 0),
    };
  }

  const trend = initialSeasonalTrend(series, period);
  const init = {
    // The level starts at the first cycle's mean, which is the de-seasonalised
    // value at that cycle's midpoint, and the seasonal indices are de-trended
    // with the same slope so the two states do not double-count the drift.
    level: mean(series.slice(0, period)),
    trend,
    seasonal: initialSeasonal(series, period, trend),
  };
  const run = runRecursion(series, { alpha, beta, gamma }, init);
  return {
    method: 'holt-winters',
    degradedReason: null,
    observations: n,
    period,
    cyclesObserved: n / period,
    params: { alpha, beta, gamma },
    level: run.level,
    trend: run.trend,
    seasonal: run.seasonal,
    fitted: run.fitted,
    residuals: run.residuals,
    sse: run.sse,
    residualSd: residualSpread(run.residuals, period),
  };
}

/**
 * Coarse grid search over alpha/beta/gamma, minimising in-sample SSE.
 *
 * Ties go to the first candidate, and the grids run low to high, so an SSE
 * plateau resolves towards the model that reacts least — the right bias on a
 * short, noisy series. See DEFAULT_GRID for why this is a grid and not a
 * descent.
 *
 * The search shrinks to match the method the data supports: gamma is not
 * searched when there is no seasonal state, and nothing is searched for a mean.
 */
export function optimiseHoltWinters(series: number[], options: OptimiseOptions): ForecastModel {
  assertFiniteSeries(series);
  const { period } = options;
  assertPeriod(period);
  const grid: SmoothingGrid = {
    alpha: options.grid?.alpha ?? DEFAULT_GRID.alpha,
    beta: options.grid?.beta ?? DEFAULT_GRID.beta,
    gamma: options.grid?.gamma ?? DEFAULT_GRID.gamma,
  };
  const { method } = classify(series.length, period);
  if (method === 'mean-only') return fitHoltWinters(series, { period });

  const gammas = method === 'holt-winters' ? grid.gamma : [0];
  let best: ForecastModel | null = null;
  for (const alpha of grid.alpha) {
    for (const beta of grid.beta) {
      for (const gamma of gammas) {
        const candidate = fitHoltWinters(series, { period, alpha, beta, gamma });
        if (!best || candidate.sse < best.sse) best = candidate;
      }
    }
  }
  // Unreachable while every grid axis is non-empty; an empty override would
  // otherwise return a model nobody fitted.
  if (!best) throw new RangeError('holtWinters: the parameter grid is empty, so nothing was fitted');
  return best;
}

/**
 * Forecast `horizon` steps past the end of the series, as point plus interval.
 *
 *   point_h = level + h * trend + seasonal[(n + h - 1) mod m]
 *
 * The interval comes from the residual standard deviation, widened with the
 * horizon by the ETS(A,A,A) variance formula (Hyndman, Koehler, Ord & Snyder,
 * "Forecasting with Exponential Smoothing", 2008, ch. 6):
 *
 *   var_h = sigma^2 (1 + sum_{j=1..h-1} c_j^2),
 *   c_j   = alpha (1 + j beta) + gamma (1 - alpha) [j mod m == 0]
 *
 * so every extra step adds the variance of one more level/trend/seasonal update
 * the model has no data for. The h=1 band is one residual sd wide; by h=12 with
 * typical parameters it is 1.4 to 2 times that, and the seasonal term only
 * enters past h = m. (The (1 - alpha) on gamma is the translation between this
 * module's component-form gamma and the ETS gamma the published formula is
 * written in: gamma_ets = gamma (1 - alpha).)
 *
 * Three assumptions, all stated because all are optimistic:
 *
 *   Errors are independent and normally distributed. Spending residuals are
 *   neither. They are right-skewed (a month can blow out by $2,000 but can only
 *   undershoot to zero) and they cluster, so the real distribution has a fatter
 *   upper tail than the normal used here. A nominal 95% band should be read as
 *   "usually right" rather than as a guarantee, and it will miss high more often
 *   than it misses low. This is the objection returns.ts answers for the plan
 *   with Student-t innovations; this module has not earned that yet, because on
 *   24 points a tail index cannot be estimated.
 *
 *   The parameters and the initial state are treated as known. They were
 *   estimated from the same short series, and that estimation error is not in
 *   the band, so true coverage of a nominal 95% interval sits somewhat below
 *   95%. Measured on synthetic series (24 months in, 12 forecast, 2,400 steps):
 *   94% coverage of the noiseless signal, but 83% coverage of the next actual
 *   observation, because sigma comes from *in-sample* residuals, which are
 *   always smaller than out-of-sample errors.
 *
 *   sigma is an estimate of the error the model has already seen. When the
 *   history is under one full period (cyclesObserved < 1) that is not the same
 *   thing as the error it is about to make: a seasonal swing it has never
 *   observed is missing from the residuals entirely. Measured on the same
 *   synthetic series with a strong yearly shape, a 6-9 month fit's nominal 95%
 *   band covered 8-20% of steps, against 83% at 10 months and 92-96% from 14
 *   months on. There is no honest repair — the amplitude of an unobserved
 *   season cannot be estimated from data that does not contain it — so the
 *   result carries cyclesObserved and says so in degradedReason instead. A
 *   caller with under a year of history should show the number and the caveat,
 *   not the band.
 *
 * On the mean-only path the band does not widen with h, and that is correct
 * rather than an oversight: an i.i.d. mean model projects nothing forward, so
 * the uncertainty about step 12 is the uncertainty about step 1, and a widening
 * band there would be decoration. It does carry the sqrt(1 + 1/n) inflation for
 * the mean having itself been estimated.
 *
 * @throws RangeError if `horizon` is not a non-negative integer or `z` is negative.
 */
export function forecastHoltWinters(
  model: ForecastModel,
  horizon: number,
  options: ForecastOptions = {},
): ForecastStep[] {
  if (!Number.isInteger(horizon) || horizon < 0) {
    throw new RangeError(`holtWinters: horizon must be a non-negative integer, got ${String(horizon)}`);
  }
  const z = options.z ?? 1.96;
  if (!Number.isFinite(z) || z < 0) {
    throw new RangeError(`holtWinters: z must be a non-negative number, got ${String(z)}`);
  }

  const { level, trend, seasonal, residualSd, observations } = model;
  const { alpha, beta, gamma } = model.params;
  const period = seasonal.length;
  const meanOnly = model.method === 'mean-only';

  let varianceRatio = 1;
  return Array.from({ length: horizon }, (_unused, index) => {
    const h = index + 1;
    if (h > 1) {
      const j = h - 1;
      const c = alpha * (1 + j * beta) + (period && j % period === 0 ? gamma * (1 - alpha) : 0);
      varianceRatio += c * c;
    }
    // (observations + h - 1) mod m: step 1 continues the cycle at the position
    // after the last observation, so a 24-month series forecast 1 step ahead
    // picks up the January index, not the December one.
    const seasonalTerm = period ? seasonal[(observations + h - 1) % period] : 0;
    const point = level + h * trend + seasonalTerm;

    let sd: number | null = null;
    if (residualSd !== null) {
      sd = meanOnly
        ? residualSd * Math.sqrt(1 + 1 / Math.max(1, observations))
        : residualSd * Math.sqrt(varianceRatio);
    }
    return {
      step: h,
      point,
      lower: sd === null ? null : point - z * sd,
      upper: sd === null ? null : point + z * sd,
      sd,
    };
  });
}
