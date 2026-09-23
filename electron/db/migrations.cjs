// Ordered schema migrations.
//
// The list is empty, and that is the honest state of things: the schema has
// been at version 1 since it was written and nothing has needed changing. The
// runner exists anyway, because the alternative is writing one for the first
// time while staring at a user's database that will not open — and because a
// version field that nothing reads is worse than no version field, since it
// looks like a plan that was made.
//
// What belongs here, and what does not:
//
//   SCHEMA_SQL is `CREATE TABLE IF NOT EXISTS`, so it already brings both a
//   fresh database and an existing one up to date for anything purely
//   additive — a new table, a new index. Those need no migration.
//
//   Everything SCHEMA_SQL cannot express belongs here: ALTER TABLE to add a
//   column to a table that already exists, rewriting stored JSON into a new
//   shape, dropping something, backfilling a default.
//
// A migration looks like:
//
//   { to: 2,
//     description: 'add transactions.cleared',
//     up(db) { db.exec('ALTER TABLE transactions ADD COLUMN cleared INTEGER DEFAULT 0'); } }
//
// `up` runs inside a transaction together with the version bump, so a
// migration that throws leaves the database exactly as it was. Write them to
// be runnable exactly once, in order, and never edit one that has shipped —
// a database in the wild has already run it.

/** @type {{ to: number, description: string, up: (db: import('better-sqlite3').Database) => void }[]} */
const MIGRATIONS = [];

module.exports = { MIGRATIONS };
