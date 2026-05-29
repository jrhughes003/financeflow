// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildPayload, ALLOW } from './payload.cjs';

const RAW_LEDGER = [{ id: 't1', merchant: 'Secret Clinic', amount: 500 }];

describe('buildPayload (data minimization)', () => {
  it('categorize sends only the merchant and taxonomy', () => {
    const out = buildPayload('categorize', {
      merchant: 'Esso',
      categories: [{ id: 'transportation', name: 'Transportation' }],
      transactions: RAW_LEDGER, // must be stripped
      amount: 40,
    });
    expect(out).toEqual({
      merchant: 'Esso',
      categories: [{ id: 'transportation', name: 'Transportation' }],
    });
    expect(out).not.toHaveProperty('transactions');
    expect(out).not.toHaveProperty('amount');
  });

  it('insights never includes raw transactions', () => {
    const out = buildPayload('insights', {
      summary: { total: 1234, byCategory: { dining_out: 200 } },
      transactions: RAW_LEDGER,
    });
    expect(out).toEqual({ summary: { total: 1234, byCategory: { dining_out: 200 } } });
    expect(out).not.toHaveProperty('transactions');
  });

  it('query carries the question + aggregate summary only', () => {
    const out = buildPayload('query', {
      question: 'How much on dining in March?',
      summary: { months: [] },
      transactions: RAW_LEDGER,
      apiKey: 'sk-secret',
    });
    expect(Object.keys(out).sort()).toEqual(['question', 'summary']);
  });

  it('extract sends the pasted text and taxonomy (raw text is unavoidable here)', () => {
    const out = buildPayload('extract', {
      text: 'COSTCO $84.21',
      categories: [{ id: 'groceries', name: 'Groceries' }],
      transactions: RAW_LEDGER,
    });
    expect(out).toEqual({
      text: 'COSTCO $84.21',
      categories: [{ id: 'groceries', name: 'Groceries' }],
    });
  });

  it('drops undefined fields rather than sending nulls', () => {
    const out = buildPayload('parse_entry', { text: 'spent $40 on gas', today: '2026-05-29' });
    expect(out).toEqual({ text: 'spent $40 on gas', today: '2026-05-29' });
    expect(out).not.toHaveProperty('categories');
  });

  it('throws on an unknown feature (a typo cannot send an unfiltered object)', () => {
    expect(() => buildPayload('exfiltrate', { transactions: RAW_LEDGER })).toThrow(/Unknown AI feature/);
  });

  it('no allow-list permits a raw transactions array', () => {
    for (const keys of Object.values(ALLOW)) {
      expect(keys).not.toContain('transactions');
    }
  });
});
