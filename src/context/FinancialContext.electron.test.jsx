// The Electron startup path, which the web-mode tests never reach.
//
// The case that matters most here is a load that fails. That used to unlock
// persistence anyway (the flag was set in a `finally`), so the next dispatch
// wrote the empty placeholder state over a database that was merely unreadable.
// These tests pin the invariant: nothing is written unless the load succeeded.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Each case resets the module registry and re-imports React, testing-library
// and the whole context graph — the only way to stub `window.api` before
// storage.js reads it. That is a few seconds of module evaluation per test,
// charged against the test's own timeout, so the default 5s is not enough
// once the suite is running everything else in parallel.
vi.setConfig({ testTimeout: 30000 });

const EMPTY_STATE = {
  transactions: [], budgets: [], incomes: [], savings_goals: [],
  investments: [], debts: [], recurringTemplates: [], customCategories: [],
  settings: { currency: 'USD' },
};

let captured;
let view;

/**
 * storage.js reads `window.api` once at module load, so the stub has to be in
 * place before the module graph is imported — hence resetModules and dynamic
 * imports.
 *
 * React and @testing-library/react are imported dynamically *too*, and that is
 * not incidental: resetModules gives the dynamically imported component tree a
 * fresh React, and a statically imported testing-library would still hold the
 * previous one. Two React copies render into the same document without
 * cleaning up after each other — the symptom is duplicate elements and a
 * `captured` that never gets set.
 */
async function renderElectron(db) {
  window.api = { isElectron: true, db, ai: {} };
  vi.resetModules();

  const React = (await import('react')).default;
  const rtl = await import('@testing-library/react');
  const { FinancialProvider, useFinancial } = await import('./FinancialContext');

  function Capture() {
    captured = useFinancial();
    return React.createElement('div', { 'data-testid': 'ready' }, captured.state.transactions.length);
  }

  await rtl.act(async () => {
    view = rtl.render(
      React.createElement(FinancialProvider, null, React.createElement(Capture)),
    );
  });
  return rtl;
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

beforeEach(() => { captured = undefined; view = undefined; localStorage.clear(); });
afterEach(() => {
  view?.unmount();
  delete window.api;
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('Electron startup', () => {
  it('never writes back when the load failed', async () => {
    const db = makeDb({ loadAll: vi.fn().mockRejectedValue(new Error('database disk image is malformed')) });
    const rtl = await renderElectron(db);

    // The app is blocked, so there is no way to dispatch and nothing to write.
    await rtl.waitFor(() => expect(view.getByText(/couldn't open your data/i)).toBeInTheDocument());
    expect(view.queryByTestId('ready')).toBeNull();
    expect(db.saveAll).not.toHaveBeenCalled();
  });

  it('shows the failure rather than an empty ledger', async () => {
    const rtl = await renderElectron(makeDb({ isInitialized: vi.fn().mockRejectedValue(new Error('locked')) }));
    await rtl.waitFor(() => expect(view.getByText(/nothing has been/i)).toBeInTheDocument());
    expect(view.queryByTestId('ready')).toBeNull();
  });

  it('unlocks persistence once the load succeeds', async () => {
    const db = makeDb({
      loadAll: vi.fn().mockResolvedValue({ ...EMPTY_STATE, transactions: [{ id: 'pre', amount: 5 }] }),
    });
    const rtl = await renderElectron(db);

    expect(captured.state.transactions).toHaveLength(1);
    db.saveAll.mockClear();

    await rtl.act(async () => { captured.dispatch({ type: 'ADD_TRANSACTION', payload: { id: 't2', amount: 1 } }); });
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
    const rtl = await renderElectron(db);

    expect(captured.state).not.toHaveProperty('_corruptRows');

    await rtl.act(async () => { captured.dispatch({ type: 'ADD_TRANSACTION', payload: { id: 't1', amount: 1 } }); });
    expect(db.saveAll.mock.calls.at(-1)[0]).not.toHaveProperty('_corruptRows');
  });

  it('reports a failing save instead of swallowing it', async () => {
    const db = makeDb({ saveAll: vi.fn().mockRejectedValue(new Error('SQLITE_FULL')) });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rtl = await renderElectron(db);

    await rtl.act(async () => { captured.dispatch({ type: 'ADD_TRANSACTION', payload: { id: 't1', amount: 1 } }); });
    await rtl.waitFor(() => expect(err).toHaveBeenCalledWith('Save failed:', expect.any(Error)));
  });
});
