// The merchant table: autofill, and a categorisation hint.
//
// Built offline by a local model and reviewed by hand — see
// scripts/generateMerchants.mjs. It exists because of a measurement: on
// merchant-grouped folds, where every scored merchant is one the model has
// never seen, the hand-written keyword table scores 0.830 macro-F1 against
// 0.257 for character n-grams and 0.254 for sentence embeddings. Curated data
// is the strongest categoriser in this repository, so the useful thing to do
// was make more of it.
//
// THE MATCHING RULE IS THE IMPORTANT PART. Keywords match as substrings, which
// is safe for a hand-chosen list and unsafe for a generated one: this table
// contains "Gap", "Roots" and "Metro", and a substring rule would file
// "Bloor Roots Cafe" under clothing and "Metrolinx" under groceries. So the
// table matches on the WHOLE normalised name, and the existing keyword list in
// categorization.ts keeps the substring heuristics. Prefix matching is used
// only to offer suggestions, where the user sees the answer before it applies.

import merchantData from '../data/merchants.json';
import { normaliseMerchant } from './ml/features';

export interface MerchantEntry {
  name: string;
  category: string;
  subcategory: string;
}

export interface MerchantSuggestion extends MerchantEntry {
  /** Lower sorts first: 0 exact, 1 starts-with, 2 word-starts-with. */
  rank: number;
}

const ENTRIES: MerchantEntry[] = (merchantData.merchants ?? []) as MerchantEntry[];

/** Normalised name → entry. Built once, on first use. */
let index: Map<string, MerchantEntry> | null = null;

function getIndex(): Map<string, MerchantEntry> {
  if (index) return index;
  index = new Map();
  for (const entry of ENTRIES) {
    const key = normaliseMerchant(entry.name);
    // First wins, so the table's own order decides a clash rather than
    // whichever row happened to be read last.
    if (key && !index.has(key)) index.set(key, entry);
  }
  return index;
}

/** How many merchants the table knows. Exposed so a test can assert it is not empty. */
export const merchantCount = ENTRIES.length;

/**
 * The table's entry for an exact merchant name, or null.
 *
 * Exact on the normalised form, so "TIM HORTONS #4021" and "Tim Hortons" agree
 * (normaliseMerchant strips digits and punctuation) while "Tim Hortons Plaza
 * Dental" does not match at all. That is deliberate: a wrong category applied
 * silently is worse than no category.
 */
export function lookupMerchant(name: string): MerchantEntry | null {
  const key = normaliseMerchant(name);
  if (!key) return null;
  return getIndex().get(key) ?? null;
}

/**
 * Suggestions for the entry form, best first.
 *
 * Ranked rather than filtered: an exact match beats a prefix match beats a
 * match on a later word, so typing "sobe" offers Sobeys before anything that
 * merely contains it. Substring-anywhere is deliberately excluded — it turns
 * three characters into a wall of unrelated names.
 */
export function searchMerchants(query: string, limit = 8): MerchantSuggestion[] {
  const q = normaliseMerchant(query);
  if (q.length < 2) return [];

  const out: MerchantSuggestion[] = [];
  for (const entry of ENTRIES) {
    const key = normaliseMerchant(entry.name);
    if (!key) continue;
    let rank = -1;
    if (key === q) rank = 0;
    else if (key.startsWith(q)) rank = 1;
    else if (key.split(' ').some(word => word.startsWith(q))) rank = 2;
    if (rank >= 0) out.push({ ...entry, rank });
  }

  out.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}

/**
 * Every category id the table refers to.
 *
 * Used by a test to prove the table cannot drift away from the taxonomy: a row
 * pointing at a category that no longer exists would silently categorise
 * transactions into nothing.
 */
export function referencedCategories(): string[] {
  return [...new Set(ENTRIES.map(e => e.category))].sort();
}
