// The worker message protocols.
//
// Worth typing rather than leaving as loose objects: the two sides of a worker
// boundary are separate modules that never call each other, so a renamed field
// is invisible until it isn't. `requestId` in particular exists to let a stale
// run's messages be ignored, and a mismatch there shows up as a simulation that
// simply never resolves.

import type { SimulationOptions } from '../utils/lifeplan/montecarlo';
import type { optimizePayoff } from '../utils/optimizePayoff';
import type { Debt, Money } from './domain';
import type { LifePlan } from './lifeplan';
import type { PlanSnapshot, SimulationOutcome } from './projection';

// --- The Monte Carlo worker -------------------------------------------------

/** Options as they cross the boundary: a Date does not survive the clone. */
export type ClonableOptions = Omit<SimulationOptions, 'today'> & { today?: string };

export interface RunRequest {
  type: 'run';
  requestId: number;
  plan: LifePlan;
  snapshot: PlanSnapshot;
  options: ClonableOptions;
}

export interface CancelRequest {
  type: 'cancel';
  requestId: number;
}

export type WorkerRequest = RunRequest | CancelRequest;

export interface ProgressMessage {
  type: 'progress';
  requestId: number;
  completed: number;
  total: number;
}

export interface ResultMessage {
  type: 'result';
  requestId: number;
  result: SimulationOutcome;
}

export interface CancelledMessage {
  type: 'cancelled';
  requestId: number;
}

export interface ErrorMessage {
  type: 'error';
  requestId: number;
  message: string;
}

export type WorkerResponse =
  | ProgressMessage
  | ResultMessage
  | CancelledMessage
  | ErrorMessage;

export interface Progress {
  completed: number;
  total: number;
}

/** Cancelling is a normal thing to do, so it resolves rather than rejecting. */
export interface Cancelled {
  cancelled: true;
}

export type SimulationCall = SimulationOutcome | Cancelled;

export interface RunningSimulation {
  promise: Promise<SimulationCall>;
  cancel: () => void;
}

// --- The payoff optimiser's worker ------------------------------------------
//
// Deliberately simpler than the Monte Carlo's. That search has a chunked API to
// yield between, which is what makes its progress reporting and cancellation
// possible; this one is a single synchronous sweep with nothing to interrupt.
// A superseded run is handled by ignoring a reply whose requestId has moved on,
// not by asking the worker to stop.

/** Derived, so the reply type cannot drift from what the function returns. */
export type PayoffOptimization = ReturnType<typeof optimizePayoff>;

export interface OptimizeRequest {
  type: 'optimize';
  requestId: number;
  debts: Debt[];
  /** `today` crosses as an ISO string: a Date does not survive the clone. */
  options: { extra?: Money; today?: string; limit?: number };
}

export type PayoffWorkerRequest = OptimizeRequest;

export interface PayoffResultMessage {
  type: 'result';
  requestId: number;
  result: PayoffOptimization;
}

export interface PayoffErrorMessage {
  type: 'error';
  requestId: number;
  message: string;
}

export type PayoffWorkerResponse = PayoffResultMessage | PayoffErrorMessage;

/** Cancelling is normal — the slider moved — so it resolves rather than rejects. */
export type OptimizeCall = PayoffOptimization | Cancelled;

export interface RunningOptimize {
  promise: Promise<OptimizeCall>;
  cancel: () => void;
}
