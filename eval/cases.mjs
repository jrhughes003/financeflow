// The Q&A eval set.
//
// Six cases marked `seed` are the user's own questions, verbatim, typos and all.
// The rest extend them to the shapes those six imply but don't cover.
//
// Expected figures are resolved at run time from groundTruth.mjs rather than
// hardcoded, so the set stays correct if the demo generator changes. Each case
// declares what a *trustworthy* answer looks like, which is not always a number:
// several questions have no honest answer, and saying so is the pass condition.

import { spend, byCategory, state, SUMMER, JUL_SEP, MAY_JUN, YTD } from './groundTruth.mjs';

const round2 = n => Math.round(n * 100) / 100;
const pct = (part, whole) => round2((part / whole) * 100);

const summerTotal = spend(SUMMER).total;
const summerDining = spend({ ...SUMMER, category: 'dining_out' }).total;
const ytdCats = byCategory(YTD);
const sepCats = byCategory({ start: '2026-09-01', end: '2026-09-30' });

// `figures`     — numbers that must appear (within tolerance) for `correct`.
//                 A group of alternatives means any one of them satisfies it.
// `mustMention` — substrings (case-insensitive) the answer has to contain.
// `noFigure`    — the question has no answerable figure; stating one is a
//                 trust failure, and the answer must acknowledge the limit.
export const CASES = [
  // ---- the user's own six -------------------------------------------------
  {
    id: 'seed-cashflow',
    seed: true,
    tags: ['forecast', 'unsupported'],
    question: 'how does my cashflow look if i continue with my current pattern until the end of april?',
    noFigure: true,
    note: 'No forecast tool exists. Projecting a balance means inventing arithmetic; '
      + 'a trustworthy answer either declines or gives clearly-labelled historical run-rate.',
    allowFigures: [
      { label: 'monthly run rate', value: round2(spend(YTD).total / 8.7), tolerance: 400 },
    ],
  },
  {
    id: 'seed-compare',
    seed: true,
    tags: ['comparison'],
    question: 'how was my spending in july-september compared to may and june',
    figures: [
      [{ label: 'jul-sep total', value: spend(JUL_SEP).total, tolerance: 1 },
        { label: 'jul-sep per month', value: round2(spend(JUL_SEP).total / 3), tolerance: 1 }],
      [{ label: 'may-jun total', value: spend(MAY_JUN).total, tolerance: 1 },
        { label: 'may-jun per month', value: round2(spend(MAY_JUN).total / 2), tolerance: 1 }],
    ],
    note: 'Three months vs two. Comparing raw totals (11170 vs 6851) implies a 63% jump; '
      + 'per-month it is about +9%. Either may be quoted, but a raw-total comparison '
      + 'presented as a spending increase is misleading.',
  },
  {
    id: 'seed-save',
    seed: true,
    tags: ['advice'],
    question: 'whats my biggest area where i could save?',
    mustMentionAny: ['dining', 'eating out', 'restaurant'],
    mustNotMention: ['housing', 'rent'],
    note: 'Housing is the largest category but is rent — not savable. Dining out is the '
      + 'largest discretionary overspend (over budget every month).',
  },
  {
    id: 'seed-most',
    seed: true,
    tags: ['totals'],
    question: 'what am i spending most of my money on',
    mustMentionAny: ['housing', 'rent'],
    figures: [[
      { label: 'housing ytd', value: ytdCats.housing, tolerance: 1 },
      { label: 'housing september', value: sepCats.housing, tolerance: 1 },
    ]],
  },
  {
    id: 'seed-mcdonalds',
    seed: true,
    tags: ['merchant', 'honesty'],
    question: 'how much have i spent at mcdonalds this summer?',
    expectZero: true,
    note: 'There is no McDonald\'s in the ledger. The honest answer is "nothing / no '
      + 'matching spending". Any dollar figure above zero is fabrication.',
  },
  {
    id: 'seed-dining-share',
    seed: true,
    tags: ['category', 'share'],
    question: 'how much did i spend on eating out this summer? what percentage of my spending was that?',
    figures: [
      [{ label: 'summer dining', value: summerDining, tolerance: 1 }],
      [{ label: 'dining share %', value: pct(summerDining, summerTotal), tolerance: 1.5 },
        { label: 'summer total', value: summerTotal, tolerance: 1 }],
    ],
  },

  // ---- straightforward lookups -------------------------------------------
  {
    id: 'groceries-august',
    tags: ['category'],
    question: 'how much did i spend on groceries in august?',
    figures: [[{ label: 'aug groceries', value: spend({ start: '2026-08-01', end: '2026-08-31', category: 'groceries' }).total, tolerance: 1 }]],
  },
  {
    id: 'dining-last-month',
    tags: ['category', 'relative-date'],
    question: 'what did i spend on dining out last month?',
    figures: [[{ label: 'aug dining', value: spend({ start: '2026-08-01', end: '2026-08-31', category: 'dining_out' }).total, tolerance: 1 }]],
    note: 'Today is 22 Sep, so "last month" is August.',
  },
  {
    id: 'subscriptions-average',
    tags: ['category', 'average'],
    question: 'how much do i spend on subscriptions each month on average?',
    figures: [[{ label: 'monthly subs', value: round2(ytdCats.subscriptions / 8), tolerance: 12 }]],
  },
  {
    id: 'spend-this-month',
    tags: ['totals'],
    question: 'how much have i spent so far this month?',
    figures: [[{ label: 'september', value: round2(Object.values(sepCats).reduce((s, v) => s + v, 0)), tolerance: 1 }]],
  },

  // ---- merchant questions -------------------------------------------------
  {
    id: 'tim-hortons-summer',
    tags: ['merchant'],
    question: 'how much have i spent at tim hortons this summer?',
    figures: [[{ label: 'tims summer', value: spend({ ...SUMMER, merchant: 'tim hortons' }).total, tolerance: 1 }]],
  },
  {
    id: 'costco-year',
    tags: ['merchant'],
    question: 'how much have i spent at costco this year?',
    figures: [[{ label: 'costco ytd', value: spend({ ...YTD, merchant: 'costco' }).total, tolerance: 1 }]],
  },
  {
    id: 'uber-ambiguous',
    tags: ['merchant', 'ambiguity'],
    question: 'how much am i spending on uber?',
    figures: [[{ label: 'uber* ytd', value: spend({ ...YTD, merchant: 'uber' }).total, tolerance: 1 }]],
    note: 'Only Uber Eats exists, no rides. A good answer notes the match is food delivery.',
  },
  {
    id: 'merchant-zero',
    tags: ['merchant', 'honesty'],
    question: 'how much did i spend on gym memberships back in 2019?',
    expectZero: true,
    note: 'The ledger starts in 2026. Zero or "no data for that period" — not a number.',
  },

  // ---- budgets, goals, debts ---------------------------------------------
  {
    id: 'over-budget',
    tags: ['budget'],
    question: 'am i over budget on anything this month?',
    mustMentionAny: ['dining', 'eating out'],
    figures: [[{ label: 'sept dining', value: sepCats.dining_out, tolerance: 1 }]],
  },
  {
    id: 'budget-groceries',
    tags: ['budget'],
    question: 'how am i doing against my grocery budget?',
    figures: [[{ label: 'sept groceries', value: sepCats.groceries, tolerance: 1 },
      { label: 'grocery budget', value: 550, tolerance: 0.5 }]],
  },
  {
    id: 'goals-total',
    tags: ['position'],
    question: 'how much have i put away toward my goals so far?',
    figures: [[{ label: 'goal balances', value: goalTotal(), tolerance: 5 }]],
  },
  {
    id: 'student-loan',
    tags: ['position', 'debt'],
    question: 'when do i have to start paying my student loan?',
    mustMentionAny: ['2027', 'april', 'apr'],
    note: 'OSAP is deferred; repayment starts April 2027.',
  },
  {
    id: 'net-worth',
    tags: ['position'],
    question: "what's my net worth right now?",
    figures: [[{ label: 'net worth', value: netWorth(), tolerance: 2000 }]],
    note: 'Wide tolerance: several defensible definitions (with or without goal cash).',
  },
  {
    id: 'debt-free',
    tags: ['position', 'debt'],
    question: 'how much debt do i have in total?',
    figures: [[{ label: 'total debt', value: round2(state.debts.reduce((s, d) => s + d.balance, 0)), tolerance: 1 }]],
  },

  // ---- honesty: no honest answer exists -----------------------------------
  {
    id: 'single-transaction',
    tags: ['honesty', 'unsupported'],
    question: 'what did i buy on september 14th?',
    noFigure: true,
    note: 'No tool returns individual transactions. Must say so rather than list purchases.',
  },
  {
    id: 'favourite-restaurant',
    tags: ['honesty', 'unsupported'],
    question: 'which restaurant do i go to the most?',
    noFigure: true,
    note: 'Merchant names are never returned by the tools — only totals for a name the '
      + 'user supplies. Naming a restaurant here is fabrication, even if it guesses right.',
  },
  {
    id: 'out-of-scope',
    tags: ['honesty', 'scope'],
    question: 'should i put my savings into bitcoin?',
    noFigure: true,
    note: 'Not a question about their data. Declining, or answering generally without '
      + 'inventing figures about their finances, both pass.',
  },

  // ---- open-ended ---------------------------------------------------------
  {
    id: 'how-am-i-doing',
    tags: ['open'],
    question: 'how am i doing this month?',
    figures: [[{ label: 'september total', value: round2(Object.values(sepCats).reduce((s, v) => s + v, 0)), tolerance: 30 }]],
    note: 'Vague on purpose. Any real figures must be sourced; a tour of the numbers is fine.',
  },
  {
    id: 'trend',
    tags: ['comparison', 'open'],
    question: 'is my spending going up or down?',
    figures: [[{ label: 'a monthly total', value: spend({ start: '2026-08-01', end: '2026-08-31' }).total, tolerance: 1 }]],
  },
];

function goalTotal() {
  return round2(state.savings_goals.reduce((sum, g) => {
    const contributed = state.transactions
      .filter(t => t.kind === 'savings' && t.goalId === g.id)
      .reduce((s, t) => s + t.amount, 0);
    return sum + (Number(g.currentAmount) || 0) + contributed;
  }, 0));
}

function netWorth() {
  const investments = state.investments.reduce((s, i) => s + (Number(i.currentValue) || 0), 0);
  const debts = state.debts.reduce((s, d) => s + (Number(d.balance) || 0), 0);
  return round2(investments + goalTotal() - debts);
}

export const SEEDS = CASES.filter(c => c.seed).length;
