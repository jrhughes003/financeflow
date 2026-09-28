// Semantic embeddings, for the merchant nobody has ever seen.
//
// The shipped classifier is logistic regression over character n-grams
// (features.ts, logreg.ts), and its weakness is documented rather than hidden:
// on a descriptor this ledger has never contained it loses to the curated
// keyword list, which is why it never overrides one. It cannot do better. A bag
// of character n-grams has no way to know that "Loblaws" and "Sobeys" are both
// groceries — the two names share no fragment worth having.
//
// A sentence embedding does know, because it was trained on text where those
// names occur in grocery-shaped sentences. So: embed the merchant, embed each
// category's merchants and average them, take the nearest centroid. There is no
// training loop and one example per category is enough, which is exactly the
// cold-start case the n-gram model cannot serve.
//
// THE EMBEDDER IS DEVELOPMENT-ONLY AND MUST STAY THAT WAY. Measured, not
// guessed:
//
//   Bundling @huggingface/transformers into the Vite renderer build produces a
//   72.9 MB chunk, 20.3 MB gzipped. The whole app today is ~460 KB.
//
//   onnxruntime-node is 288 MB on disk and onnxruntime-web 141 MB, and both are
//   hard dependencies of the package — shipping it takes the Windows installer
//   from 90 MB to 250 MB+.
//
// So the library is a devDependency, createLocalEmbedder is called from the
// evaluation harness on a developer machine, and nothing here runs in the
// renderer or the browser demo. Whether a quarter-gigabyte installer is worth it
// is a decision to make *after* the evaluation says embeddings win, which
// nobody has shown yet. Please don't rediscover the 72.9 MB chunk by trying the
// renderer route again.
//
// Everything except createLocalEmbedder is a pure function over vectors, and
// the Embedder indirection exists so that all of it can be tested against
// hand-written vectors with no model, no download and no network.

import { normaliseMerchant } from './features';

import type { FeatureExtractionPipeline } from '@huggingface/transformers';

/**
 * A dense embedding.
 *
 * Inputs are `ArrayLike<number>` so a hand-written `number[]` in a test and the
 * model's `Float32Array` are both accepted; everything this module *returns* is
 * a `Float32Array`, which is the shape the pipeline produces.
 */
export type Vector = ArrayLike<number>;

/** Embeds text into unit-length vectors. Injectable so the maths is testable. */
export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

/** Category id → its unit-length centroid. */
export type Centroids = Map<string, Float32Array>;

export interface CentroidMatch {
  category: string;
  similarity: number;
  /** Whether the app should act on this without asking the LLM. */
  confident: boolean;
}

export interface CentroidOptions {
  /** Cosine similarity below which the match is not worth acting on. */
  minSimilarity?: number;
  /**
   * When true — the default, and what the app wants — a match below
   * `minSimilarity` is reported as null rather than as a low-confidence guess,
   * so a caller can tell "unsure" from "confidently groceries", exactly as
   * classify() does in categorizer.ts.
   *
   * The evaluation harness sets it false: scoring only the rows a model chose to
   * answer is how accuracy gets inflated, so it needs the losing guess too.
   */
  abstain?: boolean;
}

export interface Neighbour {
  label: string;
  similarity: number;
  /** Index into the input arrays, so a caller can recover the merchant. */
  index: number;
}

/** Weight precision for the ONNX export. */
export type EmbeddingPrecision = 'fp32' | 'fp16' | 'q8' | 'q4';

export interface LocalEmbedderOptions {
  /** Any sentence-transformer with an ONNX export on the Hub. */
  model?: string;
  /** q8 is ~23 MB of weights against ~90 MB for fp32, for a cosine cost too small to matter here. */
  dtype?: EmbeddingPrecision;
}

/** 384 dimensions, ~23 MB quantised: the smallest model still good at short phrases. */
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

/**
 * The similarity a centroid match needs before the app acts on it.
 *
 * This number is a guess and should be read as unvalidated. 0.45 because
 * MiniLM's cosine scores for loosely related short phrases tend to land in the
 * 0.3–0.5 band, so a lower floor would accept nearly everything — which is a
 * plausibility argument, not a measurement. Replacing it with a threshold
 * chosen on held-out data is the evaluation harness's job, and until that
 * number exists this constant is not evidence of anything.
 */
export const MIN_SIMILARITY = 0.45;

/**
 * Two embeddings of different width mean two different models, and comparing
 * them by truncating to the shorter one returns a plausible number that is
 * simply wrong. A wrong similarity is worse than a crash: it degrades the
 * categoriser silently and there is nothing in the output to notice.
 */
function requireWidth(expected: number, v: Vector): void {
  if (v.length !== expected) {
    throw new Error(`embedding length mismatch: ${expected} vs ${v.length}`);
  }
}

function requireLabelled(vectors: Vector[], labels: string[]): void {
  if (vectors.length !== labels.length) {
    throw new Error(`${vectors.length} vectors for ${labels.length} labels`);
  }
}

/**
 * Cosine similarity, dividing out both magnitudes rather than assuming unit
 * length — callers mostly pass normalised vectors, but a function that is only
 * correct for normalised input is a trap.
 *
 * An all-zero vector scores 0 against everything, which is the honest answer: it
 * has no direction, so nothing is near it.
 */
export function cosineSimilarity(a: Vector, b: Vector): number {
  requireWidth(a.length, b);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const scale = Math.sqrt(normA) * Math.sqrt(normB);
  return scale ? dot / scale : 0;
}

/**
 * Scale to unit length. An all-zero vector comes back all-zero instead of full
 * of NaN — the same choice vectorise() makes in features.ts, and for the same
 * reason: "nothing to say" has to propagate as a comparable value, because a
 * NaN would poison every downstream score without ever throwing.
 */
export function l2Normalise(v: Vector): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i += 1) norm += v[i] * v[i];
  norm = Math.sqrt(norm);

  const out = new Float32Array(v.length);
  if (!norm) return out;
  for (let i = 0; i < v.length; i += 1) out[i] = v[i] / norm;
  return out;
}

/**
 * The mean vector per class, re-normalised.
 *
 * Re-normalising changes no cosine score — cosineSimilarity divides magnitude
 * out already. It is there to keep one invariant: every vector this module hands
 * back is unit-length or exactly zero. That lets a caller use a plain dot
 * product, and it makes a class whose examples point in opposite directions come
 * out as a visible zero rather than as a short vector that still wins.
 *
 * Summing in Float64Array rather than Float32Array: the inputs are float32, but
 * a few hundred accumulations of them are not, and the cost of the wider
 * accumulator is nothing.
 */
export function classCentroids(vectors: Vector[], labels: string[]): Centroids {
  requireLabelled(vectors, labels);

  // Every vector is checked against the first, not merely against the others of
  // its own class: two classes summarised at different widths would survive this
  // function and blow up later, at the query, far from the mistake.
  const width = vectors.length ? vectors[0].length : 0;

  const sums = new Map<string, Float64Array>();
  const counts = new Map<string, number>();
  vectors.forEach((vector, index) => {
    requireWidth(width, vector);
    const label = labels[index];
    let sum = sums.get(label);
    if (!sum) {
      sum = new Float64Array(width);
      sums.set(label, sum);
    }
    for (let d = 0; d < width; d += 1) sum[d] += vector[d];
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  const centroids: Centroids = new Map();
  sums.forEach((sum, label) => {
    // Every label in `sums` was counted in the same pass; `|| 1` is there
    // because the Map's type cannot say that.
    const n = counts.get(label) || 1;
    const mean = new Float64Array(sum.length);
    for (let d = 0; d < sum.length; d += 1) mean[d] = sum[d] / n;
    centroids.set(label, l2Normalise(mean));
  });
  return centroids;
}

/**
 * The nearest class centroid, or null when there is no answer worth giving.
 *
 * Ties go to the first class inserted, so a reported result is reproducible
 * rather than dependent on Map iteration luck.
 */
export function classifyByCentroid(
  centroids: ReadonlyMap<string, Vector>,
  query: Vector,
  { minSimilarity = MIN_SIMILARITY, abstain = true }: CentroidOptions = {},
): CentroidMatch | null {
  let best: CentroidMatch | null = null;
  for (const [category, centroid] of centroids) {
    const similarity = cosineSimilarity(centroid, query);
    if (best && similarity <= best.similarity) continue;
    best = { category, similarity, confident: similarity >= minSimilarity };
  }

  if (!best) return null; // no classes to choose between
  return abstain && !best.confident ? null : best;
}

/**
 * The k most similar examples, most similar first.
 *
 * A centroid is the cheaper summary, but it hides a category that is really two
 * clusters — "products" in a real ledger is hardware shops and bookshops — and
 * k-NN does not. Which of the two actually wins is a question for the
 * evaluation, so both are here.
 *
 * k beyond the dataset returns everything; ties keep input order.
 */
export function nearestNeighbours(
  vectors: Vector[],
  labels: string[],
  query: Vector,
  k = 5,
): Neighbour[] {
  requireLabelled(vectors, labels);
  return vectors
    .map((vector, index): Neighbour => ({
      label: labels[index],
      similarity: cosineSimilarity(vector, query),
      index,
    }))
    .sort((a, b) => (b.similarity - a.similarity) || (a.index - b.index))
    .slice(0, Math.max(0, k));
}

/**
 * Embed merchant descriptors, normalised by features.ts' normaliseMerchant.
 *
 * Reusing that normaliser instead of writing a second one is the whole point: an
 * evaluation that fed the embedder raw "SQ *BLUE BOTTLE 0123" while the n-gram
 * model saw "blue bottle" would be comparing two different inputs and calling
 * the difference a result.
 *
 * Distinct descriptors are embedded once each. A ledger has the same merchant
 * dozens of times and the forward pass is the expensive part, so this is the
 * difference between one batch and one per row.
 */
export async function embedMerchants(embed: Embedder, merchants: string[]): Promise<Float32Array[]> {
  const texts = merchants.map(m => normaliseMerchant(m));

  const indexOf = new Map<string, number>();
  const distinct: string[] = [];
  texts.forEach(text => {
    if (indexOf.has(text)) return;
    indexOf.set(text, distinct.length);
    distinct.push(text);
  });

  // Nothing to embed: return before touching the embedder, because a real
  // pipeline handed zero inputs is a tokeniser error rather than an empty batch.
  if (!distinct.length) return [];

  const vectors = await embed(distinct);
  // A silent mismatch here would misattribute every embedding after the gap,
  // which reads as a bad model rather than as a broken embedder.
  if (vectors.length !== distinct.length) {
    throw new Error(`embedder returned ${vectors.length} vectors for ${distinct.length} texts`);
  }
  // Every text was just inserted into `indexOf`; `?? 0` is there because the
  // Map's type cannot say that.
  return texts.map(text => vectors[indexOf.get(text) ?? 0]);
}

/**
 * Untested by design, and kept to the two lines that make it untestable: the
 * dynamic import and the pipeline call. Everything it could get wrong that does
 * not need a real model — normalisation, batching, the maths — lives above.
 */
async function loadPipeline(model: string, dtype: EmbeddingPrecision): Promise<FeatureExtractionPipeline> {
  const { pipeline } = await import('@huggingface/transformers');
  return pipeline('feature-extraction', model, { dtype });
}

/**
 * An Embedder backed by a real model, for the evaluation harness under Node.
 *
 * The model loads on the first call, never at import time, and the dynamic
 * import means merely importing this module pulls in no onnxruntime at all —
 * which is what keeps the pure functions above usable from the renderer's test
 * suite and from anywhere else in src/.
 */
export function createLocalEmbedder({
  model = EMBEDDING_MODEL,
  dtype = 'q8',
}: LocalEmbedderOptions = {}): Embedder {
  // Memoised as a promise rather than as a resolved pipeline, so two concurrent
  // first calls share one download instead of racing to start two.
  let pipe: Promise<FeatureExtractionPipeline> | null = null;

  return async (texts: string[]): Promise<Float32Array[]> => {
    pipe ??= loadPipeline(model, dtype);
    const extract = await pipe;
    // The pipeline's own mean-pool and L2 step, so vectors arrive in the
    // unit-length form every function above assumes.
    const tensor = await extract(texts, { pooling: 'mean', normalize: true });
    const rows = tensor.tolist() as number[][];
    const out: Float32Array[] = [];
    for (const row of rows) out.push(Float32Array.from(row));
    return out;
  };
}
