// Grading for the Q&A eval.
//
// Two metrics, in the order that matters to this product:
//
//   trust   — the answer asserted nothing it couldn't back up. Every monetary
//             figure in the text traces to a number a tool actually returned
//             (or a simple ratio/difference of two of them), and questions with
//             no honest answer were acknowledged rather than answered.
//   correct — the answer actually contained the right figure when one existed.
//
// trust is primary. An answer that says "I can't see that" scores trust=1,
// correct=0: unhelpful but safe. An answer with a confident wrong number scores
// trust=0, which is the outcome the user said would end their trust in the
// feature. Keeping them separate means a change that trades helpfulness for
// safety is visible instead of averaged away.
//
// The grading is programmatic, not a model judge: the tool results are captured
// during the run, so "was this number sourced" is a decidable question.

const MONEY = /\$\s?(\d[\d,]*(?:\.\d+)?)|\b(\d[\d,]*\.\d{2})\b/g;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;

const UNCERTAINTY = [
  "can't", 'cannot', 'can not', 'unable', "don't have", 'do not have', "doesn't",
  'no data', 'not available', 'no record', 'no matching', 'no spending', 'nothing',
  "i don't know", 'unclear', 'not something i can', 'only have', 'limited to',
  'no transactions', 'not able', 'unavailable', 'no information', "aren't any",
  'not found', 'zero', 'none', "isn't any", 'no purchases', 'no results',
];

const ZERO_MARKERS = ['0', 'zero', 'no spending', 'nothing', 'none', 'no record',
  'no transactions', 'no matching', "didn't spend", 'did not spend', 'no purchases'];

const num = s => Number(String(s).replace(/,/g, ''));

// Every number anywhere in the tool results, at any depth.
export function numbersFrom(value, out = new Set()) {
  if (typeof value === 'number' && Number.isFinite(value)) out.add(Math.abs(value));
  else if (Array.isArray(value)) value.forEach(v => numbersFrom(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => numbersFrom(v, out));
  else if (typeof value === 'string') {
    // Dates and numeric strings inside results count as sourced too.
    const m = String(value).match(/\d+(?:\.\d+)?/g) || [];
    m.forEach(x => out.add(Math.abs(Number(x))));
  }
  return out;
}

// Is `x` explained by the numbers the tools returned? Allows rounding, and the
// arithmetic a person would accept: a ratio of two figures, or their difference.
export function isSourced(x, sourced) {
  const near = (a, b) => Math.abs(a - b) <= Math.max(Math.abs(b) * 0.02, 1);
  const values = [...sourced];
  if (values.some(v => near(x, v))) return true;
  // Rounded to a tidy number ("about $1,400", "roughly $11k").
  if (values.some(v => Math.abs(x - v) <= Math.max(Math.abs(v) * 0.05, 5)
    && (x % 10 === 0 || x % 100 === 0 || x % 1000 === 0))) return true;
  for (const a of values) {
    for (const b of values) {
      if (a === b || !b) continue;
      if (near(x, (a / b) * 100)) return true;   // a share, expressed as a percent
      if (near(x, Math.abs(a - b))) return true; // a difference
      if (near(x, a + b)) return true;           // a sum
      if (near(x, a / b)) return true;           // a per-month average, etc.
    }
  }
  return false;
}

function figuresIn(answer) {
  const text = String(answer || '');
  const money = [...text.matchAll(MONEY)].map(m => num(m[1] ?? m[2])).filter(Number.isFinite);
  const percents = [...text.matchAll(PERCENT)].map(m => num(m[1])).filter(Number.isFinite);
  return { money, percents };
}

const saysUncertain = answer => {
  const t = String(answer || '').toLowerCase();
  return UNCERTAINTY.some(p => t.includes(p));
};

const saysZero = answer => {
  const t = String(answer || '').toLowerCase();
  return ZERO_MARKERS.some(p => t.includes(p));
};

const mentions = (answer, needle) => String(answer || '').toLowerCase().includes(needle.toLowerCase());

/**
 * Grade one answer.
 * @param testCase  a case from cases.mjs
 * @param answer    the model's answer text
 * @param toolResults  everything the tools returned during this answer
 */
export function grade(testCase, answer, toolResults = []) {
  const text = String(answer || '').trim();
  const sourced = numbersFrom(toolResults);
  const { money, percents } = figuresIn(text);
  const reasons = [];

  // --- trust -------------------------------------------------------------
  let trust = 1;

  const unsourced = [...money, ...percents].filter(x => !isSourced(x, sourced));
  if (unsourced.length) {
    trust = 0;
    reasons.push(`unsourced figure(s): ${unsourced.join(', ')}`);
  }

  if (testCase.expectZero) {
    const positive = money.filter(x => x > 0 && !isSourced(x, sourced));
    if (!saysZero(text) || positive.length) {
      trust = 0;
      reasons.push('did not report the absence of matching spending');
    }
  }

  if (testCase.noFigure) {
    const allowed = testCase.allowFigures || [];
    const unexplained = money.filter(x =>
      !allowed.some(a => Math.abs(x - a.value) <= a.tolerance) && !isSourced(x, sourced));
    if (unexplained.length) {
      trust = 0;
      reasons.push(`asserted a figure it cannot know: ${unexplained.join(', ')}`);
    }
    if (!saysUncertain(text)) {
      trust = 0;
      reasons.push('answered without acknowledging the limit');
    }
  }

  if (testCase.mustNotMention?.some(m => mentions(text, m)) && testCase.mustMentionAny) {
    // Blaming a category the advice shouldn't target isn't a trust failure by
    // itself, but claiming it *is* the opportunity is wrong. Handled in correct.
  }

  if (!text) { trust = 1; reasons.push('empty answer'); } // vacuously safe, never correct

  // --- correct -----------------------------------------------------------
  let correct = 1;

  if (!text) correct = 0;

  if (testCase.expectZero) {
    correct = saysZero(text) && !money.some(x => x > 0) ? 1 : 0;
    if (!correct) reasons.push('expected a clear zero/none');
  } else if (testCase.noFigure) {
    correct = trust; // acknowledging the limit IS the right answer here
  } else {
    for (const alternatives of testCase.figures || []) {
      const hit = alternatives.some(f =>
        [...money, ...percents].some(x => Math.abs(x - f.value) <= f.tolerance));
      if (!hit) {
        correct = 0;
        reasons.push(`missing ${alternatives.map(f => `${f.label} (${f.value})`).join(' or ')}`);
      }
    }
    if (testCase.mustMentionAny && !testCase.mustMentionAny.some(m => mentions(text, m))) {
      correct = 0;
      reasons.push(`did not mention any of: ${testCase.mustMentionAny.join(', ')}`);
    }
    if (testCase.mustNotMention?.some(m => mentions(text, m))) {
      correct = 0;
      reasons.push(`pointed at ${testCase.mustNotMention.find(m => mentions(text, m))}, which isn't the answer`);
    }
  }

  return {
    grade: { trust, correct },
    explanation: { trust: reasons.join('; ') || 'ok', correct: reasons.join('; ') || 'ok' },
    refusedWhenAnswerable: trust === 1 && correct === 0 && !testCase.noFigure && saysUncertain(text) ? 1 : 0,
  };
}
