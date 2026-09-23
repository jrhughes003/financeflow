// A merchant classifier trained on the user's own ledger.
//
// The app categorises in three ways, and they suit different situations:
//
//   keywords   fast, free, and right about the merchants someone thought to
//              list — but it knows nothing about how *this* person spends, and
//              falls back to "products" for everything it hasn't seen
//   this model learns from the ledger, so it picks up the local coffee shop and
//              the user's own corrections without anyone writing a rule
//   the LLM    handles a merchant nobody has ever seen, at the cost of a
//              network round trip and a fraction of a cent
//
// So the order is: keywords, then this, then the LLM — and because logistic
// regression gives calibrated probabilities, "then the LLM" can be conditioned
// on the model actually being unsure rather than on it having no opinion.

import { buildVocabulary, vectorise, normaliseMerchant } from './features';
import { fit, predict } from './logreg';

// Below this, the model's answer isn't worth acting on alone.
import type { Transaction } from '../../types/domain';
import type { FitOptions, Model, Sample } from './logreg';
import type { Vocabulary, VocabularyOptions } from './features';

/** One labelled example: a merchant descriptor and the category it belongs to. */
export interface TrainingRow {
  merchant: string;
  category: string;
}

/**
 * The three fields training reads.
 *
 * Narrower than Transaction on purpose: a real ledger satisfies it, and so does
 * a labelled row from the evaluation harness, which has no amount or date and
 * should not have to invent them.
 */
export type Labelled = Pick<Transaction, 'merchant' | 'category'> & Pick<Transaction, 'kind'>;

export interface TrainOptions extends VocabularyOptions, Partial<Omit<FitOptions, 'dimensions' | 'classes'>> {
  /** Confidence below which classify() reports `confident: false`. */
  threshold?: number;
}

/** A fitted classifier, plus everything needed to vectorise a new merchant. */
export interface TrainedClassifier {
  model: Model;
  vocabulary: Vocabulary;
  /** Category ids, in label order. */
  classes: string[];
  trainedOn: number;
  options: TrainOptions;
}

export interface Classification {
  category: string;
  confidence: number;
  /** Whether the app should act on this without asking the model. */
  confident: boolean;
  /** Category id → probability, for showing the runner-up. */
  probabilities: Record<string, number>;
}

export const CONFIDENCE_THRESHOLD = 0.6;

// Fewer examples than this, or fewer than two categories, and there is nothing
// to learn: the model would just memorise a handful of merchants.
export const MIN_EXAMPLES = 12;
export const MIN_PER_CLASS = 2;

/**
 * Training rows from a ledger: one per transaction that has a merchant and a
 * real category. Savings transfers carry a synthetic category and a synthetic
 * merchant, so they are excluded — including them would teach the model that
 * "savings →" predicts the savings pseudo-category, which is circular.
 */
export function trainingData(transactions: Labelled[] = []): TrainingRow[] {
  return transactions
    .filter(t => t.merchant && t.category && t.kind !== 'savings' && t.category !== 'savings')
    .map((t): TrainingRow => ({ merchant: t.merchant, category: t.category }))
    .filter(row => normaliseMerchant(row.merchant).length > 1);
}

/** Categories with enough examples to be learnable. */
function usableClasses(rows: TrainingRow[]): string[] {
  const counts = new Map<string, number>();
  rows.forEach(r => counts.set(r.category, (counts.get(r.category) || 0) + 1));
  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_PER_CLASS)
    .map(([category]) => category)
    .sort();
}

/**
 * Train on a ledger. Returns null when there isn't enough to learn from, which
 * callers treat as "fall back to keywords" rather than as an error.
 */
export function train(transactions: Labelled[], options: TrainOptions = {}): TrainedClassifier | null {
  const rows = trainingData(transactions);
  const classes = usableClasses(rows);
  if (rows.length < MIN_EXAMPLES || classes.length < 2) return null;

  const usable = rows.filter(r => classes.includes(r.category));
  const vocabulary = buildVocabulary(usable.map(r => r.merchant), options);
  if (!vocabulary.size) return null;

  const labelOf = new Map(classes.map((c, i) => [c, i]));
  // Every row was filtered to a usable class above, so the lookup always hits;
  // ?? 0 is there because the Map's type cannot say that.
  const samples: Sample[] = usable.map(r => ({
    vector: vectorise(r.merchant, vocabulary, options),
    label: labelOf.get(r.category) ?? 0,
  }));

  const model = fit(samples, { dimensions: vocabulary.size, classes: classes.length, ...options });
  return {
    model,
    vocabulary,
    classes,
    trainedOn: usable.length,
    options,
  };
}

/**
 * Predict a category. Returns null when the classifier has no real opinion, so
 * a caller can tell "unsure" from "confidently products".
 */
export function classify(trained: TrainedClassifier | null, merchant: string): Classification | null {
  if (!trained || !merchant) return null;
  const vector = vectorise(merchant, trained.vocabulary, trained.options);
  if (!vector.size) return null; // nothing recognisable in this descriptor

  const { label, confidence, probabilities } = predict(trained.model, vector);
  return {
    category: trained.classes[label],
    confidence,
    confident: confidence >= (trained.options.threshold ?? CONFIDENCE_THRESHOLD),
    probabilities: Object.fromEntries(trained.classes.map((c, i) => [c, probabilities[i]])),
  };
}
