// The payoff search, off the main thread.
//
// The module used to claim 8! orderings run "well under a second". Measured:
// 1.4s on a structured 8-debt set and up to 3.9s on harder randomised ones,
// against 48-76ms at 6 debts and 0.4-0.8s at 7. It ran inside a bare useMemo
// during render, so every $10 step of the extra-payment slider froze the
// window for over a second, and a drag queued dozens of them.
//
// Trading the search away was measured first, because it would have been free:
// over 25 randomised 8-debt sets the greedy fallback runs in ~3ms but found the
// cheapest order only 5 times, and when it missed it cost on average 2.6% and
// at worst 22% more interest. So the exhaustive search earns its cost and moves
// here instead of being given up.
//
// Unlike the Monte Carlo worker there is no chunked API to yield between, so
// this one reports no progress and cannot be interrupted. It does not need to
// be: the caller debounces the slider, and a reply for a superseded request is
// discarded by id.

import { optimizePayoff } from '../utils/optimizePayoff';
import type { PayoffWorkerRequest, PayoffWorkerResponse } from '../types/worker';

// `self` in a module worker. Declaring the two members used keeps the message
// protocol typed without pulling in a lib that fights the DOM one.
declare const self: {
  onmessage: ((event: MessageEvent<PayoffWorkerRequest>) => void) | null;
  postMessage: (message: PayoffWorkerResponse) => void;
};

self.onmessage = (event) => {
  const request = event.data;
  if (request?.type !== 'optimize') return;
  const { requestId, debts, options } = request;
  try {
    const result = optimizePayoff(debts, {
      extra: options.extra,
      // Sent as an ISO string; rebuilt here so the search sees a real Date.
      today: options.today ? new Date(options.today) : new Date(),
      limit: options.limit,
    });
    self.postMessage({ type: 'result', requestId, result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'error', requestId, message });
  }
};
