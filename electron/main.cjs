// Electron main process: creates the window, owns the SQLite database, and
// exposes a small IPC surface to the renderer. The renderer never touches the
// filesystem or the database directly — it calls window.api.db.* (see preload.cjs).

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const { getDb, closeDb } = require('./db/index.cjs');
const { loadAll, saveAll, getMeta, setMeta } = require('./db/repository.cjs');
const { buildPayload } = require('./ai/payload.cjs');
const { createClient, runFeature } = require('./ai/client.cjs');
const { executeTool } = require('./ai/aggregates.cjs');
const auditLog = require('./ai/auditLog.cjs');
const secureStore = require('./ai/secureStore.cjs');
const backup = require('./backup.cjs');

const isDev = !app.isPackaged;

// Packaged with the app (package.json → build.files) so the window carries it
// in development too; the installed exe already embeds the same icon.
const APP_ICON = path.join(__dirname, '..', 'build', 'logo', 'logo', 'icon-dark.ico');

/** URL parsing that answers "no" instead of throwing. */
function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Only real web links are worth handing to the system browser. */
function isExternal(url) {
  const parsed = parseUrl(url);
  return parsed !== null && /^https?:$/.test(parsed.protocol);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    icon: APP_ICON,
    backgroundColor: '#0a0c0f', // the dark canvas, so the window never flashes white
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, // renderer cannot reach Node directly
      nodeIntegration: false,
      sandbox: true, // Electron's default here, but worth saying out loud
    },
  });

  // The renderer is a local app, not a browser: it has no reason to navigate
  // anywhere or open a window. Anything that tries is a bug or an injection, so
  // both are refused and genuine external links go to the real browser instead,
  // where they are sandboxed and visible.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const target = parseUrl(url);
    const devServer = process.env.VITE_DEV_SERVER_URL;
    const allowed = isDev && devServer && url.startsWith(devServer);
    // An unparseable URL is not a file: URL, so it lands here and is blocked.
    // Parsing used to happen before this line, which meant a malformed URL
    // threw out of the handler and the navigation went ahead unblocked.
    if (!allowed && target?.protocol !== 'file:') {
      event.preventDefault();
      if (isExternal(url)) shell.openExternal(url);
    }
  });

  if (isDev) {
    // Vite dev server. VITE_DEV_SERVER_URL is set by the dev script.
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// A Content-Security-Policy for the packaged app. Scripts and styles come from
// the bundle only, so a string that reached the DOM from a CSV, a pasted
// receipt or an AI response cannot execute. `connect-src 'none'` is the honest
// setting here: the renderer never talks to the network itself — the main
// process makes the Anthropic call, which this policy does not govern.
//
// Dev is exempt because Vite's HMR needs inline scripts and a websocket; the
// policy that matters is the one that ships.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // styled-in-JS values, e.g. category colours
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function applyContentSecurityPolicy() {
  if (isDev) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });
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

// --- Automatic backups ------------------------------------------------------
// One SQLite backup a day, kept to the newest N. Settings live in the meta
// table so they survive reinstalls along with the data they protect.

const DEFAULT_BACKUP_DIR = () => path.join(app.getPath('userData'), 'backups');
let lastBackupResult = null;

function backupConfig() {
  return backup.readConfig(key => getMeta(getDb(), key), DEFAULT_BACKUP_DIR());
}

async function backupNow(force = false) {
  const { dir, keep } = backupConfig();
  const result = await backup.runBackup(getDb(), { dir, keep, force });
  lastBackupResult = result;
  if (result.ok && result.created) setMeta(getDb(), backup.META_LAST, new Date().toISOString());
  if (!result.ok) console.error('Backup failed:', result.error);
  return result;
}

function backupStatus() {
  const cfg = backupConfig();
  const files = backup.listBackups(cfg.dir);
  return {
    dir: cfg.dir,
    defaultDir: DEFAULT_BACKUP_DIR(),
    keep: cfg.keep,
    lastAt: cfg.last,
    files: files.map(f => ({ name: f.name, size: f.size })),
    lastError: lastBackupResult && !lastBackupResult.ok ? lastBackupResult.error : null,
  };
}

ipcMain.handle('backup:status', () => backupStatus());
ipcMain.handle('backup:runNow', async () => {
  const result = await backupNow(true);
  return { ...backupStatus(), ok: result.ok, error: result.ok ? null : result.error };
});
ipcMain.handle('backup:configure', (_evt, cfg) => {
  if (cfg && typeof cfg.keep !== 'undefined') setMeta(getDb(), backup.META_KEEP, String(backup.clampKeep(cfg.keep)));
  if (cfg && cfg.resetDir) setMeta(getDb(), backup.META_DIR, '');
  return backupStatus();
});
// The folder is chosen in a native dialog here rather than typed in the
// renderer, so a path never has to be trusted from the page.
ipcMain.handle('backup:chooseDir', async () => {
  const res = await dialog.showOpenDialog({ title: 'Choose a backup folder', properties: ['openDirectory', 'createDirectory'] });
  if (!res.canceled && res.filePaths[0]) setMeta(getDb(), backup.META_DIR, res.filePaths[0]);
  return backupStatus();
});
ipcMain.handle('backup:openDir', async () => {
  const { dir } = backupConfig();
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return true;
});

// --- IPC: export to a folder --------------------------------------------------
// "Export everything" writes one CSV per collection into a folder the user
// picks. Names are reduced to a safe basename so the page cannot write
// anywhere but inside that folder.
ipcMain.handle('files:saveToFolder', async (_evt, files) => {
  const res = await dialog.showOpenDialog({ title: 'Choose a folder for the export', properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths[0]) return { ok: false, error: 'cancelled' };
  const target = res.filePaths[0];
  const written = [];
  for (const f of Array.isArray(files) ? files : []) {
    const name = path.basename(String(f && f.name || '')).replace(/[^A-Za-z0-9._-]/g, '_');
    if (!name || name.startsWith('.')) continue;
    fs.writeFileSync(path.join(target, name), String(f.content ?? ''), 'utf8');
    written.push(name);
  }
  shell.openPath(target);
  return { ok: true, dir: target, written };
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

// In-memory only, and cleared when the app closes: the log is a transcript of
// the user's finances, so writing it to disk would create the file this app
// exists not to have.
ipcMain.handle('ai:auditLog', () => auditLog.getEntries());
ipcMain.handle('ai:clearAuditLog', () => { auditLog.clear(); return true; });

ipcMain.handle('ai:run', async (_evt, feature, input) => {
  try {
    const apiKey = secureStore.getApiKey(getDb());
    if (!apiKey) return { ok: false, error: 'no_key' };
    const payload = buildPayload(feature, input); // data-minimization gate
    // Wrapped so every request body this feature sends is recorded for the
    // "what was sent" panel — including the tool results Q&A returns in later
    // turns, which a payload-level log would miss.
    const client = auditLog.auditClient(createClient(apiKey), feature);
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

// Must match build.appId: Windows groups the window with the installed
// shortcut by this id, which is what makes the taskbar show the app's icon
// rather than a generic Electron one.
if (process.platform === 'win32') app.setAppUserModelId('com.financeflow.app');

app.whenReady().then(() => {
  applyContentSecurityPolicy(); // before any window loads
  getDb(); // open + migrate up front so the first IPC call is fast
  createWindow();

  // Today's backup, then a check every six hours so an app left open across
  // midnight still takes the next day's. Neither blocks the window.
  setTimeout(() => { backupNow(); }, 5_000);
  setInterval(() => { backupNow(); }, 6 * 60 * 60 * 1000);

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
