import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { FinancialProvider, useFinancial } from './FinancialContext';
import type { FinancialContextValue } from './FinancialContext';
import type { Action, AppState } from '../types/state';
import { makeBudget, makeCategory, makeTransaction } from '../test/factories';

// The reducer is private, so we drive it through the public provider + hook.
// A tiny harness captures the latest { state, dispatch } so tests can dispatch
// actions and assert on the resulting state.
let captured: FinancialContextValue | undefined;
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

/** The latest { state, dispatch }. Capture writes it on every render, so it is
 *  only ever undefined when renderProvider() has not run. */
function ctx(): FinancialContextValue {
  expect(captured).toBeDefined();
  if (!captured) throw new Error('renderProvider() was not called');
  return captured;
}

const send = (action: Action) => act(() => ctx().dispatch(action));

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
    expect(ctx().state.transactions).toEqual([]);
    expect(ctx().state.budgets.length).toBe(5);
  });

  it('ADD / UPDATE / DELETE_TRANSACTION', () => {
    renderProvider();
    send({ type: 'ADD_TRANSACTION', payload: makeTransaction({ id: 't1', amount: 10, merchant: 'A' }) });
    expect(ctx().state.transactions).toHaveLength(1);

    send({ type: 'UPDATE_TRANSACTION', payload: makeTransaction({ id: 't1', amount: 99, merchant: 'A' }) });
    expect(ctx().state.transactions[0].amount).toBe(99);

    send({ type: 'DELETE_TRANSACTION', payload: 't1' });
    expect(ctx().state.transactions).toHaveLength(0);
  });

  it('MARK_EXCEPTION toggles the flag', () => {
    renderProvider();
    send({ type: 'ADD_TRANSACTION', payload: makeTransaction({ id: 't1', amount: 10 }) });
    send({ type: 'MARK_EXCEPTION', payload: 't1' });
    expect(ctx().state.transactions[0].isException).toBe(true);
    send({ type: 'MARK_EXCEPTION', payload: 't1' });
    expect(ctx().state.transactions[0].isException).toBe(false);
  });

  it('SET_BUDGET upserts (insert then update)', () => {
    renderProvider();
    const before = ctx().state.budgets.length;
    send({ type: 'SET_BUDGET', payload: makeBudget({ id: 'newb', category: 'x', amount: 10 }) });
    expect(ctx().state.budgets.length).toBe(before + 1);
    send({ type: 'SET_BUDGET', payload: makeBudget({ id: 'newb', category: 'x', amount: 20 }) });
    expect(ctx().state.budgets.length).toBe(before + 1);
    const updated = ctx().state.budgets.find(b => b.id === 'newb');
    expect(updated).toBeDefined();
    if (!updated) throw new Error('unreachable');
    expect(updated.amount).toBe(20);
  });

  it('IMPORT_TRANSACTIONS appends', () => {
    renderProvider();
    send({ type: 'IMPORT_TRANSACTIONS', payload: [makeTransaction({ id: 'a' }), makeTransaction({ id: 'b' })] });
    expect(ctx().state.transactions).toHaveLength(2);
  });

  it('ADD_CATEGORY is idempotent on id; DELETE_CATEGORY removes', () => {
    renderProvider();
    send({ type: 'ADD_CATEGORY', payload: makeCategory({ id: 'c1', name: 'Pets' }) });
    send({ type: 'ADD_CATEGORY', payload: makeCategory({ id: 'c1', name: 'Pets (dup)' }) });
    expect(ctx().state.customCategories).toHaveLength(1);
    send({ type: 'DELETE_CATEGORY', payload: 'c1' });
    expect(ctx().state.customCategories).toHaveLength(0);
  });

  it('UPDATE_SETTINGS merges', () => {
    renderProvider();
    send({ type: 'UPDATE_SETTINGS', payload: { currency: 'CAD' } });
    expect(ctx().state.settings.currency).toBe('CAD');
    // existing keys preserved
    expect(ctx().state.settings).toHaveProperty('showSampleData');
  });

  it('persists to localStorage on change', () => {
    renderProvider();
    send({ type: 'ADD_TRANSACTION', payload: makeTransaction({ id: 't1', amount: 10 }) });
    const raw = localStorage.getItem('financeflow_data');
    expect(raw).not.toBeNull();
    if (!raw) throw new Error('unreachable');
    const stored = JSON.parse(raw) as AppState;
    expect(stored.transactions).toHaveLength(1);
  });

  it('loads existing localStorage data on mount', () => {
    localStorage.setItem('financeflow_data', JSON.stringify({
      transactions: [{ id: 'pre', amount: 5 }],
      budgets: [], incomes: [], savings_goals: [], investments: [],
      debts: [], recurringTemplates: [], settings: {},
    }));
    renderProvider();
    expect(ctx().state.transactions).toHaveLength(1);
    expect(ctx().state.transactions[0].id).toBe('pre');
    // backwards-compat: customCategories is always present
    expect(ctx().state.customCategories).toEqual([]);
  });
});
