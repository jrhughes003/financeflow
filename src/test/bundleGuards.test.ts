// Guards that keep heavyweight dependencies out of the shipped bundle.
//
// The embedding work is evaluation-only, and the reason is worth stating
// because it is not obvious from the code: bundling @huggingface/transformers
// for the renderer produces a 72.9 MB chunk (20.3 MB gzipped) against a whole
// current bundle of ~1.3 MB, and on the Node side onnxruntime-node is 288 MB
// and onnxruntime-web 141 MB, which would take the installer from 90 MB to
// 250 MB+.
//
// The trap is that a dynamic `await import()` does NOT save you. Vite still
// emits the chunk if the module is reachable from a renderer entry; the
// dynamic form only defers *evaluation*. So the real constraint is reachability
// from the app graph, which is what this file asserts — a single stray import
// in a component would ship all of it, and the only symptom would be a bundle
// nobody looks at until someone on a slow connection complains.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** Files that are allowed to reach for the embedding module. */
const ALLOWED = [
  'src/utils/ml/embeddings.ts',
  'src/utils/ml/embeddings.test.ts',
  'src/utils/ml/embeddings.eval.test.ts',
  'src/test/bundleGuards.test.ts',
];

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) found.push(relative(ROOT, full).split(sep).join('/'));
  }
  return found;
}

describe('the embedding model stays out of the app bundle', () => {
  const sourceFiles = walk(join(ROOT, 'src'));

  it('is imported by nothing the renderer can reach', () => {
    const offenders = sourceFiles.filter((file) => {
      if (ALLOWED.includes(file)) return false;
      const text = readFileSync(join(ROOT, file), 'utf8');
      return /from\s+['"][^'"]*ml\/embeddings['"]|from\s+['"]\.\/embeddings['"]/.test(text);
    });
    expect(
      offenders,
      `these reach the embedding module and would pull ~73MB into the bundle: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('never imports the transformers library outside the embedding module', () => {
    const offenders = sourceFiles.filter((file) => {
      if (ALLOWED.includes(file)) return false;
      return /@huggingface\/transformers/.test(readFileSync(join(ROOT, file), 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('keeps the library a devDependency, so it cannot be packaged', () => {
    // electron-builder packages `dependencies` only. A move to the production
    // block would put 288MB of onnxruntime inside the installer.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies?.['@huggingface/transformers']).toBeUndefined();
    expect(pkg.devDependencies?.['@huggingface/transformers']).toBeDefined();
  });
});
