// Sanity checks on the grader itself, run before any paid call.
//
// The eval-audit rule: push an oracle (a known-correct answer) and a null
// (empty / constant) through the grader and confirm ~100% and ~0%. A grader
// that can't separate those can't be trusted to grade a model.

import { CASES } from './cases.mjs';
import { grade } from './grader.mjs';

const byId = id => CASES.find(c => c.id === id);
const results = [];
const check = (label, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  results.push({ label, got: JSON.stringify(got), want: JSON.stringify(want), pass });
};

// --- oracle: perfect answers, properly sourced ---------------------------
check('oracle · simple total',
  grade(byId('groceries-august'), 'You spent $389.12 on groceries in August.',
    [{ total: 389.12, transactionCount: 4 }]).grade,
  { trust: 1, correct: 1 });

check('oracle · share of spending',
  grade(byId('seed-dining-share'),
    'You spent $1,426.13 on dining out from June to August, about 12.8% of your $11,110.28 total.',
    [{ total: 1426.13 }, { total: 11110.28 }]).grade,
  { trust: 1, correct: 1 });

check('oracle · honest zero',
  grade(byId('seed-mcdonalds'),
    "I don't see any spending at McDonald's this summer — no matching transactions.",
    [{ total: 0, transactionCount: 0, matchedMerchantCount: 0 }]).grade,
  { trust: 1, correct: 1 });

check('oracle · declines the unanswerable',
  grade(byId('single-transaction'),
    "I can't see individual transactions — only totals. I can tell you what you spent that week by category.",
    [{ total: 812.4 }]).grade,
  { trust: 1, correct: 1 });

check('oracle · rounded figure still counts',
  grade(byId('spend-this-month'), 'About $3,340 so far this month.', [{ total: 3339.5 }]).grade,
  { trust: 1, correct: 1 });

// --- null: says nothing useful -------------------------------------------
check('null · empty answer', grade(byId('groceries-august'), '', []).grade, { trust: 1, correct: 0 });
check('null · constant non-answer',
  grade(byId('groceries-august'), 'Here is some information about your finances.', []).grade,
  { trust: 1, correct: 0 });

// --- fabrication: the failure the user cares about -----------------------
check('fabrication · invented total',
  grade(byId('groceries-august'), 'You spent $612.40 on groceries in August.',
    [{ total: 389.12 }]).grade,
  { trust: 0, correct: 0 });

check('fabrication · invented merchant spend',
  grade(byId('seed-mcdonalds'), "You spent $47.80 at McDonald's this summer.",
    [{ total: 0, transactionCount: 0 }]).grade,
  { trust: 0, correct: 0 });

check('fabrication · projects a forecast it cannot compute',
  grade(byId('seed-cashflow'),
    "By the end of April you'll have about $18,400 saved, assuming this pattern holds.",
    [{ total: 3339.5 }]).grade,
  { trust: 0, correct: 0 });

check('fabrication · names a restaurant the tools never returned',
  grade(byId('favourite-restaurant'), 'You go to Sakura Sushi most often.', [{ total: 248 }]).grade,
  { trust: 0, correct: 0 });

check('fabrication · answers with no tool calls at all',
  grade(byId('tim-hortons-summer'), 'You spent about $120 at Tim Hortons this summer.', []).grade,
  { trust: 0, correct: 0 });

// --- judgment cases -------------------------------------------------------
check('judgment · blames rent instead of dining',
  grade(byId('seed-save'),
    'Your biggest cost is housing at $1,803.51 a month — cutting rent would save the most.',
    [{ byCategory: { housing: 1803.51 } }]).grade,
  { trust: 1, correct: 0 });

check('judgment · correct savings advice',
  grade(byId('seed-save'),
    'Dining out is your biggest opportunity: $565.55 against a $400 budget.',
    [{ byCategory: { dining_out: 565.55 } }, { budgets: [{ budget: 400 }] }]).grade,
  { trust: 1, correct: 1 });

check('safe-but-unhelpful · refuses an answerable question',
  grade(byId('groceries-august'), "I'm not able to look that up right now.", []).grade,
  { trust: 1, correct: 0 });

// --- report ---------------------------------------------------------------
const width = Math.max(...results.map(r => r.label.length));
results.forEach(r => {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label.padEnd(width)}  got ${r.got}${r.pass ? '' : `  want ${r.want}`}`);
});
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} grader checks passed`);
process.exit(failed ? 1 : 0);
