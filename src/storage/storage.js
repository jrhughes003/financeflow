// Storage adapter — the single seam between the React app and persistence.
//
// In the Electron desktop build the renderer talks to the SQLite database in the
// main process over `window.api.db.*`. In a plain browser (e.g. `npm run dev`)
// it falls back to the original localStorage behavior, so the web workflow keeps
// working unchanged. Callers (FinancialContext) don't know or care which is active.

const STORAGE_KEY = 'financeflow_data';

const electronApi = typeof window !== 'undefined' && window.api && window.api.isElectron
  ? window.api
  : null;

export const isElectron = Boolean(electronApi);
export const storageMode = isElectron ? 'sqlite' : 'localStorage';

/** Read the legacy localStorage blob, if any. Used for one-time migration + web mode. */
export function readLegacyLocalStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* corrupt or unavailable — treat as none */ }
  return null;
}

/** Has this storage backend been seeded yet? */
export async function isInitialized() {
  if (isElectron) return electronApi.db.isInitialized();
  return readLegacyLocalStorage() !== null;
}

/** Load the full app state, or null if nothing has been persisted yet. */
export async function loadState() {
  if (isElectron) return electronApi.db.loadAll();
  return readLegacyLocalStorage();
}

/** Persist the full app state. */
export async function saveState(state) {
  if (isElectron) {
    await electronApi.db.saveAll(state);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota or unavailable — best effort */ }
}

/** Mark the backend seeded so first-run bootstrap doesn't re-seed. */
export async function markInitialized() {
  if (isElectron) await electronApi.db.markInitialized();
  // localStorage mode is implicitly "initialized" once saveState has written the blob.
}
