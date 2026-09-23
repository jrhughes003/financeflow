// The Monte Carlo, off the main thread.
//
// Measured on the demo plan: 300 trials takes 680ms and 1000 takes 1.8s, all of
// it blocking — the window freezes, and on a slower machine it looks like the
// app has hung. The precision argument makes that worse rather than better,
// because the interval at 300 trials is roughly ±5 points, so the honest answer
// is to run *more* trials, not fewer.
//
// So the work moves here, and it advances in chunks: between chunks the worker
// yields, which is the only moment a message can arrive. That is what makes
// progress reporting and cancellation possible at all — a synchronous loop
// cannot be interrupted from outside, however the caller asks.

import { createRun } from '../utils/lifeplan/montecarlo';
import type { RunRequest, WorkerRequest, WorkerResponse } from '../types/worker';

// `self` in a module worker. Declaring the two members used keeps the message
// protocol typed without pulling in a lib that fights the DOM one.
declare const self: {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

// Small enough that a cancel feels immediate, large enough that the yields
// don't dominate the run.
const CHUNK_PAIRS = 12;

let cancelled = false;

const yieldToMessages = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });

async function simulate({ plan, snapshot, options, requestId }: RunRequest): Promise<void> {
  cancelled = false;

  // Dates don't survive structured cloning as Dates when they come from a
  // serialised plan, so the caller sends an ISO string.
  const today = options?.today ? new Date(options.today) : new Date();
  const run = createRun(plan, snapshot, { ...options, today });

  let progress = run.step(CHUNK_PAIRS);
  while (!progress.done) {
    if (cancelled) {
      self.postMessage({ type: 'cancelled', requestId });
      return;
    }
    self.postMessage({
      type: 'progress', requestId, completed: progress.completed, total: progress.total,
    });
    await yieldToMessages();
    progress = run.step(CHUNK_PAIRS);
  }

  self.postMessage({ type: 'result', requestId, result: run.finish() });
}

self.onmessage = (event) => {
  const request = event.data;
  if (request?.type === 'run') {
    simulate(request).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({ type: 'error', requestId: request.requestId, message });
    });
  } else if (request?.type === 'cancel') {
    cancelled = true;
  }
};
