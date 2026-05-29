// Electron-side database singleton: opens the better-sqlite3 file at the app's
// userData path and applies the schema. Kept thin — all logic lives in the
// electron-free repository.cjs so it can be unit-tested.

const path = require('node:path');
const Database = require('better-sqlite3');
const { app } = require('electron');
const { initSchema } = require('./repository.cjs');

let db = null;

function getDb() {
  if (db) return db;
  const file = path.join(app.getPath('userData'), 'financeflow.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL'); // better durability + concurrent reads
  initSchema(db);
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
