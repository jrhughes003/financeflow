// @vitest-environment node
//
// The node environment is load-bearing, not tidiness. Under the default jsdom
// environment onnxruntime rejects its own output with "A float32 tensor's data
// must be type of function Float32Array()": jsdom supplies a different realm,
// so its Float32Array is a distinct constructor from the one the runtime
// checks against, and a perfectly good tensor fails an identity test.
//
// Does a sentence-embedding model actually beat character n-grams at
// categorising a merchant nobody has ever seen?
//
// That is the one question the existing classifier cannot answer for itself.
// Its own comment concedes the weakness — a bag of character n-grams has no
// way to know that "Loblaws" and "Sobeys" are both groceries — and
// crossValidate's `splitBy: 'merchant'` mode exists precisely to measure it.
// So this reuses the same merchant-grouped folds and scores an embedding
// nearest-centroid classifier beside the incumbent on identical splits.
//
// It is skipped by default and never runs in CI, because it downloads ~23 MB
// of model weights on first use. Run it deliberately:
//
//   RUN_EMBEDDING_EVAL=1 npx vitest run src/utils/ml/embeddings.eval.test.ts
//
// Grouped folds, not row folds: splitting by row would put "Metro" in both
// train and test and report a number that flatters everyone. Every merchant
// scored here is one the model has genuinely never seen.

import { describe, it, expect } from 'vitest';
import { train, classify, trainingData } from './categorizer';
import { merchantFolds, scores } from './evaluate';
import type { PredictionPair } from './evaluate';
import {
  createLocalEmbedder, embedMerchants, classCentroids, classifyByCentroid,
} from './embeddings';
import { autoCategorize } from '../categorization';
import generateDemoData from '../demoData';

const ENABLED = process.env.RUN_EMBEDDING_EVAL === '1';

describe.skipIf(!ENABLED)('embeddings vs character n-grams, on unseen merchants', () => {
  it('measures macro-F1 for both on identical merchant-grouped folds', async () => {
    const demo = generateDemoData(new Date(2026, 8, 22));
    const rows = trainingData(demo.transactions);
    const classes = [...new Set(rows.map(r => r.category))].sort();
    const folds = merchantFolds(rows, 5, 1);

    const embed = createLocalEmbedder();

    const ngramPairs: PredictionPair[] = [];
    const embeddingPairs: PredictionPair[] = [];
    const keywordPairs: PredictionPair[] = [];

    for (const [index, heldOut] of folds.entries()) {
      if (!heldOut.length) continue;
      const trainRows = folds.filter((_, i) => i !== index).flat().flatMap(g => g.rows);
      const testRows = heldOut.flatMap(g => g.rows);
      if (!trainRows.length) continue;

      const trained = train(trainRows.map(r => ({ ...r, kind: 'expense' as const })));

      // One vector per training row, then a centroid per category. Centroids
      // rather than k-NN because the classes are very unbalanced here and a
      // handful of dining merchants would otherwise outvote everything.
      const trainVectors = await embedMerchants(embed, trainRows.map(r => r.merchant));
      const centroids = classCentroids(trainVectors, trainRows.map(r => r.category));
      const testVectors = await embedMerchants(embed, testRows.map(r => r.merchant));

      testRows.forEach((row, i) => {
        const keyword = autoCategorize(row.merchant, []);
        keywordPairs.push({ actual: row.category, predicted: keyword });

        // An abstention still counts as a prediction. Scoring only the rows a
        // model chose to answer is how accuracy gets inflated, which is why
        // both fall back to the keyword answer rather than being dropped.
        const ngram = classify(trained, row.merchant);
        ngramPairs.push({ actual: row.category, predicted: ngram ? ngram.category : keyword });

        const match = classifyByCentroid(centroids, testVectors[i], { abstain: false });
        embeddingPairs.push({ actual: row.category, predicted: match ? match.category : keyword });
      });
    }

    const keywordScore = scores(keywordPairs, classes);
    const ngramScore = scores(ngramPairs, classes);
    const embeddingScore = scores(embeddingPairs, classes);

    const row = (name: string, s: { accuracy: number; macroF1: number; n: number }) =>
      `${name.padEnd(22)} acc=${s.accuracy.toFixed(3)}  macroF1=${s.macroF1.toFixed(3)}  n=${s.n}`;
    console.log('');
    console.log(row('keywords only', keywordScore));
    console.log(row('character n-grams', ngramScore));
    console.log(row('embeddings', embeddingScore));

    // Deliberately not asserting that embeddings win. The point of the harness
    // is to find out; an assertion here would turn a measurement into a wish.
    // What is asserted is that the comparison is valid: same rows, same
    // classes, every row scored by all three.
    expect(embeddingScore.n).toBe(ngramScore.n);
    expect(embeddingScore.n).toBe(keywordScore.n);
    expect(embeddingScore.n).toBeGreaterThan(0);
  }, 600_000);
});
