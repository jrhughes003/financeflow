// Client for the Monte Carlo worker.
//
// Hides two things from the UI: that there's a worker at all, and that there
// might not be one. Workers are unavailable in a few places this code runs —
// jsdom under test, and any environment where module workers are blocked — so
// the same call falls back to running in-process rather than failing. The
// fallback still reports progress, so the caller's code path is identical.

import { runMonteCarlo } from './montecarlo';

let worker = null;
let nextRequestId = 1;

function getWorker() {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('../../workers/montecarlo.worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null; // blocked or unsupported; the caller gets the fallback
  }
  return worker;
}

/**
 * Run the simulation.
 *
 * @param onProgress  ({ completed, total }) => void
 * @returns { promise, cancel } — cancel resolves the promise with
 *          { cancelled: true } rather than rejecting, because abandoning a
 *          simulation is a normal thing for a user to do, not an error.
 */
export function runSimulation(plan, snapshot, options = {}, onProgress = () => {}) {
  const active = getWorker();
  const requestId = nextRequestId++;

  if (!active) {
    // No worker: run it here. The UI still blocks, but the result is the same
    // and nothing has to know the difference.
    let cancelled = false;
    const promise = Promise.resolve().then(() => {
      if (cancelled) return { cancelled: true };
      const result = runMonteCarlo(plan, snapshot, options);
      onProgress({ completed: result.trials ?? 0, total: result.trials ?? 0 });
      return result;
    });
    return { promise, cancel: () => { cancelled = true; } };
  }

  const promise = new Promise((resolve, reject) => {
    const handleMessage = (event) => {
      const data = event.data || {};
      if (data.requestId !== requestId) return; // a stale run's messages

      if (data.type === 'progress') {
        onProgress({ completed: data.completed, total: data.total });
      } else if (data.type === 'result') {
        active.removeEventListener('message', handleMessage);
        resolve(data.result);
      } else if (data.type === 'cancelled') {
        active.removeEventListener('message', handleMessage);
        resolve({ cancelled: true });
      } else if (data.type === 'error') {
        active.removeEventListener('message', handleMessage);
        reject(new Error(data.message));
      }
    };

    active.addEventListener('message', handleMessage);
    active.postMessage({
      type: 'run',
      requestId,
      plan,
      snapshot,
      // Dates don't survive the clone as Dates.
      options: { ...options, today: (options.today || new Date()).toISOString() },
    });
  });

  return { promise, cancel: () => active.postMessage({ type: 'cancel', requestId }) };
}
