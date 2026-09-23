// Pure data-access layer over a better-sqlite3 database handle.
//
// Intentionally free of any Electron import so it can be unit-tested against an
// in-memory database. The Electron-specific wiring (opening the file at the
// userData path, registering IPC handlers) lives in ./index.cjs and ../main.cjs.

const { SCHEMA_SQL, CURRENT_VERSION, COLLECTION_TABLES } = require('./schema.cjs');
const { MIGRATIONS } = require('./migrations.cjs');

// The default settings used when a fresh database has none yet.
const DEFAULT_SETTINGS = { currency: 'CAD', showSampleData: false };

/**
 * Bring a database up to `target`, applying each pending migration in order.
 *
 * A database with no recorded version was created by the `db.exec(SCHEMA_SQL)`
 * that just ran, so it is already at the current shape: it gets stamped, not
 * migrated. Running migration 2's `ALTER TABLE ... ADD COLUMN` against a table
 * SCHEMA_SQL just created with that column would fail.
 *
 * Each migration commits together with its version bump, so one that throws
 * leaves the database exactly as it was rather than half-migrated with a
 * version claiming otherwise.
 *
 * `migrations` and `target` are injectable so the runner can be tested without
 * inventing a schema change to test it with.
 *
 * @returns {{ from: number, to: number, applied: number[] }}
 */
function runMigrations(db, { migrations = MIGRATIONS, target = CURRENT_VERSION } = {}) {
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get();

  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(target);
    return { from: target, to: target, applied: [] };
  }

  const from = Number(row.version) || 0;

  // Written by a newer build. There is no way to know what it changed, and
  // guessing means writing this version's assumptions over data that does not
  // match them — the same failure mode as the empty-ledger overwrite.
  if (from > target) {
    throw new Error(
      `This database is at schema version ${from}, but this build only understands ${target}. `
      + 'It was written by a newer version of FinanceFlow. Update the app rather than opening it with this one.',
    );
  }

  const pending = migrations
    .filter(m => m.to > from && m.to <= target)
    .sort((a, b) => a.to - b.to);

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.prepare('UPDATE schema_version SET version = ?').run(migration.to);
    })();
  }

  // A version can climb with no migration behind it — adding a table or an
  // index needs none, because SCHEMA_SQL is CREATE ... IF NOT EXISTS and has
  // already run. Record where we ended up either way.
  if (from !== target) db.prepare('UPDATE schema_version SET version = ?').run(target);

  return { from, to: target, applied: pending.map(m => m.to) };
}

/**
 * Create the schema (idempotent) and bring it up to the current version.
 * Safe to call on every startup.
 */
function initSchema(db, options) {
  db.exec(SCHEMA_SQL);
  return runMigrations(db, options);
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
 *
 * It really does rewrite everything on every change — DELETE FROM across eight
 * tables, then re-insert — so it is worth knowing what that costs rather than
 * asserting it is free, which an earlier version of this comment did ("sub-
 * millisecond", untrue above a few hundred rows). Measured:
 *
 *   transactions      270     1,000    3,000    10,000
 *   saveAll here      1.8ms   10ms     21ms     77ms
 *   renderer's clone  0.5ms   1.7ms    5.8ms    17.6ms
 *
 * Only the second row lands on the UI thread, and only the second row is paid
 * per keystroke. At the scale a personal ledger actually reaches it is under a
 * millisecond, which is why this is still written the simple way: debouncing
 * would buy back a fraction of a frame in exchange for a window in which a
 * saved edit exists only in memory, and losing data is the failure this file
 * cares most about. Around 10k transactions that trade flips.
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

module.exports = {
  initSchema, runMigrations, isEmpty, loadAll, saveAll, getMeta, setMeta, DEFAULT_SETTINGS,
};
