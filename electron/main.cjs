// Electron main process: creates the window, owns the SQLite database, and
// exposes a small IPC surface to the renderer. The renderer never touches the
// filesystem or the database directly — it calls window.api.db.* (see preload.cjs).

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { getDb, closeDb } = require('./db/index.cjs');
const { loadAll, saveAll, getMeta, setMeta } = require('./db/repository.cjs');
const { buildPayload } = require('./ai/payload.cjs');
const { createClient, runFeature } = require('./ai/client.cjs');
const { executeTool } = require('./ai/aggregates.cjs');
const secureStore = require('./ai/secureStore.cjs');

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, // renderer cannot reach Node directly
      nodeIntegration: false,
    },
  });

  if (isDev) {
    // Vite dev server. VITE_DEV_SERVER_URL is set by the dev script.
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// --- IPC: database access ---------------------------------------------------
// saveAll mirrors the previous "persist the whole blob on change" model, which
// keeps the renderer's context API identical and the migration low-risk.
ipcMain.handle('db:loadAll', () => loadAll(getDb()));
ipcMain.handle('db:saveAll', (_evt, state) => {
  saveAll(getDb(), state);
  return true;
});
// First-run bootstrap: the renderer seeds sample data (or migrates a legacy
// localStorage blob) exactly once, then marks the database initialized.
ipcMain.handle('db:isInitialized', () => getMeta(getDb(), 'initialized') === '1');
ipcMain.handle('db:markInitialized', () => {
  setMeta(getDb(), 'initialized', '1');
  return true;
});

// --- IPC: AI ----------------------------------------------------------------
// The API key lives only in the main process (encrypted at rest via safeStorage).
// The renderer triggers features over IPC; main minimizes the payload, attaches
// the key, calls Anthropic, and returns a structured { ok, data | error } result.
ipcMain.handle('ai:status', () => ({
  encryptionAvailable: secureStore.isEncryptionAvailable(),
  hasKey: secureStore.hasApiKey(getDb()),
}));

ipcMain.handle('ai:setKey', (_evt, key) => {
  try {
    secureStore.setApiKey(getDb(), key);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('ai:clearKey', () => {
  secureStore.clearApiKey(getDb());
  return { ok: true };
});

ipcMain.handle('ai:run', async (_evt, feature, input) => {
  try {
    const apiKey = secureStore.getApiKey(getDb());
    if (!apiKey) return { ok: false, error: 'no_key' };
    const payload = buildPayload(feature, input); // data-minimization gate
    const client = createClient(apiKey);
    // Q&A answers by calling local aggregate tools. State is read once per
    // question so every lookup within one answer sees the same data, and only
    // the aggregate a tool returns is ever sent.
    const ctx = feature === 'query'
      ? { runTool: (name, toolInput) => executeTool(loadAll(getDb()), name, toolInput) }
      : {};
    const data = await runFeature(client, feature, payload, ctx);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || 'AI request failed' };
  }
});

app.whenReady().then(() => {
  getDb(); // open + migrate up front so the first IPC call is fast
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDb();
    app.quit();
  }
});
