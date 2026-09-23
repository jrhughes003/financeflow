// Tests for the merchant classifier: the maths, then what it is actually worth.
//
// The first version of this file asserted that the model beats the keyword
// matcher on merchants it has never seen. It doesn't, and the measurement said
// so — a curated keyword list is a human prior over thousands of merchants,
// while the model has a few dozen names and no way to know that an unseen brand
// sells coffee. The demo ledger makes that gap wider still, because its
// merchants were drawn from the keyword lists in the first place.
//
// So the claims here are the ones the data supports: the model matches keywords
// on merchants already in the ledger, and it wins on the merchants keywords
// have no rule for — which is the only place the app lets it speak.

import { describe, it, expect } from 'vitest';
import { normaliseMerchant, extractFeatures, buildVocabulary, vectorise } from './features';
import { softmax, fit, predict } from './logreg';
import { train, classify, trainingData } from './categorizer';
import { crossValidate, scores, confusionMatrix, merchantFolds } from './evaluate';
import generateDemoData from '../demoData';

const TODAY = new Date(2026, 8, 22);
const demo = generateDemoData(TODAY);

describe('merchant normalisation', () => {
  it('strips the noise a payment processor adds', () => {
    expect(normaliseMerchant('SQ *BLUE BOTTLE 0123')).toBe('blue bottle');
    expect(normaliseMerchant('TIM HORTONS #4412')).toBe('tim hortons');
    expect(normaliseMerchant('AMZN MKTP CA*2X4B9')).toBe('amzn mktp ca x b');
  });

  it('is stable under case and punctuation', () => {
    expect(normaliseMerchant('Metro!')).toBe(normaliseMerchant('METRO'));
  });

  it('survives an empty or junk descriptor', () => {
    expect(normaliseMerchant('')).toBe('');
    expect(normaliseMerchant('###')).toBe('');
    expect(normaliseMerchant(null)).toBe('');
  });
});

describe('features', () => {
  it('produces character n-grams anchored at word edges', () => {
    const features = extractFeatures('metro', { minN: 3, maxN: 3 });
    expect(features).toContain('c:^me');
    expect(features).toContain('c:ro$');
    expect(features).toContain('w:metro');
  });

  it('lets a truncated descriptor share features with the full name', () => {
    const full = new Set(extractFeatures('tim hortons'));
    const truncated = new Set(extractFeatures('tim horton'));
    const shared = [...truncated].filter(f => full.has(f));
    expect(shared.length).toBeGreaterThan(5);
  });

  it('drops one-off fragments from the vocabulary', () => {
    const vocabulary = buildVocabulary(['metro', 'metro', 'zzqqxx'], { minCount: 2 });
    expect([...vocabulary.keys()].some(f => f.includes('metro'))).toBe(true);
    expect([...vocabulary.keys()].some(f => f.includes('zzqq'))).toBe(false);
  });

  it('L2-normalises, so a long descriptor does not outweigh a short one', () => {
    const vocabulary = buildVocabulary(['metro store downtown', 'metro'], { minCount: 1 });
    const norm = v => Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0));
    expect(norm(vectorise('metro store downtown', vocabulary))).toBeCloseTo(1, 6);
    expect(norm(vectorise('metro', vocabulary))).toBeCloseTo(1, 6);
  });

  it('returns an empty vector for a merchant with no known features', () => {
    const vocabulary = buildVocabulary(['metro', 'metro'], { minCount: 1 });
    expect(vectorise('qqqzzz', vocabulary).size).toBe(0);
  });
});

describe('softmax and fitting', () => {
  it('softmax is a distribution and is shift-invariant', () => {
    const p = softmax([1, 2, 3]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    // Shifting every score by a constant must not change the result — this is
    // the property that keeps large scores from overflowing.
    softmax([101, 102, 103]).forEach((q, i) => expect(q).toBeCloseTo(p[i], 10));
  });

  it('learns a separable problem and drives the loss down', () => {
    const samples = [
      { vector: new Map([[0, 1]]), label: 0 },
      { vector: new Map([[0, 1]]), label: 0 },
      { vector: new Map([[1, 1]]), label: 1 },
      { vector: new Map([[1, 1]]), label: 1 },
    ];
    const model = fit(samples, { dimensions: 2, classes: 2, epochs: 200, learningRate: 0.5 });
    expect(model.losses.at(-1)).toBeLessThan(model.losses[0]);
    expect(predict(model, new Map([[0, 1]])).label).toBe(0);
    expect(predict(model, new Map([[1, 1]])).label).toBe(1);
  });

  it('is less confident where the classes genuinely overlap', () => {
    const samples = [
      { vector: new Map([[0, 1]]), label: 0 },
      { vector: new Map([[0, 1]]), label: 1 }, // the same feature, both labels
      { vector: new Map([[1, 1]]), label: 1 },
      { vector: new Map([[1, 1]]), label: 1 },
    ];
    const model = fit(samples, { dimensions: 2, classes: 2, epochs: 200, learningRate: 0.5 });
    const ambiguous = predict(model, new Map([[0, 1]])).confidence;
    const clear = predict(model, new Map([[1, 1]])).confidence;
    expect(ambiguous).toBeLessThan(clear);
  });

  it('is reproducible from a seed', () => {
    const samples = [
      { vector: new Map([[0, 1]]), label: 0 },
      { vector: new Map([[1, 1]]), label: 1 },
      { vector: new Map([[0, 0.5], [1, 0.5]]), label: 0 },
    ];
    const a = fit(samples, { dimensions: 2, classes: 2, epochs: 30, seed: 5 });
    const b = fit(samples, { dimensions: 2, classes: 2, epochs: 30, seed: 5 });
    expect(a.losses).toEqual(b.losses);
  });
});

describe('training on a ledger', () => {
  it('excludes savings transfers, which would teach a circular rule', () => {
    const rows = trainingData(demo.transactions);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.some(r => r.category === 'savings')).toBe(false);
    expect(rows.some(r => r.merchant.startsWith('Savings →'))).toBe(false);
  });

  it('declines to train on too little history rather than memorising it', () => {
    expect(train([{ merchant: 'Metro', category: 'groceries' }])).toBeNull();
    expect(train(Array.from({ length: 30 }, () => ({ merchant: 'Metro', category: 'groceries' })))).toBeNull();
  });

  it('learns the merchants in the ledger', () => {
    const trained = train(demo.transactions);
    expect(trained.classes.length).toBeGreaterThan(2);
    expect(classify(trained, 'Tim Hortons').category).toBe('dining_out');
    expect(classify(trained, 'Metro').category).toBe('groceries');
    expect(classify(trained, 'Esso').category).toBe('transportation');
  });

  it('generalises to a descriptor it never saw in that exact form', () => {
    const trained = train(demo.transactions);
    // The ledger has "Tim Hortons"; a bank would write it like this.
    expect(classify(trained, 'TIM HORTONS #0482').category).toBe('dining_out');
    expect(classify(trained, 'METRO *ETOBICOKE').category).toBe('groceries');
  });

  it('says nothing rather than guessing at an unrecognisable descriptor', () => {
    const trained = train(demo.transactions);
    expect(classify(trained, 'zzzz')).toBeNull();
    expect(classify(trained, '')).toBeNull();
  });

  it('reports a confidence that separates sure answers from unsure ones', () => {
    const trained = train(demo.transactions);
    const known = classify(trained, 'Tim Hortons');
    expect(known.confidence).toBeGreaterThan(0.5);
    expect(known.confident).toBe(true);
    const total = Object.values(known.probabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe('metrics', () => {
  const classes = ['a', 'b'];
  const pairs = [
    { actual: 'a', predicted: 'a' }, { actual: 'a', predicted: 'b' },
    { actual: 'b', predicted: 'b' }, { actual: 'b', predicted: 'b' },
  ];

  it('computes precision, recall and F1 by hand-checkable values', () => {
    const s = scores(pairs, classes);
    expect(s.accuracy).toBe(0.75);
    const a = s.perClass.find(c => c.category === 'a');
    expect(a.precision).toBe(1);      // one predicted a, and it was right
    expect(a.recall).toBe(0.5);       // two actual a, one found
    expect(a.f1).toBeCloseTo(2 / 3, 6);
    const b = s.perClass.find(c => c.category === 'b');
    expect(b.precision).toBeCloseTo(2 / 3, 6);
    expect(b.recall).toBe(1);
  });

  it('builds a confusion matrix that sums to the sample', () => {
    const matrix = confusionMatrix(pairs, classes);
    expect(matrix).toEqual([[1, 1], [0, 2]]);
    expect(matrix.flat().reduce((a, b) => a + b, 0)).toBe(pairs.length);
  });

  it('splits folds by merchant, so no merchant appears on both sides', () => {
    const rows = trainingData(demo.transactions);
    const folds = merchantFolds(rows, 5, 1);
    const seen = new Map();
    folds.forEach((fold, index) => fold.forEach(group => {
      expect(seen.has(group.key)).toBe(false); // each merchant lands in one fold
      seen.set(group.key, index);
    }));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('measured against the keyword matcher', () => {
  const unseen = crossValidate(demo.transactions, { k: 5, seed: 1, splitBy: 'merchant', customCategories: demo.customCategories });
  const repeat = crossValidate(demo.transactions, { k: 5, seed: 1, splitBy: 'row', customCategories: demo.customCategories });

  it('evaluates on held-out data both ways', () => {
    expect(unseen).not.toBeNull();
    expect(repeat).not.toBeNull();
    expect(unseen.folds).toBe(5);
    expect(unseen.merchants).toBeGreaterThan(15);
  });

  // This is the result, not a bug to be tuned away. A curated keyword list is a
  // human prior over thousands of merchants; the model has a few dozen names
  // and no way to know that an unseen brand sells coffee. The honest reading is
  // that the model does not replace keywords, and the app does not ask it to.
  it('loses to keywords on merchants it has never seen', () => {
    expect(unseen.model.accuracy).toBeLessThan(unseen.baseline.accuracy);
  });

  it('matches keywords once a merchant has been seen before', () => {
    // The real case: another transaction arrives from a place already in the
    // ledger. Here memorisation is the point, not leakage.
    expect(repeat.model.accuracy).toBeGreaterThan(0.9);
    expect(repeat.model.accuracy).toBeGreaterThanOrEqual(repeat.baseline.accuracy - 0.02);
  });

  it('helps exactly where keywords give up, which is the reason to ship it', () => {
    // These demo merchants have no keyword rule, so the baseline scores zero on
    // them by construction. The sample is small — it travels with the number.
    expect(repeat.whereKeywordsGiveUp.n).toBeGreaterThan(0);
    expect(repeat.whereKeywordsGiveUp.baseline.accuracy).toBe(0);
    expect(repeat.whereKeywordsGiveUp.model.accuracy).toBeGreaterThan(0.5);
  });

  it('is honest about coverage — abstentions are scored, not dropped', () => {
    expect(unseen.model.n).toBe(unseen.baseline.n); // the same cases, both ways
    expect(unseen.coverage).toBeGreaterThan(0.5);
  });

  it('returns nothing when there is too little history to evaluate', () => {
    expect(crossValidate([])).toBeNull();
    expect(crossValidate(demo.transactions.slice(0, 5))).toBeNull();
  });
});
