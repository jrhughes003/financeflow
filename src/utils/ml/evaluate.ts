// Evaluation for the merchant classifier.
//
// A model without a measured baseline is a claim, not a result. The baseline
// here is the keyword matcher the app already shipped: if the learned model
// can't beat it on held-out data, it shouldn't be in the product.
//
// Two details that decide whether the number means anything:
//
//   The split is stratified and grouped by merchant. Grouping matters more
//   than it sounds — a ledger has the same merchant dozens of times, so a
//   random row split puts "Tim Hortons" in both train and test and reports
//   memorisation as accuracy. Splitting by distinct merchant measures what is
//   actually being asked: a descriptor this model has never seen.
//
//   Macro-F1 sits alongside accuracy. Spending is imbalanced — housing might
//   be 4 rows and dining 200 — and accuracy alone would call a model that
//   ignores every small category a success.

import { train, classify } from './categorizer';
import { trainingData } from './categorizer';
import { autoCategorize } from '../categorization';
import { normaliseMerchant } from './features';

import type { Category, Transaction } from '../../types/domain';
import type { TrainingRow, TrainOptions } from './categorizer';

/** A merchant and every labelled row belonging to it. */
export interface MerchantGroup {
  key: string;
  category: string;
  rows: TrainingRow[];
}

/** One prediction against its true label. */
export interface PredictionPair {
  actual: string;
  predicted: string;
}

export interface ClassScore {
  category: string;
  precision: number;
  recall: number;
  f1: number;
  /** How many rows actually belong to this class. */
  support: number;
}

export interface Scores {
  accuracy: number;
  macroF1: number;
  macroPrecision: number;
  macroRecall: number;
  perClass: ClassScore[];
  n: number;
}

export interface CrossValidateOptions extends TrainOptions {
  k?: number;
  seed?: number;
  customCategories?: Category[];
  /**
   * 'merchant' asks whether an unseen merchant can be categorised; 'row' asks
   * whether a merchant the user has already labelled can be. Two different
   * questions with two different answers.
   */
  splitBy?: 'merchant' | 'row';
}

/** Deterministic shuffle, so a reported score is reproducible. */
function shuffled<T>(items: T[], seed = 1): T[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Fold assignment by distinct merchant, balanced across categories so each
 * fold sees a similar class mix.
 */
export function merchantFolds(rows: TrainingRow[], k = 5, seed = 1): MerchantGroup[][] {
  const byMerchant = new Map<string, MerchantGroup>();
  rows.forEach(row => {
    const key = normaliseMerchant(row.merchant);
    let group = byMerchant.get(key);
    if (!group) { group = { key, category: row.category, rows: [] }; byMerchant.set(key, group); }
    group.rows.push(row);
  });

  const groups = [...byMerchant.values()];
  const byCategory = new Map<string, MerchantGroup[]>();
  groups.forEach(g => {
    let list = byCategory.get(g.category);
    if (!list) { list = []; byCategory.set(g.category, list); }
    list.push(g);
  });

  const folds: MerchantGroup[][] = Array.from({ length: k }, () => []);
  // Deal each category's merchants round-robin, so no fold is starved of a class.
  [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([, groupList]) => {
    shuffled(groupList, seed).forEach((group, index) => folds[index % k].push(group));
  });
  return folds;
}

/**
 * Folds over individual rows, so a merchant can appear in both train and test.
 * That is not leakage here — it is the question: the user has categorised this
 * place before, and another transaction from it has just arrived.
 */
export function rowFolds(rows: TrainingRow[], k = 5, seed = 1): MerchantGroup[][] {
  const folds: MerchantGroup[][] = Array.from({ length: k }, () => []);
  shuffled(rows, seed).forEach((row, index) => {
    folds[index % k].push({ key: row.merchant, category: row.category, rows: [row] });
  });
  return folds;
}

export function confusionMatrix(pairs: PredictionPair[], classes: string[]): number[][] {
  const index = new Map(classes.map((c, i) => [c, i]));
  const matrix = classes.map(() => new Array(classes.length).fill(0));
  pairs.forEach(({ actual, predicted }) => {
    const a = index.get(actual);
    const p = index.get(predicted);
    if (a !== undefined && p !== undefined) matrix[a][p] += 1;
  });
  return matrix;
}

/** Per-class precision, recall and F1, plus the macro average and accuracy. */
export function scores(pairs: PredictionPair[], classes: string[]): Scores {
  const perClass = classes.map(category => {
    const tp = pairs.filter(p => p.actual === category && p.predicted === category).length;
    const fp = pairs.filter(p => p.actual !== category && p.predicted === category).length;
    const fn = pairs.filter(p => p.actual === category && p.predicted !== category).length;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { category, precision, recall, f1, support: tp + fn };
  });

  // Macro averages over classes that actually appear, so an absent category
  // can't drag the mean down to look like a failure.
  const present = perClass.filter(c => c.support > 0);
  const mean = (key: 'f1' | 'precision' | 'recall'): number =>
    (present.length ? present.reduce((a, c) => a + c[key], 0) / present.length : 0);

  return {
    accuracy: pairs.length ? pairs.filter(p => p.actual === p.predicted).length / pairs.length : 0,
    macroF1: mean('f1'),
    macroPrecision: mean('precision'),
    macroRecall: mean('recall'),
    perClass,
    n: pairs.length,
  };
}

/**
 * Cross-validate the classifier against the keyword baseline on the same folds.
 *
 * Returns null when there isn't enough labelled history to evaluate honestly.
 */
export function crossValidate(transactions: Transaction[], {
  k = 5, seed = 1, customCategories = [], splitBy = 'merchant', ...options
}: CrossValidateOptions = {}) {
  const rows = trainingData(transactions);
  if (rows.length < 20) return null;

  // Two different questions, and they have different answers:
  //
  //   splitBy 'merchant' — can it categorise a merchant it has never seen?
  //     Hard, and a curated keyword list is strong competition here: a prior
  //     written by a human beats character n-grams generalising from a few
  //     dozen names.
  //
  //   splitBy 'row' — can it categorise a merchant this ledger has seen before
  //     but no keyword list contains? That is the common case in real data and
  //     the one the feature exists for.
  const folds = splitBy === 'row' ? rowFolds(rows, k, seed) : merchantFolds(rows, k, seed);
  if (folds.filter(f => f.length).length < 2) return null;

  const modelPairs: PredictionPair[] = [];
  const baselinePairs: PredictionPair[] = [];
  // The cases that decide whether this feature earns its place: the keyword
  // matcher has no rule, so it falls back to the catch-all category.
  const fallbackModel: PredictionPair[] = [];
  const fallbackBaseline: PredictionPair[] = [];
  let abstained = 0;

  folds.forEach((heldOut, index) => {
    if (!heldOut.length) return;
    const trainRows = folds.filter((_, i) => i !== index).flat().flatMap(g => g.rows);
    const testRows = heldOut.flatMap(g => g.rows);
    if (!trainRows.length) return;

    const trained = train(trainRows.map(r => ({ ...r, kind: 'expense' as const })), options);

    testRows.forEach(row => {
      const prediction = trained ? classify(trained, row.merchant) : null;
      if (!prediction) abstained += 1;
      const keyword = autoCategorize(row.merchant, customCategories);
      // An abstention still counts as a prediction — scoring only the cases a
      // model chose to answer is how accuracy gets inflated.
      const modelAnswer = prediction ? prediction.category : keyword;

      modelPairs.push({ actual: row.category, predicted: modelAnswer });
      baselinePairs.push({ actual: row.category, predicted: keyword });

      // 'products' is the keyword matcher's "no idea" answer.
      if (keyword === 'products' && row.category !== 'products') {
        fallbackModel.push({ actual: row.category, predicted: modelAnswer });
        fallbackBaseline.push({ actual: row.category, predicted: keyword });
      }
    });
  });

  const classes = [...new Set(rows.map(r => r.category))].sort();
  return {
    classes,
    splitBy,
    model: scores(modelPairs, classes),
    baseline: scores(baselinePairs, classes),
    // Restricted to the rows the keyword matcher couldn't place. Small samples
    // are common here, so `n` travels with the score — a win over four rows is
    // not a result.
    whereKeywordsGiveUp: {
      model: scores(fallbackModel, classes),
      baseline: scores(fallbackBaseline, classes),
      n: fallbackModel.length,
    },
    confusion: confusionMatrix(modelPairs, classes),
    coverage: modelPairs.length ? 1 - abstained / modelPairs.length : 0,
    folds: folds.filter(f => f.length).length,
    merchants: new Set(rows.map(r => normaliseMerchant(r.merchant))).size,
    rows: rows.length,
  };
}
