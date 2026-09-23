// The Electron startup path, which the web-mode tests never reach.
//
// The case that matters most here is a load that fails. That used to unlock
// persistence anyway (the flag was set in a `finally`), so the next dispatch
// wrote the empty placeholder state over a database that was merely unreadable.
// These tests pin the invariant: nothing is written unless the load succeeded.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Type-only imports: erased at compile time, so they pull in neither a second
// React nor a second testing-library at runtime.
import type { Mock } from 'vitest';
import type { RenderResult } from '@testing-library/react';
import type { FinancialContextValue } from './FinancialContext';
import type { AiBridge, DatabaseBridge } from '../types/api';
import { makeState, makeTransaction } from '../test/factories';

// Each case resets the module registry and re-imports React, testing-library
// and the whole context graph — the only way to stub `window.api` before
// storage.js reads it. That is a few seconds of module evaluation per test,
// charged against the test's own timeout, so the default 5s is not enough
// once the suite is running everything else in parallel.
vi.setConfig({ testTimeout: 30000 });

const EMPTY_STATE = makeState({ settings: { currency: 'USD' } });

/** The db bridge as these tests use it: every method a spy, so the writes the
 *  context makes can be read back off `.mock.calls`. */
type MockDb = { [K in keyof DatabaseBridge]: Mock };

/** The context never touches the AI bridge; this is here to satisfy the type. */
const AI_STUB: AiBridge = {
  status: vi.fn().mockResolvedValue({ encryptionAvailable: false, hasKey: false }),
  setKey: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
  clearKey: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
  run: vi.fn().mockResolvedValue({ ok: true, data: null }),
};

let captured: FinancialContextValue | undefined;
let view: RenderResult | undefined;

/** The latest { state, dispatch }. Undefined until the provider renders its
 *  children, which the blocked-startup cases deliberately never do. */
function ctx(): FinancialContextValue {
  expect(captured).toBeDefined();
  if (!captured) throw new Error('the provider never rendered its children');
  return captured;
}

function ui(): RenderResult {
  expect(view).toBeDefined();
  if (!view) throw new Error('renderElectron() was not called');
  return view;
}

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
async function renderElectron(db: MockDb) {
  window.api = { isElectron: true, db, ai: AI_STUB };
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

function makeDb(overrides: Partial<MockDb> = {}): MockDb {
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
    await rtl.waitFor(() => expect(ui().getByText(/couldn't open your data/i)).toBeInTheDocument());
    expect(ui().queryByTestId('ready')).toBeNull();
    expect(db.saveAll).not.toHaveBeenCalled();
  });

  it('shows the failure rather than an empty ledger', async () => {
    const rtl = await renderElectron(makeDb({ isInitialized: vi.fn().mockRejectedValue(new Error('locked')) }));
    await rtl.waitFor(() => expect(ui().getByText(/nothing has been/i)).toBeInTheDocument());
    expect(ui().queryByTestId('ready')).toBeNull();
  });

  it('unlocks persistence once the load succeeds', async () => {
    const db = makeDb({
      loadAll: vi.fn().mockResolvedValue({ ...EMPTY_STATE, transactions: [{ id: 'pre', amount: 5 }] }),
    });
    const rtl = await renderElectron(db);

    expect(ctx().state.transactions).toHaveLength(1);
    db.saveAll.mockClear();

    await rtl.act(async () => { ctx().dispatch({ type: 'ADD_TRANSACTION', payload: makeTransaction({ id: 't2', amount: 1 }) }); });
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
    expect(ctx().state.transactions).toEqual([]);
  });

  it('strips the corrupt-row report so it is never written back as state', async () => {
    const db = makeDb({
      loadAll: vi.fn().mockResolvedValue({ ...EMPTY_STATE, _corruptRows: 3 }),
    });
    const rtl = await renderElectron(db);

    expect(ctx().state).not.toHaveProperty('_corruptRows');

    await rtl.act(async () => { ctx().dispatch({ type: 'ADD_TRANSACTION', payload: makeTransaction({ id: 't1', amount: 1 }) }); });
    const lastSave = db.saveAll.mock.calls.at(-1);
    expect(lastSave).toBeDefined();
    if (!lastSave) throw new Error('unreachable');
    expect(lastSave[0]).not.toHaveProperty('_corruptRows');
  });

  it('reports a failing save instead of swallowing it', async () => {
    const db = makeDb({ saveAll: vi.fn().mockRejectedValue(new Error('SQLITE_FULL')) });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rtl = await renderElectron(db);

    await rtl.act(async () => { ctx().dispatch({ type: 'ADD_TRANSACTION', payload: makeTransaction({ id: 't1', amount: 1 }) }); });
    await rtl.waitFor(() => expect(err).toHaveBeenCalledWith('Save failed:', expect.any(Error)));
  });
});
