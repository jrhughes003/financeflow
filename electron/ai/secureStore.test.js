// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

// A stand-in for Electron's OS-backed safeStorage. The real one is DPAPI /
// Keychain and cannot run here, and a real cipher would only test the cipher —
// what is worth testing is this module's logic: that it encrypts before it
// writes, refuses to write when it cannot encrypt, and survives ciphertext it
// cannot read. So the fake is trivially reversible but *not* the identity: it
// reverses the string behind a marker, which means an assertion that the
// plaintext is absent from the stored row is a real assertion and not one that
// base64 would satisfy on its own.
const MARKER = 'fake-enc:';
const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
}));

// Covers anything that reaches electron through the ESM graph.
vi.mock('electron', () => ({ safeStorage }));

// ...but secureStore.cjs is CommonJS, and its `require('electron')` goes
// straight to Node, past Vitest's module registry: without the line below it
// receives the real electron package, whose main export is a *path string*, so
// `safeStorage` destructures to undefined and every call is a TypeError (which
// isEncryptionAvailable's catch then reports as "unavailable"). Seeding the
// CommonJS cache with the fake before the module is loaded is what actually
// injects it. The module under test is imported dynamically so that happens
// first — static imports are hoisted above this.
const require = createRequire(import.meta.url);
const electronId = require.resolve('electron');
require.cache[electronId] = {
  id: electronId, filename: electronId, path: electronId,
  loaded: true, children: [], paths: [], exports: { safeStorage },
};

// The repository needs the same treatment, for a different reason. secureStore
// requires it too, and that require would otherwise load a SECOND, plain-Node
// copy. Every test still passes — both copies talk to the same database handle
// — but the coverage report then sees this worker exercising an instance that
// barely runs, and repository.cjs drops from 100% to 62% functions purely as a
// measurement artefact, dragging electron/db under its threshold. Seeding the
// cache with the instrumented module keeps it to one instance.
const repository = await import('../db/repository.cjs');
const repositoryId = require.resolve('../db/repository.cjs');
require.cache[repositoryId] = {
  id: repositoryId, filename: repositoryId, path: repositoryId,
  loaded: true, children: [], paths: [],
  exports: repository.default ?? repository,
};

const { setApiKey, getApiKey, hasApiKey, clearApiKey, isEncryptionAvailable } =
  await import('./secureStore.cjs');
const { initSchema, getMeta } = repository;

// better-sqlite3 is a CommonJS native module; load it via require so this test
// exercises the exact meta-table path Electron's main process uses, rather
// than a second fake stacked on top of the first.
const Database = require('better-sqlite3');

const KEY_NAME = 'anthropic_api_key_enc';
const API_KEY = 'sk-ant-api03-not-a-real-key-0123456789';

// The raw meta row, read straight from SQLite — the bytes that actually land on
// the user's disk.
const storedRow = (db) => db.prepare('SELECT value FROM meta WHERE key = ?').get(KEY_NAME);

let db;
beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);

  safeStorage.isEncryptionAvailable.mockReset().mockReturnValue(true);
  safeStorage.encryptString.mockReset()
    .mockImplementation((s) => Buffer.from(MARKER + [...s].reverse().join(''), 'utf8'));
  safeStorage.decryptString.mockReset().mockImplementation((buf) => {
    const text = buf.toString('utf8');
    // The real safeStorage throws on data it cannot decrypt; so does this.
    if (!text.startsWith(MARKER)) throw new Error('decryption failed');
    return [...text.slice(MARKER.length)].reverse().join('');
  });
});

describe('secureStore', () => {
  it('round-trips the API key through the store', () => {
    setApiKey(db, API_KEY);
    expect(getApiKey(db)).toBe(API_KEY);
  });

  it('writes ciphertext, never the key itself', () => {
    // This is the property README and SECURITY.md actually claim, so it is
    // asserted against the bytes on disk rather than inferred from the fact
    // that encryptString was called.
    setApiKey(db, API_KEY);

    const row = storedRow(db);
    if (!row) throw new Error('unreachable: setApiKey stored nothing');
    expect(row.value).not.toContain(API_KEY);
    // base64 alone would hide the key from a substring search, so decode it and
    // check the real bytes too.
    expect(Buffer.from(row.value, 'base64').toString('utf8')).not.toContain(API_KEY);
    expect(safeStorage.encryptString).toHaveBeenCalledWith(API_KEY);
  });

  it('refuses to store the key when OS encryption is unavailable', () => {
    // The dangerous failure mode is a silent fallback to plaintext, so both
    // halves matter: it throws, *and* nothing was written.
    safeStorage.isEncryptionAvailable.mockReturnValue(false);

    expect(() => setApiKey(db, API_KEY)).toThrow(/secure storage is unavailable/i);
    expect(storedRow(db)).toBeUndefined();
    expect(getMeta(db, KEY_NAME)).toBeNull();
    expect(hasApiKey(db)).toBe(false);
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the ciphertext cannot be decrypted', () => {
    // What a key encrypted on another machine, or a corrupted row, looks like:
    // safeStorage rejects it. Callers get null and can prompt for a new key;
    // an exception here would take down whatever IPC handler asked.
    setApiKey(db, API_KEY);
    safeStorage.decryptString.mockImplementation(() => { throw new Error('DPAPI: bad data'); });

    expect(() => getApiKey(db)).not.toThrow();
    expect(getApiKey(db)).toBeNull();
    // The row survives — reading it is what failed, so nothing is destroyed.
    expect(hasApiKey(db)).toBe(true);
  });

  it('returns null when nothing was ever stored', () => {
    expect(getApiKey(db)).toBeNull();
    expect(hasApiKey(db)).toBe(false);
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it('clearApiKey removes the key and hasApiKey follows', () => {
    setApiKey(db, API_KEY);
    expect(hasApiKey(db)).toBe(true);

    clearApiKey(db);
    expect(hasApiKey(db)).toBe(false);
    expect(getApiKey(db)).toBeNull();
    // The row is blanked rather than deleted; what matters is that no
    // ciphertext is left behind for getApiKey to hand back.
    const row = storedRow(db);
    if (!row) throw new Error('unreachable: clearApiKey dropped the meta row entirely');
    expect(row.value).toBe('');
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('setApiKey with %s clears instead of storing an empty ciphertext', (_label, value) => {
    setApiKey(db, API_KEY);

    setApiKey(db, value);
    expect(hasApiKey(db)).toBe(false);
    expect(getApiKey(db)).toBeNull();
    // Clearing must not run the plaintext through the cipher — an encrypted
    // empty string would still read as "a key is set".
    expect(safeStorage.encryptString).toHaveBeenCalledTimes(1);
  });

  it('clearing works even when OS encryption is unavailable', () => {
    // A user whose keychain broke must still be able to remove the stored key.
    setApiKey(db, API_KEY);
    safeStorage.isEncryptionAvailable.mockReturnValue(false);

    expect(() => setApiKey(db, '')).not.toThrow();
    expect(hasApiKey(db)).toBe(false);
  });

  it('isEncryptionAvailable reports false instead of throwing', () => {
    // safeStorage throws on some Linux desktops rather than returning false;
    // the app reads this to decide whether to offer the key field at all, so a
    // throw here would break the settings screen instead of disabling a input.
    safeStorage.isEncryptionAvailable.mockImplementation(() => {
      throw new Error('no keyring backend');
    });

    expect(isEncryptionAvailable()).toBe(false);
  });

  it('isEncryptionAvailable passes the platform answer through', () => {
    expect(isEncryptionAvailable()).toBe(true);
    safeStorage.isEncryptionAvailable.mockReturnValue(false);
    expect(isEncryptionAvailable()).toBe(false);
  });
});
