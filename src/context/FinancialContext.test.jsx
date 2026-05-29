import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { FinancialProvider, useFinancial } from './FinancialContext';

// The reducer is private, so we drive it through the public provider + hook.
// A tiny harness captures the latest { state, dispatch } so tests can dispatch
// actions and assert on the resulting state.
let captured;
function Capture() {
  captured = useFinancial();
  return <div data-testid="count">{captured.state.transactions.length}</div>;
}

function renderProvider() {
  return render(
    <FinancialProvider>
      <Capture />
    </FinancialProvider>,
  );
}

const send = (action) => act(() => captured.dispatch(action));

beforeEach(() => {
  localStorage.clear();
  captured = undefined;
});
afterEach(() => {
  localStorage.clear();
});

describe('FinancialProvider reducer', () => {
  it('starts from sample data when localStorage is empty', () => {
    renderProvider();
    expect(captured.state.transactions).toEqual([]);
    expect(captured.state.budgets.length).toBe(5);
  });

  it('ADD / UPDATE / DELETE_TRANSACTION', () => {
    renderProvider();
    send({ type: 'ADD_TRANSACTION', payload: { id: 't1', amount: 10, merchant: 'A' } });
    expect(captured.state.transactions).toHaveLength(1);

    send({ type: 'UPDATE_TRANSACTION', payload: { id: 't1', amount: 99, merchant: 'A' } });
    expect(captured.state.transactions[0].amount).toBe(99);

    send({ type: 'DELETE_TRANSACTION', payload: 't1' });
    expect(captured.state.transactions).toHaveLength(0);
  });

  it('MARK_EXCEPTION toggles the flag', () => {
    renderProvider();
    send({ type: 'ADD_TRANSACTION', payload: { id: 't1', amount: 10 } });
    send({ type: 'MARK_EXCEPTION', payload: 't1' });
    expect(captured.state.transactions[0].isException).toBe(true);
    send({ type: 'MARK_EXCEPTION', payload: 't1' });
    expect(captured.state.transactions[0].isException).toBe(false);
  });

  it('SET_BUDGET upserts (insert then update)', () => {
    renderProvider();
    const before = captured.state.budgets.length;
    send({ type: 'SET_BUDGET', payload: { id: 'newb', category: 'x', amount: 10 } });
    expect(captured.state.budgets.length).toBe(before + 1);
    send({ type: 'SET_BUDGET', payload: { id: 'newb', category: 'x', amount: 20 } });
    expect(captured.state.budgets.length).toBe(before + 1);
    expect(captured.state.budgets.find(b => b.id === 'newb').amount).toBe(20);
  });

  it('IMPORT_TRANSACTIONS appends', () => {
    renderProvider();
    send({ type: 'IMPORT_TRANSACTIONS', payload: [{ id: 'a' }, { id: 'b' }] });
    expect(captured.state.transactions).toHaveLength(2);
  });

  it('ADD_CATEGORY is idempotent on id; DELETE_CATEGORY removes', () => {
    renderProvider();
    send({ type: 'ADD_CATEGORY', payload: { id: 'c1', name: 'Pets' } });
    send({ type: 'ADD_CATEGORY', payload: { id: 'c1', name: 'Pets (dup)' } });
    expect(captured.state.customCategories).toHaveLength(1);
    send({ type: 'DELETE_CATEGORY', payload: 'c1' });
    expect(captured.state.customCategories).toHaveLength(0);
  });

  it('UPDATE_SETTINGS merges', () => {
    renderProvider();
    send({ type: 'UPDATE_SETTINGS', payload: { currency: 'CAD' } });
    expect(captured.state.settings.currency).toBe('CAD');
    // existing keys preserved
    expect(captured.state.settings).toHaveProperty('showSampleData');
  });

  it('persists to localStorage on change', () => {
    renderProvider();
    send({ type: 'ADD_TRANSACTION', payload: { id: 't1', amount: 10 } });
    const stored = JSON.parse(localStorage.getItem('financeflow_data'));
    expect(stored.transactions).toHaveLength(1);
  });

  it('loads existing localStorage data on mount', () => {
    localStorage.setItem('financeflow_data', JSON.stringify({
      transactions: [{ id: 'pre', amount: 5 }],
      budgets: [], incomes: [], savings_goals: [], investments: [],
      debts: [], recurringTemplates: [], settings: {},
    }));
    renderProvider();
    expect(captured.state.transactions).toHaveLength(1);
    expect(captured.state.transactions[0].id).toBe('pre');
    // backwards-compat: customCategories is always present
    expect(captured.state.customCategories).toEqual([]);
  });
});
