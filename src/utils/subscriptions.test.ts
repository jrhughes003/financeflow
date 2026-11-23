import { describe, it, expect } from 'vitest';
import { subscriptionAudit } from './subscriptions';
import type { RecurringTemplate, Transaction } from '../types/domain';

const today = new Date(2026, 10, 23);
const tpl = (id: string, merchant: string, amount: number, frequency: RecurringTemplate['frequency'] = 'monthly', active = true): RecurringTemplate =>
  ({ id, merchant, amount, category: 'subscriptions', frequency, nextDate: '2026-12-01', active });
const tx = (id: string, date: string, merchant: string, amount: number): Transaction => ({ id, date, merchant, amount, category: 'subscriptions' });

describe('subscriptionAudit', () => {
  it('sorts by yearly cost and skips paused templates', () => {
    const rows = subscriptionAudit([tpl('a', 'Spotify', 11.99), tpl('b', 'Costco membership', 65, 'annual'), tpl('c', 'Paused', 99, 'monthly', false)], [], today);
    expect(rows.map(r => [r.template.merchant, r.annual])).toEqual([['Costco membership', 65], ['Spotify', 143.88]].reverse());
  });

  it('finds a price increase in the ledger and the last charge', () => {
    const rows = subscriptionAudit([tpl('n', 'Netflix', 18.99)], [
      tx('1', '2026-01-05', 'NETFLIX.COM', 16.49),
      tx('2', '2026-06-05', 'Netflix', 16.49),
      tx('3', '2026-11-05', 'Netflix', 18.99),
      tx('x', '2024-01-05', 'Netflix', 9.99), // outside the lookback
    ], today);
    expect(rows[0].priceChangePct).toBe(15.2);
    expect(rows[0].lastCharged?.id).toBe('3');
    expect(rows[0].daysSinceCharged).toBe(18);
  });

  it('reports no change with no history', () => {
    expect(subscriptionAudit([tpl('n', 'Netflix', 18.99)], [], today)[0].priceChangePct).toBeNull();
  });
});
