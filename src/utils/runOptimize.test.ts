// The payoff search runs in a worker so a slider drag doesn't freeze the
// window, and it has to give the same answer when there isn't one — jsdom has
// no module workers, and a packaged app could have them blocked. These cover
// the seam: the fallback's answer, cancellation, and the nothing-to-do case.

import { describe, it, expect } from 'vitest';
import { optimizePayoff } from './optimizePayoff';
import { runOptimize } from './runOptimize';
import { makeDebt } from '../test/factories';
import type { OptimizeCall, PayoffOptimization } from '../types/worker';

const TODAY = new Date(2026, 8, 22);

// A promotional 0% that reverts is the case the search exists for: avalanche
// sorts on today's rate and puts it last, walking into the reversion.
const debts = [
  makeDebt({ id: 'promo', name: 'Store card', balance: 6000, interestRate: 0, minimumPayment: 120, promoUntil: '2027-03-01', postPromoRate: 26.99 }),
  makeDebt({ id: 'visa', name: 'Visa', balance: 4000, interestRate: 19.99, minimumPayment: 90 }),
  makeDebt({ id: 'loan', name: 'Car loan', balance: 9000, interestRate: 6.5, minimumPayment: 210 }),
];

function settled(result: OptimizeCall): PayoffOptimization {
  if (result && 'cancelled' in result) throw new Error('search was cancelled');
  return result;
}

describe('runOptimize', () => {
  it('gives the same answer as calling the optimiser directly', async () => {
    const direct = optimizePayoff(debts, { extra: 300, today: TODAY });
    const viaSeam = settled(await runOptimize(debts, { extra: 300, today: TODAY }).promise);

    expect(direct).not.toBeNull();
    expect(viaSeam).not.toBeNull();
    if (!direct || !viaSeam) throw new Error('unreachable');
    expect(viaSeam.feasible).toBe(direct.feasible);
    expect(viaSeam.searched).toBe(direct.searched);
    expect(viaSeam.exhaustive).toBe(direct.exhaustive);
    expect(viaSeam.order).toEqual(direct.order);
    expect(viaSeam.totalInterest).toBe(direct.totalInterest);
  });

  it('checks every order at this size, so "cheapest" is a claim not a hope', async () => {
    const result = settled(await runOptimize(debts, { extra: 300, today: TODAY }).promise);
    if (!result) throw new Error('unreachable');
    expect(result.exhaustive).toBe(true);
    expect(result.searched).toBe(6); // 3! orderings
  });

  it('resolves as cancelled rather than rejecting, because the slider moving is normal', async () => {
    const run = runOptimize(debts, { extra: 300, today: TODAY });
    run.cancel();
    await expect(run.promise).resolves.toEqual({ cancelled: true });
  });

  it('returns null when there is nothing to order', async () => {
    const one = settled(await runOptimize([debts[0]], { extra: 100, today: TODAY }).promise);
    expect(one).toBeNull();
    const none = settled(await runOptimize([], { extra: 100, today: TODAY }).promise);
    expect(none).toBeNull();
  });
});
