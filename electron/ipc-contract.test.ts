// @vitest-environment node
//
// The renderer and the main process agree on eight channel names, and nothing
// enforces that agreement. Rename one on either side and the failure is a
// promise that never resolves at runtime — no compile error, no test failure,
// just a page that stays empty.
//
// A hand-written .d.ts would not help, because the .d.ts is itself the thing
// that drifts. These are read out of the source instead: preload.cjs is what
// the renderer calls, main.cjs is what answers, and src/types/api.ts is what
// the typed code believes. All three have to list the same set.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** Channel names passed to `fn('channel', …)`, wherever they appear. */
function channelsPassedTo(source: string, fn: string): string[] {
  const names: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`${fn}(`, from);
    if (at === -1) break;
    from = at + fn.length + 1;
    const quoted = /^\s*(['"])([^'"]+)\1/.exec(source.slice(from));
    if (quoted) names.push(quoted[2]);
  }
  return names.sort();
}

const invoked = channelsPassedTo(read('electron/preload.cjs'), 'ipcRenderer.invoke');
const handled = channelsPassedTo(read('electron/main.cjs'), 'ipcMain.handle');

// Read as text so this test needs no TypeScript toolchain to run.
const declared = (() => {
  const block = /IPC_CHANNELS = \[([^\]]+)\]/.exec(read('src/types/api.ts'));
  if (!block) throw new Error('IPC_CHANNELS not found in src/types/api.ts');
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
})();

describe('IPC contract', () => {
  it('finds channels on both sides', () => {
    expect(invoked.length).toBeGreaterThan(0);
    expect(handled.length).toBeGreaterThan(0);
  });

  it('answers every channel the preload invokes', () => {
    const unanswered = invoked.filter(c => !handled.includes(c));
    expect(unanswered, `invoked by preload, never handled in main: ${unanswered.join(', ')}`).toEqual([]);
  });

  it('exposes every channel main handles', () => {
    const unreachable = handled.filter(c => !invoked.includes(c));
    expect(unreachable, `handled in main, unreachable from the renderer: ${unreachable.join(', ')}`).toEqual([]);
  });

  it('matches the channel list the typed bridge declares', () => {
    expect(declared).toEqual(invoked);
  });

  it('exposes nothing beyond db and ai', () => {
    const preload = read('electron/preload.cjs');
    // A second exposeInMainWorld, or ipcRenderer handed over whole, would widen
    // the bridge well past the eight methods above.
    expect(preload.match(/exposeInMainWorld/g)).toHaveLength(1);
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*,\s*ipcRenderer\s*\)/);
  });
});
