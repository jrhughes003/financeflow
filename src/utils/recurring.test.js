import { describe, it, expect } from 'vitest';
import {
  detectRecurringCandidates,
  advanceDate,
  isTemplateDue,
  postTemplate,
} from './recurring';

const tx = (date, merchant, amount, over = {}) => ({
  id: `${merchant}-${date}`, date, merchant, amount,
  category: 'subscriptions', tags: [], isException: false, ...over,
});

describe('detectRecurringCandidates', () => {
  it('detects a stable monthly subscription', () => {
    const txns = [
      tx('2026-01-05', 'Netflix', 15.99),
      tx('2026-02-05', 'Netflix', 15.99),
      tx('2026-03-05', 'Netflix', 15.99),
    ];
    const found = detectRecurringCandidates(txns);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ merchant: 'Netflix', frequency: 'monthly', occurrences: 3 });
    expect(found[0].amount).toBeCloseTo(15.99);
    expect(found[0].nextDate).toBe('2026-04-05');
  });

  it('ignores merchants with too few occurrences', () => {
    const txns = [tx('2026-01-05', 'Netflix', 15.99), tx('2026-02-05', 'Netflix', 15.99)];
    expect(detectRecurringCandidates(txns)).toEqual([]);
  });

  it('ignores irregular cadence', () => {
    const txns = [
      tx('2026-01-01', 'Random', 10),
      tx('2026-01-03', 'Random', 10),
      tx('2026-03-20', 'Random', 10),
    ];
    expect(detectRecurringCandidates(txns)).toEqual([]);
  });

  it('ignores wildly varying amounts for the same merchant', () => {
    const txns = [
      tx('2026-01-05', 'Amazon', 5),
      tx('2026-02-05', 'Amazon', 200),
      tx('2026-03-05', 'Amazon', 50),
    ];
    expect(detectRecurringCandidates(txns)).toEqual([]);
  });

  it('groups merchant name variants together', () => {
    const txns = [
      tx('2026-01-05', 'Netflix #123', 15.99),
      tx('2026-02-05', 'NETFLIX', 15.99),
      tx('2026-03-05', 'netflix.com', 15.99),
    ];
    expect(detectRecurringCandidates(txns)).toHaveLength(1);
  });
});

describe('advanceDate', () => {
  it('advances by the right period', () => {
    expect(advanceDate('2026-01-31', 'monthly')).toBe('2026-02-28'); // clamps to month end
    expect(advanceDate('2026-03-05', 'weekly')).toBe('2026-03-12');
    expect(advanceDate('2026-03-05', 'biweekly')).toBe('2026-03-19');
    expect(advanceDate('2026-03-05', 'annual')).toBe('2027-03-05');
  });
});

describe('isTemplateDue', () => {
  it('is due when nextDate is on or before today and active', () => {
    expect(isTemplateDue({ nextDate: '2026-05-01', active: true }, '2026-05-29')).toBe(true);
    expect(isTemplateDue({ nextDate: '2026-06-15', active: true }, '2026-05-29')).toBe(false);
    expect(isTemplateDue({ nextDate: '2026-05-01', active: false }, '2026-05-29')).toBe(false);
  });
});

describe('postTemplate', () => {
  it('produces a transaction and advances the template', () => {
    const template = { id: 'r1', merchant: 'Spotify', amount: 10.99, category: 'subscriptions', frequency: 'monthly', nextDate: '2026-05-05', active: true };
    const { transaction, template: updated } = postTemplate(template, '2026-05-29');
    expect(transaction).toMatchObject({
      merchant: 'Spotify', amount: 10.99, date: '2026-05-05', recurringTemplateId: 'r1',
    });
    expect(transaction.tags).toContain('recurring');
    expect(updated.nextDate).toBe('2026-06-05');
  });
});
