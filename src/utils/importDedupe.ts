// Spotting rows in a bank export that the ledger already has.
//
// Bank exports overlap: a statement downloaded on the 15th and another on the
// 30th share two weeks of rows. Importing both used to double those weeks, and
// nothing said so until a budget looked wrong. This decides, row by row, which
// incoming transactions already exist, so the preview can untick them.
//
// Deliberately conservative in one direction. A false "duplicate" is cheap —
// the row is shown, unticked, with the match beside it, and one click brings it
// back. A missed duplicate is silent and corrupts every total it touches.

import type { IsoDate, Transaction } from '../types/domain';

/** How sure the match is. `exact` is same day and amount; `likely` allows a few days' drift. */
export type DuplicateStrength = 'exact' | 'likely';

export interface DuplicateMatch {
  strength: DuplicateStrength;
  /** The ledger transaction this row appears to repeat. */
  existing: Transaction;
}

/** Banks post a card charge a day or two after the receipt date. */
const DRIFT_DAYS = 3;

const cents = (n: number): number => Math.round(n * 100);

function dayNumber(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

/**
 * A merchant reduced to what survives the bank's decoration.
 *
 * "TIM HORTONS #1234 TORONTO ON" and "Tim Hortons" should agree; "AMZN Mktp
 * CA*2K4" and "Amazon.ca" mostly will not, which is why a same-day,
 * same-amount row counts as a duplicate whatever the merchant says.
 */
export function merchantKey(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[#*].*$/, '')
    .replace(/[^a-z]/g, '')
    .slice(0, 8);
}

function similarMerchant(a: string, b: string): boolean {
  const ka = merchantKey(a);
  const kb = merchantKey(b);
  if (!ka || !kb) return false;
  const n = Math.min(ka.length, kb.length, 5);
  return ka.slice(0, n) === kb.slice(0, n);
}

/**
 * For each incoming row, the ledger transaction it repeats, or null.
 *
 * Each ledger transaction can be claimed once. Two identical coffees on the
 * same day are two coffees: if the ledger has one, one incoming row is a
 * duplicate and the other is new.
 */
export function findDuplicates(incoming: Transaction[], existing: Transaction[]): (DuplicateMatch | null)[] {
  const pool = existing
    .filter(t => t.kind !== 'savings')
    .map(t => ({ t, day: dayNumber(t.date), cents: cents(t.amount), claimed: false }));

  const claim = (row: Transaction, accept: (p: typeof pool[number], drift: number) => boolean): Transaction | null => {
    const day = dayNumber(row.date);
    const amt = cents(row.amount);
    let best: typeof pool[number] | null = null;
    let bestDrift = Infinity;
    for (const p of pool) {
      if (p.claimed || p.cents !== amt) continue;
      const drift = Math.abs(p.day - day);
      if (drift < bestDrift && accept(p, drift)) { best = p; bestDrift = drift; }
    }
    if (!best) return null;
    best.claimed = true;
    return best.t;
  };

  const result: (DuplicateMatch | null)[] = incoming.map(() => null);

  // Two passes so an exact match is never stolen by a nearby "likely" one.
  incoming.forEach((row, i) => {
    const hit = claim(row, (_p, drift) => drift === 0);
    if (hit) result[i] = { strength: 'exact', existing: hit };
  });
  incoming.forEach((row, i) => {
    if (result[i]) return;
    const hit = claim(row, (p, drift) => drift <= DRIFT_DAYS && similarMerchant(p.t.merchant, row.merchant));
    if (hit) result[i] = { strength: 'likely', existing: hit };
  });

  return result;
}
