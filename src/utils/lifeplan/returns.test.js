// Property tests for the return models.
//
// A statistical routine can be wrong in ways an example-based test never sees:
// the mean comes out right while the tails are missing, or persistence is
// claimed but the series is independent. These generate large samples and check
// the moments and dependence structure the models are supposed to produce —
// against known values, with tolerances sized to the sample.

import { describe, it, expect } from 'vitest';
import {
  normal, normalVector, chiSquared, standardisedT, annualReturns,
  normalCdf, wilsonInterval,
} from './returns';
import { mulberry32 } from './montecarlo';

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = xs => {
  const m = mean(xs);
  return xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
};
const sd = xs => Math.sqrt(variance(xs));

function autocorrelation(xs, lag = 1) {
  const m = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    den += (xs[i] - m) ** 2;
    if (i + lag < xs.length) num += (xs[i] - m) * (xs[i + lag] - m);
  }
  return num / den;
}

function excessKurtosis(xs) {
  const m = mean(xs);
  const s = sd(xs);
  const fourth = xs.reduce((acc, x) => acc + ((x - m) / s) ** 4, 0) / xs.length;
  return fourth - 3;
}

describe('normal draws', () => {
  it('recovers the standard normal moments', () => {
    const rand = mulberry32(7);
    const xs = normalVector(rand, 20000);
    expect(mean(xs)).toBeCloseTo(0, 1);
    expect(sd(xs)).toBeCloseTo(1, 1);
    expect(Math.abs(excessKurtosis(xs))).toBeLessThan(0.3); // a normal has none
  });

  it('is reproducible from a seed', () => {
    expect(normalVector(mulberry32(3), 5)).toEqual(normalVector(mulberry32(3), 5));
  });
});

describe('chi-squared', () => {
  it('has mean df and variance 2·df', () => {
    const rand = mulberry32(11);
    const df = 5;
    const xs = Array.from({ length: 20000 }, () => chiSquared(rand, df));
    expect(mean(xs)).toBeCloseTo(df, 0);
    expect(variance(xs) / (2 * df)).toBeGreaterThan(0.85);
    expect(variance(xs) / (2 * df)).toBeLessThan(1.15);
  });
});

describe('Student-t innovations', () => {
  it('keeps unit variance but adds tail mass a normal does not have', () => {
    const rand = mulberry32(19);
    const df = 5;
    const ts = Array.from({ length: 40000 }, () => standardisedT(normal(rand), chiSquared(rand, df), df));

    // Standardised, so volatility still means what the user set…
    expect(sd(ts)).toBeGreaterThan(0.9);
    expect(sd(ts)).toBeLessThan(1.1);
    // …but the tails are heavier: t(5) has excess kurtosis 6 in theory, and
    // extreme moves are several times more likely than under a normal.
    expect(excessKurtosis(ts)).toBeGreaterThan(1.5);

    const beyondThreeSigma = ts.filter(t => Math.abs(t) > 3).length / ts.length;
    expect(beyondThreeSigma).toBeGreaterThan(0.0027); // the normal rate
  });
});

describe('annualReturns', () => {
  const shocks = n => normalVector(mulberry32(23), n);

  it('centres on the expected return with the requested volatility', () => {
    const xs = annualReturns({ model: 'normal', mean: 0.06, sd: 0.12, phi: 0, shocks: shocks(20000) });
    expect(mean(xs)).toBeCloseTo(0.06, 2);
    expect(sd(xs)).toBeGreaterThan(0.10);
    expect(sd(xs)).toBeLessThan(0.14);
  });

  it('produces persistence when phi is set, and none when it is not', () => {
    const independent = annualReturns({ model: 'normal', mean: 0.06, sd: 0.12, phi: 0, shocks: shocks(20000) });
    expect(Math.abs(autocorrelation(independent))).toBeLessThan(0.05);

    const persistent = annualReturns({ model: 'normal', mean: 0.06, sd: 0.12, phi: 0.4, shocks: shocks(20000) });
    expect(autocorrelation(persistent)).toBeGreaterThan(0.25);
  });

  it('holds volatility steady as persistence is turned up', () => {
    // Scaling the innovation by sqrt(1-phi²) is what makes this true; without
    // it, adding persistence would silently inflate the volatility the user set.
    const flat = annualReturns({ model: 'normal', mean: 0.06, sd: 0.12, phi: 0, shocks: shocks(20000) });
    const sticky = annualReturns({ model: 'normal', mean: 0.06, sd: 0.12, phi: 0.5, shocks: shocks(20000) });
    expect(Math.abs(sd(flat) - sd(sticky))).toBeLessThan(0.02);
  });

  it('never loses more than everything in a year', () => {
    const wild = annualReturns({ model: 'studentT', mean: 0.06, sd: 0.9, df: 3, shocks: shocks(5000),
      tailDraws: Array.from({ length: 5000 }, (_, i) => 1 + (i % 9)) });
    expect(Math.min(...wild)).toBeGreaterThanOrEqual(-0.95);
  });

  it('bootstrap resamples the supplied series and keeps blocks intact', () => {
    const series = [0.20, -0.35, 0.18, 0.05, -0.10, 0.28, 0.11];
    const out = annualReturns({ model: 'bootstrap', series, blockYears: 3, shocks: shocks(600) });

    expect(out).toHaveLength(600);
    out.forEach(r => expect(series).toContain(r));
    // Every value follows its neighbour in the source at least sometimes, which
    // is the whole point of drawing blocks rather than single years.
    const followsSource = out.slice(0, -1).filter((r, i) => {
      const at = series.indexOf(r);
      return series[(at + 1) % series.length] === out[i + 1];
    }).length;
    expect(followsSource / out.length).toBeGreaterThan(0.5);
  });

  it('refuses to bootstrap without a series rather than inventing one', () => {
    expect(() => annualReturns({ model: 'bootstrap', series: [], shocks: shocks(10) }))
      .toThrow(/needs a series/i);
  });
});

describe('normalCdf', () => {
  it('matches known values of the standard normal', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(2.58)).toBeCloseTo(0.995, 2);
  });
});

describe('wilsonInterval', () => {
  it('brackets the estimate and stays inside [0, 1]', () => {
    const { low, high } = wilsonInterval(213, 300); // the app's 71% example
    expect(low).toBeLessThan(0.71);
    expect(high).toBeGreaterThan(0.71);
    expect(high - low).toBeGreaterThan(0.08); // ±5 points at this sample size
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
  });

  it('narrows as trials increase', () => {
    const few = wilsonInterval(71, 100);
    const many = wilsonInterval(7100, 10000);
    expect(many.high - many.low).toBeLessThan(few.high - few.low);
  });

  it('stays in range at the boundaries, where the normal approximation fails', () => {
    // p = 1 would give a zero-width normal interval; p = 0 would go negative.
    const all = wilsonInterval(50, 50);
    expect(all.high).toBeLessThanOrEqual(1);
    expect(all.low).toBeLessThan(1);
    const none = wilsonInterval(0, 50);
    expect(none.low).toBeGreaterThanOrEqual(0);
    expect(none.high).toBeGreaterThan(0);
  });
});
