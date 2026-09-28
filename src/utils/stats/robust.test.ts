// Tests for the robust-statistics module.
//
// Two kinds of claim are made in robust.ts, and they need two kinds of test.
//
// The estimators (median, MAD, the normal tail) have properties that must hold
// for every input, not for the handful of samples someone thought to type out —
// a median cannot depend on input order, a MAD cannot be moved by one extreme
// value, a tail probability cannot rise as its z-score rises. Those are written
// as fast-check properties, in the style of invariants.test.ts.
//
// benjaminiHochberg makes a claim of a different kind: that *over many datasets*
// no more than q of what it returns is wrong on average. No single example can
// show that, and no property over one input can either — the guarantee is about
// a distribution of outcomes. So it is measured the only way it can be: simulate
// ledgers with a known truth, run the procedure over thousands of them, and
// check the realised false-discovery proportion against q. That test is the
// reason to trust this module at all.
//
// All randomness comes from a seeded generator (and fast-check runs with a fixed
// seed), so a failure here is reproducible from the failure message alone.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { median, mad, robustZ, normalTwoSidedP, benjaminiHochberg } from './robust';

// Fixed so CI reproduces any failure exactly. Bump it deliberately to search a
// different slice of the input space; do not make it vary per run.
const RUNS = { numRuns: 300, seed: 20260928 };

/**
 * mulberry32: a small, fast, well-distributed 32-bit PRNG. Used instead of
 * Math.random so every simulated ledger below is identical on every machine.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller. The log needs a strictly positive uniform, hence the guard. */
function standardNormal(rand: () => number): number {
  let u = rand();
  while (u <= 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** The non-robust comparison the whole module is arguing against. */
function stdDev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
}

const finite = () => fc.double({ min: -1e6, max: 1e6, noNaN: true });

// A sample plus a sort key per element, so a property can compare a sample
// against a genuine permutation of itself rather than just its reverse.
const keyedSample = (minLength = 1) => fc.array(
  fc.record({ value: finite(), key: fc.double({ min: 0, max: 1, noNaN: true }) }),
  { minLength, maxLength: 60 },
);

describe('median', () => {
  it('interpolates between the two middle values on an even sample', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([1, 2])).toBe(1.5);
    expect(median([-4, -1])).toBe(-2.5);
    expect(median([7])).toBe(7);
    // Documented convention, shared with median() in utils/insights.ts: no
    // sample means no signal, not NaN.
    expect(median([])).toBe(0);
  });

  it('does not depend on the order of its input', () => {
    fc.assert(fc.property(keyedSample(1), entries => {
      const asGiven = entries.map(e => e.value);
      const permuted = [...entries].sort((a, b) => a.key - b.key).map(e => e.value);
      expect(median(permuted)).toBe(median(asGiven));
      expect(median([...asGiven].reverse())).toBe(median(asGiven));
    }), RUNS);
  });

  it('is unchanged when the whole sample is duplicated', () => {
    // True for both parities: doubling every value shifts both middle indices by
    // exactly one rank, landing on the same values (or the same pair).
    fc.assert(fc.property(fc.array(finite(), { minLength: 1, maxLength: 40 }), xs => {
      expect(median([...xs, ...xs])).toBeCloseTo(median(xs), 9);
      expect(median([...xs, ...xs, ...xs])).toBeCloseTo(median(xs), 9);
    }), RUNS);
  });

  it('lies inside the sample and splits it in half', () => {
    fc.assert(fc.property(fc.array(finite(), { minLength: 1, maxLength: 60 }), xs => {
      const m = median(xs);
      expect(m).toBeGreaterThanOrEqual(Math.min(...xs));
      expect(m).toBeLessThanOrEqual(Math.max(...xs));
      const half = Math.floor(xs.length / 2);
      expect(xs.filter(x => x <= m).length).toBeGreaterThanOrEqual(half);
      expect(xs.filter(x => x >= m).length).toBeGreaterThanOrEqual(half);
    }), RUNS);
  });
});

describe('mad', () => {
  it('is the median of the absolute deviations, scaled by 1.4826 by default', () => {
    // [1,2,3,4,5]: median 3, deviations [2,1,0,1,2], median deviation 1.
    expect(mad([1, 2, 3, 4, 5], { consistency: false })).toBe(1);
    expect(mad([1, 2, 3, 4, 5])).toBeCloseTo(1.4826, 10);
    // A run of identical values has no spread at all, scaled or not.
    expect(mad([40, 40, 40, 40], { consistency: false })).toBe(0);
    expect(mad([40, 40, 40, 40])).toBe(0);
    expect(mad([])).toBe(0);
    expect(mad([], { consistency: false })).toBe(0);
  });

  it('the consistency factor really does put the MAD on sigma\'s scale', () => {
    // The justification for 1.4826, measured rather than asserted: on a large
    // normal sample the scaled MAD must agree with the standard deviation. Drop
    // the factor and it is ~32% too small, which is exactly how a "3 sigma"
    // threshold silently becomes a 2 sigma one.
    const rand = mulberry32(0x5EED);
    const sample = Array.from({ length: 4000 }, () => standardNormal(rand));
    const sigma = stdDev(sample);
    expect(mad(sample) / sigma).toBeCloseTo(1, 1); // within 10%
    expect(mad(sample, { consistency: false }) / sigma).toBeLessThan(0.75);
  });

  it('is unmoved by an extreme outlier that sends the standard deviation flying', () => {
    // The point of the module, asserted as a contrast rather than in isolation.
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 41, maxLength: 200 }),
      fc.integer({ min: 100000, max: 10000000 }),
      (bulk, outlier) => {
        const contaminated = [...bulk, outlier];
        const madBefore = mad(bulk);
        const madAfter = mad(contaminated);
        const sdBefore = stdDev(bulk);
        const sdAfter = stdDev(contaminated);

        // With n >= 41, one added point moves the median deviation by at most one
        // order statistic, and every one of those lies within the bulk's range.
        // So the MAD stays on the scale of the bulk data no matter how far away
        // the outlier is.
        expect(madAfter).toBeLessThanOrEqual(100 * 1.4826);
        // The standard deviation cannot: it is dragged clean out of that range.
        expect(sdAfter).toBeGreaterThan(100 * 1.4826);
        // Stated directly: the robust estimate moves less than the naive one.
        expect(Math.abs(madAfter - madBefore)).toBeLessThan(Math.abs(sdAfter - sdBefore));
      },
    ), RUNS);
  });

  it('barely notices a million-dollar charge in a normal sample', () => {
    const rand = mulberry32(0xC0FFEE);
    const sample = Array.from({ length: 200 }, () => 40 + 5 * standardNormal(rand));
    const contaminated = [...sample, 1000000];
    // Under 2% movement in the robust scale...
    expect(Math.abs(mad(contaminated) - mad(sample)) / mad(sample)).toBeLessThan(0.02);
    // ...against a standard deviation that grows by more than 50x, which is the
    // failure that lets one huge charge hide itself behind its own threshold.
    expect(stdDev(contaminated) / stdDev(sample)).toBeGreaterThan(50);
  });
});

describe('robustZ', () => {
  it('measures distance from the median in robust sigmas', () => {
    const xs = [1, 2, 3, 4, 5]; // median 3, MAD 1.4826
    expect(robustZ(3, xs)).toBe(0);
    expect(robustZ(5, xs)).toBeCloseTo(2 / 1.4826, 10);
    expect(robustZ(1, xs)).toBeCloseTo(-2 / 1.4826, 10);
    // A 900 among 40s: flagged strongly, and by a scale the 900 did not inflate.
    const ledger = [38, 41, 39, 42, 40, 37, 43, 40, 41, 39, 900];
    expect(robustZ(900, ledger)).toBeGreaterThan(100);
    expect(robustZ(40, ledger)).toBeLessThan(1);
  });

  it('returns 0, not Infinity, when the sample has no spread whatsoever', () => {
    // Pinned behaviour. Twelve identical subscription charges give MAD = 0 and
    // mean absolute deviation = 0, so there is no scale to divide by. The honest
    // answer is "this sample cannot tell you", i.e. no evidence — reporting
    // Infinity would turn into p = 0 and a claim of certainty from data that
    // contains no information about spread.
    const identical = [10.99, 10.99, 10.99, 10.99, 10.99];
    expect(robustZ(10.99, identical)).toBe(0);
    expect(robustZ(900, identical)).toBe(0);
    expect(robustZ(-900, identical)).toBe(0);
  });

  it('falls back to the mean absolute deviation when the MAD alone is degenerate', () => {
    // More than half the sample is identical, so MAD = 0 — but the sample does
    // have spread, so a finite z is available and worth having.
    const ledger = [40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 900];
    expect(mad(ledger)).toBe(0);
    const z = robustZ(900, ledger);
    expect(Number.isFinite(z)).toBe(true);
    expect(z).toBeGreaterThan(5);
    expect(robustZ(40, ledger)).toBe(0);
  });

  it('never returns NaN or Infinity for a finite value', () => {
    // `finite()` reaches into the denormals, which is where this first failed:
    // for xs = [0, 1e-323] the MAD is a denormal and the division overflows to
    // Infinity. No ledger produces that, but the guarantee is either true or it
    // is not, so robust.ts bounds the ratio and this property holds it to it.
    fc.assert(fc.property(finite(), fc.array(finite(), { maxLength: 40 }), (x, xs) => {
      const z = robustZ(x, xs);
      if (!Number.isFinite(z)) throw new Error(`robustZ returned ${z} for x=${x} over ${xs.length} values`);
      if (!xs.length) expect(z).toBe(0);
    }), RUNS);
  });

  it('is unchanged by rescaling or shifting the whole sample', () => {
    // A z-score is a unit-free statement about position, so switching from
    // dollars to cents, or subtracting a baseline, must not change it.
    //
    // Amounts in cents rather than arbitrary doubles, deliberately: a sample of
    // denormals (5e-324) times a scale of 0.01 underflows to all-zeros, and the
    // property then fails on IEEE-754 rather than on anything this function did.
    // The claim is about money, so the generator stays inside money.
    const cents = () => fc.integer({ min: -100000, max: 100000 }).map(n => n / 100);
    fc.assert(fc.property(
      fc.array(cents(), { minLength: 3, maxLength: 40 }),
      fc.double({ min: 0.01, max: 100, noNaN: true }),
      fc.double({ min: -500, max: 500, noNaN: true }),
      (xs, scale, shift) => {
        const x = xs[0];
        const before = robustZ(x, xs);
        const after = robustZ(x * scale + shift, xs.map(v => v * scale + shift));
        // Tolerance is generous because the transform itself loses bits; the
        // claim being tested is equivariance, not exact float reproduction.
        expect(after).toBeCloseTo(before, 6);
      },
    ), RUNS);
  });

  it('treats an empty sample or a non-finite value as no evidence', () => {
    expect(robustZ(100, [])).toBe(0);
    expect(robustZ(Number.NaN, [1, 2, 3, 4, 5])).toBe(0);
    expect(robustZ(Infinity, [1, 2, 3, 4, 5])).toBe(0);
  });
});

describe('normalTwoSidedP', () => {
  it('matches the values every table of critical values lists', () => {
    expect(normalTwoSidedP(0)).toBeCloseTo(1, 6);
    expect(normalTwoSidedP(1)).toBeCloseTo(0.31731, 4);
    expect(normalTwoSidedP(1.959964)).toBeCloseTo(0.05, 5);
    expect(normalTwoSidedP(2.575829)).toBeCloseTo(0.01, 5);
    expect(normalTwoSidedP(3)).toBeCloseTo(0.0026998, 6);
    expect(normalTwoSidedP(4)).toBeCloseTo(0.0000633, 6);
  });

  it('is symmetric in the sign of z', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 40, noNaN: true }), z => {
      expect(normalTwoSidedP(-z)).toBe(normalTwoSidedP(z));
    }), RUNS);
  });

  it('is bounded in [0,1] and never rises as |z| rises', () => {
    fc.assert(fc.property(
      fc.double({ min: -40, max: 40, noNaN: true }),
      fc.double({ min: 0, max: 20, noNaN: true }),
      (z, extra) => {
        const near = normalTwoSidedP(z);
        const far = normalTwoSidedP(Math.abs(z) + extra);
        expect(near).toBeGreaterThanOrEqual(0);
        expect(near).toBeLessThanOrEqual(1);
        // Non-strict, and with a tolerance the size of the approximation's own
        // stated error (1.5e-7): claiming strict monotonicity of a polynomial
        // approximation at that resolution would be claiming more than A&S does.
        expect(far).toBeLessThanOrEqual(near + 1.5e-7);
      },
    ), RUNS);
  });

  it('handles the extremes without producing a nonsense p-value', () => {
    expect(normalTwoSidedP(Number.NaN)).toBe(1); // no evidence, not certainty
    expect(normalTwoSidedP(Infinity)).toBe(0);
    expect(normalTwoSidedP(-Infinity)).toBe(0);
    const tail = normalTwoSidedP(12);
    expect(tail).toBeGreaterThanOrEqual(0);
    expect(tail).toBeLessThan(1e-6);
  });
});

describe('benjaminiHochberg', () => {
  it('returns indices into the original array, not ranks', () => {
    // The classic bug: sort internally, then hand back positions in the sorted
    // array. Here the two discoveries sit at original indices 3 and 1, so an
    // implementation that forgot to map back would answer [0, 1].
    const p = [0.9, 0.001, 0.5, 0.0001, 0.7];
    const { discoveries, criticalP } = benjaminiHochberg(p, 0.05);
    expect(discoveries).toEqual([1, 3]);
    expect(criticalP).toBe(0.001);
    // And the answer cannot depend on how the caller happened to order its data.
    const reordered = [...p].reverse();
    const mirrored = benjaminiHochberg(reordered, 0.05).discoveries.map(i => p.length - 1 - i);
    expect([...mirrored].sort((a, b) => a - b)).toEqual(discoveries);
  });

  it('steps up: a p-value that fails its own rank still counts if a later rank passes', () => {
    // m = 3, q = 0.05. At rank 3 the threshold is 0.05 and p_(3) = 0.04 passes,
    // so all three are discoveries — including 0.04, which fails the rank-1 and
    // rank-2 thresholds. A step-*down* implementation returns nothing here.
    const { discoveries, criticalP } = benjaminiHochberg([0.04, 0.01, 0.03], 0.05);
    expect(discoveries).toEqual([0, 1, 2]);
    expect(criticalP).toBe(0.04);
  });

  it('keeps tied p-values together', () => {
    // Selecting by rank would take two of the three 0.01s and drop the third for
    // no reason a user could ever be told.
    const { discoveries } = benjaminiHochberg([0.01, 0.9, 0.01, 0.01], 0.05);
    expect(discoveries).toEqual([0, 2, 3]);
  });

  it('handles the degenerate inputs', () => {
    expect(benjaminiHochberg([], 0.05)).toEqual({ discoveries: [], criticalP: 0 });
    expect(benjaminiHochberg([])).toEqual({ discoveries: [], criticalP: 0 });

    // q = 0 asks for zero tolerance of false discoveries, which is only
    // satisfiable by discovering nothing at all — including when p is exactly 0,
    // where a literal `p <= 0` comparison would otherwise let it through.
    expect(benjaminiHochberg([0, 1e-300, 0.001], 0).discoveries).toEqual([]);
    expect(benjaminiHochberg([0.001], Number.NaN).discoveries).toEqual([]);
    expect(benjaminiHochberg([0.001], -1).discoveries).toEqual([]);

    // q = 1 tolerates everything, so everything is a discovery.
    const all = benjaminiHochberg([0.1, 0.4, 0.99, 0.6], 1);
    expect(all.discoveries).toEqual([0, 1, 2, 3]);
    expect(all.criticalP).toBe(0.99);
    // q above 1 is nonsense but must not misbehave: it is clamped to 1.
    expect(benjaminiHochberg([0.1, 0.4, 0.99, 0.6], 5).discoveries).toEqual([0, 1, 2, 3]);

    // All strongly significant: everything found, whatever the multiplicity.
    const tiny = Array.from({ length: 50 }, () => 1e-12);
    expect(benjaminiHochberg(tiny, 0.05).discoveries).toHaveLength(50);
    expect(benjaminiHochberg(tiny, 0.05).criticalP).toBe(1e-12);
  });

  it('discovers nothing when every hypothesis is null', () => {
    // 500 uniform p-values — a ledger where nothing is wrong. An uncorrected 5%
    // screen would flag roughly 25 of them; BH is expected to flag none, and
    // under the global null does so with probability >= 1 - q.
    const rand = mulberry32(0xA11);
    const nulls = Array.from({ length: 500 }, () => rand());
    expect(benjaminiHochberg(nulls, 0.05).discoveries).toEqual([]);
    expect(nulls.filter(p => p <= 0.05).length).toBeGreaterThan(10);
  });

  it('treats NaN and out-of-range p-values as no evidence', () => {
    const { discoveries } = benjaminiHochberg([Number.NaN, 1e-9, Infinity, -0.5, 7], 0.05);
    // 1e-9 is a discovery; so is -0.5, which clamps to 0. The garbage that means
    // "unknown" (NaN, Infinity) clamps to 1 and is never significant.
    expect(discoveries).toEqual([1, 3]);
  });

  it('finds more as q rises, never fewer', () => {
    fc.assert(fc.property(
      fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 80 }),
      fc.double({ min: 0.001, max: 0.5, noNaN: true }),
      fc.double({ min: 0.001, max: 0.5, noNaN: true }),
      (ps, qa, qb) => {
        const [low, high] = qa <= qb ? [qa, qb] : [qb, qa];
        const lenient = new Set(benjaminiHochberg(ps, high).discoveries);
        benjaminiHochberg(ps, low).discoveries.forEach(i => {
          if (!lenient.has(i)) throw new Error(`index ${i} found at q=${low} but lost at q=${high}`);
        });
      },
    ), RUNS);
  });

  it('is never less powerful than Bonferroni on the same data', () => {
    // Both control a form of error; BH controls the weaker one, and gets extra
    // power for it. Anything Bonferroni finds, BH must also find — otherwise
    // there is no reason to prefer it.
    fc.assert(fc.property(
      fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 120 }),
      fc.double({ min: 0.001, max: 0.2, noNaN: true }),
      (ps, q) => {
        const found = new Set(benjaminiHochberg(ps, q).discoveries);
        ps.forEach((p, i) => {
          if (p <= q / ps.length && !found.has(i)) {
            throw new Error(`Bonferroni found index ${i} (p=${p}) and BH did not`);
          }
        });
      },
    ), RUNS);
  });

  // --- The claim the module is actually making ---------------------------
  //
  // Everything above checks mechanics. This checks the guarantee: over many
  // simulated ledgers, of everything BH flags, no more than q is expected to be
  // wrong. Each simulated ledger has a known truth — the first `effects`
  // hypotheses are real (their z is drawn shifted away from zero), the rest are
  // pure noise (z ~ N(0,1), so their two-sided p is exactly uniform).
  function simulate({ trials, m, effects, shift, q, seed }: {
    trials: number; m: number; effects: number; shift: number; q: number; seed: number;
  }) {
    const rand = mulberry32(seed);
    let fdpTotal = 0;         // sum of false-discovery proportions, one per trial
    let naiveFdpTotal = 0;    // the same, for an uncorrected per-test screen
    let foundTotal = 0;       // true effects recovered, for power
    let trialsWithAnyFalse = 0;

    for (let t = 0; t < trials; t++) {
      const ps: number[] = [];
      for (let i = 0; i < m; i++) {
        const z = standardNormal(rand) + (i < effects ? shift : 0);
        ps.push(normalTwoSidedP(z));
      }
      const { discoveries } = benjaminiHochberg(ps, q);
      const falsePositives = discoveries.filter(i => i >= effects).length;
      // The convention in the FDR literature: a trial that discovers nothing has
      // a false-discovery proportion of 0, not 0/0.
      fdpTotal += discoveries.length ? falsePositives / discoveries.length : 0;
      foundTotal += discoveries.length - falsePositives;
      if (falsePositives > 0) trialsWithAnyFalse++;

      const naive: number[] = [];
      ps.forEach((p, i) => { if (p <= q) naive.push(i); });
      const naiveFalse = naive.filter(i => i >= effects).length;
      naiveFdpTotal += naive.length ? naiveFalse / naive.length : 0;
    }

    return {
      fdr: fdpTotal / trials,
      naiveFdr: naiveFdpTotal / trials,
      power: effects ? foundTotal / (trials * effects) : 0,
      anyFalseRate: trialsWithAnyFalse / trials,
    };
  }

  it('controls the false discovery rate at q, where an uncorrected screen does not', () => {
    const q = 0.05;
    const m = 200;
    const effects = 20;
    const { fdr, naiveFdr, power } = simulate({ trials: 2000, m, effects, shift: 4, q, seed: 0xBEEF });

    // The theoretical ceiling is q * m0/m = 0.05 * 180/200 = 0.045; BH is
    // conservative, never anti-conservative, so the measured value should sit at
    // or below it. The margin covers Monte Carlo error over 2000 trials (the
    // standard error of this mean is ~0.002), not a fudge factor.
    expect(fdr).toBeLessThanOrEqual(q + 0.01);
    // And it is not vacuously small: the procedure is genuinely spending its
    // error budget rather than refusing to discover anything.
    expect(fdr).toBeGreaterThan(0.01);
    // The same data screened at a raw 5% per test: ~9 of the 180 nulls flagged
    // every time, so about a third of the flags are wrong. That is the number
    // this module exists to remove.
    expect(naiveFdr).toBeGreaterThan(0.25);
    expect(naiveFdr).toBeGreaterThan(fdr * 4);
    // Control would be worthless if it also found nothing: a 4-sigma effect is
    // recovered most of the time.
    expect(power).toBeGreaterThan(0.7);
  });

  it('under the global null, almost never discovers anything at all', () => {
    // With no true effects, any discovery is false, so FDR control collapses to
    // familywise control: the chance of even one flag is at most q.
    const { fdr, anyFalseRate, power } = simulate({
      trials: 1000, m: 200, effects: 0, shift: 0, q: 0.05, seed: 0xFEED,
    });
    expect(power).toBe(0);
    // Binomial standard error at p=0.05 over 1000 trials is 0.0069, so 0.08 is
    // ~4 SE above the ceiling: loose enough not to flake, tight enough that a
    // broken correction (which would sit near 1.0) cannot pass.
    expect(anyFalseRate).toBeLessThanOrEqual(0.08);
    expect(fdr).toBeLessThanOrEqual(0.08);
  });

  it('holds its FDR at a stricter q, and finds less as a result', () => {
    const strict = simulate({ trials: 1000, m: 300, effects: 30, shift: 3.5, q: 0.01, seed: 0x1234 });
    const loose = simulate({ trials: 1000, m: 300, effects: 30, shift: 3.5, q: 0.1, seed: 0x1234 });
    expect(strict.fdr).toBeLessThanOrEqual(0.01 + 0.005);
    expect(loose.fdr).toBeLessThanOrEqual(0.1 + 0.02);
    // The trade being made: a tighter error budget buys fewer discoveries.
    expect(strict.power).toBeLessThan(loose.power);
    expect(strict.fdr).toBeLessThan(loose.fdr);
  });
});

describe('unchecked callers', () => {
  it('treats a missing array as an empty one rather than throwing', () => {
    // The types say number[], but half this codebase is still .jsx and passes
    // whatever it has. A missing sample is "no data", which every function here
    // already answers with 0 — so these guards exist, and they are tested.
    const missing = undefined as unknown as number[];
    expect(median(missing)).toBe(0);
    expect(mad(missing)).toBe(0);
    expect(robustZ(100, missing)).toBe(0);
    expect(benjaminiHochberg(missing, 0.05)).toEqual({ discoveries: [], criticalP: 0 });
  });
});
