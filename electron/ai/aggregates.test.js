// The Q&A tools are the only path by which the model learns anything about the
// ledger, so they get tested on three fronts: they agree with the app's own
// arithmetic, they answer correctly, and they never hand back a transaction.

import { describe, it, expect } from 'vitest';
import { TOOLS, executeTool, effectiveAmount } from './aggregates.cjs';
import generateDemoData from '../../src/utils/demoData';
import { getSpendingByCategory, getTotalExpenses } from '../../src/utils/calculations';
import { effectiveAmount as rendererEffectiveAmount } from '../../src/utils/reimbursements';

const TODAY = new Date(2026, 8, 22);
const state = generateDemoData(TODAY);
const SEP = { start: '2026-09-01', end: '2026-09-30' };

describe('parity with the renderer\'s own calculations', () => {
  // aggregates.cjs is CommonJS in the main process and can't import the ESM
  // modules in src/, so the netting rule is restated there. These tests fail if
  // the two ever drift apart.
  it('computes effectiveAmount the same way as reimbursements.js', () => {
    state.transactions.forEach(t => {
      expect(effectiveAmount(t)).toBeCloseTo(rendererEffectiveAmount(t), 2);
    });
    const owed = state.transactions.find(t => t.owed);
    expect(effectiveAmount(owed)).toBeLessThan(owed.amount); // the case that matters
  });

  it('category totals match getSpendingByCategory', () => {
    const viaTool = executeTool(state, 'get_spending', { ...SEP, group_by: 'category' });
    const viaApp = getSpendingByCategory(state.transactions, 8, 2026);
    Object.entries(viaApp).forEach(([category, total]) => {
      expect(viaTool.byCategory[category]).toBeCloseTo(total, 2);
    });
  });

  it('the monthly total matches getTotalExpenses', () => {
    const viaTool = executeTool(state, 'get_spending', SEP);
    expect(viaTool.total).toBeCloseTo(getTotalExpenses(state.transactions, 8, 2026), 2);
  });
});

describe('get_spending', () => {
  it('groups by category, month, or not at all', () => {
    expect(executeTool(state, 'get_spending', SEP).total).toBeGreaterThan(0);
    expect(Object.keys(executeTool(state, 'get_spending', { ...SEP, group_by: 'category' }).byCategory).length).toBeGreaterThan(3);

    const byMonth = executeTool(state, 'get_spending', { start: '2026-04-01', end: '2026-09-30', group_by: 'month' });
    expect(Object.keys(byMonth.byMonth)).toContain('2026-07');
    expect(byMonth.averagePerMonth).toBeGreaterThan(0);
  });

  it('filters to one category', () => {
    const dining = executeTool(state, 'get_spending', { ...SEP, category: 'dining_out' });
    expect(dining.total).toBeGreaterThan(0);
    expect(dining.total).toBeLessThan(executeTool(state, 'get_spending', SEP).total);
  });

  it('excludes savings transfers and flagged exceptions', () => {
    const all = { start: '2026-01-01', end: '2026-12-31' };
    const total = executeTool(state, 'get_spending', all).total;
    const savings = state.transactions.filter(t => t.kind === 'savings').reduce((s, t) => s + t.amount, 0);
    const exceptions = state.transactions.filter(t => t.isException).reduce((s, t) => s + t.amount, 0);
    expect(savings).toBeGreaterThan(0);
    expect(exceptions).toBeGreaterThan(0);
    const naive = state.transactions.reduce((s, t) => s + t.amount, 0);
    expect(total).toBeLessThan(naive - savings - exceptions + 1);
  });

  it('returns zero rather than failing for an empty period', () => {
    const out = executeTool(state, 'get_spending', { start: '2019-01-01', end: '2019-01-31' });
    expect(out).toMatchObject({ total: 0, transactionCount: 0 });
  });
});

describe('get_merchant_spending', () => {
  it('answers the question a fixed summary blob never could', () => {
    const out = executeTool(state, 'get_merchant_spending', { merchant: 'tim hortons' });
    expect(out.total).toBeGreaterThan(0);
    expect(out.transactionCount).toBeGreaterThan(10);
    expect(out.categories).toContain('dining_out');
  });

  it('matches case-insensitively on a fragment and honours a date range', () => {
    const all = executeTool(state, 'get_merchant_spending', { merchant: 'TIM' });
    const sept = executeTool(state, 'get_merchant_spending', { merchant: 'TIM', ...SEP });
    expect(all.total).toBeGreaterThan(sept.total);
  });

  it('says so plainly when nothing matches', () => {
    const out = executeTool(state, 'get_merchant_spending', { merchant: 'zzz nowhere' });
    expect(out).toMatchObject({ total: 0, transactionCount: 0 });
    expect(out.note).toMatch(/No spending matched/i);
  });
});

describe('get_budget_status and get_financial_position', () => {
  it('reports budget vs actual per category', () => {
    const out = executeTool(state, 'get_budget_status', { month: 8, year: 2026 });
    expect(out.budgets.length).toBe(state.budgets.length);
    expect(out.budgets.some(b => b.over)).toBe(true); // demo data overruns dining
    out.budgets.forEach(b => expect(b).toHaveProperty('percentUsed'));
  });

  it('reports goals, debts and net worth', () => {
    const out = executeTool(state, 'get_financial_position', {});
    expect(out.monthlyIncome).toBeGreaterThan(0);
    expect(out.goals.length).toBe(state.savings_goals.length);
    expect(out.goals[0].percentComplete).toBeGreaterThan(0);
    expect(out.debts.some(d => d.deferredUntil)).toBe(true);
    expect(out.netWorth).not.toBeNaN();
  });

  it('throws on an unknown tool rather than returning something readable as data', () => {
    expect(() => executeTool(state, 'drop_everything', {})).toThrow(/Unknown tool/);
  });
});

describe('privacy boundary of tool results', () => {
  const everyResult = () => JSON.stringify([
    executeTool(state, 'get_spending', { start: '2026-01-01', end: '2026-12-31', group_by: 'category' }),
    executeTool(state, 'get_spending', { start: '2026-01-01', end: '2026-12-31', group_by: 'month' }),
    executeTool(state, 'get_budget_status', { month: 8, year: 2026 }),
    executeTool(state, 'get_financial_position', {}),
  ]);

  it('never returns a merchant name the user did not ask about', () => {
    const serialized = everyResult();
    const merchants = [...new Set(state.transactions.map(t => t.merchant))];
    expect(merchants.filter(m => serialized.includes(m))).toEqual([]);
  });

  it('never returns transaction ids, notes or tags', () => {
    const serialized = everyResult();
    expect(state.transactions.map(t => t.id).filter(id => serialized.includes(id))).toEqual([]);
    expect(serialized).not.toContain('Birthday dinner');
    expect(serialized).not.toContain('recurring');
  });

  it('reports how many merchants matched a search, not which', () => {
    const out = executeTool(state, 'get_merchant_spending', { merchant: 'tim' });
    expect(out).toHaveProperty('matchedMerchantCount');
    expect(out).not.toHaveProperty('merchants');
    // The only merchant string in the result is the one the user typed.
    expect(JSON.stringify(out)).not.toContain('Hortons');
  });
});

describe('tool definitions', () => {
  it('every advertised tool has an executor and a documented schema', () => {
    TOOLS.forEach(tool => {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.input_schema.type).toBe('object');
      expect(() => executeTool(state, tool.name, { merchant: 'x', month: 8, year: 2026, start: SEP.start, end: SEP.end })).not.toThrow();
    });
  });
});
