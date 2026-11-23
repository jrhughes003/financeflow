import { describe, it, expect } from 'vitest';
import { findDuplicates, merchantKey } from './importDedupe';
import type { Transaction } from '../types/domain';

const tx = (id: string, date: string, merchant: string, amount: number, extra: Partial<Transaction> = {}): Transaction =>
  ({ id, date, merchant, amount, category: 'dining', ...extra });

describe('merchantKey', () => {
  it('strips store numbers and punctuation', () => {
    expect(merchantKey('TIM HORTONS #1234 TORONTO')).toBe(merchantKey('Tim Hortons'));
  });
});

describe('findDuplicates', () => {
  it('flags a same-day, same-amount row as exact whatever the merchant', () => {
    const res = findDuplicates([tx('n1', '2026-11-03', 'AMZN Mktp CA*2K4', 42.1)], [tx('e1', '2026-11-03', 'Amazon.ca', 42.1)]);
    expect(res[0]?.strength).toBe('exact');
    expect(res[0]?.existing.id).toBe('e1');
  });

  it('allows a few days of posting drift when the merchant agrees', () => {
    const res = findDuplicates([tx('n1', '2026-11-05', 'TIM HORTONS #88', 6.45)], [tx('e1', '2026-11-03', 'Tim Hortons', 6.45)]);
    expect(res[0]?.strength).toBe('likely');
  });

  it('does not match drifted rows from a different merchant', () => {
    const res = findDuplicates([tx('n1', '2026-11-05', 'Shell', 6.45)], [tx('e1', '2026-11-03', 'Tim Hortons', 6.45)]);
    expect(res[0]).toBeNull();
  });

  it('does not match beyond the drift window', () => {
    const res = findDuplicates([tx('n1', '2026-11-10', 'Tim Hortons', 6.45)], [tx('e1', '2026-11-03', 'Tim Hortons', 6.45)]);
    expect(res[0]).toBeNull();
  });

  it('lets each ledger row be claimed only once', () => {
    const res = findDuplicates(
      [tx('n1', '2026-11-03', 'Tim Hortons', 2), tx('n2', '2026-11-03', 'Tim Hortons', 2)],
      [tx('e1', '2026-11-03', 'Tim Hortons', 2)],
    );
    expect(res.filter(Boolean)).toHaveLength(1);
  });

  it('prefers an exact match over a nearby likely one', () => {
    const res = findDuplicates(
      [tx('n1', '2026-11-04', 'Tim Hortons', 2), tx('n2', '2026-11-03', 'Tim Hortons', 2)],
      [tx('e1', '2026-11-03', 'Tim Hortons', 2), tx('e2', '2026-11-04', 'Tim Hortons', 2)],
    );
    expect(res[0]?.existing.id).toBe('e2');
    expect(res[1]?.existing.id).toBe('e1');
    expect(res.every(r => r?.strength === 'exact')).toBe(true);
  });

  it('ignores savings transfers', () => {
    const res = findDuplicates([tx('n1', '2026-11-03', 'Transfer', 100)], [tx('e1', '2026-11-03', 'Transfer', 100, { kind: 'savings' })]);
    expect(res[0]).toBeNull();
  });

  it('compares amounts to the cent', () => {
    const res = findDuplicates([tx('n1', '2026-11-03', 'X', 0.1 + 0.2)], [tx('e1', '2026-11-03', 'X', 0.3)]);
    expect(res[0]?.strength).toBe('exact');
  });
});
