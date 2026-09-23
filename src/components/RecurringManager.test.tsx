// This page called toMonthlyAmount without importing it, so the monthly total
// threw a ReferenceError as soon as the user had one active template. With no
// templates the reduce never ran its callback, which is why it survived: the
// empty state worked perfectly and every populated one crashed.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FinancialProvider } from '../context/FinancialContext';
import { ToastProvider } from '../context/ToastContext';
import RecurringManager from './RecurringManager';
import { makeRecurring } from '../test/factories';
import type { RecurringTemplate } from '../types/domain';

const seed = (templates: RecurringTemplate[]) => localStorage.setItem('financeflow_data', JSON.stringify({
  transactions: [], budgets: [], incomes: [], savings_goals: [], investments: [],
  debts: [], customCategories: [], settings: { currency: 'CAD' },
  recurringTemplates: templates,
}));

const template = (over: Partial<RecurringTemplate> = {}): RecurringTemplate => makeRecurring({
  category: 'entertainment', nextDate: '2099-01-01', active: true, ...over,
});

const renderPage = () => render(
  <ToastProvider><FinancialProvider><RecurringManager /></FinancialProvider></ToastProvider>,
);

// <Money> puts the currency symbol in its own span so it can be de-emphasised,
// so the figure is never one text node. Read the whole tree instead.
const text = (view: ReturnType<typeof renderPage>) => view.container.textContent;

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('RecurringManager', () => {
  it('renders with no templates', () => {
    seed([]);
    expect(() => renderPage()).not.toThrow();
  });

  it('renders with an active template rather than throwing', () => {
    seed([template()]);
    expect(() => renderPage()).not.toThrow();
    expect(screen.getByText('Spotify')).toBeInTheDocument();
  });

  // The crash was in the monthly total, so the total is what to assert on:
  // weekly and annual charges have to be converted, not summed as they stand.
  it('normalises every cadence into one monthly figure', () => {
    seed([
      template({ id: 'a', merchant: 'Weekly', amount: 10, frequency: 'weekly' }),
      template({ id: 'b', merchant: 'Monthly', amount: 50, frequency: 'monthly' }),
      template({ id: 'c', merchant: 'Yearly', amount: 120, frequency: 'annual' }),
    ]);
    // 10/wk → 43.33, plus 50 monthly, plus 120/yr → 10. Summing them as they
    // stand would give 180.
    expect(text(renderPage())).toMatch(/\$103\.33/);
  });

  it('leaves paused templates out of the monthly total', () => {
    seed([template({ amount: 50 }), template({ id: 'rt2', merchant: 'Paused', amount: 999, active: false })]);
    const view = renderPage();
    expect(text(view)).toMatch(/\$50\.00/);
    expect(text(view)).not.toMatch(/\$1,049/);
  });
});
