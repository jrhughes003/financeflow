// Pure data-access layer over a better-sqlite3 database handle.
//
// Intentionally free of any Electron import so it can be unit-tested against an
// in-memory database. The Electron-specific wiring (opening the file at the
// userData path, registering IPC handlers) lives in ./index.cjs and ../main.cjs.

const { SCHEMA_SQL, CURRENT_VERSION, COLLECTION_TABLES } = require('./schema.cjs');

// The default settings used when a fresh database has none yet.
const DEFAULT_SETTINGS = { currency: 'USD', showSampleData: false };

/**
 * Create the schema (idempotent) and record the schema version. Safe to call on
 * every startup; future versions add migration steps keyed on the stored version.
 */
function initSchema(db) {
  db.exec(SCHEMA_SQL);
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get();
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_VERSION);
  }
  // (When CURRENT_VERSION climbs, run ordered ALTER/data migrations here based on row.version.)
}

/** True if the database has no user data yet (used to decide whether to migrate). */
function isEmpty(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n > 0) return false;
  for (const { table } of COLLECTION_TABLES) {
    if (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n > 0) return false;
  }
  return true;
}

/**
 * Parse one stored JSON blob, counting rather than throwing on failure.
 *
 * A single unreadable row used to reject the whole load, and the renderer
 * treated that rejection as "no data yet" and wrote an empty ledger over the
 * top. Skipping the row loses one record; aborting the load lost all of them.
 * The count travels back to the UI so the user is told rather than guessing.
 */
function parseRow(json, report) {
  try {
    const value = JSON.parse(json);
    if (value && typeof value === 'object') return value;
  } catch { /* fall through to the skip below */ }
  report.corrupt += 1;
  return null;
}

/** Read the entire database back into the in-memory state shape the app expects. */
function loadAll(db) {
  const report = { corrupt: 0 };

  const state = {
    transactions: db
      .prepare('SELECT data FROM transactions')
      .all()
      .map(r => parseRow(r.data, report))
      .filter(Boolean),
  };

  for (const { stateKey, table } of COLLECTION_TABLES) {
    state[stateKey] = db
      .prepare(`SELECT data FROM ${table}`)
      .all()
      .map(r => parseRow(r.data, report))
      .filter(Boolean);
  }

  const settingsRow = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get();
  const settings = settingsRow ? parseRow(settingsRow.value, report) : null;
  state.settings = settings || { ...DEFAULT_SETTINGS };

  // Only present when something was unreadable; the renderer strips it before
  // it can reach the reducer and be written back as a real state field.
  if (report.corrupt > 0) state._corruptRows = report.corrupt;

  return state;
}

/**
 * Persist the full in-memory state to the database in a single transaction.
 * Mirrors the previous "write the whole localStorage blob on change" semantics,
 * which keeps the migration low-risk: the renderer's context API is unchanged.
 * Writing the whole set in one better-sqlite3 transaction is sub-millisecond for
 * the dataset sizes a personal-finance app produces.
 */
function saveAll(db, state) {
  const run = db.transaction((s) => {
    // transactions: promote queryable columns + keep the full object in `data`.
    db.prepare('DELETE FROM transactions').run();
    const insertTx = db.prepare(`
      INSERT INTO transactions
        (id, date, merchant, amount, category, subcategory, is_exception,
         kind, goal_id, recurring_template_id, data)
      VALUES
        (@id, @date, @merchant, @amount, @category, @subcategory, @is_exception,
         @kind, @goal_id, @recurring_template_id, @data)
    `);
    for (const t of s.transactions || []) {
      insertTx.run({
        id: String(t.id),
        date: t.date ?? null,
        merchant: t.merchant ?? null,
        amount: typeof t.amount === 'number' ? t.amount : Number(t.amount) || 0,
        category: t.category ?? null,
        subcategory: t.subcategory ?? null,
        is_exception: t.isException ? 1 : 0,
        kind: t.kind ?? 'expense',
        goal_id: t.goalId ?? null,
        recurring_template_id: t.recurringTemplateId ?? null,
        data: JSON.stringify(t),
      });
    }

    // JSON-only collections.
    for (const { stateKey, table } of COLLECTION_TABLES) {
      db.prepare(`DELETE FROM ${table}`).run();
      const insert = db.prepare(`INSERT INTO ${table} (id, data) VALUES (@id, @data)`);
      for (const item of s[stateKey] || []) {
        insert.run({ id: String(item.id), data: JSON.stringify(item) });
      }
    }

    // settings (leaves other meta keys, e.g. the migration flag, untouched).
    db.prepare("INSERT INTO meta (key, value) VALUES ('settings', @value) "
      + 'ON CONFLICT(key) DO UPDATE SET value = @value')
      .run({ value: JSON.stringify(s.settings ?? DEFAULT_SETTINGS) });
  });
  run(state);
}

/** Read a bookkeeping flag from the meta table. */
function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

/** Write a bookkeeping flag to the meta table. */
function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) '
    + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

module.exports = { initSchema, isEmpty, loadAll, saveAll, getMeta, setMeta, DEFAULT_SETTINGS };
