// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { backupName, toPrune, clampKeep, readConfig, runBackup, listBackups } = require('./backup.cjs');

describe('backup naming and pruning', () => {
  it('names by local date', () => {
    expect(backupName(new Date(2026, 0, 5))).toBe('financeflow-2026-01-05.db');
  });

  it('prunes all but the newest N, ignoring unrelated files', () => {
    const names = ['financeflow-2026-11-01.db', 'notes.txt', 'financeflow-2026-11-03.db', 'financeflow-2026-11-02.db', 'financeflow.db'];
    expect(toPrune(names, 2)).toEqual(['financeflow-2026-11-01.db']);
  });

  it('never prunes the last backup', () => {
    expect(toPrune(['financeflow-2026-11-01.db'], 0)).toEqual([]);
  });

  it('clamps keep to a sane range', () => {
    expect(clampKeep('abc')).toBe(14);
    expect(clampKeep(0)).toBe(1);
    expect(clampKeep(9999)).toBe(365);
    expect(clampKeep('7')).toBe(7);
  });

  it('reads config with defaults', () => {
    const meta = { 'backup.keep': '5' };
    expect(readConfig(k => meta[k] ?? null, '/default')).toEqual({ dir: '/default', keep: 5, last: null });
  });
});

describe('runBackup', () => {
  let dir;
  const fakeDb = { backup: async (dest) => { fs.writeFileSync(dest, 'sqlite'); } };

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-backup-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates today\'s backup once and skips it the second time', async () => {
    const now = new Date(2026, 10, 23);
    const first = await runBackup(fakeDb, { dir, keep: 14, now });
    expect(first.ok && first.created).toBe(true);
    const second = await runBackup(fakeDb, { dir, keep: 14, now });
    expect(second.ok && second.created).toBe(false);
    expect(listBackups(dir).map(b => b.name)).toEqual(['financeflow-2026-11-23.db']);
  });

  it('prunes beyond keep and leaves other files alone', async () => {
    fs.writeFileSync(path.join(dir, 'financeflow-2026-11-01.db'), 'x');
    fs.writeFileSync(path.join(dir, 'financeflow-2026-11-02.db'), 'x');
    fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'x');
    const res = await runBackup(fakeDb, { dir, keep: 2, now: new Date(2026, 10, 3) });
    expect(res.ok && res.pruned).toEqual(['financeflow-2026-11-01.db']);
    expect(fs.existsSync(path.join(dir, 'keep-me.txt'))).toBe(true);
  });

  it('reports a failure instead of throwing', async () => {
    const broken = { backup: async () => { throw new Error('disk full'); } };
    const res = await runBackup(broken, { dir, keep: 3, now: new Date() });
    expect(res).toEqual({ ok: false, error: 'disk full' });
    expect(listBackups(dir)).toEqual([]);
  });
});
