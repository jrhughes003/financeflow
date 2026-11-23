import { describe, it, expect } from 'vitest';
import { buildReminders, pruneDismissed } from './reminders';
import { asAppState } from '../types/state';

const today = new Date(2026, 10, 23); // 23 Nov 2026

const state = asAppState({
  recurringTemplates: [
    { id: 'rent', merchant: 'Rent', amount: 1650, category: 'housing', frequency: 'monthly', nextDate: '2026-11-25' },
    { id: 'far', merchant: 'Insurance', amount: 90, category: 'insurance', frequency: 'monthly', nextDate: '2026-12-10' },
    { id: 'late', merchant: 'Gym', amount: 40, category: 'health', frequency: 'monthly', nextDate: '2026-11-20' },
    { id: 'off', merchant: 'Paused', amount: 5, category: 'x', frequency: 'monthly', nextDate: '2026-11-24', active: false },
  ],
  transactions: [
    { id: 'd1', date: '2026-10-01', merchant: 'Dinner', amount: 120, category: 'dining', owed: { amount: 60, people: 2, payments: [], forgiven: false } },
    { id: 'd2', date: '2026-11-20', merchant: 'Lunch', amount: 40, category: 'dining', owed: { amount: 20, people: 2, payments: [], forgiven: false } },
  ],
  investments: [
    { id: 'chq', name: 'Chequing', type: 'cash', currentValue: 1000, asOfDate: '2026-11-01' },
    { id: 'fresh', name: 'Savings', type: 'cash', currentValue: 1000, asOfDate: '2026-11-20' },
    { id: 'tfsa', name: 'TFSA', type: 'stocks', currentValue: 1000, asOfDate: '2026-01-01' },
  ],
});

describe('buildReminders', () => {
  it('finds overdue charges, bills due soon, old debts owed and stale balances, most pressing first', () => {
    const r = buildReminders(state, today);
    expect(r.map(x => x.kind)).toEqual(['overdue', 'bill', 'owed', 'stale-balance']);
    expect(r[1].text).toContain('Rent');
    expect(r[2].text).toContain('$60.00');
    expect(r[3].text).toContain('Chequing');
  });

  it('hides dismissed reminders by id, and a dismissed bill is only that date', () => {
    const r = buildReminders(state, today, ['bill:rent:2026-11-25']);
    expect(r.some(x => x.kind === 'bill')).toBe(false);
    const nextMonth = buildReminders({ ...state, recurringTemplates: [{ ...state.recurringTemplates[0], nextDate: '2026-11-24' }] }, today, ['bill:rent:2026-11-25']);
    expect(nextMonth.some(x => x.kind === 'bill')).toBe(true);
  });

  it('prunes dismissals for dates long past', () => {
    expect(pruneDismissed(['bill:a:2026-01-01', 'bill:b:2026-11-01', 'owed:x'], today)).toEqual(['bill:b:2026-11-01', 'owed:x']);
  });
});
