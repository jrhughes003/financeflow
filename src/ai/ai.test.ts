// buildSummary decides what leaves the device for insights and Q&A, so these
// tests pin BOTH halves of the bargain: it must carry enough analysis to be
// worth sending, and it must never carry an individual transaction.

import { describe, it, expect } from 'vitest';
import { buildSummary, taxonomy } from './ai';
import generateDemoData from '../utils/demoData';
import { makeState } from '../test/factories';

const TODAY = new Date(2026, 8, 22); // 2026-09-22
const state = generateDemoData(TODAY);
const summary = buildSummary(state, 8, 2026, { today: TODAY });
const serialized = JSON.stringify(summary);

describe('buildSummary — privacy boundary', () => {
  it('contains no merchant name from the ledger', () => {
    const merchants = [...new Set(state.transactions.map(t => t.merchant).filter(Boolean))];
    expect(merchants.length).toBeGreaterThan(10); // the fixture is meaningful
    const leaked = merchants.filter(m => serialized.includes(m));
    expect(leaked).toEqual([]);
  });

  it('contains no transaction id', () => {
    const leaked = state.transactions.map(t => t.id).filter(id => serialized.includes(id));
    expect(leaked).toEqual([]);
  });

  it('carries no per-transaction notes, tags or dates', () => {
    expect(serialized).not.toContain('Birthday dinner');
    expect(serialized).not.toContain('Charged twice?');
    expect(serialized).not.toContain('ai-imported');
    // Exact ledger dates (YYYY-MM-DD) belong to transactions; the summary
    // speaks in months and labels. Goal target dates are the one exception.
    const isoDates = serialized.match(/\d{4}-\d{2}-\d{2}/g) || [];
    expect(isoDates).toEqual([]);
  });

  it('reports flagged findings as counts, not as the underlying charges', () => {
    expect(summary.flagged.possibleDuplicates).toBeGreaterThan(0);
    expect(summary.flagged).not.toHaveProperty('items');
    expect(JSON.stringify(summary.flagged)).not.toContain('Best Buy');
  });

  it('drops the merchant from merchant-derived savings opportunities', () => {
    const small = summary.savingsOpportunities.find(o => o.type === 'frequent_small');
    if (small) {
      expect(small).not.toHaveProperty('merchant');
      expect(small.monthlySaving).toBeGreaterThan(0);
    }
  });

  it('stays small enough to be cheap to send', () => {
    // ~4 chars/token: a few thousand tokens at most, not a ledger dump.
    expect(serialized.length).toBeLessThan(12000);
  });
});

describe('buildSummary — analytical content', () => {
  it('includes the headline figures', () => {
    expect(summary.totalExpenses).toBeGreaterThan(0);
    expect(summary.totalMonthlyIncome).toBeGreaterThan(0);
    expect(summary.byCategory).toHaveProperty('dining_out');
    expect(summary.sixMonthTotals).toHaveLength(6);
  });

  it('includes what changed against the user\'s own baseline', () => {
    expect(summary.whatChanged.baselineMonths).toBeGreaterThan(0);
    expect(summary.whatChanged.byCategory.length).toBeGreaterThan(0);
    const dining = summary.whatChanged.byCategory.find(c => c.category === 'dining_out');
    expect(dining).toBeDefined();
    if (!dining) throw new Error('unreachable');
    expect(dining.change).toBeGreaterThan(0); // demo data trends dining upward
  });

  it('includes a month-end projection and a forward outlook', () => {
    expect(summary.monthEndProjection.projected).toBeGreaterThan(0);
    expect(summary.monthEndProjection.daysInMonth).toBe(30);
    expect(summary.cashFlowOutlook.length).toBeGreaterThan(0);
    expect(summary.cashFlowOutlook[0]).toHaveProperty('net');
  });

  it('includes goal pacing and a debt strategy recommendation', () => {
    expect(summary.goals.length).toBeGreaterThan(0);
    expect(summary.goals[0]).toHaveProperty('status');
    // buildSummary returns null here only when there are no debts, and the
    // demo fixture has them.
    const debts = summary.debts;
    expect(debts).not.toBeNull();
    if (!debts) throw new Error('unreachable');
    expect(['avalanche', 'snowball']).toContain(debts.recommendedStrategy);
    expect(debts.items.some(d => d.deferred)).toBe(true);
  });

  it('handles an empty state without throwing', () => {
    const empty = makeState();
    expect(() => buildSummary(empty, 8, 2026, { today: TODAY })).not.toThrow();
    expect(buildSummary(empty, 8, 2026, { today: TODAY }).debts).toBeNull();
  });
});

describe('taxonomy', () => {
  it('sends only category ids and names', () => {
    const cats = taxonomy(state.customCategories);
    expect(cats.length).toBeGreaterThan(5);
    cats.forEach(c => expect(Object.keys(c).sort()).toEqual(['id', 'name']));
  });
});
