import { describe, it, expect } from 'vitest';
import { runMonteCarlo, mulberry32, normal, percentile } from './montecarlo';
import { createDefaultPlan, normalizePlan } from './snapshot';

const TODAY = new Date(2026, 8, 22);
const plan = (over = {}) => normalizePlan({
  ...createDefaultPlan(),
  people: [{ id: 'me', birthYear: 2000, retireAge: 65, cppAt65: 0 }],
  living: { spendingMode: 'custom', spendingMonthly: 1000, rentMonthly: 0, emergencyMonths: 0, retirementSpendingPct: 100 },
  assumptions: { inflationPct: 0, returnPct: 6, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 40 },
  ...over,
});
const snap = (over = {}) => ({ cash: 0, accounts: [], debts: [], historyMonthly: 0, ...over });

describe('random helpers', () => {
  it('is repeatable for a seed and roughly standard normal', () => {
    expect(mulberry32(7)()).toBe(mulberry32(7)());
    const rand = mulberry32(1);
    const xs = Array.from({ length: 4000 }, () => normal(rand));
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.08);
    expect(sd).toBeGreaterThan(0.9);
    expect(sd).toBeLessThan(1.1);
  });

  it('interpolates percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([10, 20], 0.9)).toBeCloseTo(19);
  });
});

describe('runMonteCarlo', () => {
  it('needs setup like the engine does', () => {
    expect(runMonteCarlo(createDefaultPlan(), snap(), { today: TODAY, trials: 2 })).toEqual({ needsSetup: true });
  });

  it('always succeeds when the plan is funded regardless of markets', () => {
    const r = runMonteCarlo(plan(), snap({ cash: 5000000 }), { today: TODAY, trials: 40 });
    expect(r.successRate).toBe(1);
    expect(r.failures).toBe(0);
    expect(r.depletionYears).toBeNull();
    expect(r.bands[0].year).toBe(2026);
    expect(r.bands[r.bands.length - 1].age).toBe(40);
  });

  it('always fails when there is no money', () => {
    const r = runMonteCarlo(plan(), snap({ cash: 1000 }), { today: TODAY, trials: 20 });
    expect(r.successRate).toBe(0);
    expect(r.depletionYears.p50).toBeGreaterThanOrEqual(2026);
  });

  it('spreads outcomes with volatility and is repeatable', () => {
    const args = { today: TODAY, trials: 60, seed: 42 };
    const steady = runMonteCarlo(plan(), snap({ cash: 300000 }), { ...args, volatilityPct: 0 });
    const wild = runMonteCarlo(plan(), snap({ cash: 300000 }), { ...args, volatilityPct: 20 });
    const spread = b => b[b.length - 1].p90 - b[b.length - 1].p10;
    expect(spread(steady.bands)).toBeCloseTo(0, 0);       // no volatility → one outcome
    expect(spread(wild.bands)).toBeGreaterThan(100000);    // volatility → a wide range
    expect(wild.bands.every(b => b.p10 <= b.p50 && b.p50 <= b.p90)).toBe(true);
    // Same seed, same answer.
    expect(runMonteCarlo(plan(), snap({ cash: 300000 }), { ...args, volatilityPct: 20 }).successRate).toBe(wild.successRate);
  });

  it('a borderline plan succeeds less often as volatility rises', () => {
    const p = plan({ assumptions: { inflationPct: 0, returnPct: 6, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 60 } });
    const s = snap({ cash: 0, accounts: [{ id: 'a', bucket: 'nonreg', owner: 'me', value: 260000, acb: 260000 }] });
    const calm = runMonteCarlo(p, s, { today: TODAY, trials: 80, volatilityPct: 2, seed: 7 });
    const rough = runMonteCarlo(p, s, { today: TODAY, trials: 80, volatilityPct: 25, seed: 7 });
    expect(rough.successRate).toBeLessThan(calm.successRate);
  });
});
