// Client for the payoff worker.
//
// Same shape as runSimulation: hides that there is a worker, and that there
// might not be one. Workers are unavailable in jsdom under test and anywhere
// module workers are blocked, so the same call falls back to running
// in-process — slower, identical answer, no branch for the caller.

import { optimizePayoff } from './optimizePayoff';
import type { Debt, Money } from '../types/domain';
import type { OptimizeCall, PayoffWorkerResponse, RunningOptimize } from '../types/worker';

let worker: Worker | null = null;
let nextRequestId = 1;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    // Vite reads this literal at build time, so it has to name the real file.
    // Get it wrong and the catch below swallows the failure, the search
    // silently falls back to blocking the main thread, and every test still
    // passes — which is why CI asserts both worker chunks exist in the bundle.
    worker = new Worker(new URL('../workers/payoff.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null; // blocked or unsupported; the caller gets the fallback
  }
  return worker;
}

/**
 * Search for the cheapest payoff order.
 *
 * Cancelling resolves with `{ cancelled: true }` rather than rejecting, because
 * moving the slider again is a normal thing to do, not an error.
 */
export function runOptimize(
  debts: Debt[],
  { extra = 0, today = new Date(), limit }: { extra?: Money; today?: Date; limit?: number } = {},
): RunningOptimize {
  const active = getWorker();
  const requestId = nextRequestId++;
  let cancelled = false;

  if (!active) {
    const promise = Promise.resolve().then((): OptimizeCall => (
      cancelled ? { cancelled: true } : optimizePayoff(debts, { extra, today, limit })
    ));
    return { promise, cancel: () => { cancelled = true; } };
  }

  const promise = new Promise<OptimizeCall>((resolve, reject) => {
    const handleMessage = (event: MessageEvent<PayoffWorkerResponse>): void => {
      const data = event.data;
      if (!data || data.requestId !== requestId) return; // a superseded run
      active.removeEventListener('message', handleMessage);
      if (cancelled) resolve({ cancelled: true });
      else if (data.type === 'result') resolve(data.result);
      else reject(new Error(data.message));
    };

    active.addEventListener('message', handleMessage);
    active.postMessage({
      type: 'optimize',
      requestId,
      debts,
      // Dates don't survive the clone as Dates.
      options: { extra, today: today.toISOString(), limit },
    });
  });

  // The search cannot be interrupted mid-sweep, so cancelling means "ignore the
  // answer" rather than "stop working". The worker is on another thread, so the
  // cost of letting it finish is not paid by the UI.
  return { promise, cancel: () => { cancelled = true; } };
}
