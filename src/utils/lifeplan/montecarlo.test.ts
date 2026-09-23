import { describe, it, expect } from 'vitest';
import { runMonteCarlo, mulberry32, normal, percentile } from './montecarlo';
import { createDefaultPlan, normalizePlan } from './snapshot';
import type {
  LifePlan, PersonId, PlanAssumptions, PlanLiving, PlanPerson,
} from '../../types/lifeplan';
import type {
  NetWorthBand, PlanSnapshot, SimulationOutcome, SimulationResult, SnapshotAccount,
} from '../../types/projection';

const TODAY = new Date(2026, 8, 22);

/**
 * Overrides as the fixtures write them: normalizePlan merges each person, the
 * living block and the assumptions over the plan defaults, so a fixture names
 * only the fields it exercises.
 */
type PlanOverrides = Omit<Partial<LifePlan>, 'people' | 'living' | 'assumptions'> & {
  people?: (Partial<PlanPerson> & { id: PersonId })[];
  living?: Partial<PlanLiving>;
  assumptions?: Partial<PlanAssumptions>;
};

const plan = (over: PlanOverrides = {}): LifePlan => {
  const d = createDefaultPlan();
  const base = { id: 'me' as PersonId, birthYear: 2000, retireAge: 65, cppAt65: 0 };
  return normalizePlan({
    ...d,
    ...over,
    people: (over.people ?? [base]).map(o => ({ ...d.people.find(dp => dp.id === o.id)!, ...o })),
    living: {
      ...d.living,
      ...(over.living ?? { spendingMode: 'custom', spendingMonthly: 1000, rentMonthly: 0, emergencyMonths: 0, retirementSpendingPct: 100 }),
    },
    assumptions: {
      ...d.assumptions,
      ...(over.assumptions ?? { inflationPct: 0, returnPct: 6, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 40 }),
    },
  });
};

const account = (over: Partial<SnapshotAccount> = {}): SnapshotAccount => ({
  id: 'a',
  name: 'Account',
  bucket: 'nonreg',
  owner: 'me',
  value: 0,
  acb: over.value ?? 0, // the engine falls back to the value when none is given
  ...over,
});

const snap = (over: Partial<PlanSnapshot> = {}): PlanSnapshot =>
  ({ cash: 0, goalsCash: 0, accounts: [], debts: [], historyMonthly: 0, historyMonths: 0, ...over });

// Apart from the needsSetup test below, every plan here can run, so a
// needsSetup result means the fixture broke rather than that the test passes.
const ran = (res: SimulationOutcome): SimulationResult => {
  if ('needsSetup' in res) throw new Error('simulation needs setup');
  return res;
};

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

  // `trials` was reported as pairs * 2, but an odd count runs a single path in
  // the last pair. The extra phantom path counted as a failure, pulling the
  // success rate and its interval down.
  it('reports the number of paths it actually ran, odd counts included', () => {
    const funded = snap({ cash: 5000000 });
    for (const trials of [1, 5, 7]) {
      const r = ran(runMonteCarlo(plan(), funded, { today: TODAY, trials }));
      expect(r.trials).toBe(trials);
      expect(r.successRate).toBe(1);
      expect(r.successInterval.low).toBeGreaterThan(0);
    }
  });

  it('always succeeds when the plan is funded regardless of markets', () => {
    const r = ran(runMonteCarlo(plan(), snap({ cash: 5000000 }), { today: TODAY, trials: 40 }));
    expect(r.successRate).toBe(1);
    expect(r.failures).toBe(0);
    expect(r.depletionYears).toBeNull();
    expect(r.bands[0].year).toBe(2026);
    expect(r.bands[r.bands.length - 1].age).toBe(40);
  });

  it('always fails when there is no money', () => {
    const r = ran(runMonteCarlo(plan(), snap({ cash: 1000 }), { today: TODAY, trials: 20 }));
    expect(r.successRate).toBe(0);
    expect(r.depletionYears!.p50).toBeGreaterThanOrEqual(2026);
  });

  it('spreads outcomes with volatility and is repeatable', () => {
    const args = { today: TODAY, trials: 60, seed: 42 };
    const steady = ran(runMonteCarlo(plan(), snap({ cash: 300000 }), { ...args, volatilityPct: 0 }));
    const wild = ran(runMonteCarlo(plan(), snap({ cash: 300000 }), { ...args, volatilityPct: 20 }));
    const spread = (b: NetWorthBand[]): number => b[b.length - 1].p90 - b[b.length - 1].p10;
    expect(spread(steady.bands)).toBeCloseTo(0, 0);       // no volatility → one outcome
    expect(spread(wild.bands)).toBeGreaterThan(100000);    // volatility → a wide range
    expect(wild.bands.every(b => b.p10 <= b.p50 && b.p50 <= b.p90)).toBe(true);
    // Same seed, same answer.
    expect(ran(runMonteCarlo(plan(), snap({ cash: 300000 }), { ...args, volatilityPct: 20 })).successRate).toBe(wild.successRate);
  });

  it('a borderline plan succeeds less often as volatility rises', () => {
    const p = plan({ assumptions: { inflationPct: 0, returnPct: 6, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 60 } });
    const s = snap({ cash: 0, accounts: [account({ id: 'a', bucket: 'nonreg', owner: 'me', value: 260000, acb: 260000 })] });
    const calm = ran(runMonteCarlo(p, s, { today: TODAY, trials: 80, volatilityPct: 2, seed: 7 }));
    const rough = ran(runMonteCarlo(p, s, { today: TODAY, trials: 80, volatilityPct: 25, seed: 7 }));
    expect(rough.successRate).toBeLessThan(calm.successRate);
  });

  // --- what the upgraded model is supposed to buy you --------------------

  it('reports the sampling error, not just a bare percentage', () => {
    const r = ran(runMonteCarlo(plan(), snap({ cash: 300000 }), { today: TODAY, trials: 60, volatilityPct: 18, seed: 5 }));
    expect(r.successInterval.low).toBeLessThanOrEqual(r.successRate);
    expect(r.successInterval.high).toBeGreaterThanOrEqual(r.successRate);
    expect(r.successInterval.low).toBeGreaterThanOrEqual(0);
    expect(r.successInterval.high).toBeLessThanOrEqual(1);
    expect(r.standardError).toBeGreaterThanOrEqual(0);
  });

  it('narrows the interval as runs increase', () => {
    const args = { today: TODAY, volatilityPct: 18, seed: 9 };
    const few = ran(runMonteCarlo(plan(), snap({ cash: 260000 }), { ...args, trials: 40 }));
    const many = ran(runMonteCarlo(plan(), snap({ cash: 260000 }), { ...args, trials: 400 }));
    const width = (r: SimulationResult): number => r.successInterval.high - r.successInterval.low;
    expect(width(many)).toBeLessThan(width(few));
  });

  it('runs antithetic pairs, so every path has a mirror', () => {
    const r = ran(runMonteCarlo(plan(), snap({ cash: 300000 }), { today: TODAY, trials: 50, seed: 3 }));
    expect(r.trials % 2).toBe(0); // pairs, not odd counts
    const independent = ran(runMonteCarlo(plan(), snap({ cash: 300000 }), { today: TODAY, trials: 50, seed: 3, antithetic: false }));
    expect(independent.trials).toBe(50);
  });

  it('defaults to the fat-tailed model and can be pointed at another', () => {
    const fat = ran(runMonteCarlo(plan(), snap({ cash: 300000 }), { today: TODAY, trials: 40, seed: 2 }));
    expect(fat.model).toBe('studentT');
    const thin = ran(runMonteCarlo(plan(), snap({ cash: 300000 }), { today: TODAY, trials: 40, seed: 2, model: 'normal' }));
    expect(thin.model).toBe('normal');
  });

  it('can resample a supplied history instead of assuming a distribution', () => {
    const series = [0.21, -0.37, 0.26, 0.15, -0.04, 0.32, 0.13, -0.22, 0.18, 0.06];
    const r = ran(runMonteCarlo(plan(), snap({ cash: 300000 }), {
      today: TODAY, trials: 40, seed: 4, model: 'bootstrap', series, blockYears: 3,
    }));
    expect(r.model).toBe('bootstrap');
    expect(r.bands.length).toBeGreaterThan(0);
  });
});
