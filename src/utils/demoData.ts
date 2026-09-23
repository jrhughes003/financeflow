// Demo data generator — realistic, self-consistent sample data for screenshots,
// first-run exploration, and manual testing.
//
// Everything is generated relative to `today` so the app always looks current,
// and from a fixed PRNG seed so the same day always produces the same data
// (stable screenshots, and diffable in tests).
//
// The data is deliberately shaped to exercise the analytics features rather than
// being uniformly random: dining out trends up over the last few months, a
// subscription raises its price partway through, a pair of duplicate charges
// lands two days apart, one dinner is split with friends and partly repaid, and
// an insurance bill arrives twice a year. See DEMO_NOTES at the bottom.

import { format, startOfMonth, subMonths, addMonths, getDaysInMonth } from 'date-fns';
import { DEFAULT_FLEX, SUBSCRIPTION_FLEX } from './constants';

// Months of history to generate (full months before the current, partial month).
const HISTORY_MONTHS = 8;

const SEED = 0x5f3a91c7;

// Small deterministic PRNG (mulberry32) — no dependency, repeatable output.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ymd = d => format(d, 'yyyy-MM-dd');
const round2 = n => Math.round(n * 100) / 100;

export default function generateDemoData(today = new Date()) {
  const rand = mulberry32(SEED);
  const todayStr = ymd(today);

  // --- helpers ---------------------------------------------------------------
  let seq = 0;
  const nextId = prefix => `${prefix}_demo_${(seq += 1).toString(36).padStart(4, '0')}`;

  const between = (lo, hi) => round2(lo + rand() * (hi - lo));
  const pick = arr => arr[Math.floor(rand() * arr.length)];

  // A date inside `monthStart`, clamped to the real length of that month.
  const dayIn = (monthStart, day) =>
    ymd(new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(day, getDaysInMonth(monthStart))));

  const txns = [];
  // Pushes a transaction, skipping anything in the future (the current month is
  // only partially elapsed, so demo data must stop at today).
  const add = t => {
    if (t.date > todayStr) return null;
    const full = {
      id: nextId('tx'),
      subcategory: '',
      notes: '',
      tags: [],
      isException: false,
      kind: 'expense',
      goalId: '',
      ...t,
      amount: round2(t.amount),
    };
    txns.push(full);
    return full;
  };

  // Oldest → newest, so ids run in chronological order.
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) =>
    startOfMonth(subMonths(today, HISTORY_MONTHS - 1 - i)));

  // --- custom categories -----------------------------------------------------
  // Shows off user-created categories alongside the five built-ins.
  const customCategories = [
    {
      id: 'housing', name: 'Housing', color: '#0ea5e9', icon: 'Tag',
      subcategories: ['Rent', 'Utilities', 'Internet'],
      keywords: ['rent', 'hydro', 'landlord', 'rogers', 'bell'],
    },
    {
      id: 'health', name: 'Health & Fitness', color: '#14b8a6', icon: 'Tag',
      subcategories: ['Gym', 'Pharmacy', 'Dental'],
      keywords: ['gym', 'goodlife', 'pharmacy', 'shoppers drug', 'dental'],
    },
  ];

  // --- recurring bills -------------------------------------------------------
  // Each posts one transaction per month and leaves behind a live template whose
  // nextDate is the next occurrence after today.
  const bills = [
    { merchant: 'Rent — Maple Grove Apts', amount: 1650, category: 'housing', subcategory: 'Rent', day: 1 },
    { merchant: 'Hydro One', amount: 84.5, category: 'housing', subcategory: 'Utilities', day: 8, vary: 18 },
    { merchant: 'Rogers Internet', amount: 74.99, category: 'housing', subcategory: 'Internet', day: 12 },
    { merchant: 'GoodLife Fitness', amount: 39.99, category: 'health', subcategory: 'Gym', day: 3 },
    { merchant: 'Spotify', amount: 11.99, category: 'subscriptions', subcategory: 'Streaming', day: 17 },
    // Netflix raises its price partway through the history → price-increase insight.
    { merchant: 'Netflix', amount: 16.99, laterAmount: 18.99, raiseAfter: 5, category: 'subscriptions', subcategory: 'Streaming', day: 21 },
  ];

  months.forEach((monthStart, mi) => {
    bills.forEach(bill => {
      const base = bill.laterAmount && mi >= bill.raiseAfter ? bill.laterAmount : bill.amount;
      const amount = bill.vary ? between(base - bill.vary, base + bill.vary) : base;
      add({
        date: dayIn(monthStart, bill.day),
        merchant: bill.merchant,
        amount,
        category: bill.category,
        subcategory: bill.subcategory,
        notes: 'Recurring',
        tags: ['recurring'],
      });
    });
  });

  const recurringTemplates = bills.map(bill => {
    // First occurrence strictly after today.
    let next = dayIn(startOfMonth(today), bill.day);
    if (next <= todayStr) next = dayIn(startOfMonth(addMonths(today, 1)), bill.day);
    return {
      id: nextId('rt'),
      merchant: bill.merchant,
      amount: bill.laterAmount || bill.amount,
      category: bill.category,
      frequency: 'monthly',
      nextDate: next,
      active: true,
    };
  });

  // --- everyday spending -----------------------------------------------------
  const GROCERS = ['Metro', 'Fortinos', 'No Frills', 'Costco', 'Farm Boy'];
  const COFFEE = ['Tim Hortons', 'Starbucks'];
  const RESTAURANTS = ['Lucx Kitchen', 'Sakura Sushi', 'The Open Grill', 'Pizzeria Uno', 'Pho 88'];
  const DELIVERY = ['Uber Eats', 'DoorDash'];
  const SHOPS = ['Amazon.ca', 'Best Buy', 'Indigo', 'Winners', 'Canadian Tire'];
  const GAS = ['Esso', 'Petro-Canada', 'Shell'];

  months.forEach((monthStart, mi) => {
    // Dining out drifts upward over the final three months → "trending up".
    const monthsFromEnd = HISTORY_MONTHS - 1 - mi;
    const diningFactor = monthsFromEnd <= 2 ? 1.35 : 1;

    // Groceries: weekly-ish.
    [4, 11, 18, 25].forEach(day => {
      add({
        date: dayIn(monthStart, day + Math.floor(rand() * 3)),
        merchant: pick(GROCERS),
        amount: between(48, 165),
        category: 'groceries',
        subcategory: 'Supermarket',
      });
    });

    // Coffee: small, frequent → "small purchases add up".
    for (let i = 0; i < 7; i += 1) {
      add({
        date: dayIn(monthStart, 2 + i * 4 + Math.floor(rand() * 2)),
        merchant: COFFEE[0],
        amount: between(4.25, 7.8),
        category: 'dining_out',
        subcategory: 'Coffee & Drinks',
      });
    }

    // Restaurants and delivery.
    for (let i = 0; i < 4; i += 1) {
      add({
        date: dayIn(monthStart, 6 + i * 6 + Math.floor(rand() * 3)),
        merchant: pick(RESTAURANTS),
        amount: between(28, 92) * diningFactor,
        category: 'dining_out',
        subcategory: 'Restaurant',
      });
    }
    for (let i = 0; i < 3; i += 1) {
      add({
        date: dayIn(monthStart, 9 + i * 8),
        merchant: pick(DELIVERY),
        amount: between(24, 58) * diningFactor,
        category: 'dining_out',
        subcategory: 'Food Delivery',
      });
    }

    // Transportation: gas, transit pass, occasional parking.
    [7, 19].forEach(day => {
      add({
        date: dayIn(monthStart, day + Math.floor(rand() * 3)),
        merchant: pick(GAS),
        amount: between(52, 88),
        category: 'transportation',
        subcategory: 'Gas',
      });
    });
    add({
      date: dayIn(monthStart, 2),
      merchant: 'Presto Transit',
      amount: 128,
      category: 'transportation',
      subcategory: 'Public Transit',
    });
    if (rand() > 0.45) {
      add({
        date: dayIn(monthStart, 14 + Math.floor(rand() * 10)),
        merchant: 'Green P Parking',
        amount: between(8, 26),
        category: 'transportation',
        subcategory: 'Parking',
      });
    }

    // Products / shopping.
    for (let i = 0; i < 3; i += 1) {
      add({
        date: dayIn(monthStart, 5 + i * 9 + Math.floor(rand() * 4)),
        merchant: pick(SHOPS),
        amount: between(22, 180),
        category: 'products',
        subcategory: 'Online Shopping',
      });
    }

    // Pharmacy run most months.
    if (rand() > 0.3) {
      add({
        date: dayIn(monthStart, 16),
        merchant: 'Shoppers Drug Mart',
        amount: between(18, 74),
        category: 'health',
        subcategory: 'Pharmacy',
      });
    }
  });

  // --- deliberate analytics hooks -------------------------------------------
  // Semiannual car insurance → irregular/periodic expense detection. Kept out of
  // the current month so the live month's categories aren't distorted.
  months.forEach((monthStart, mi) => {
    if (mi % 6 === 0) {
      add({
        date: dayIn(monthStart, 10),
        merchant: 'Aviva Insurance',
        amount: 642,
        category: 'transportation',
        subcategory: 'Car Maintenance',
        notes: 'Semiannual auto policy',
      });
    }
  });

  // Duplicate charge two days apart → duplicates panel.
  const dupMonth = months[HISTORY_MONTHS - 2];
  add({ date: dayIn(dupMonth, 13), merchant: 'Best Buy', amount: 129.99, category: 'products', subcategory: 'Electronics' });
  add({ date: dayIn(dupMonth, 15), merchant: 'Best Buy', amount: 129.99, category: 'products', subcategory: 'Electronics', notes: 'Charged twice?' });

  // A big group dinner split four ways, partly paid back → "owed to me".
  const owedMonth = months[HISTORY_MONTHS - 1];
  const owedDinner = add({
    date: dayIn(owedMonth, 6),
    merchant: 'Sakura Sushi',
    amount: 248,
    category: 'dining_out',
    subcategory: 'Restaurant',
    notes: 'Birthday dinner — covered the table',
  });
  if (owedDinner) {
    owedDinner.owed = {
      amount: 186, // three friends' share
      people: 4,
      payments: [
        { id: nextId('pay'), date: dayIn(owedMonth, 8), amount: 62 },
        { id: nextId('pay'), date: dayIn(owedMonth, 11), amount: 62 },
      ],
      forgiven: false,
    };
  }

  // A one-off flagged as an exception so it doesn't distort budgets.
  add({
    date: dayIn(months[HISTORY_MONTHS - 3], 22),
    merchant: 'Air Canada',
    amount: 812,
    category: 'products',
    subcategory: 'Events & Tickets',
    notes: 'Wedding travel — one-off',
    isException: true,
    tags: ['one-time'],
  });

  // --- savings goals (opening balance + real savings transactions) -----------
  const goals = [
    { id: nextId('g'), name: 'Emergency Fund', targetAmount: 15000, currentAmount: 6200, monthlyContribution: 450, monthsAhead: 18, color: '#22c55e', icon: 'Shield', perMonth: 450 },
    { id: nextId('g'), name: 'House Down Payment', targetAmount: 90000, currentAmount: 24500, monthlyContribution: 900, monthsAhead: 48, color: '#3b82f6', icon: 'Home', perMonth: 900 },
    { id: nextId('g'), name: 'Japan Trip', targetAmount: 6000, currentAmount: 1100, monthlyContribution: 250, monthsAhead: 11, color: '#f97316', icon: 'Plane', perMonth: 250 },
  ];

  const savings_goals = goals.map(g => ({
    id: g.id,
    name: g.name,
    targetAmount: g.targetAmount,
    currentAmount: g.currentAmount,
    monthlyContribution: g.monthlyContribution,
    targetDate: ymd(startOfMonth(addMonths(today, g.monthsAhead))),
    color: g.color,
    icon: g.icon,
  }));

  months.forEach(monthStart => {
    goals.forEach(g => {
      add({
        date: dayIn(monthStart, 26),
        merchant: `Savings → ${g.name}`,
        amount: g.perMonth,
        category: 'savings',
        kind: 'savings',
        goalId: g.id,
      });
    });
  });

  // --- budgets ---------------------------------------------------------------
  const budgets = [
    { id: nextId('b'), category: 'groceries', amount: 550, flex: DEFAULT_FLEX, rollover: true },
    { id: nextId('b'), category: 'dining_out', amount: 400, flex: DEFAULT_FLEX, rollover: false },
    { id: nextId('b'), category: 'transportation', amount: 350, flex: DEFAULT_FLEX, rollover: false },
    { id: nextId('b'), category: 'subscriptions', amount: 45, flex: SUBSCRIPTION_FLEX, rollover: false },
    { id: nextId('b'), category: 'products', amount: 300, flex: DEFAULT_FLEX, rollover: true },
    { id: nextId('b'), category: 'housing', amount: 1850, flex: 5, rollover: false },
    { id: nextId('b'), category: 'health', amount: 90, flex: DEFAULT_FLEX, rollover: false },
  ];

  // --- income ----------------------------------------------------------------
  const incomes = [
    { id: nextId('i'), name: 'Software developer salary', amount: 2650, frequency: 'biweekly', source: 'employer', color: '#3b82f6' },
    { id: nextId('i'), name: 'Freelance web work', amount: 600, frequency: 'monthly', source: 'self-employed', color: '#8b5cf6' },
  ];

  // --- investments / tracked accounts ---------------------------------------
  const tfsaId = nextId('inv');
  const rrspId = nextId('inv');
  const advisorId = nextId('inv');
  const anchor = ymd(startOfMonth(subMonths(today, 1)));
  const syncedAt = startOfMonth(subMonths(today, 1)).getTime();

  const investments = [
    {
      id: tfsaId, name: 'TFSA — index funds', type: 'stocks',
      currentValue: 38400, asOfDate: anchor, syncedAt,
      costBasis: 31000, annualReturn: 7, monthlyWithdrawal: 0, withdrawalDay: 1,
      withdrawalCountsAsIncome: false, color: '#3b82f6',
      entries: [
        { id: nextId('ent'), type: 'deposit', amount: 1000, date: ymd(today), note: 'Monthly contribution', createdAt: today.getTime() },
      ],
    },
    {
      id: rrspId, name: 'RRSP — employer match', type: 'retirement',
      currentValue: 22750, asOfDate: anchor, syncedAt,
      costBasis: 20000, annualReturn: 6.5, monthlyWithdrawal: 0, withdrawalDay: 1,
      withdrawalCountsAsIncome: false, color: '#8b5cf6', entries: [],
    },
    {
      id: advisorId, name: 'Advisor managed portfolio', type: 'stocks',
      currentValue: 54200, asOfDate: anchor, syncedAt,
      costBasis: 48000, annualReturn: 6, monthlyWithdrawal: 0, withdrawalDay: 15,
      withdrawalCountsAsIncome: false, color: '#22c55e', entries: [],
    },
  ];

  // --- debts (incl. an interest-free deferred student loan) ------------------
  const debts = [
    {
      id: nextId('d'), name: 'OSAP student loan', type: 'student_loan',
      balance: 17400, interestRate: 0, minimumPayment: 290,
      originalBalance: 22000,
      repaymentStart: ymd(startOfMonth(addMonths(today, 7))), // still deferred
    },
    {
      id: nextId('d'), name: 'Car loan', type: 'auto',
      balance: 12850, interestRate: 6.4, minimumPayment: 385, originalBalance: 24000,
    },
    {
      id: nextId('d'), name: 'Visa', type: 'credit_card',
      balance: 2340, interestRate: 19.99, minimumPayment: 75, originalBalance: 3500,
    },
  ];

  // --- Plan Ahead (life plan) ------------------------------------------------
  const planMonth = d => format(d, 'yyyy-MM');
  const birthYear = today.getFullYear() - 27;

  const lifePlan = {
    version: 1,
    people: [
      {
        id: 'me', name: 'You', enabled: true, birthYear,
        retireAge: 62, cppStartAge: 65, oasStartAge: 65, cppAt65: 9000,
        tfsaRoom: 12000, rrspRoom: 18000, fhsaAnnual: 8000, fhsaContributedSoFar: 8000,
      },
      {
        id: 'partner', name: 'Partner', enabled: false, birthYear: null,
        retireAge: 65, cppStartAge: 65, oasStartAge: 65, cppAt65: 9000,
        tfsaRoom: 0, rrspRoom: 0, fhsaAnnual: 0,
      },
    ],
    incomes: [
      {
        id: nextId('inc'), personId: 'me', name: 'Software developer salary',
        start: planMonth(subMonths(today, 18)), end: '',
        annual: 84000, growthPct: 3, rrspPct: 5, employerMatchPct: 3,
      },
    ],
    living: {
      spendingMode: 'history', spendingMonthly: 0,
      historyIncludesRent: true, rentMonthly: 1650, rentGrowthPct: 3,
      retirementSpendingPct: 80, emergencyMonths: 3, cashOnHand: 9500,
    },
    accountMap: {
      [tfsaId]: { bucket: 'tfsa', owner: 'me' },
      [rrspId]: { bucket: 'rrsp', owner: 'me' },
      [advisorId]: { bucket: 'nonreg', owner: 'me' },
    },
    events: [
      {
        id: nextId('ev'), type: 'house', name: 'First home', enabled: true,
        date: planMonth(addMonths(today, 30)),
        price: 640000, downPct: 15, mortgageRate: 4.6, amortizationYears: 25,
        firstTime: true, toronto: false, propertyTaxPct: 1, insuranceAnnual: 1800,
        maintenancePct: 1, condoFeesMonthly: 0, useFHSA: true, useHBP: true,
      },
      {
        id: nextId('ev'), type: 'car', name: 'Replace the car', enabled: true,
        date: planMonth(addMonths(today, 14)),
        price: 34000, financing: 'loan', downPct: 20, loanRate: 6.2,
        loanMonths: 60, replaceEveryYears: 0,
      },
      {
        id: nextId('ev'), type: 'oneTime', name: 'Wedding', enabled: true,
        date: planMonth(addMonths(today, 20)), amount: 28000,
      },
      {
        id: nextId('ev'), type: 'recurring', name: 'Childcare', enabled: false,
        start: planMonth(addMonths(today, 42)), end: planMonth(addMonths(today, 90)),
        monthly: 1250, inflate: true,
      },
    ],
    assumptions: {
      inflationPct: 2.5, returnPct: 6, cashReturnPct: 2.5,
      homeAppreciationPct: 3, endAge: 95,
    },
    scenarios: [],
  };

  // Oldest first reads better in the ledger's default (date-sorted) views.
  txns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    transactions: txns,
    budgets,
    incomes,
    savings_goals,
    investments,
    debts,
    recurringTemplates,
    customCategories,
    settings: {
      currency: 'CAD',
      showSampleData: true,
      aiEnabled: false,
      merchantCategoryHints: {
        'presto transit': 'transportation',
        'goodlife fitness': 'health',
      },
      dismissedBudgetTips: [],
      dismissedDuplicates: [],
      lifePlan,
    },
  };
}

// What the generated data is built to demonstrate, for anyone reading the code:
export const DEMO_NOTES = [
  'Dining out trends up over the last three months (trend detection)',
  'Netflix raises its price partway through the history (price-increase insight)',
  'Frequent small coffee purchases (small purchases add up)',
  'Two identical Best Buy charges two days apart (duplicate detection)',
  'Semiannual car insurance (irregular/periodic expense detection)',
  'A group dinner split four ways and partly repaid (owed to me)',
  'A flagged one-off flight so it stays out of budget math (exceptions)',
  'An interest-free OSAP loan still in deferment (deferred debt handling)',
  'Monthly savings transactions feeding three goals (goal progress)',
  'A funded Plan Ahead config with house, car, wedding and childcare events',
];
