// Trips: tagged spending measured against a trip budget instead of a monthly
// one.
//
// A trip is a tag plus a budget. The budget is either set directly or taken
// from a Plan Ahead one-off, so a trip already costed in the long-range plan
// does not have to be costed twice — and when the plan's estimate changes,
// the trip's budget moves with it.

import type { Money, Transaction, Trip } from '../types/domain';
import type { LifePlan } from '../types/lifeplan';
import { effectiveAmount } from './reimbursements';

export interface TripStatus {
  trip: Trip;
  /** Your share: net of repayments, like every other spending figure. */
  spent: Money;
  /** Null when the trip has no budget and no linked event to take one from. */
  budget: Money | null;
  /** Where the budget came from, so the UI can say so. */
  budgetSource: 'trip' | 'lifePlan' | null;
  count: number;
  firstDate: string | null;
  lastDate: string | null;
}

const roundCents = (n: number): Money => Math.round(n * 100) / 100;

const hasTag = (t: Transaction, tag: string) =>
  (t.tags || []).some(x => x.toLowerCase() === tag.toLowerCase());

/** The budget a trip is measured against, and where it came from. */
export function tripBudget(trip: Trip, lifePlan?: LifePlan): { budget: Money | null; source: TripStatus['budgetSource'] } {
  if (typeof trip.budget === 'number' && trip.budget > 0) return { budget: trip.budget, source: 'trip' };
  if (trip.lifePlanEventId && lifePlan) {
    const ev = (lifePlan.events || []).find(e => e.id === trip.lifePlanEventId);
    if (ev && ev.type === 'oneTime') {
      // Plan events store a cost as negative, but older ones were written as a
      // positive string. Either way the size is the budget.
      const amount = Math.abs(Number(ev.amount) || 0);
      if (amount > 0) return { budget: amount, source: 'lifePlan' };
    }
  }
  return { budget: null, source: null };
}

/**
 * Where each trip stands. Counts every tagged transaction regardless of month
 * and including one-offs: a trip is a single budget, not a monthly one.
 * Savings transfers are still left out — they are not spending.
 */
export function getTripStatuses(trips: Trip[] | undefined, transactions: Transaction[], lifePlan?: LifePlan): TripStatus[] {
  return (trips || []).map((trip) => {
    const tagged = transactions
      .filter(t => t.kind !== 'savings' && hasTag(t, trip.tag))
      .sort((a, b) => a.date.localeCompare(b.date));
    const { budget, source } = tripBudget(trip, lifePlan);
    return {
      trip,
      spent: roundCents(tagged.reduce((s, t) => s + effectiveAmount(t), 0)),
      budget,
      budgetSource: source,
      count: tagged.length,
      firstDate: tagged[0]?.date ?? null,
      lastDate: tagged[tagged.length - 1]?.date ?? null,
    };
  });
}
