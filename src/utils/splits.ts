// Splitting one purchase across categories.
//
// A Costco run is groceries and household and a gift. Rather than teach every
// total in the app about a transaction with parts, a split *is* several
// transactions: same date, same merchant, one per category, amounts adding
// up to what the card was charged, and a shared `splitGroupId` tying them
// together so they can be shown as one purchase and merged back.
//
// The one place that has to know is import de-duplication: the bank shows the
// whole charge, so the group's total is what an incoming row is compared to.

import type { Transaction } from '../types/domain';

export interface SplitPart {
  category: string;
  amount: number;
  subcategory?: string;
  notes?: string;
}

const cents = (n: number): number => Math.round(n * 100);

/** Every transaction in the same split group as `t`, in id order; just `t` when it isn't split. */
export function splitGroup(t: Transaction, all: Transaction[]): Transaction[] {
  if (!t.splitGroupId) return [t];
  return all.filter(x => x.splitGroupId === t.splitGroupId).sort((a, b) => a.id.localeCompare(b.id));
}

/** Why these parts can't be saved, or null when they can. */
export function validateSplit(total: number, parts: SplitPart[]): string | null {
  if (parts.length < 2) return 'A split needs at least two parts.';
  if (parts.some(p => !p.category)) return 'Every part needs a category.';
  if (parts.some(p => !(p.amount > 0))) return 'Every part needs an amount above zero.';
  const diff = cents(total) - parts.reduce((s, p) => s + cents(p.amount), 0);
  if (diff !== 0) return `The parts add up to ${diff > 0 ? 'less' : 'more'} than the charge, by $${(Math.abs(diff) / 100).toFixed(2)}.`;
  return null;
}

/**
 * The transactions that replace `original`. The first part keeps the
 * original's id, so anything that pointed at it — a recurring template's
 * posting, an owed record — still finds a transaction.
 */
export function applySplit(original: Transaction, parts: SplitPart[], groupId = `split_${original.id}`): Transaction[] {
  return parts.map((p, i) => ({
    ...original,
    id: i === 0 ? original.id : `${original.id}_s${i}`,
    amount: Math.round(p.amount * 100) / 100,
    category: p.category,
    subcategory: p.subcategory ?? (i === 0 ? original.subcategory : ''),
    notes: p.notes ?? original.notes,
    splitGroupId: groupId,
  }));
}

/** One transaction again, from a whole group: the first part with the total, in its category. */
export function mergeSplit(group: Transaction[]): Transaction {
  const [first] = [...group].sort((a, b) => a.id.localeCompare(b.id));
  const { splitGroupId: _g, ...rest } = first;
  return { ...rest, amount: group.reduce((s, t) => s + cents(t.amount), 0) / 100 };
}

/**
 * The ledger as a bank sees it: each split group folded back into a single
 * charge of the group's total. Used only for comparing against an import.
 */
export function foldSplits(transactions: Transaction[]): Transaction[] {
  const groups = new Map<string, Transaction[]>();
  const out: Transaction[] = [];
  for (const t of transactions) {
    if (!t.splitGroupId) { out.push(t); continue; }
    const g = groups.get(t.splitGroupId);
    if (g) g.push(t); else groups.set(t.splitGroupId, [t]);
  }
  for (const g of groups.values()) out.push(mergeSplit(g));
  return out;
}
