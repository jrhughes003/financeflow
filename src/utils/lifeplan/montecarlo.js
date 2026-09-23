// Monte Carlo: how the plan holds up when markets don't return the same amount
// every year. Each trial draws a return for each year, runs the whole
// projection, and the result is how often the plan survives plus the spread of
// outcomes.
//
// Three things separate this from the naive version:
//
//   The return model is not i.i.d. normal. See returns.js — Student-t
//   innovations give the tails a normal distribution doesn't have, and an AR(1)
//   term lets bad years cluster, which is what makes sequence risk real.
//
//   Trials run in antithetic pairs: the second path of a pair uses the same
//   shocks with their signs flipped. The two are negatively correlated, so the
//   pair's average is a lower-variance estimate than two independent trials —
//   the same precision for roughly half the work.
//
//   The success rate is reported with a confidence interval. "71% of runs hold
//   up" from 300 trials carries roughly ±5 points of sampling error, and a
//   number that size shouldn't be presented as if it were exact.
//
// Inflation is still held at the plan's assumption.

import { runPlan } from './engine';
import { normalVector, chiSquared, annualReturns, wilsonInterval } from './returns';

const round2 = n => Math.round(n * 100) / 100;
const round4 = n => Math.round(n * 10000) / 10000;

/** Small seeded RNG so the same inputs give the same answer twice. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { normal } from './returns';

export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * @returns { trials, successRate, bands: [{ year, age, p10, p50, p90 }],
 *            depletionYears: { p10, p50, p90 } | null, failures, volatilityPct }
 */
export function runMonteCarlo(plan, snapshot, {
  today = new Date(), trials = 300, volatilityPct = 12, seed = 12345,
  model = 'studentT', df = 5, phi = 0.15, series = [], blockYears = 5,
  antithetic = true,
} = {}) {
  const mean = Number(plan.assumptions?.returnPct ?? 6) / 100;
  const sd = Math.max(0, Number(volatilityPct) / 100);
  const rand = mulberry32(seed);
  const horizon = Math.max(1, Number(plan.assumptions?.endAge ?? 95) - 18) + 1;

  const byYear = new Map();   // year → net worth (today's $) across trials
  const depletions = [];
  const ages = new Map();
  let survived = 0;
  // Survival counted per antithetic pair: a pair is one independent draw, so
  // this is the sequence the standard error is computed from.
  const pairOutcomes = [];

  const runTrial = (returnsByYear) => {
    const monthly = returnsByYear.map(a => Math.pow(1 + a, 1 / 12) - 1);
    const monthlyReturn = k => monthly[Math.min(Math.floor(k / 12), monthly.length - 1)];
    const res = runPlan(plan, snapshot, { today, monthlyReturn });
    if (res.needsSetup) return null;

    if (res.firstShortfall) depletions.push(res.firstShortfall.year);
    else survived += 1;
    res.rows.forEach(r => {
      if (!byYear.has(r.year)) { byYear.set(r.year, []); ages.set(r.year, r.ages.me); }
      byYear.get(r.year).push(r.netWorth / r.inflationIndex);
    });
    return res.firstShortfall ? 0 : 1;
  };

  const step = antithetic ? 2 : 1;
  for (let t = 0; t < trials; t += step) {
    const shocks = normalVector(rand, horizon);
    // The tail draws are shared with the antithetic twin, so only the direction
    // of each shock flips — the magnitude of the tail event is held fixed.
    const tailDraws = model === 'studentT'
      ? Array.from({ length: horizon }, () => chiSquared(rand, df))
      : [];

    const opts = { model, mean, sd, df, phi, tailDraws, series, blockYears };
    const first = runTrial(annualReturns({ ...opts, shocks }));
    if (first === null) return { needsSetup: true };

    let outcomes = [first];
    if (antithetic && t + 1 < trials) {
      const mirrored = runTrial(annualReturns({ ...opts, shocks: shocks.map(z => -z) }));
      if (mirrored === null) return { needsSetup: true };
      outcomes.push(mirrored);
    }
    pairOutcomes.push(outcomes.reduce((a, b) => a + b, 0) / outcomes.length);
  }

  const bands = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, values]) => {
    const sorted = values.sort((a, b) => a - b);
    return {
      year,
      age: ages.get(year),
      p10: round2(percentile(sorted, 0.1)),
      p50: round2(percentile(sorted, 0.5)),
      p90: round2(percentile(sorted, 0.9)),
    };
  });

  const depSorted = [...depletions].sort((a, b) => a - b);
  const ran = pairOutcomes.length * (antithetic ? 2 : 1);
  const successRate = ran > 0 ? survived / ran : 0;

  // Standard error from the pair means, because a pair — not a path — is the
  // independent unit once antithetic sampling is on. Treating each path as
  // independent here would understate the error, which is the usual way this
  // technique gets misreported.
  const pairMean = pairOutcomes.reduce((a, b) => a + b, 0) / Math.max(1, pairOutcomes.length);
  const variance = pairOutcomes.length > 1
    ? pairOutcomes.reduce((acc, v) => acc + (v - pairMean) ** 2, 0) / (pairOutcomes.length - 1)
    : 0;
  const standardError = Math.sqrt(variance / Math.max(1, pairOutcomes.length));

  return {
    trials: ran,
    volatilityPct: Number(volatilityPct),
    model,
    successRate,
    successInterval: wilsonInterval(survived, ran),
    standardError: round4(standardError),
    failures: depletions.length,
    bands,
    depletionYears: depSorted.length
      ? { p10: Math.round(percentile(depSorted, 0.1)), p50: Math.round(percentile(depSorted, 0.5)), p90: Math.round(percentile(depSorted, 0.9)) }
      : null,
  };
}
