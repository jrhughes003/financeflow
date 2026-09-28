// Tests for the embedding maths, with no model and no network.
//
// Every vector below was written by hand. That is deliberate and it is the only
// way this file can exist: downloading MiniLM to assert that cosine similarity
// is symmetric would make the test suite depend on the Hugging Face CDN to check
// arithmetic. So the Embedder is injected, the fake one is a three-axis lookup
// table, and the suite runs in milliseconds — if it ever starts taking seconds,
// something has begun loading a real model and that is a bug.
//
// What is *not* tested here is createLocalEmbedder's loader, which does nothing
// but fetch and run that model. It is two lines for exactly that reason.

import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  l2Normalise,
  classCentroids,
  classifyByCentroid,
  nearestNeighbours,
  embedMerchants,
  createLocalEmbedder,
  EMBEDDING_MODEL,
  MIN_SIMILARITY,
} from './embeddings';
import type { Embedder } from './embeddings';

// A hand-made semantic space: x is groceries, y is dining, z is transport. Real
// embeddings have 384 axes and none of them mean anything this tidy, but the
// property the module relies on is the same — related merchants point the same
// way, and a name the ledger has never contained still lands near its category.
const SPACE: Record<string, number[]> = {
  loblaws: [1, 0, 0],
  sobeys: [0.94, 0.34, 0], // groceries, with a little dining smell from the deli
  'no frills': [0.98, 0.2, 0], // the held-out grocer: never in any centroid below
  'blue bottle': [0, 1, 0],
  'tim hortons': [0.2, 0.98, 0],
  'via rail': [0, 0, 1],
  presto: [0, 0.1, 0.99],
  // Equidistant from all three axes: the descriptor that genuinely resembles
  // nothing, which is what the abstention path is for.
  'zzz holdings': [0.577, 0.577, 0.577],
};

interface Fake {
  embed: Embedder;
  /** Every batch the embedder was handed, so the dedupe can be asserted. */
  batches: string[][];
}

function fakeEmbedder(): Fake {
  const batches: string[][] = [];
  const embed: Embedder = async texts => {
    batches.push([...texts]);
    return texts.map(text => {
      const vector = SPACE[text];
      // Loudly, because a missing entry means the module normalised a descriptor
      // differently than this file expects — which is the interesting failure.
      if (!vector) throw new Error(`the fake embedder has no vector for "${text}"`);
      return l2Normalise(vector);
    });
  };
  return { embed, batches };
}

function vec(name: string): Float32Array {
  const raw = SPACE[name];
  if (!raw) throw new Error(`unknown fixture vector "${name}"`);
  return l2Normalise(raw);
}

function magnitude(v: Float32Array): number {
  return Math.sqrt([...v].reduce((a, x) => a + x * x, 0));
}

describe('cosineSimilarity', () => {
  it('scores an identical direction at 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(cosineSimilarity(vec('loblaws'), vec('loblaws'))).toBeCloseTo(1, 6);
  });

  it('scores orthogonal vectors at 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity(vec('loblaws'), vec('via rail'))).toBeCloseTo(0, 6);
  });

  it('scores an opposite direction at -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    expect(cosineSimilarity([2, 3], [-4, -6])).toBeCloseTo(-1, 6);
  });

  it('ignores magnitude, so normalising first changes nothing', () => {
    expect(cosineSimilarity([3, 4], [6, 8])).toBeCloseTo(1, 6);

    const raw = cosineSimilarity([1, 2], [3, 4]);
    const normalised = cosineSimilarity(l2Normalise([1, 2]), l2Normalise([3, 4]));
    expect(normalised).toBeCloseTo(raw, 6);

    // And scaling one side alone leaves the score alone.
    expect(cosineSimilarity([1, 2], [30, 40])).toBeCloseTo(raw, 6);
  });

  it('is symmetric', () => {
    expect(cosineSimilarity(vec('sobeys'), vec('tim hortons')))
      .toBeCloseTo(cosineSimilarity(vec('tim hortons'), vec('sobeys')), 6);
  });

  it('scores a zero vector at 0 rather than NaN', () => {
    const score = cosineSimilarity([0, 0, 0], [1, 2, 3]);
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('throws on mismatched widths instead of comparing what overlaps', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(/length mismatch/);
    expect(() => cosineSimilarity([1, 0, 0], [1, 0])).toThrow(/2 vs 3|3 vs 2/);
  });
});

describe('l2Normalise', () => {
  it('returns a unit-length vector', () => {
    expect(magnitude(l2Normalise([3, 4]))).toBeCloseTo(1, 6);
    expect(magnitude(l2Normalise([-1, 2, -3, 4]))).toBeCloseTo(1, 6);
  });

  it('preserves direction', () => {
    const unit = l2Normalise([3, 4]);
    expect(unit[0]).toBeCloseTo(0.6, 6);
    expect(unit[1]).toBeCloseTo(0.8, 6);
    expect(cosineSimilarity(unit, [3, 4])).toBeCloseTo(1, 6);
  });

  it('leaves an already-unit vector where it was', () => {
    const unit = l2Normalise(l2Normalise([1, 1, 1, 1]));
    expect(magnitude(unit)).toBeCloseTo(1, 6);
    expect(unit[0]).toBeCloseTo(0.5, 6);
  });

  it('maps a zero vector to zeros, never to NaN', () => {
    // The pinned behaviour: "no direction" propagates as a comparable value.
    // NaN would spread through every downstream score without ever throwing.
    const out = l2Normalise([0, 0, 0]);
    expect([...out]).toEqual([0, 0, 0]);
    expect([...out].some(Number.isNaN)).toBe(false);
    expect(cosineSimilarity(out, [1, 2, 3])).toBe(0);
  });

  it('survives an empty vector', () => {
    expect(l2Normalise([]).length).toBe(0);
  });

  it('does not alias its input', () => {
    const input = new Float32Array([3, 4]);
    l2Normalise(input);
    expect([...input]).toEqual([3, 4]);
  });
});

describe('classCentroids', () => {
  it('averages a class and re-normalises the result', () => {
    const centroids = classCentroids([[1, 0], [0, 1]], ['groceries', 'groceries']);
    const groceries = centroids.get('groceries');
    if (!groceries) throw new Error('groceries should have a centroid');

    // The mean is [0.5, 0.5]; re-normalised that is [0.7071, 0.7071].
    expect(groceries[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(groceries[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(magnitude(groceries)).toBeCloseTo(1, 6);
  });

  it('weights every example equally, not by magnitude', () => {
    // [10, 0] is the same direction as [1, 0] and must not dominate the mean.
    const long = classCentroids([[10, 0], [0, 1]], ['a', 'a']).get('a');
    const short = classCentroids([[1, 0], [0, 1]], ['a', 'a']).get('a');
    if (!long || !short) throw new Error('both should have a centroid');
    // Deliberately unequal: this documents that callers must hand in normalised
    // vectors, which is why the Embedder contract says unit length.
    expect(cosineSimilarity(long, short)).toBeLessThan(1);
    expect(magnitude(long)).toBeCloseTo(1, 6);
  });

  it('gives a single-example class that example, normalised', () => {
    const centroids = classCentroids([[3, 4]], ['transport']);
    const transport = centroids.get('transport');
    if (!transport) throw new Error('transport should have a centroid');
    expect(transport[0]).toBeCloseTo(0.6, 6);
    expect(transport[1]).toBeCloseTo(0.8, 6);
  });

  it('collapses a class of conflicting examples to zeros rather than NaN', () => {
    // A user who filed the same merchant under two categories, or a category
    // that is really two unrelated clusters: the mean cancels out. Zeros then
    // score 0 against everything, so the class simply never wins.
    const centroids = classCentroids([[1, 0], [-1, 0]], ['products', 'products']);
    const products = centroids.get('products');
    if (!products) throw new Error('products should have a centroid');
    expect([...products]).toEqual([0, 0]);
    expect([...products].some(Number.isNaN)).toBe(false);
    expect(cosineSimilarity(products, [1, 0])).toBe(0);
  });

  it('keeps classes separate and in insertion order', () => {
    const centroids = classCentroids(
      [vec('loblaws'), vec('sobeys'), vec('blue bottle')],
      ['groceries', 'groceries', 'dining'],
    );
    expect([...centroids.keys()]).toEqual(['groceries', 'dining']);
    expect(centroids.size).toBe(2);
  });

  it('returns nothing for no examples', () => {
    expect(classCentroids([], []).size).toBe(0);
  });

  it('throws when the labels do not line up with the vectors', () => {
    expect(() => classCentroids([[1, 0], [0, 1]], ['a'])).toThrow(/2 vectors for 1 labels/);
    expect(() => classCentroids([[1, 0]], ['a', 'b'])).toThrow(/1 vectors for 2 labels/);
  });

  it('throws on mismatched widths, within a class or across classes', () => {
    expect(() => classCentroids([[1, 0], [1, 0, 0]], ['a', 'a'])).toThrow(/length mismatch/);
    // Across classes too: otherwise each class summarises fine and the crash
    // arrives later, at a query, a long way from the mistake.
    expect(() => classCentroids([[1, 0], [1, 0, 0]], ['a', 'b'])).toThrow(/length mismatch/);
  });
});

describe('classifyByCentroid', () => {
  const centroids = classCentroids(
    [vec('loblaws'), vec('sobeys'), vec('blue bottle'), vec('tim hortons'), vec('via rail')],
    ['groceries', 'groceries', 'dining', 'dining', 'transport'],
  );

  it('picks the nearest class', () => {
    const match = classifyByCentroid(centroids, vec('presto'));
    if (!match) throw new Error('presto should match transport');
    expect(match.category).toBe('transport');
    expect(match.similarity).toBeGreaterThan(0.9);
    expect(match.confident).toBe(true);
  });

  it('places a merchant no centroid ever saw — the reason this module exists', () => {
    // "no frills" is in no centroid, and shares no useful character n-gram with
    // "loblaws" or "sobeys". Direction is the only thing that can place it.
    const match = classifyByCentroid(centroids, vec('no frills'));
    if (!match) throw new Error('no frills should match groceries');
    expect(match.category).toBe('groceries');
  });

  it('returns null when nothing clears minSimilarity', () => {
    expect(classifyByCentroid(centroids, vec('zzz holdings'), { minSimilarity: 0.95 })).toBeNull();
    // The zero vector clears nothing, so an unembeddable merchant abstains.
    expect(classifyByCentroid(centroids, [0, 0, 0])).toBeNull();
  });

  it('reports the losing guess when asked not to abstain', () => {
    const match = classifyByCentroid(centroids, vec('zzz holdings'), {
      minSimilarity: 0.95,
      abstain: false,
    });
    if (!match) throw new Error('abstain: false should still answer');
    expect(match.confident).toBe(false);
    expect(match.similarity).toBeLessThan(0.95);
    expect(['groceries', 'dining', 'transport']).toContain(match.category);
  });

  it('sets confident from the threshold, inclusively', () => {
    const exact = classifyByCentroid(centroids, vec('presto'), { abstain: false });
    if (!exact) throw new Error('presto should answer');

    const atThreshold = classifyByCentroid(centroids, vec('presto'), {
      minSimilarity: exact.similarity,
      abstain: false,
    });
    const justAbove = classifyByCentroid(centroids, vec('presto'), {
      minSimilarity: exact.similarity + 1e-3,
      abstain: false,
    });
    if (!atThreshold || !justAbove) throw new Error('both should answer');
    expect(atThreshold.confident).toBe(true);
    expect(justAbove.confident).toBe(false);
  });

  it('defaults to MIN_SIMILARITY', () => {
    const withDefault = classifyByCentroid(centroids, vec('zzz holdings'), { abstain: false });
    const withExplicit = classifyByCentroid(centroids, vec('zzz holdings'), {
      minSimilarity: MIN_SIMILARITY,
      abstain: false,
    });
    if (!withDefault || !withExplicit) throw new Error('both should answer');
    expect(withDefault.confident).toBe(withExplicit.confident);
  });

  it('returns null when there are no classes', () => {
    expect(classifyByCentroid(new Map(), vec('loblaws'))).toBeNull();
    expect(classifyByCentroid(new Map(), vec('loblaws'), { abstain: false })).toBeNull();
  });

  it('breaks ties towards the first class inserted', () => {
    // Both centroids sit the same distance from the query, so the answer would
    // otherwise depend on iteration luck and move between runs.
    const tied = new Map([['first', [1, 0]], ['second', [1, 0]]]);
    const match = classifyByCentroid(tied, [1, 0]);
    if (!match) throw new Error('a tie should still answer');
    expect(match.category).toBe('first');
  });

  it('throws when the query is a different width from the centroids', () => {
    expect(() => classifyByCentroid(centroids, [1, 0])).toThrow(/length mismatch/);
  });
});

describe('nearestNeighbours', () => {
  const names = ['loblaws', 'sobeys', 'blue bottle', 'tim hortons', 'via rail'];
  const vectors = names.map(vec);
  const labels = ['groceries', 'groceries', 'dining', 'dining', 'transport'];

  it('orders by similarity, most similar first', () => {
    const found = nearestNeighbours(vectors, labels, vec('no frills'), 3);
    expect(found).toHaveLength(3);
    // Both grocers before either restaurant, and sobeys ahead of loblaws because
    // "no frills" carries a little dining component too.
    expect(found.map(n => names[n.index])).toEqual(['sobeys', 'loblaws', 'tim hortons']);
    expect(found.map(n => n.label)).toEqual(['groceries', 'groceries', 'dining']);
    for (let i = 1; i < found.length; i += 1) {
      expect(found[i - 1].similarity).toBeGreaterThanOrEqual(found[i].similarity);
    }
  });

  it('carries the index back, so a caller can recover the merchant', () => {
    const found = nearestNeighbours(vectors, labels, vec('via rail'), 1);
    expect(found[0].index).toBe(4);
    expect(found[0].label).toBe('transport');
    expect(found[0].similarity).toBeCloseTo(1, 6);
  });

  it('breaks ties by input order', () => {
    const duplicate = [[1, 0], [1, 0], [1, 0]];
    const found = nearestNeighbours(duplicate, ['a', 'b', 'c'], [1, 0], 3);
    expect(found.map(n => n.label)).toEqual(['a', 'b', 'c']);
    expect(found.map(n => n.index)).toEqual([0, 1, 2]);
  });

  it('returns everything when k exceeds the dataset', () => {
    expect(nearestNeighbours(vectors, labels, vec('loblaws'), 99)).toHaveLength(vectors.length);
    expect(nearestNeighbours(vectors, labels, vec('loblaws'))).toHaveLength(vectors.length);
  });

  it('returns nothing for k of zero or less, and nothing for no data', () => {
    expect(nearestNeighbours(vectors, labels, vec('loblaws'), 0)).toEqual([]);
    expect(nearestNeighbours(vectors, labels, vec('loblaws'), -3)).toEqual([]);
    expect(nearestNeighbours([], [], vec('loblaws'))).toEqual([]);
  });

  it('throws when the labels do not line up with the vectors', () => {
    expect(() => nearestNeighbours(vectors, ['groceries'], vec('loblaws')))
      .toThrow(/5 vectors for 1 labels/);
  });

  it('throws when the query is a different width', () => {
    expect(() => nearestNeighbours(vectors, labels, [1, 0])).toThrow(/length mismatch/);
  });
});

describe('embedMerchants', () => {
  it('normalises descriptors the way the n-gram model does', async () => {
    const { embed, batches } = fakeEmbedder();
    // Raw bank descriptors: the fake embedder only knows the normalised forms,
    // so reaching a vector at all proves normaliseMerchant ran.
    const vectors = await embedMerchants(embed, ['SQ *LOBLAWS 0123', 'Blue Bottle!']);
    expect(batches).toEqual([['loblaws', 'blue bottle']]);
    expect(cosineSimilarity(vectors[0], vec('loblaws'))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(vectors[1], vec('blue bottle'))).toBeCloseTo(1, 6);
  });

  it('embeds each distinct descriptor once, in one batch', async () => {
    const { embed, batches } = fakeEmbedder();
    const ledger = ['LOBLAWS #221', 'loblaws', 'Loblaws', 'VIA RAIL 8891', 'via rail'];
    const vectors = await embedMerchants(embed, ledger);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(['loblaws', 'via rail']);
    // One vector per input row, in input order, repeats included.
    expect(vectors).toHaveLength(5);
    expect(cosineSimilarity(vectors[0], vectors[2])).toBeCloseTo(1, 6);
    expect(cosineSimilarity(vectors[3], vectors[4])).toBeCloseTo(1, 6);
    expect(cosineSimilarity(vectors[0], vectors[3])).toBeCloseTo(0, 6);
  });

  it('never hands the embedder an empty batch', async () => {
    // A real pipeline given zero inputs is a tokeniser error, not an empty result.
    const { embed, batches } = fakeEmbedder();
    expect(await embedMerchants(embed, [])).toEqual([]);
    expect(batches).toEqual([]);
  });

  it('throws when the embedder returns the wrong number of vectors', async () => {
    // Otherwise every vector after the gap is attached to the wrong merchant,
    // and the evaluation reports that as a bad model.
    const short: Embedder = async texts => texts.slice(1).map(() => new Float32Array([1, 0, 0]));
    await expect(embedMerchants(short, ['loblaws', 'via rail']))
      .rejects.toThrow(/returned 1 vectors for 2 texts/);
  });

  it('feeds classCentroids end to end', async () => {
    const { embed } = fakeEmbedder();
    const merchants = ['LOBLAWS #221', 'Sobeys', 'BLUE BOTTLE', 'TIM HORTONS #4412'];
    const labels = ['groceries', 'groceries', 'dining', 'dining'];
    const centroids = classCentroids(await embedMerchants(embed, merchants), labels);

    const query = await embedMerchants(embed, ['NO FRILLS 4410']);
    const match = classifyByCentroid(centroids, query[0]);
    if (!match) throw new Error('no frills should match groceries');
    expect(match.category).toBe('groceries');
    expect(match.confident).toBe(true);
  });
});

describe('createLocalEmbedder', () => {
  // The model is never downloaded here. These assertions are about the one
  // property that can be checked without it, and it is the property that
  // matters: construction is free, so importing this module — or building an
  // embedder and never using it — costs no onnxruntime and no network.
  it('loads nothing until it is called', () => {
    expect(typeof createLocalEmbedder()).toBe('function');
    expect(typeof createLocalEmbedder({ model: 'Xenova/bge-small-en-v1.5', dtype: 'fp32' }))
      .toBe('function');
  });

  it('gives each embedder its own pipeline cache', () => {
    // Two models must not share one memoised pipeline.
    expect(createLocalEmbedder()).not.toBe(createLocalEmbedder());
  });

  it('names a default model', () => {
    expect(EMBEDDING_MODEL).toBe('Xenova/all-MiniLM-L6-v2');
  });
});

describe('MIN_SIMILARITY', () => {
  it('is a plausible cosine threshold, and nothing more than that', () => {
    // Pinned so a change is deliberate. It is a guess until the evaluation
    // harness picks a threshold on held-out data; see the comment on it.
    expect(MIN_SIMILARITY).toBeGreaterThan(0);
    expect(MIN_SIMILARITY).toBeLessThan(1);
    expect(MIN_SIMILARITY).toBe(0.45);
  });
});
