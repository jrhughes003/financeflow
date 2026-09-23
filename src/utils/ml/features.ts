// Turning a merchant string into features.
//
// Bank descriptors are not natural language: "SQ *BLUE BOTTLE 0123", "TIM
// HORTONS #4412", "AMZN MKTP CA*2X4B9". Word-level features handle none of
// that well — the useful signal is in fragments ("hort", "amzn", "mktp") that
// survive the store numbers, prefixes and truncation a payment processor adds.
//
// So the representation is character n-grams over a normalised string, plus
// whole words where they exist. Vectors are L2-normalised so a long descriptor
// doesn't outweigh a short one purely by having more features.

/** Feature name → its column index. Built once from the training corpus. */
export type Vocabulary = Map<string, number>;

/** A sparse vector: column index → weight. Absent columns are zero. */
export type SparseVector = Map<number, number>;

export interface FeatureOptions {
  /** Shortest character n-gram. */
  minN?: number;
  /** Longest character n-gram. */
  maxN?: number;
}

export interface VocabularyOptions extends FeatureOptions {
  /** Drop features seen fewer times than this across the corpus. */
  minCount?: number;
}

const DIGITS = /\d+/g;
const NOISE = /\b(?:sq|tst|pos|pmt|purchase|payment|ref|card|visa|debit|inc|ltd|llc|co)\b/g;
const PUNCT = /[^a-z0-9\s]+/g;

/** Lowercase, drop processor noise and store numbers, collapse whitespace. */
export function normaliseMerchant(raw: unknown): string {
  return String(raw || '')
    .toLowerCase()
    .replace(PUNCT, ' ')
    .replace(DIGITS, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Character n-grams plus word unigrams.
 *
 * The string is padded so that word beginnings and endings are themselves
 * features — "^ti", "ons$" — which is what lets a truncated descriptor still
 * match a known merchant.
 */
export function extractFeatures(raw: unknown, { minN = 3, maxN = 5 }: FeatureOptions = {}): string[] {
  const text = normaliseMerchant(raw);
  if (!text) return [];

  const features: string[] = [];
  const padded = `^${text}$`;
  for (let n = minN; n <= maxN; n += 1) {
    for (let i = 0; i + n <= padded.length; i += 1) {
      features.push(`c:${padded.slice(i, i + n)}`);
    }
  }
  text.split(' ').filter(Boolean).forEach(word => features.push(`w:${word}`));
  return features;
}

/**
 * Build the vocabulary from a training corpus.
 *
 * Features seen fewer than `minCount` times are dropped: with a few hundred
 * examples, a fragment that appears once is far more likely to be a store
 * number's residue than a signal, and keeping it invites overfitting.
 */
export function buildVocabulary(
  documents: string[],
  { minCount = 2, ...options }: VocabularyOptions = {},
): Vocabulary {
  const counts = new Map<string, number>();
  documents.forEach(doc => {
    new Set(extractFeatures(doc, options)).forEach(f => counts.set(f, (counts.get(f) || 0) + 1));
  });

  const vocabulary: Vocabulary = new Map();
  [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])) // stable, most frequent first
    .forEach(([feature], index) => vocabulary.set(feature, index));
  return vocabulary;
}

/**
 * A sparse, L2-normalised term-frequency vector: Map(index → weight).
 * Features outside the vocabulary are ignored, which is how an unseen merchant
 * degrades gracefully instead of throwing.
 */
export function vectorise(raw: unknown, vocabulary: Vocabulary, options: FeatureOptions = {}): SparseVector {
  const counts: SparseVector = new Map();
  extractFeatures(raw, options).forEach(feature => {
    const index = vocabulary.get(feature);
    if (index !== undefined) counts.set(index, (counts.get(index) || 0) + 1);
  });

  let norm = 0;
  counts.forEach(v => { norm += v * v; });
  norm = Math.sqrt(norm);
  if (!norm) return counts; // no known features: an all-zero vector

  const vector: SparseVector = new Map();
  counts.forEach((v, index) => vector.set(index, v / norm));
  return vector;
}
