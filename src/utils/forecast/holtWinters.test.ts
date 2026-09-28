// Tests for the additive Holt-Winters forecaster.
//
// A smoother is easy to test wrongly: feed it a series, assert the output
// matches the output you recorded last time, and you have pinned a bug in
// place. So these build series whose true generator is known — level + trend
// + seasonal + seeded noise — and assert the fit recovers the generator and the
// forecast continues it, within a tolerance sized to the noise.
//
// The two that matter most are the interval and the degraded paths. An interval
// is only worth reporting if the truth actually falls inside it at about the
// advertised rate, so that is measured rather than assumed. And since a real
// ledger holds 8-24 months, the short-series cases are the common path, not the
// edge: they get as much attention as the smoothing.
//
// Noise is drawn from the repo's seeded RNG so every failure reproduces.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  fitHoltWinters, optimiseHoltWinters, forecastHoltWinters,
} from './holtWinters';
import type { ForecastModel, ForecastStep } from './holtWinters';
import { mulberry32 } from '../lifeplan/montecarlo';

const PERIOD = 12;

// A yearly shape with the summer dip and December spike a ledger actually has,
// centred so that it adds nothing to the average level.
const RAW_SHAPE = [-120, -90, -40, 10, 40, 80, 120, 90, -10, -60, 60, 280];
const SHAPE = (() => {
  const centre = RAW_SHAPE.reduce((a, b) => a + b, 0) / RAW_SHAPE.length;
  return RAW_SHAPE.map(v => v - centre);
})();

interface SeriesOptions {
  n: number;
  level?: number;
  trend?: number;
  shape?: number[];
  /** Half-width of the uniform noise. 0 makes the series exact. */
  noise?: number;
  seed?: number;
}

/** level + trend*t + shape[t mod m] + uniform noise, from a seeded RNG. */
function makeSeries({
  n, level = 1200, trend = 8, shape = SHAPE, noise = 0, seed = 12345,
}: SeriesOptions): { series: number[]; truth: (t: number) => number } {
  const rand = mulberry32(seed);
  const truth = (t: number): number =>
    level + trend * t + (shape.length ? shape[t % shape.length] : 0);
  const series = Array.from({ length: n }, (_unused, t) => truth(t) + (rand() * 2 - 1) * noise);
  return { series, truth };
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const meanAbs = (xs: number[]): number => mean(xs.map(Math.abs));

/** Narrowing helpers that throw rather than assert non-null with `!`. */
function expectInterval(step: ForecastStep): { lower: number; upper: number; sd: number } {
  const { lower, upper, sd } = step;
  if (lower === null || upper === null || sd === null) {
    throw new Error(`unreachable: step ${step.step} should carry an interval`);
  }
  return { lower, upper, sd };
}

function expectSd(model: ForecastModel): number {
  const { residualSd } = model;
  if (residualSd === null) throw new Error('unreachable: this model should have a residual sd');
  return residualSd;
}

describe('fitHoltWinters on a known additive series', () => {
  it('recovers level, trend and seasonal shape', () => {
    const { series } = makeSeries({ n: 48, noise: 20, seed: 4 });
    const model = optimiseHoltWinters(series, { period: PERIOD });
    if (model.method !== 'holt-winters') throw new Error(`unreachable: 48 points is four cycles, got ${model.method}`);

    // Level is de-seasonalised, so at the end of the series it should sit near
    // level0 + trend * (n - 1) = 1200 + 8*47.
    expect(model.level).toBeGreaterThan(1500);
    expect(model.level).toBeLessThan(1650);
    expect(model.trend).toBeGreaterThan(4);
    expect(model.trend).toBeLessThan(12);

    // The recovered shape should correlate with the generator's, position by
    // position. December is the spike; June-ish is the peak of the summer bump.
    expect(model.seasonal).toHaveLength(PERIOD);
    const worstPosition = model.seasonal.indexOf(Math.max(...model.seasonal));
    expect(worstPosition).toBe(11);
    expect(meanAbs(model.seasonal.map((v, i) => v - SHAPE[i]))).toBeLessThan(60);

    // In-sample: the fit tracks the series to roughly the noise level, not to
    // the swing of the seasonal pattern it is supposed to have absorbed.
    expect(meanAbs(model.residuals.slice(PERIOD))).toBeLessThan(45);
    expect(model.sse).toBeGreaterThan(0);
  });

  it('continues the pattern out of sample', () => {
    const { series, truth } = makeSeries({ n: 48, noise: 20, seed: 4 });
    const model = optimiseHoltWinters(series, { period: PERIOD });
    const steps = forecastHoltWinters(model, PERIOD);
    expect(steps).toHaveLength(PERIOD);

    const errors = steps.map(s => s.point - truth(series.length + s.step - 1));
    expect(meanAbs(errors)).toBeLessThan(80);
    // Specifically: the forecast reproduces the December spike rather than
    // flattening it into the average, which is the whole point of the seasonal
    // term. Series ends at t=47 (December, index 11), so t=59 is the next one.
    const december = steps.find(s => (series.length + s.step - 1) % PERIOD === 11);
    if (!december) throw new Error('unreachable: a 12-step forecast contains every cycle position');
    const decemberLift = december.point - mean(steps.map(s => s.point));
    expect(decemberLift).toBeGreaterThan(120);
  });

  it('beats a flat mean forecast on the same series', () => {
    // The claim that justifies the module: against a series with drift and
    // shape, level+trend+seasonal has to be closer than "the usual amount".
    const { series, truth } = makeSeries({ n: 36, noise: 20, seed: 9 });
    const model = optimiseHoltWinters(series, { period: PERIOD });
    const steps = forecastHoltWinters(model, PERIOD);
    const flat = mean(series);

    const hwError = meanAbs(steps.map(s => s.point - truth(series.length + s.step - 1)));
    const flatError = meanAbs(steps.map(s => flat - truth(series.length + s.step - 1)));
    expect(hwError).toBeLessThan(flatError / 2);
  });

  it('handles a period of 7 for a day-of-week shape', () => {
    const weekend = [-30, -35, -20, -10, 15, 60, 20];
    const { series, truth } = makeSeries({
      n: 42, level: 90, trend: 0.4, shape: weekend, noise: 8, seed: 21,
    });
    const model = optimiseHoltWinters(series, { period: 7 });
    if (model.method !== 'holt-winters') throw new Error(`unreachable: 42 points is six weeks, got ${model.method}`);
    const steps = forecastHoltWinters(model, 14);
    expect(meanAbs(steps.map(s => s.point - truth(series.length + s.step - 1)))).toBeLessThan(20);
  });
});

describe('optimiseHoltWinters', () => {
  it('picks parameters from the grid and never does worse than the default fit', () => {
    const { series } = makeSeries({ n: 36, noise: 25, seed: 7 });
    const best = optimiseHoltWinters(series, { period: PERIOD });
    const plain = fitHoltWinters(series, { period: PERIOD });
    expect(best.sse).toBeLessThanOrEqual(plain.sse);
    expect([0.1, 0.3, 0.5, 0.7, 0.9]).toContain(best.params.alpha);
    expect([0, 0.05, 0.1, 0.3]).toContain(best.params.beta);
    expect([0, 0.1, 0.3, 0.6]).toContain(best.params.gamma);
  });

  it('is deterministic', () => {
    const { series } = makeSeries({ n: 30, noise: 30, seed: 3 });
    const a = optimiseHoltWinters(series, { period: PERIOD });
    const b = optimiseHoltWinters(series, { period: PERIOD });
    expect(a.params).toEqual(b.params);
    expect(a.sse).toBe(b.sse);
  });

  it('honours a custom grid and leaves gamma alone when there is no season', () => {
    const { series } = makeSeries({ n: 8, shape: [], noise: 5, seed: 5 });
    const model = optimiseHoltWinters(series, { period: PERIOD, grid: { alpha: [0.2, 0.4] } });
    expect(model.method).toBe('trend-only');
    expect([0.2, 0.4]).toContain(model.params.alpha);
    expect(model.params.gamma).toBe(0);
  });

  it('throws rather than returning an unfitted model when the grid is empty', () => {
    const { series } = makeSeries({ n: 24, noise: 10 });
    expect(() => optimiseHoltWinters(series, { period: PERIOD, grid: { alpha: [] } }))
      .toThrow(/grid is empty/);
  });

  it('skips the search entirely for a mean-only series', () => {
    const model = optimiseHoltWinters([100, 120], { period: PERIOD });
    expect(model.method).toBe('mean-only');
    expect(model.params).toEqual({ alpha: 0, beta: 0, gamma: 0 });
  });
});

describe('pure trend, no seasonality', () => {
  it('is forecast well by the seasonal model when there is history for it', () => {
    const { series, truth } = makeSeries({ n: 36, level: 500, trend: 12, shape: [], noise: 15, seed: 11 });
    const model = optimiseHoltWinters(series, { period: PERIOD });
    if (model.method !== 'holt-winters') throw new Error(`unreachable: expected the full method, got ${model.method}`);
    // The seasonal indices should be near zero: there is no shape to find.
    expect(meanAbs(model.seasonal)).toBeLessThan(25);
    const steps = forecastHoltWinters(model, 6);
    expect(meanAbs(steps.map(s => s.point - truth(series.length + s.step - 1)))).toBeLessThan(40);
  });

  it('is forecast well by the trend-only path on a short series', () => {
    const { series, truth } = makeSeries({ n: 9, level: 500, trend: 12, shape: [], noise: 10, seed: 13 });
    const model = optimiseHoltWinters(series, { period: PERIOD });
    expect(model.method).toBe('trend-only');
    expect(model.seasonal).toEqual([]);
    const steps = forecastHoltWinters(model, 6);
    expect(meanAbs(steps.map(s => s.point - truth(series.length + s.step - 1)))).toBeLessThan(30);
    // The slope is real and is carried forward, not averaged away.
    expect(steps[5].point - steps[0].point).toBeGreaterThan(30);
  });
});

describe('a flat series', () => {
  it('forecasts flat with a narrow interval', () => {
    const flat = new Array(24).fill(800);
    const model = optimiseHoltWinters(flat, { period: PERIOD });
    if (model.method !== 'holt-winters') throw new Error('unreachable: 24 points is two cycles');
    const steps = forecastHoltWinters(model, PERIOD);
    steps.forEach(step => {
      const { lower, upper } = expectInterval(step);
      expect(step.point).toBeCloseTo(800, 6);
      expect(upper - lower).toBeLessThan(1e-6);
    });
    expect(expectSd(model)).toBeLessThan(1e-9);
  });

  it('treats all zeros the same way, without dividing by anything', () => {
    const zeros = new Array(24).fill(0);
    const model = optimiseHoltWinters(zeros, { period: PERIOD });
    expect(model.method).toBe('holt-winters');
    expect(expectSd(model)).toBeCloseTo(0, 9);
    const steps = forecastHoltWinters(model, 3);
    steps.forEach(step => {
      expect(step.point).toBeCloseTo(0, 9);
      expect(Number.isFinite(step.point)).toBe(true);
      const { lower, upper } = expectInterval(step);
      expect(upper - lower).toBeLessThan(1e-9);
    });
  });
});

describe('prediction intervals', () => {
  it('widen monotonically with the horizon under Holt-Winters', () => {
    const { series } = makeSeries({ n: 36, noise: 25, seed: 17 });
    const model = optimiseHoltWinters(series, { period: PERIOD });
    const widths = forecastHoltWinters(model, 24).map(step => {
      const { lower, upper } = expectInterval(step);
      return upper - lower;
    });
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
    // And the widening is material, not a rounding artefact.
    expect(widths[23]).toBeGreaterThan(widths[0] * 1.5);
  });

  it('widen with the horizon on the trend-only path too', () => {
    const { series } = makeSeries({ n: 10, shape: [], trend: 5, noise: 20, seed: 19 });
    const model = optimiseHoltWinters(series, { period: PERIOD });
    expect(model.method).toBe('trend-only');
    const widths = forecastHoltWinters(model, 8).map(step => {
      const { lower, upper } = expectInterval(step);
      return upper - lower;
    });
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
  });

  it('stay constant on the mean-only path, because nothing is projected forward', () => {
    const model = fitHoltWinters([100, 140, 90], { period: PERIOD });
    expect(model.method).toBe('mean-only');
    const widths = forecastHoltWinters(model, 6).map(step => {
      const { lower, upper } = expectInterval(step);
      return upper - lower;
    });
    widths.forEach(w => expect(w).toBeCloseTo(widths[0], 9));
    expect(widths[0]).toBeGreaterThan(0);
  });

  it('are centred on the point and scale with z', () => {
    const { series } = makeSeries({ n: 24, noise: 25, seed: 23 });
    const model = optimiseHoltWinters(series, { period: PERIOD });
    const wide = forecastHoltWinters(model, 4);
    const narrow = forecastHoltWinters(model, 4, { z: 1 });
    wide.forEach((step, i) => {
      const w = expectInterval(step);
      const n = expectInterval(narrow[i]);
      expect(step.point - w.lower).toBeCloseTo(w.upper - step.point, 9);
      expect(w.upper - step.point).toBeCloseTo((n.upper - step.point) * 1.96, 9);
    });
  });

  it('contain the truth for most steps of a synthetic series', () => {
    // The test that makes the interval mean something: fit on the first 24
    // months, forecast the next 12, and count how often the truth lands inside
    // the nominal 95% band. Twenty seeds, 240 steps, so no single unlucky draw
    // carries the result.
    //
    // Both targets are counted, because they answer different questions. The
    // signal is "did the band capture where the series was heading"; the noisy
    // observation is "would the band have contained next month's actual number".
    // The second is the harder one and it under-covers, for the reason the
    // module's comment gives: sigma is estimated from in-sample residuals, which
    // are always smaller than out-of-sample errors.
    let onSignal = 0;
    let onObservations = 0;
    let total = 0;
    for (let seed = 31; seed < 51; seed += 1) {
      const { series, truth } = makeSeries({ n: 36, noise: 60, seed });
      const model = optimiseHoltWinters(series.slice(0, 24), { period: PERIOD });
      forecastHoltWinters(model, PERIOD).forEach(step => {
        const { lower, upper } = expectInterval(step);
        const signal = truth(24 + step.step - 1);
        const observed = series[24 + step.step - 1];
        total += 1;
        if (signal >= lower && signal <= upper) onSignal += 1;
        if (observed >= lower && observed <= upper) onObservations += 1;
      });
    }
    expect(total).toBe(240);
    // Measured over 200 seeds: 94% against the signal, 83% against the next
    // observation. The bounds here are the measured figures with room for the
    // smaller sample, and the upper bounds matter too — a band that covered
    // everything would be passing this test by being useless.
    expect(onSignal / total).toBeGreaterThanOrEqual(0.88);
    expect(onSignal / total).toBeLessThanOrEqual(0.995);
    expect(onObservations / total).toBeGreaterThanOrEqual(0.72);
  });
});

describe('short series are degraded explicitly', () => {
  it('reports trend-only, and why, below two full periods', () => {
    const { series } = makeSeries({ n: 14, noise: 20, seed: 29 });
    const model = fitHoltWinters(series, { period: PERIOD });
    expect(model.method).toBe('trend-only');
    expect(model.degradedReason).toContain('14 observations');
    expect(model.degradedReason).toContain('24');
    expect(model.seasonal).toEqual([]);
    expect(model.cyclesObserved).toBeCloseTo(14 / 12, 9);
    // 23 months is still not enough: the boundary is two full cycles, not
    // "nearly two".
    expect(fitHoltWinters(new Array(23).fill(100), { period: PERIOD }).method).toBe('trend-only');
    expect(fitHoltWinters(new Array(24).fill(100), { period: PERIOD }).method).toBe('holt-winters');
  });

  it('warns, under one full period, that the interval cannot see seasonality', () => {
    // The nastiest case in the module, and it is a common one: 8 months of a
    // series with a yearly shape. The fit sees a smooth run of points, its
    // residuals are small, and the band it derives from them is confident and
    // wrong — measured at 8-20% coverage against a strongly seasonal generator.
    // Nothing in the data can fix that, so the result has to say it.
    const { series } = makeSeries({ n: 8, noise: 20, seed: 33 });
    const model = fitHoltWinters(series, { period: PERIOD });
    expect(model.method).toBe('trend-only');
    expect(model.cyclesObserved).toBeCloseTo(8 / 12, 9);
    expect(model.degradedReason).toContain('under one full period');
    expect(model.degradedReason).toContain('cannot include seasonal variation');

    // At 14 months the warning is gone: a full cycle has been observed, so the
    // residuals do contain the seasonal swing even though the shape is not
    // modelled, and the band is wide for an honest reason.
    const longer = fitHoltWinters(makeSeries({ n: 14, noise: 20, seed: 33 }).series, { period: PERIOD });
    expect(longer.cyclesObserved).toBeGreaterThan(1);
    expect(longer.degradedReason).not.toContain('under one full period');
    expect(expectSd(longer)).toBeGreaterThan(expectSd(model));
  });

  it('reports mean-only for a single data point, and carries no interval', () => {
    const model = fitHoltWinters([742.5], { period: PERIOD });
    expect(model.method).toBe('mean-only');
    expect(model.degradedReason).toContain('1 observation ');
    expect(model.observations).toBe(1);
    expect(model.level).toBe(742.5);
    expect(model.trend).toBe(0);
    // One point fits itself perfectly, so a residual sd of 0 would claim
    // certainty. null is the honest answer and the interval disappears with it.
    expect(model.residualSd).toBeNull();
    expect(model.sse).toBe(0);
    forecastHoltWinters(model, 3).forEach(step => {
      expect(step.point).toBe(742.5);
      expect(step.lower).toBeNull();
      expect(step.upper).toBeNull();
      expect(step.sd).toBeNull();
    });
  });

  it('reports mean-only for an empty series without inventing a number', () => {
    const model = fitHoltWinters([], { period: PERIOD });
    expect(model.method).toBe('mean-only');
    expect(model.degradedReason).toContain('No observations');
    expect(model.observations).toBe(0);
    expect(model.level).toBe(0);
    expect(model.residuals).toEqual([]);
    expect(model.residualSd).toBeNull();
    const steps = forecastHoltWinters(model, 2);
    expect(steps.map(s => s.point)).toEqual([0, 0]);
    expect(steps.every(s => s.lower === null)).toBe(true);
  });

  it('reports mean-only for two or three points and forecasts their mean', () => {
    const model = fitHoltWinters([100, 200, 300], { period: PERIOD });
    expect(model.method).toBe('mean-only');
    expect(model.degradedReason).toContain('3 observations');
    expect(model.level).toBe(200);
    expect(model.fitted).toEqual([200, 200, 200]);
    // A rising three-point series is *not* extrapolated: 400 would be a guess
    // dressed as a trend.
    expect(forecastHoltWinters(model, 1)[0].point).toBe(200);
    expect(expectSd(model)).toBeCloseTo(100, 9);
  });

  it('keeps all zeros flat on the degraded paths as well', () => {
    const model = fitHoltWinters([0, 0, 0, 0, 0, 0], { period: PERIOD });
    expect(model.method).toBe('trend-only');
    expect(expectSd(model)).toBe(0);
    forecastHoltWinters(model, 4).forEach(step => {
      expect(step.point).toBe(0);
      const { lower, upper } = expectInterval(step);
      expect(lower).toBe(0);
      expect(upper).toBe(0);
    });
  });
});

describe('bad input fails loudly', () => {
  it('rejects a NaN anywhere in the series, naming the index', () => {
    const series = new Array(24).fill(100);
    series[13] = NaN;
    expect(() => fitHoltWinters(series, { period: PERIOD })).toThrow(/series\[13\] is NaN/);
    expect(() => optimiseHoltWinters(series, { period: PERIOD })).toThrow(/series\[13\] is NaN/);
  });

  it('rejects Infinity rather than propagating it into a forecast', () => {
    const series = new Array(24).fill(100);
    series[0] = Infinity;
    expect(() => fitHoltWinters(series, { period: PERIOD })).toThrow(/series\[0\] is Infinity/);
    const negative = new Array(24).fill(100);
    negative[23] = -Infinity;
    expect(() => fitHoltWinters(negative, { period: PERIOD })).toThrow(/finite number/);
  });

  it('rejects non-numeric entries and non-arrays', () => {
    // A ledger aggregation that forgot to coerce is the realistic version of
    // this: string amounts would smoothe into "1001000" rather than throwing.
    expect(() => fitHoltWinters(['200', 100, 100, 100] as unknown as number[], { period: PERIOD }))
      .toThrow(/finite number/);
    expect(() => fitHoltWinters([100, null, 100, 100] as unknown as number[], { period: PERIOD }))
      .toThrow(/finite number/);
    expect(() => fitHoltWinters(undefined as unknown as number[], { period: PERIOD }))
      .toThrow(/must be an array/);
  });

  it('rejects a period that cannot describe a cycle', () => {
    const series = new Array(24).fill(100);
    expect(() => fitHoltWinters(series, { period: 1 })).toThrow(/period must be an integer/);
    expect(() => fitHoltWinters(series, { period: 12.5 })).toThrow(/period must be an integer/);
    expect(() => optimiseHoltWinters(series, { period: 0 })).toThrow(/period must be an integer/);
  });

  it('rejects smoothing parameters outside [0, 1]', () => {
    const series = new Array(24).fill(100);
    expect(() => fitHoltWinters(series, { period: PERIOD, alpha: 1.2 })).toThrow(/alpha must be between/);
    expect(() => fitHoltWinters(series, { period: PERIOD, beta: -0.1 })).toThrow(/beta must be between/);
    expect(() => fitHoltWinters(series, { period: PERIOD, gamma: NaN })).toThrow(/gamma must be between/);
  });

  it('rejects a nonsense horizon or z', () => {
    const model = fitHoltWinters(new Array(24).fill(100), { period: PERIOD });
    expect(() => forecastHoltWinters(model, -1)).toThrow(/horizon must be a non-negative integer/);
    expect(() => forecastHoltWinters(model, 2.5)).toThrow(/horizon must be a non-negative integer/);
    expect(() => forecastHoltWinters(model, 4, { z: -1 })).toThrow(/z must be a non-negative number/);
    expect(forecastHoltWinters(model, 0)).toEqual([]);
  });
});

describe('properties that must hold for any finite series', () => {
  const finiteSeries = (min: number, max: number) =>
    fc.array(fc.integer({ min: -500000, max: 500000 }).map(n => n / 100), { minLength: min, maxLength: max });

  it('never produces a non-finite forecast, and the point always sits inside its band', () => {
    fc.assert(fc.property(finiteSeries(0, 40), fc.integer({ min: 1, max: 18 }), (series, horizon) => {
      const model = optimiseHoltWinters(series, { period: PERIOD });
      expect(Number.isFinite(model.sse)).toBe(true);
      forecastHoltWinters(model, horizon).forEach(step => {
        expect(Number.isFinite(step.point)).toBe(true);
        if (step.lower === null || step.upper === null) {
          // Only legal when the spread could not be estimated at all.
          expect(model.residualSd).toBeNull();
          return;
        }
        expect(step.lower).toBeLessThanOrEqual(step.point);
        expect(step.upper).toBeGreaterThanOrEqual(step.point);
      });
    }), { numRuns: 120 });
  });

  it('always reports a method the series length can support', () => {
    fc.assert(fc.property(finiteSeries(0, 30), series => {
      const model = fitHoltWinters(series, { period: PERIOD });
      if (series.length >= 24) expect(model.method).toBe('holt-winters');
      else if (series.length >= 4) expect(model.method).toBe('trend-only');
      else expect(model.method).toBe('mean-only');
      // Exactly one of the two states: the full method explains nothing, a
      // degraded one always explains itself.
      if (model.method === 'holt-winters') expect(model.degradedReason).toBeNull();
      else expect(model.degradedReason.length).toBeGreaterThan(20);
    }), { numRuns: 200 });
  });

  it('is unaffected by a constant shift beyond shifting the forecast', () => {
    // Additive smoothing is equivariant under adding a constant: the level
    // moves, the trend and the seasonal shape do not. A fit that fails this is
    // mixing the level into the seasonal indices.
    fc.assert(fc.property(finiteSeries(24, 40), fc.integer({ min: -1000, max: 1000 }), (series, shift) => {
      const base = fitHoltWinters(series, { period: PERIOD });
      const shifted = fitHoltWinters(series.map(v => v + shift), { period: PERIOD });
      expect(shifted.level).toBeCloseTo(base.level + shift, 4);
      expect(shifted.trend).toBeCloseTo(base.trend, 4);
      expect(shifted.sse).toBeCloseTo(base.sse, 2);
      const baseSd = expectSd(base);
      expect(expectSd(shifted)).toBeCloseTo(baseSd, 4);
    }), { numRuns: 60 });
  });
});
