// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import {
  initSchema, isEmpty, loadAll, saveAll, getMeta, setMeta,
} from './repository.cjs';

// better-sqlite3 is a CommonJS native module; load it via require so this test
// exercises the exact code path Electron's main process uses.
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let db;
beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
});

// A representative slice of app state covering every collection + odd shapes.
const sampleState = () => ({
  transactions: [
    { id: 't1', date: '2026-03-01', merchant: 'Esso', amount: 40, category: 'transportation',
      subcategory: 'Gas', notes: '', tags: ['fuel'], isException: false },
    { id: 't2', date: '2026-03-02', merchant: 'Save', amount: 100, category: 'savings',
      kind: 'savings', goalId: 'g1', tags: [], isException: true },
  ],
  budgets: [{ id: 'b1', category: 'transportation', amount: 200, flex: 10, rollover: true }],
  incomes: [{ id: 'i1', source: 'Job', amount: 5000, frequency: 'monthly' }],
  savings_goals: [{ id: 'g1', name: 'Emergency', targetAmount: 1000, currentAmount: 100 }],
  investments: [{ id: 'v1', name: 'Index', currentValue: 3000, costBasis: 2500 }],
  debts: [{ id: 'd1', name: 'Card', balance: 500, originalBalance: 800, interestRate: 19.99 }],
  recurringTemplates: [{ id: 'r1', merchant: 'Netflix', amount: 15.99, frequency: 'monthly' }],
  customCategories: [{ id: 'c1', name: 'Pets', color: '#000', keywords: ['vet'] }],
  settings: { currency: 'CAD', showSampleData: false },
});

describe('repository', () => {
  it('reports an empty database before any save', () => {
    expect(isEmpty(db)).toBe(true);
  });

  it('round-trips the full state without losing fields', () => {
    const state = sampleState();
    saveAll(db, state);
    expect(isEmpty(db)).toBe(false);

    const loaded = loadAll(db);
    // Order isn't guaranteed by SQL; compare by id where it matters.
    expect(loaded.transactions).toHaveLength(2);
    const t2 = loaded.transactions.find(t => t.id === 't2');
    expect(t2).toMatchObject({ kind: 'savings', goalId: 'g1', isException: true, tags: [] });
    expect(loaded.budgets[0]).toMatchObject({ rollover: true, flex: 10 });
    expect(loaded.recurringTemplates[0].merchant).toBe('Netflix');
    expect(loaded.customCategories[0].keywords).toEqual(['vet']);
    expect(loaded.settings).toEqual({ currency: 'CAD', showSampleData: false });
  });

  it('promotes queryable transaction columns for SQL aggregates', () => {
    saveAll(db, sampleState());
    // Aggregate by category directly in SQL (the shape Phase 3 AI queries will use).
    const row = db.prepare(
      "SELECT SUM(amount) AS total FROM transactions WHERE category = 'transportation'"
    ).get();
    expect(row.total).toBe(40);
    // is_exception is stored as an integer flag.
    const flagged = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE is_exception = 1').get();
    expect(flagged.n).toBe(1);
  });

  it('saveAll replaces rather than appends (no duplicate rows on re-save)', () => {
    saveAll(db, sampleState());
    saveAll(db, sampleState());
    const n = db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
    expect(n).toBe(2);
  });

  it('migrates a legacy localStorage blob shape', () => {
    // Simulate the exact object stored under financeflow_data.
    const legacyBlob = sampleState();
    saveAll(db, legacyBlob); // the migration path is just saveAll(parsedBlob)
    const loaded = loadAll(db);
    expect(loaded.transactions.map(t => t.id).sort()).toEqual(['t1', 't2']);
    expect(loaded.budgets).toHaveLength(1);
  });

  it('persists and reads meta flags (initialized bookkeeping)', () => {
    expect(getMeta(db, 'initialized')).toBeNull();
    setMeta(db, 'initialized', '1');
    expect(getMeta(db, 'initialized')).toBe('1');
    // saveAll must not clobber unrelated meta keys.
    saveAll(db, sampleState());
    expect(getMeta(db, 'initialized')).toBe('1');
  });

  it('defaults settings when the database has none', () => {
    const loaded = loadAll(db);
    expect(loaded.settings).toEqual({ currency: 'USD', showSampleData: false });
  });

  // A single unreadable row used to reject the whole load. The renderer read
  // that rejection as "nothing stored yet" and wrote an empty ledger over the
  // top, so one bad cell cost the user everything.
  describe('unreadable rows', () => {
    const corruptOne = (table, id) => db.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`).run('{not json', id);

    it('skips a corrupt transaction and keeps the rest', () => {
      saveAll(db, sampleState());
      corruptOne('transactions', 't1');

      const loaded = loadAll(db);
      expect(loaded.transactions.map(t => t.id)).toEqual(['t2']);
      expect(loaded._corruptRows).toBe(1);
    });

    it('skips a corrupt row in a JSON-only collection', () => {
      saveAll(db, sampleState());
      corruptOne('budgets', 'b1');

      const loaded = loadAll(db);
      expect(loaded.budgets).toEqual([]);
      expect(loaded.transactions).toHaveLength(2);
      expect(loaded._corruptRows).toBe(1);
    });

    it('falls back to default settings when the settings blob is unreadable', () => {
      saveAll(db, sampleState());
      db.prepare("UPDATE meta SET value = ? WHERE key = 'settings'").run('{not json');

      const loaded = loadAll(db);
      expect(loaded.settings).toEqual({ currency: 'USD', showSampleData: false });
      expect(loaded._corruptRows).toBe(1);
    });

    it('counts every unreadable row, not just the first', () => {
      saveAll(db, sampleState());
      corruptOne('transactions', 't1');
      corruptOne('transactions', 't2');
      corruptOne('budgets', 'b1');

      expect(loadAll(db)._corruptRows).toBe(3);
    });

    it('omits the report entirely when everything reads back', () => {
      saveAll(db, sampleState());
      expect(loadAll(db)).not.toHaveProperty('_corruptRows');
    });
  });
});
