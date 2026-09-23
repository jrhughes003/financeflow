// No example transactions — app starts fresh so you can upload your own CSV.
// Budgets, income, goals, and investments are minimal defaults to get started.

export const sampleData = {
  transactions: [],

  budgets: [
    { id: 'b1', category: 'dining_out',     amount: 0, flex: 10, rollover: false },
    { id: 'b2', category: 'groceries',      amount: 0, flex: 10, rollover: false },
    { id: 'b3', category: 'transportation', amount: 0, flex: 10, rollover: false },
    { id: 'b4', category: 'subscriptions',  amount: 0, flex: 5,  rollover: false },
    { id: 'b5', category: 'products',       amount: 0, flex: 10, rollover: false },
  ],

  customCategories: [], // user-created categories stored here

  incomes: [],
  savings_goals: [],
  investments: [],
  debts: [],
  recurringTemplates: [],

  settings: {
    currency: 'CAD',
    showSampleData: false,
  },
};
