// Guards the one migration mistake that leaves CI green while deleting coverage.
//
// vitest.config.js decides which files count as tests by glob. Rename a test to
// .ts while that glob still says .js and the file simply stops being collected
// — no error, no failure, the suite just gets quieter. The same trap exists on
// the packaging side, where a test that stops matching the exclusion starts
// shipping inside app.asar instead.
//
// So both are asserted here rather than trusted.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// vitest runs from the project root. import.meta.url is not a file: URL under
// the jsdom environment, so it is not an option here.
const ROOT = process.cwd();

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (/\.(test|spec)\./.test(entry.name)) {
      found.push(relative(ROOT, full).split(sep).join('/'));
    }
  }
  return found;
}

const testFiles = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'electron'))];

/** The extensions each include pattern in vitest.config.js accepts. */
function includedExtensions(config: string, prefix: string): string[] {
  const pattern = new RegExp(`'${prefix}/\\*\\*/\\*\\.\\{test,spec\\}\\.\\{([^}]+)\\}'`);
  const match = config.match(pattern);
  if (!match) throw new Error(`no ${prefix} include pattern found in vitest.config.js`);
  return match[1].split(',');
}

describe('test discovery', () => {
  const config = readFileSync(join(ROOT, 'vitest.config.js'), 'utf8');

  it('finds every test file on disk', () => {
    // Not a fixed number: the point is that the walk works, so a future
    // rename can be compared against something real.
    expect(testFiles.length).toBeGreaterThanOrEqual(30);
  });

  it('collects every test file the config claims to', () => {
    const src = includedExtensions(config, 'src');
    const electron = includedExtensions(config, 'electron');

    const missed = testFiles.filter((file) => {
      // Everything walk() collected matched /\.(test|spec)\./, so there is one.
      const ext = file.slice(file.lastIndexOf('.') + 1);
      const allowed = file.startsWith('electron/') ? electron : src;
      return !allowed.includes(ext);
    });

    expect(missed, `not matched by any vitest include glob: ${missed.join(', ')}`).toEqual([]);
  });

  it('keeps every extension a TypeScript migration could produce', () => {
    for (const ext of ['js', 'jsx', 'ts', 'tsx']) {
      expect(includedExtensions(config, 'src')).toContain(ext);
    }
    for (const ext of ['js', 'cjs', 'ts', 'cts']) {
      expect(includedExtensions(config, 'electron')).toContain(ext);
    }
  });

  it('excludes electron tests from the packaged app whatever they are renamed to', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    // "!electron/**/*.test.js" would stop matching the moment one becomes .ts.
    expect(pkg.build.files).toContain('!electron/**/*.test.*');
  });
});
