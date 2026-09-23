// Multinomial logistic regression, trained by gradient descent.
//
// Chosen over a naive Bayes classifier for one reason that matters to the
// product: the probabilities are usable. Naive Bayes is fast and fine at
// picking a winner, but its independence assumption is badly violated by
// overlapping character n-grams, and its scores saturate at 0 and 1 — so
// "how sure are you?" can't be answered. Here a confidence threshold is
// meaningful, which is what lets the app categorise silently when it is
// confident and ask the model only when it isn't.
//
// Everything is sparse: a document touches a few dozen of several thousand
// features, so only those weights are read or updated.

const EPS = 1e-12;

/** Softmax over raw scores, shifted by the maximum for numerical stability. */
export function softmax(scores) {
  const max = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - max));
  const total = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map(e => e / total);
}

function scoreOne(weights, bias, vector, classes, dimensions) {
  const scores = new Array(classes).fill(0);
  for (let c = 0; c < classes; c += 1) {
    let sum = bias[c];
    const row = weights[c];
    vector.forEach((value, index) => {
      if (index < dimensions) sum += row[index] * value;
    });
    scores[c] = sum;
  }
  return scores;
}

/**
 * Fit weights by minimising cross-entropy with L2 regularisation.
 *
 * @param samples     [{ vector: Map(index → weight), label: number }]
 * @param dimensions  vocabulary size
 * @param classes     number of categories
 * @param epochs      passes over the data
 * @param learningRate step size
 * @param l2          regularisation strength — with a few hundred examples and
 *                    thousands of features this is doing real work, not decoration
 * @param seed        shuffling seed, so a fit is reproducible
 */
export function fit(samples, {
  dimensions, classes, epochs = 60, learningRate = 0.5, l2 = 1e-4, seed = 1,
} = {}) {
  const weights = Array.from({ length: classes }, () => new Float64Array(dimensions));
  const bias = new Float64Array(classes);
  if (!samples.length) return { weights, bias, dimensions, classes, losses: [] };

  // Deterministic shuffling: the same data must give the same model, or the
  // evaluation numbers move between runs for no reason.
  let rngState = seed >>> 0;
  const random = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  };

  const order = samples.map((_, i) => i);
  const losses = [];

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    let epochLoss = 0;
    order.forEach(index => {
      const { vector, label } = samples[index];
      const probabilities = softmax(scoreOne(weights, bias, vector, classes, dimensions));
      epochLoss -= Math.log(Math.max(probabilities[label], EPS));

      for (let c = 0; c < classes; c += 1) {
        const error = probabilities[c] - (c === label ? 1 : 0);
        if (error === 0) continue;
        const row = weights[c];
        const step = learningRate * error;
        vector.forEach((value, featureIndex) => {
          if (featureIndex < dimensions) {
            row[featureIndex] -= step * value + learningRate * l2 * row[featureIndex];
          }
        });
        bias[c] -= step;
      }
    });
    losses.push(epochLoss / samples.length);
  }

  return { weights, bias, dimensions, classes, losses };
}

/** Class probabilities for one vector. */
export function predictProba(model, vector) {
  return softmax(scoreOne(model.weights, model.bias, vector, model.classes, model.dimensions));
}

/** The most likely class, with its probability. */
export function predict(model, vector) {
  const probabilities = predictProba(model, vector);
  let best = 0;
  probabilities.forEach((p, i) => { if (p > probabilities[best]) best = i; });
  return { label: best, confidence: probabilities[best], probabilities };
}
