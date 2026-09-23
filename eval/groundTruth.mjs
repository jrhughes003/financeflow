// Ground truth for the Q&A eval.
//
// Deliberately computed here with plain filters rather than by calling
// aggregates.cjs: if the eval asked the same code that answers the model's tool
// calls, a bug in that code would grade itself correct. These are independent
// second-source numbers over the same deterministic demo data.

import generateDemoData from '../src/utils/demoData.js';

export const TODAY = new Date(2026, 8, 22); // 2026-09-22
export const state = generateDemoData(TODAY);

const round2 = n => Math.round(n * 100) / 100;

// Spending, the way the app defines it: no savings transfers, no flagged
// one-offs, net of money other people paid back.
function net(t) {
  const amount = Number(t.amount) || 0;
  if (!t.owed || !(Number(t.owed.amount) > 0)) return amount;
  const paid = (t.owed.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return round2(Math.max(0, amount - Math.min(paid, t.owed.amount)));
}

export function spend({ start, end, category, merchant } = {}) {
  const rows = state.transactions.filter(t =>
    t.kind !== 'savings'
    && !t.isException
    && (!start || t.date >= start)
    && (!end || t.date <= end)
    && (!category || t.category === category)
    && (!merchant || (t.merchant || '').toLowerCase().includes(merchant.toLowerCase())));
  return { total: round2(rows.reduce((s, t) => s + net(t), 0)), count: rows.length };
}

export function byCategory({ start, end }) {
  const out = {};
  state.transactions
    .filter(t => t.kind !== 'savings' && !t.isException && t.date >= start && t.date <= end)
    .forEach(t => { out[t.category] = round2((out[t.category] || 0) + net(t)); });
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

// "This summer" — June through August, the reading a person means.
export const SUMMER = { start: '2026-06-01', end: '2026-08-31' };
export const JUL_SEP = { start: '2026-07-01', end: '2026-09-30' };
export const MAY_JUN = { start: '2026-05-01', end: '2026-06-30' };
export const YTD = { start: '2026-01-01', end: '2026-09-22' };

// `vite-node eval/groundTruth.mjs --report` prints the reference figures.
if (process.argv.includes('--report')) {
  const summer = spend(SUMMER);
  const dining = spend({ ...SUMMER, category: 'dining_out' });
  const julSep = spend(JUL_SEP);
  const mayJun = spend(MAY_JUN);

  console.log('ledger range      ', state.transactions[0].date, '→', state.transactions.at(-1).date);
  console.log('summer total      ', summer.total, `(${summer.count} txns)`);
  console.log('summer dining     ', dining.total, `→ ${round2((dining.total / summer.total) * 100)}% of summer spending`);
  console.log('mcdonalds (any)   ', JSON.stringify(spend({ merchant: 'mcdonald' })));
  console.log('tim hortons summer', JSON.stringify(spend({ ...SUMMER, merchant: 'tim hortons' })));
  console.log('jul-sep           ', julSep.total, `(${julSep.count})  per-month ${round2(julSep.total / 3)}`);
  console.log('may-jun           ', mayJun.total, `(${mayJun.count})  per-month ${round2(mayJun.total / 2)}`);
  console.log('ytd by category   ', JSON.stringify(byCategory(YTD), null, 1));
  console.log('sept by category  ', JSON.stringify(byCategory({ start: '2026-09-01', end: '2026-09-30' }), null, 1));
  console.log('budgets           ', JSON.stringify(state.budgets.map(b => [b.category, b.amount])));
}
