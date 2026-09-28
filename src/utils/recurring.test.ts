import { describe, it, expect } from 'vitest';
import {
  detectRecurringCandidates,
  advanceDate,
  isTemplateDue,
  postTemplate,
} from './recurring';
import { makeRecurring, makeTransaction } from '../test/factories';
import type { IsoDate, Money, Transaction } from '../types/domain';

const tx = (
  date: IsoDate, merchant: string, amount: Money, over: Partial<Transaction> = {},
): Transaction => makeTransaction({
  id: `${merchant}-${date}`, date, merchant, amount,
  category: 'subscriptions', tags: [], isException: false, ...over,
});

describe('detectRecurringCandidates — cadences the average-gap rule missed', () => {
  it('still finds a monthly subscription that skipped a month', () => {
    // 30/30/60/30: the mean gap is 37.5 days, outside the 25% band around 30,
    // so the old rule dropped this entirely. One missed payment should cost a
    // little confidence, not the whole detection.
    const txns = [
      tx('2026-01-05', 'Netflix', 15.99),
      tx('2026-02-05', 'Netflix', 15.99),
      tx('2026-03-05', 'Netflix', 15.99),
      // April missed
      tx('2026-05-05', 'Netflix', 15.99),
      tx('2026-06-05', 'Netflix', 15.99),
    ];
    const [found] = detectRecurringCandidates(txns);
    if (!found) throw new Error('unreachable: nothing detected');
    expect(found.frequency).toBe('monthly');
    expect(found.confidence).toBeGreaterThan(0.6);
  });

  it('survives an unrelated one-off charge at the same merchant', () => {
    // The extra charge inserts a short gap that drags the average down to
    // 22.5 days. Six real monthly charges still outvote it.
    //
    // Six and not four on purpose: with only four, `Jan 5, Jan 19, Feb 5,
    // Mar 5` is honestly ambiguous — a semi-monthly charge that missed a few
    // beats fits those dates about as well as a monthly one with an extra, and
    // the detector says so by scoring it 0.56 and declining. That is the
    // behaviour we want from thin evidence, so the fixture gives it enough
    // evidence to be sure instead of lowering the bar until it agrees.
    const txns = [
      tx('2026-01-05', 'Spotify', 11.99),
      tx('2026-01-19', 'Spotify', 11.99), // a one-off, not part of the cadence
      tx('2026-02-05', 'Spotify', 11.99),
      tx('2026-03-05', 'Spotify', 11.99),
      tx('2026-04-05', 'Spotify', 11.99),
      tx('2026-05-05', 'Spotify', 11.99),
      tx('2026-06-05', 'Spotify', 11.99),
    ];
    const [found] = detectRecurringCandidates(txns);
    if (!found) throw new Error('unreachable: nothing detected');
    expect(found.frequency).toBe('monthly');
  });

  it('predicts the next date from the whole series, not just the last charge', () => {
    // The final charge landed three days early. advanceDate would carry that
    // drift forward; the detector knows the phase of every prior occurrence.
    const txns = [
      tx('2026-01-10', 'Rent', 1200),
      tx('2026-02-10', 'Rent', 1200),
      tx('2026-03-10', 'Rent', 1200),
      tx('2026-04-07', 'Rent', 1200),
    ];
    const [found] = detectRecurringCandidates(txns);
    if (!found) throw new Error('unreachable: nothing detected');
    expect(found.frequency).toBe('monthly');
    expect(found.nextDate).not.toBe('2026-05-07');
  });

  it('does not invent a cadence for scattered one-off purchases', () => {
    const txns = [
      tx('2026-01-03', 'Canadian Tire', 40),
      tx('2026-01-27', 'Canadian Tire', 40),
      tx('2026-03-14', 'Canadian Tire', 40),
      tx('2026-03-19', 'Canadian Tire', 40),
      tx('2026-06-02', 'Canadian Tire', 40),
    ];
    expect(detectRecurringCandidates(txns)).toEqual([]);
  });
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
    expect(isTemplateDue(makeRecurring({ nextDate: '2026-05-01', active: true }), '2026-05-29')).toBe(true);
    expect(isTemplateDue(makeRecurring({ nextDate: '2026-06-15', active: true }), '2026-05-29')).toBe(false);
    expect(isTemplateDue(makeRecurring({ nextDate: '2026-05-01', active: false }), '2026-05-29')).toBe(false);
  });
});

describe('postTemplate', () => {
  it('produces a transaction and advances the template', () => {
    const template = makeRecurring({ id: 'r1', merchant: 'Spotify', amount: 10.99, category: 'subscriptions', frequency: 'monthly', nextDate: '2026-05-05', active: true });
    const { transaction, template: updated } = postTemplate(template, '2026-05-29');
    expect(transaction).toMatchObject({
      merchant: 'Spotify', amount: 10.99, date: '2026-05-05', recurringTemplateId: 'r1',
    });
    expect(transaction.tags).toContain('recurring');
    expect(updated.nextDate).toBe('2026-06-05');
  });
});
