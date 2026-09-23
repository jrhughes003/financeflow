// The Electron startup path, which the web-mode tests never reach.
//
// The case that matters most here is a load that fails. That used to unlock
// persistence anyway (the flag was set in a `finally`), so the next dispatch
// wrote the empty placeholder state over a database that was merely unreadable.
// These tests pin the invariant: nothing is written unless the load succeeded.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

const EMPTY_STATE = {
  transactions: [], budgets: [], incomes: [], savings_goals: [],
  investments: [], debts: [], recurringTemplates: [], customCategories: [],
  settings: { currency: 'USD' },
};

let captured;

/**
 * storage.js reads `window.api` once at module load, so the stub has to be in
 * place before the module graph is imported — hence resetModules + dynamic
 * import rather than a top-level import.
 */
async function renderElectron(db) {
  window.api = { isElectron: true, db, ai: {} };
  vi.resetModules();
  const { FinancialProvider, useFinancial } = await import('./FinancialContext.jsx');

  function Capture() {
    captured = useFinancial();
    return <div data-testid="ready">{captured.state.transactions.length}</div>;
  }

  await act(async () => {
    render(<FinancialProvider><Capture /></FinancialProvider>);
  });
}

function makeDb(overrides = {}) {
  return {
    isInitialized: vi.fn().mockResolvedValue(true),
    loadAll: vi.fn().mockResolvedValue({ ...EMPTY_STATE }),
    saveAll: vi.fn().mockResolvedValue(true),
    markInitialized: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => { captured = undefined; localStorage.clear(); });
afterEach(() => { delete window.api; vi.restoreAllMocks(); });

describe('Electron startup', () => {
  it('never writes back when the load failed', async () => {
    const db = makeDb({ loadAll: vi.fn().mockRejectedValue(new Error('database disk image is malformed')) });
    await renderElectron(db);

    // The app is blocked, so there is no way to dispatch and nothing to write.
    await waitFor(() => expect(screen.getByText(/couldn't open your data/i)).toBeInTheDocument());
    expect(screen.queryByTestId('ready')).toBeNull();
    expect(db.saveAll).not.toHaveBeenCalled();
  });

  it('shows the failure rather than an empty ledger', async () => {
    await renderElectron(makeDb({ isInitialized: vi.fn().mockRejectedValue(new Error('locked')) }));
    await waitFor(() => expect(screen.getByText(/nothing has been/i)).toBeInTheDocument());
    expect(screen.queryByTestId('ready')).toBeNull();
  });

  it('unlocks persistence once the load succeeds', async () => {
    const db = makeDb({
      loadAll: vi.fn().mockResolvedValue({ ...EMPTY_STATE, transactions: [{ id: 'pre', amount: 5 }] }),
    });
    await renderElectron(db);

    expect(captured.state.transactions).toHaveLength(1);
    db.saveAll.mockClear();

    await act(async () => { captured.dispatch({ type: 'ADD_TRANSACTION', payload: { id: 't2', amount: 1 } }); });
    expect(db.saveAll).toHaveBeenCalledTimes(1);
    expect(db.saveAll.mock.calls[0][0].transactions).toHaveLength(2);
  });

  it('seeds a fresh database exactly once', async () => {
    const db = makeDb({ isInitialized: vi.fn().mockResolvedValue(false) });
    await renderElectron(db);

    // The seed is written directly, then the persist effect writes the same
    // state again once the load unlocks it. Redundant, but not wrong — so this
    // asserts the seed landed rather than pinning a write count.
    expect(db.saveAll).toHaveBeenCalled();
    expect(db.markInitialized).toHaveBeenCalledTimes(1);
    expect(db.saveAll.mock.calls[0][0].budgets).toHaveLength(5);
    expect(captured.state.transactions).toEqual([]);
  });

  it('strips the corrupt-row report so it is never written back as state', async () => {
    const db = makeDb({
      loadAll: vi.fn().mockResolvedValue({ ...EMPTY_STATE, _corruptRows: 3 }),
    });
    await renderElectron(db);

    expect(captured.state).not.toHaveProperty('_corruptRows');

    await act(async () => { captured.dispatch({ type: 'ADD_TRANSACTION', payload: { id: 't1', amount: 1 } }); });
    expect(db.saveAll.mock.calls.at(-1)[0]).not.toHaveProperty('_corruptRows');
  });

  it('reports a failing save instead of swallowing it', async () => {
    const db = makeDb({ saveAll: vi.fn().mockRejectedValue(new Error('SQLITE_FULL')) });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderElectron(db);

    await act(async () => { captured.dispatch({ type: 'ADD_TRANSACTION', payload: { id: 't1', amount: 1 } }); });
    await waitFor(() => expect(err).toHaveBeenCalledWith('Save failed:', expect.any(Error)));
  });
});
