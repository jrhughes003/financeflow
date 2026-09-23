// The simulation runs in a worker so the window stays usable, and it has to
// behave the same when there isn't one — jsdom has no module workers, and a
// packaged app could have them blocked. These cover the seam: stepping,
// progress, cancellation, and the in-process fallback.

import { describe, it, expect, vi } from 'vitest';
import { createRun, runMonteCarlo } from './montecarlo';
import { runSimulation } from './runSimulation';
import { buildSnapshot, normalizePlan } from './snapshot';
import generateDemoData from '../demoData';

const TODAY = new Date(2026, 8, 22);
const demo = generateDemoData(TODAY);
const plan = normalizePlan(demo.settings.lifePlan);
const snapshot = buildSnapshot(demo, plan, { today: TODAY });
const options = { today: TODAY, trials: 40, volatilityPct: 12, seed: 5 };

describe('a run that can be advanced in pieces', () => {
  it('reports progress and finishes exactly once', () => {
    const run = createRun(plan, snapshot, options);
    let progress = run.step(3);
    expect(progress.done).toBe(false);
    expect(progress.completed).toBeGreaterThan(0);
    expect(progress.total).toBe(40);

    let guard = 0;
    while (!progress.done && guard++ < 100) progress = run.step(3);
    expect(progress.done).toBe(true);
    expect(progress.completed).toBe(40);
  });

  it('gives the same answer whether stepped finely or all at once', () => {
    const stepped = createRun(plan, snapshot, options);
    while (!stepped.step(1).done) { /* one pair at a time */ }

    const atOnce = runMonteCarlo(plan, snapshot, options);
    const fine = stepped.finish();

    // Chunking must not disturb the random stream, or results would depend on
    // how the UI happened to slice the work.
    expect(fine.successRate).toBe(atOnce.successRate);
    expect(fine.trials).toBe(atOnce.trials);
    expect(fine.bands.at(-1).p50).toBeCloseTo(atOnce.bands.at(-1).p50, 6);
  });

  it('can be abandoned part-way and still summarise what it ran', () => {
    const run = createRun(plan, snapshot, { ...options, trials: 400 });
    run.step(4);
    const partial = run.finish();
    expect(partial.completed).toBeLessThan(400);
    expect(partial.successRate).toBeGreaterThanOrEqual(0);
    expect(partial.successRate).toBeLessThanOrEqual(1);
  });
});

describe('runSimulation without a worker', () => {
  it('falls back in-process and still reports progress', async () => {
    expect(typeof Worker).toBe('undefined'); // jsdom: the fallback path
    const onProgress = vi.fn();
    const { promise } = runSimulation(plan, snapshot, options, onProgress);
    const result = await promise;

    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.trials).toBe(40);
    expect(onProgress).toHaveBeenCalled();
  });

  it('resolves as cancelled rather than rejecting', async () => {
    // Abandoning a simulation is a normal thing to do, not an error, so callers
    // shouldn't need a try/catch to handle it.
    const { promise, cancel } = runSimulation(plan, snapshot, options, () => {});
    cancel();
    await expect(promise).resolves.toEqual({ cancelled: true });
  });

  it('matches the direct call', async () => {
    const { promise } = runSimulation(plan, snapshot, options, () => {});
    const viaClient = await promise;
    const direct = runMonteCarlo(plan, snapshot, options);
    expect(viaClient.successRate).toBe(direct.successRate);
  });
});
