# AI features, the Q&A eval, and the local classifier

The AI features are desktop only, opt-in, and off by default. To enable them, enter your
own Anthropic API key in **Settings** and turn on the toggle. What each feature may send
is in [PRIVACY.md](PRIVACY.md).

## The features

1. **Categorization.** It tries three sources, cheapest first (see
   [below](#the-local-classifier-measured-against-keywords)): keyword rules, then a
   classifier trained locally on your ledger, then the model.
2. **Natural-language entry.** "spent $40 on gas at Esso yesterday" fills in the
   transaction form.
3. **Insights.** A short monthly narrative built on the app's *own* analysis: change
   against your baseline, month-end projection, quantified savings opportunities, goal
   pacing and debt payoff. The model interprets the figures rather than calculating them.
4. **Q&A.** Ask a question about your finances. The model answers by calling local
   aggregate tools, and each answer shows which lookups it used.
5. **Receipt and statement parsing.** Paste messy text and get structured transactions
   back.

How they are built:
- **Models:** routine calls use Sonnet, and insights use Opus. Structured outputs use
  forced tool use, and system prompts are marked cacheable.
- **Fallback:** every feature degrades gracefully when AI is off, no key is set, or the
  request fails. The rest of the app does not depend on them.

**No key is needed to develop against them.** `npm run electron:dev:mock` points the SDK at
a local stand-in for the API ([`electron/ai/mockServer.cjs`](../electron/ai/mockServer.cjs)).
It answers from the real request, and can return a 401, a 429, a malformed body or an
invalid category on demand, so the failure paths get exercised, not only the happy one. See
[DEVELOPMENT.md](../DEVELOPMENT.md#testing-the-ai-features-without-an-api-key).

## Measuring the Q&A

An assistant that answers questions about your money has one failure that matters more than
the rest: a confident figure that is wrong. So the eval in [`eval/`](../eval/) scores two
things and deliberately does not average them.

| Metric | What it asks |
|---|---|
| **trust** | Did every monetary figure in the answer come from a number a tool actually returned, or a simple ratio or difference of two? |
| **correct** | When there was a right figure, did the answer contain it? |

How the two scores interact:
- An answer that says "I can't see that from here" scores trust 1, correct 0: unhelpful
  but safe.
- A confident wrong number scores trust 0. That is the outcome that ends someone's trust
  in the feature.
- Averaging the two would let the second hide behind the first.

**The grader is programmatic, not an LLM judge** ([`eval/grader.mjs`](../eval/grader.mjs)).
- Every tool result is captured during the run, so "was this number sourced?" is a
  decidable question. Each figure in the answer is checked against the numbers the tools
  returned.
- The tolerance is 2% or $1, with an allowance for tidy rounding.

**The cases** ([`eval/cases.mjs`](../eval/cases.mjs)):
- There are 25. Six are marked `seed`: questions I actually asked the app, typos included.
- Four carry `noFigure`. They have no honest answer, so stating a figure at all is a trust
  failure.
- Expected figures are computed at run time from the demo ledger by
  [`eval/groundTruth.mjs`](../eval/groundTruth.mjs). It uses plain filters rather than the
  app's own tools, so a bug in the tools cannot grade itself correct.

**It drives the shipped code path:** the same `runFeature('query', …)` and the same
`aggregates.cjs` tools that the desktop app uses.

```bash
npm run ai:mock                                # terminal 1: the local API stand-in
npx vite-node eval/run.mjs -- --mock --limit 3 # terminal 2: free smoke run
npx vite-node eval/run.mjs                     # the real thing; needs an API key
npx vite-node eval/listCases.mjs               # list the cases and their expected figures
```

The mock run exercises the whole harness for free, but its scores are meaningless, because
the stand-in returns canned text. **Scores from a real run are not published yet.** When
they are, they will be reported as two separate numbers.

## The local classifier, measured against keywords

Keywords handle merchants someone wrote a rule for. A **logistic-regression classifier
trained on your own ledger** ([`src/utils/ml/`](../src/utils/ml/)) handles the ones it has
seen before but no keyword list contains, such as the corner shop or the gym. It runs
locally, costs nothing and needs no API key. Its probabilities give a confidence threshold
(0.6) for when to answer and when to defer. Only when neither source has an answer is a
network call worth making.

**The order is set by measurement.** The measurement is 5-fold cross-validation on the demo
ledger (249 labelled rows, 32 merchants) in
[`src/utils/ml/evaluate.ts`](../src/utils/ml/evaluate.ts). It scores two different
questions:
- Can it categorise a merchant it has never seen? The folds are split by merchant.
- Can it categorise a merchant already in the ledger? The folds are split by row.

When the classifier abstains, its answer falls back to the keyword answer, and abstentions
are scored, not dropped.

| Question | Keywords: accuracy (macro-F1) | Classifier: accuracy (macro-F1) |
|---|---|---|
| A merchant never seen before | **91.2%** (0.81) | 42.6% (0.43) |
| A merchant already in the ledger | 91.2% (0.81) | **96.0%** (0.74) |

How to read it:
- **On unseen merchants, keywords win clearly.** A curated keyword list is a human prior
  over many merchants, while the classifier has a few dozen names and no way to know that
  an unseen brand sells coffee. So the classifier never overrides a keyword match. It
  speaks only where keywords fall back to the catch-all category.
- **On merchants already in the ledger, the classifier has higher accuracy.** But its
  macro-F1 is lower, so it does worse than keywords on the small categories.
- **The demo ledger flatters keywords**, because its merchants were drawn from the keyword
  lists in the first place.
- **The gap the classifier fills has shrunk.** An earlier version of this README reported
  75% accuracy (n = 8) on merchants keywords have no rule for. Expanding the keyword table
  to about 400 keywords and 18 categories left only 2 such rows in the demo ledger, which is
  too few to report an accuracy on. The claim was withdrawn
  ([`classifier.test.ts`](../src/utils/ml/classifier.test.ts)).

These figures come from `crossValidate(…, { k: 5, seed: 1 })` on the demo ledger generated
for 2026-09-22, the same fixture the tests use.
