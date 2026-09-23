// The runtime-backend switch: SQLite under Electron, localStorage in a browser.
//
// storage.ts resolves `electronBridge` ONCE, at module evaluation time, from
// `window.api`. That is deliberate — the bridge cannot appear or vanish while
// the app is running — but it means a test file that imports the module at the
// top can only ever exercise whichever branch happened to be live when the
// module first loaded. Every case here therefore stubs (or deletes)
// `window.api`, calls vi.resetModules() to throw away the cached evaluation,
// and re-imports with `await import('./storage')`. That dance is the only way
// to see both halves of the switch, and it is why this file has no static
// import of the module under test.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { AiBridge, DatabaseBridge, FinanceFlowApi } from '../types/api';
import { makeState, makeTransaction } from '../test/factories';

type StorageModule = typeof import('./storage');

/** The db bridge with every method a spy, so delegation is readable off `.mock`. */
type MockDb = { [K in keyof DatabaseBridge]: Mock };

/** Storage never touches the AI bridge; this only exists to satisfy the type. */
const AI_STUB: AiBridge = {
  status: vi.fn(),
  setKey: vi.fn(),
  clearKey: vi.fn(),
  run: vi.fn(),
};

// Hard-coded rather than imported: STORAGE_KEY is not exported, and it is a
// data contract with blobs written by every previous version of the app. If a
// refactor renames it, users silently lose their ledger — so the literal being
// spelled out here, and failing loudly, is the point.
const STORAGE_KEY = 'financeflow_data';

const makeDb = (over: Partial<MockDb> = {}): MockDb => ({
  isInitialized: vi.fn().mockResolvedValue(true),
  loadAll: vi.fn().mockResolvedValue(null),
  saveAll: vi.fn().mockResolvedValue(true),
  markInitialized: vi.fn().mockResolvedValue(true),
  ...over,
});

/** Load storage with an Electron bridge in place. */
async function loadElectron(db: MockDb): Promise<StorageModule> {
  window.api = { isElectron: true, db, ai: AI_STUB };
  vi.resetModules();
  return import('./storage');
}

/** Load storage the way `npm run dev` does: no preload, so no `window.api`. */
async function loadWeb(): Promise<StorageModule> {
  delete window.api;
  vi.resetModules();
  return import('./storage');
}

beforeEach(() => { delete window.api; localStorage.clear(); });
afterEach(() => { delete window.api; vi.restoreAllMocks(); localStorage.clear(); });

describe('browser mode', () => {
  it('reports itself as localStorage-backed and hands out no bridge', async () => {
    const storage = await loadWeb();
    expect(storage.isElectron).toBe(false);
    expect(storage.storageMode).toBe('localStorage');
    // Callers narrow on this instead of reaching for the optional global, so a
    // null here is what keeps `window.api?` honest in web builds.
    expect(storage.electronApi()).toBeNull();
  });

  it('round-trips the whole state through the legacy blob', async () => {
    const storage = await loadWeb();
    const state = makeState({ transactions: [makeTransaction({ id: 't1', amount: 42 })] });

    expect(await storage.isInitialized()).toBe(false); // nothing written yet
    await storage.saveState(state);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    if (raw === null) throw new Error('unreachable');
    expect(JSON.parse(raw)).toEqual(state);

    expect(await storage.loadState()).toEqual(state);
    expect(storage.readLegacyLocalStorage()).toEqual(state);
    // The blob's existence *is* the initialized flag in web mode.
    expect(await storage.isInitialized()).toBe(true);
  });

  it('loads null before anything has been saved', async () => {
    const storage = await loadWeb();
    expect(await storage.loadState()).toBeNull();
    expect(storage.readLegacyLocalStorage()).toBeNull();
  });

  it('treats markInitialized as a no-op rather than writing a flag', async () => {
    const storage = await loadWeb();
    // There is no separate flag row in web mode, so this must not invent one —
    // a stray key would make isInitialized() true over an empty ledger and the
    // first-run bootstrap would skip seeding.
    await expect(storage.markInitialized()).resolves.toBeUndefined();
    expect(localStorage.length).toBe(0);
    expect(await storage.isInitialized()).toBe(false);
  });
});

describe('readLegacyLocalStorage', () => {
  it('returns null on a corrupt blob instead of throwing', async () => {
    const storage = await loadWeb();
    localStorage.setItem(STORAGE_KEY, '{"transactions":[');
    // A half-written blob must read as "no data", not crash the app on boot;
    // the bootstrap then seeds a fresh ledger rather than showing a blank page.
    expect(storage.readLegacyLocalStorage()).toBeNull();
    expect(await storage.loadState()).toBeNull();
    expect(await storage.isInitialized()).toBe(false);
  });

  it('returns null when localStorage itself is unavailable', async () => {
    const storage = await loadWeb();
    // Safari private mode and blocked site data make getItem *throw*, not
    // return null. That used to take the whole app down before first paint.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(storage.readLegacyLocalStorage()).toBeNull();
    await expect(storage.loadState()).resolves.toBeNull();
  });

  it('reads an empty string as no data', async () => {
    const storage = await loadWeb();
    localStorage.setItem(STORAGE_KEY, '');
    // Falsy, so it never reaches JSON.parse — which would throw on ''.
    expect(storage.readLegacyLocalStorage()).toBeNull();
  });
});

describe('electron mode', () => {
  it('reports itself as sqlite-backed and exposes the bridge it was given', async () => {
    const db = makeDb();
    const storage = await loadElectron(db);
    expect(storage.isElectron).toBe(true);
    expect(storage.storageMode).toBe('sqlite');
    expect(storage.electronApi()).toBe(window.api);
  });

  it('delegates every operation to db.* and leaves localStorage alone', async () => {
    const state = makeState({ transactions: [makeTransaction({ id: 't1', amount: 7 })] });
    const db = makeDb({
      loadAll: vi.fn().mockResolvedValue(state),
      isInitialized: vi.fn().mockResolvedValue(false),
    });
    const storage = await loadElectron(db);

    // Spied after the module loaded, so this only catches storage's own reads
    // and writes — the point being that SQLite is the single source of truth
    // and a stale localStorage blob must never be consulted or refreshed.
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    expect(await storage.isInitialized()).toBe(false);
    expect(db.isInitialized).toHaveBeenCalledTimes(1);

    expect(await storage.loadState()).toEqual(state);
    expect(db.loadAll).toHaveBeenCalledTimes(1);

    await storage.saveState(state);
    expect(db.saveAll).toHaveBeenCalledTimes(1);
    expect(db.saveAll.mock.calls[0][0]).toEqual(state);

    await storage.markInitialized();
    expect(db.markInitialized).toHaveBeenCalledTimes(1);

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('ignores a bridge that is present but not flagged as Electron', async () => {
    // `isElectron: false` is the point of this case: the type says the flag is
    // always true, but a half-initialised or spoofed preload is exactly what
    // the `&& window.api.isElectron` guard exists to reject, and without the
    // cast there is no way to express it.
    window.api = { isElectron: false, db: makeDb(), ai: AI_STUB } as unknown as FinanceFlowApi;
    vi.resetModules();
    const storage: StorageModule = await import('./storage');

    expect(storage.isElectron).toBe(false);
    expect(storage.storageMode).toBe('localStorage');
    expect(storage.electronApi()).toBeNull();
  });
});

describe('saveState failure', () => {
  it('rejects when the database write fails', async () => {
    const db = makeDb({ saveAll: vi.fn().mockRejectedValue(new Error('SQLITE_FULL')) });
    const storage = await loadElectron(db);
    // Load-bearing: a save that fails quietly leaves the user editing a copy
    // that is never written, and they only find out when they reopen the app.
    // The caller turns this rejection into a toast, so it must reach them.
    await expect(storage.saveState(makeState())).rejects.toThrow('SQLITE_FULL');
  });

  it('rejects when localStorage refuses the write', async () => {
    const storage = await loadWeb();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    // Same invariant on the web side. saveState has no try/catch here on
    // purpose — the synchronous throw becomes a rejected promise, which is
    // what the caller is already awaiting.
    await expect(storage.saveState(makeState())).rejects.toThrow('QuotaExceededError');
  });
});
