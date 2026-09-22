// The tools the Q&A model is allowed to call, and the code that answers them.
//
// This inverts how Q&A used to work. Before, the app shipped one fixed summary
// blob with every question, whether or not the question needed it. Now only the
// question itself leaves the device, and the model has to *ask* for each figure
// — and this file decides what an answer may contain.
//
// The rules every executor here obeys:
//   • it returns aggregates — sums, counts, averages — never a transaction;
//   • it never returns a merchant the user did not name themselves (a merchant
//     search reports how many merchants matched, not which);
//   • it never returns ids, notes or tags.
// So the model can reason over the ledger without the ledger ever being sent.
//
// Runs in the Electron main process over the state loaded from SQLite. Kept free
// of Electron and DB imports so it is directly testable.

const EXCLUDED_FROM_SPENDING = t => t.kind === 'savings' || t.isException;

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Mirrors src/utils/reimbursements.js: a fronted purchase costs the charged
// amount minus whatever has actually been paid back, attributed to the original
// month. Parity with the renderer's implementation is covered by tests.
function effectiveAmount(t) {
  const amount = Number(t.amount) || 0;
  const owed = t.owed;
  if (!owed || !(Number(owed.amount) > 0)) return amount;
  const paid = (owed.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const repaid = Math.min(paid, Number(owed.amount) || 0);
  if (repaid <= 0) return amount;
  return round2(Math.max(0, amount - repaid));
}

function spendingRows(transactions, { start, end, category } = {}) {
  return (transactions || [])
    .filter(t => !EXCLUDED_FROM_SPENDING(t))
    .filter(t => (!start || t.date >= start) && (!end || t.date <= end))
    .filter(t => (!category || t.category === category));
}

const monthKey = date => (date || '').slice(0, 7);

// --- tool definitions (what the model sees) ---------------------------------

const TOOLS = [
  {
    name: 'get_spending',
    description:
      'Total spending over a date range, optionally broken down. Excludes savings '
      + 'transfers and transactions flagged as one-off exceptions, and is net of '
      + 'money other people have paid back. Use this for "how much did I spend on X".',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Start date, inclusive, YYYY-MM-DD' },
        end: { type: 'string', description: 'End date, inclusive, YYYY-MM-DD' },
        group_by: { type: 'string', enum: ['total', 'category', 'month'], description: 'Default total' },
        category: { type: 'string', description: 'Optional category id to restrict to' },
      },
      required: ['start', 'end'],
    },
  },
  {
    name: 'get_merchant_spending',
    description:
      'Total spent at merchants whose name contains the given text, e.g. "tim hortons". '
      + 'Returns totals and counts only — never a list of merchant names. Use this when '
      + 'the user names a specific place.',
    input_schema: {
      type: 'object',
      properties: {
        merchant: { type: 'string', description: 'Merchant name or fragment, as the user said it' },
        start: { type: 'string', description: 'Optional start date, YYYY-MM-DD' },
        end: { type: 'string', description: 'Optional end date, YYYY-MM-DD' },
      },
      required: ['merchant'],
    },
  },
  {
    name: 'get_budget_status',
    description: 'Budgets versus actual spending for one month, per category.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'number', description: '0-11, where 0 is January' },
        year: { type: 'number' },
      },
      required: ['month', 'year'],
    },
  },
  {
    name: 'get_financial_position',
    description:
      'Current standing: monthly income, savings goals, debts, investments and net worth. '
      + 'Use for questions about goals, debts, or whether something is affordable.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

// --- executors --------------------------------------------------------------

function getSpending(state, { start, end, group_by = 'total', category }) {
  const rows = spendingRows(state.transactions, { start, end, category });
  const total = round2(rows.reduce((s, t) => s + effectiveAmount(t), 0));

  if (group_by === 'category') {
    const byCategory = {};
    rows.forEach(t => { byCategory[t.category] = round2((byCategory[t.category] || 0) + effectiveAmount(t)); });
    return { start, end, total, transactionCount: rows.length, byCategory };
  }

  if (group_by === 'month') {
    const byMonth = {};
    rows.forEach(t => { byMonth[monthKey(t.date)] = round2((byMonth[monthKey(t.date)] || 0) + effectiveAmount(t)); });
    const months = Object.keys(byMonth).length;
    return {
      start, end, total, transactionCount: rows.length, byMonth,
      averagePerMonth: months ? round2(total / months) : 0,
    };
  }

  return {
    start, end, total, transactionCount: rows.length,
    ...(category ? { category } : {}),
    averagePerTransaction: rows.length ? round2(total / rows.length) : 0,
  };
}

function getMerchantSpending(state, { merchant, start, end }) {
  const needle = String(merchant || '').trim().toLowerCase();
  if (!needle) return { error: 'merchant is required' };

  const rows = spendingRows(state.transactions, { start, end })
    .filter(t => (t.merchant || '').toLowerCase().includes(needle));

  const total = round2(rows.reduce((s, t) => s + effectiveAmount(t), 0));
  const byMonth = {};
  rows.forEach(t => { byMonth[monthKey(t.date)] = round2((byMonth[monthKey(t.date)] || 0) + effectiveAmount(t)); });
  // How many distinct merchants matched, not which — the model learns only about
  // the name the user supplied.
  const distinctMatches = new Set(rows.map(t => (t.merchant || '').toLowerCase())).size;
  const categories = [...new Set(rows.map(t => t.category))];

  return {
    query: merchant,
    matchedMerchantCount: distinctMatches,
    total,
    transactionCount: rows.length,
    averagePerTransaction: rows.length ? round2(total / rows.length) : 0,
    categories,
    byMonth,
    ...(rows.length ? {} : { note: 'No spending matched that name in the period.' }),
  };
}

function getBudgetStatus(state, { month, year }) {
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const end = `${year}-${String(month + 1).padStart(2, '0')}-31`;
  const rows = spendingRows(state.transactions, { start, end });

  const spent = {};
  rows.forEach(t => { spent[t.category] = round2((spent[t.category] || 0) + effectiveAmount(t)); });

  const budgets = (state.budgets || []).map(b => {
    const actual = spent[b.category] || 0;
    const limit = Number(b.amount) || 0;
    return {
      category: b.category,
      budget: limit,
      actual,
      remaining: round2(limit - actual),
      percentUsed: limit > 0 ? Math.round((actual / limit) * 100) : null,
      over: actual > limit,
    };
  });

  const uncategorized = Object.keys(spent).filter(c => !budgets.some(b => b.category === c));
  return {
    month, year,
    totalSpent: round2(Object.values(spent).reduce((s, v) => s + v, 0)),
    budgets,
    spendingWithoutABudget: uncategorized.map(c => ({ category: c, actual: spent[c] })),
  };
}

const MONTHLY_FACTOR = {
  weekly: 52 / 12, biweekly: 26 / 12, 'semi-monthly': 2, monthly: 1, annual: 1 / 12,
};

function getFinancialPosition(state) {
  const incomes = state.incomes || [];
  const monthlyIncome = round2(incomes.reduce(
    (s, i) => s + (Number(i.amount) || 0) * (MONTHLY_FACTOR[i.frequency] ?? 1), 0,
  ));

  const goals = (state.savings_goals || []).map(g => {
    const contributed = (state.transactions || [])
      .filter(t => t.kind === 'savings' && t.goalId === g.id)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const current = round2((Number(g.currentAmount) || 0) + contributed);
    const target = Number(g.targetAmount) || 0;
    return {
      name: g.name,
      target,
      current,
      remaining: round2(Math.max(0, target - current)),
      percentComplete: target > 0 ? Math.round((current / target) * 100) : 0,
      monthlyContribution: Number(g.monthlyContribution) || 0,
      targetDate: g.targetDate || null,
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const debts = (state.debts || []).map(d => ({
    name: d.name,
    balance: round2(d.balance),
    interestRate: Number(d.interestRate) || 0,
    minimumPayment: Number(d.minimumPayment) || 0,
    deferredUntil: d.repaymentStart && d.repaymentStart > today ? d.repaymentStart : null,
  }));

  const investmentTotal = round2((state.investments || [])
    .reduce((s, i) => s + (Number(i.currentValue) || 0), 0));
  const debtTotal = round2(debts.reduce((s, d) => s + d.balance, 0));
  const goalCash = round2(goals.reduce((s, g) => s + g.current, 0));

  return {
    monthlyIncome,
    incomeSourceCount: incomes.length,
    goals,
    debts,
    investmentTotal,
    debtTotal,
    netWorth: round2(investmentTotal + goalCash - debtTotal),
  };
}

const EXECUTORS = {
  get_spending: getSpending,
  get_merchant_spending: getMerchantSpending,
  get_budget_status: getBudgetStatus,
  get_financial_position: getFinancialPosition,
};

// Run one tool call. Unknown names throw rather than returning something the
// model might read as data.
function executeTool(state, name, input) {
  const fn = EXECUTORS[name];
  if (!fn) throw new Error(`Unknown tool: ${name}`);
  return fn(state || {}, input || {});
}

module.exports = { TOOLS, executeTool, effectiveAmount };
