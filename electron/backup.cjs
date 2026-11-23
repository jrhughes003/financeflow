// Automatic daily backups of the SQLite database.
//
// The only backup used to be the JSON export in Settings, which works when you
// remember it. This takes one copy a day without being asked — on launch, and
// again every few hours while the app stays open across midnight — and keeps
// the newest N so the folder never grows without bound.
//
// The copy is made with SQLite's online backup API (better-sqlite3's
// `db.backup`), not a file copy. The database runs in WAL mode, where recent
// writes can sit in financeflow.db-wal for hours: copying financeflow.db alone
// would produce a backup that is quietly missing them. The backup API reads
// through the WAL and writes one self-contained file.
//
// Electron-free apart from the parameters it is handed, so it can be tested
// against a real database in Node.

const fs = require('node:fs');
const path = require('node:path');

const PREFIX = 'financeflow-';
const SUFFIX = '.db';
const DEFAULT_KEEP = 14;
const MIN_KEEP = 1;
const MAX_KEEP = 365;

const META_DIR = 'backup.dir';
const META_KEEP = 'backup.keep';
const META_LAST = 'backup.last';

/** `financeflow-2026-11-23.db` for a local date. */
function backupName(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${PREFIX}${y}-${m}-${d}${SUFFIX}`;
}

const NAME_RE = /^financeflow-\d{4}-\d{2}-\d{2}\.db$/;

/** The backups in a folder, newest first. Anything else in the folder is ignored and never deleted. */
function listBackups(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter(n => NAME_RE.test(n))
    .sort()
    .reverse()
    .map(name => {
      const file = path.join(dir, name);
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* vanished between list and stat */ }
      return { name, file, size };
    });
}

/** Which backups fall outside the newest `keep`. Pure, for testing. */
function toPrune(names, keep) {
  return [...names].filter(n => NAME_RE.test(n)).sort().reverse().slice(Math.max(MIN_KEEP, keep));
}

function clampKeep(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_KEEP;
  return Math.min(MAX_KEEP, Math.max(MIN_KEEP, n));
}

/**
 * The settings, read from the meta table.
 * @param {(key: string) => string | null} getMeta
 * @param {string} defaultDir
 */
function readConfig(getMeta, defaultDir) {
  return {
    dir: getMeta(META_DIR) || defaultDir,
    keep: clampKeep(getMeta(META_KEEP) ?? DEFAULT_KEEP),
    last: getMeta(META_LAST) || null,
  };
}

/**
 * Take today's backup unless it already exists (or `force`), then prune.
 *
 * Returns what happened rather than throwing: a failed backup must never stop
 * the app from opening, but it should be visible in Settings.
 */
async function runBackup(db, { dir, keep, now = new Date(), force = false }) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const name = backupName(now);
    const file = path.join(dir, name);
    let created = false;
    if (force || !fs.existsSync(file)) {
      // Written to a temporary name first, so a crash mid-backup cannot leave
      // a truncated file that looks like a good one.
      const tmp = `${file}.partial`;
      try { fs.rmSync(tmp, { force: true }); } catch { /* none */ }
      await db.backup(tmp);
      fs.renameSync(tmp, file);
      created = true;
    }
    const pruned = [];
    for (const old of toPrune(fs.readdirSync(dir), keep)) {
      try { fs.rmSync(path.join(dir, old)); pruned.push(old); } catch { /* locked by a sync client; next time */ }
    }
    return { ok: true, file, created, pruned };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  backupName, listBackups, toPrune, clampKeep, readConfig, runBackup,
  DEFAULT_KEEP, META_DIR, META_KEEP, META_LAST,
};
