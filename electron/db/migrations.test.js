// @vitest-environment node
//
// The migration list is empty, so these drive the runner with migrations
// defined here. That is the point: the runner is the thing that has to be
// right before the first real migration is written, and testing it against an
// invented schema change would only test the invention.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { initSchema, runMigrations, saveAll, loadAll } from './repository.cjs';
import { MIGRATIONS } from './migrations.cjs';
import { CURRENT_VERSION } from './schema.cjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let db;
beforeEach(() => {
  db = new Database(':memory:');
});

const version = () => db.prepare('SELECT version FROM schema_version LIMIT 1').get()?.version;
const columns = table => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

/** Records which migrations ran, so order is observable and not just implied. */
const ran = [];
const addColumn = (to, column) => ({
  to,
  description: `add transactions.${column}`,
  up(d) { ran.push(to); d.exec(`ALTER TABLE transactions ADD COLUMN ${column} TEXT`); },
});

beforeEach(() => { ran.length = 0; });

describe('the shipped migration list', () => {
  it('is ordered, uniquely numbered, and reaches the current version', () => {
    const versions = MIGRATIONS.map(m => m.to);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions.every(v => v > 1 && v <= CURRENT_VERSION)).toBe(true);
    expect(MIGRATIONS.every(m => typeof m.up === 'function' && m.description)).toBe(true);
  });
});

describe('a fresh database', () => {
  it('is stamped at the current version without running anything', () => {
    const result = initSchema(db, { migrations: [addColumn(2, 'cleared')], target: 2 });
    expect(version()).toBe(2);
    expect(result.applied).toEqual([]);
    // SCHEMA_SQL already built the current shape; migrating it would fail.
    expect(ran).toEqual([]);
  });
});

describe('an existing database', () => {
  beforeEach(() => { initSchema(db); });

  it('applies every pending migration, in order', () => {
    const result = runMigrations(db, {
      migrations: [addColumn(3, 'settled'), addColumn(2, 'cleared')],
      target: 3,
    });
    expect(ran).toEqual([2, 3]);
    expect(result).toEqual({ from: 1, to: 3, applied: [2, 3] });
    expect(columns('transactions')).toEqual(expect.arrayContaining(['cleared', 'settled']));
    expect(version()).toBe(3);
  });

  it('skips migrations at or below the recorded version', () => {
    runMigrations(db, { migrations: [addColumn(2, 'cleared')], target: 2 });
    ran.length = 0;
    const result = runMigrations(db, { migrations: [addColumn(2, 'cleared')], target: 2 });
    expect(ran).toEqual([]);
    expect(result.applied).toEqual([]);
    // Re-running the ALTER would throw "duplicate column name".
    expect(version()).toBe(2);
  });

  it('records a version that climbs with no migration behind it', () => {
    // Adding a table or an index needs none: SCHEMA_SQL is CREATE IF NOT EXISTS.
    const result = runMigrations(db, { migrations: [], target: 4 });
    expect(result).toEqual({ from: 1, to: 4, applied: [] });
    expect(version()).toBe(4);
  });

  it('leaves the database untouched when a migration throws', () => {
    const state = {
      transactions: [{ id: 't1', date: '2026-03-01', merchant: 'Esso', amount: 40, category: 'transportation' }],
      budgets: [], incomes: [], savings_goals: [], investments: [], debts: [],
      recurringTemplates: [], customCategories: [], settings: { currency: 'CAD' },
    };
    saveAll(db, state);

    const exploding = {
      to: 2,
      description: 'add a column, then fail',
      up(d) {
        d.exec('ALTER TABLE transactions ADD COLUMN cleared TEXT');
        throw new Error('migration blew up');
      },
    };

    expect(() => runMigrations(db, { migrations: [exploding], target: 2 }))
      .toThrow('migration blew up');

    // The version bump and the ALTER commit together, so both rolled back.
    expect(version()).toBe(1);
    expect(columns('transactions')).not.toContain('cleared');
    expect(loadAll(db).transactions).toHaveLength(1);
  });

  it('refuses a database written by a newer build rather than guessing', () => {
    db.prepare('UPDATE schema_version SET version = ?').run(99);
    expect(() => runMigrations(db, { migrations: [], target: CURRENT_VERSION }))
      .toThrow(/schema version 99.*only understands/s);
    // Refusing means refusing to write, too.
    expect(version()).toBe(99);
  });
});
