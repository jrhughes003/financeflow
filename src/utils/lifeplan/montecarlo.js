// Monte Carlo: how the plan holds up when markets don't return the same amount
// every year. Each trial draws a random return for each year (normal
// distribution around the expected return, with the given volatility) and runs
// the whole projection. The result is how often the plan survives, and the
// spread of outcomes.
//
// Deliberately simple: returns are independent year to year (no mean reversion
// or fat tails), and inflation is held at the plan's assumption.

import { runPlan } from './engine';

const round2 = n => Math.round(n * 100) / 100;

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

/** Standard normal via Box–Muller. */
export function normal(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

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
} = {}) {
  const mean = Number(plan.assumptions?.returnPct ?? 6) / 100;
  const sd = Math.max(0, Number(volatilityPct) / 100);
  const rand = mulberry32(seed);

  const byYear = new Map();   // year → net worth (today's $) across trials
  const depletions = [];
  let survived = 0;
  let ages = new Map();

  for (let t = 0; t < trials; t++) {
    // One random return per calendar year, reused for that year's 12 months.
    const yearly = [];
    const monthlyReturn = k => {
      const y = Math.floor(k / 12);
      if (yearly[y] === undefined) {
        const annual = Math.max(-0.95, mean + normal(rand) * sd);
        yearly[y] = Math.pow(1 + annual, 1 / 12) - 1;
      }
      return yearly[y];
    };
    const res = runPlan(plan, snapshot, { today, monthlyReturn });
    if (res.needsSetup) return { needsSetup: true };

    if (res.firstShortfall) depletions.push(res.firstShortfall.year);
    else survived++;
    res.rows.forEach(r => {
      if (!byYear.has(r.year)) { byYear.set(r.year, []); ages.set(r.year, r.ages.me); }
      byYear.get(r.year).push(r.netWorth / r.inflationIndex);
    });
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
  return {
    trials,
    volatilityPct: Number(volatilityPct),
    successRate: trials > 0 ? survived / trials : 0,
    failures: depletions.length,
    bands,
    depletionYears: depSorted.length
      ? { p10: Math.round(percentile(depSorted, 0.1)), p50: Math.round(percentile(depSorted, 0.5)), p90: Math.round(percentile(depSorted, 0.9)) }
      : null,
  };
}
