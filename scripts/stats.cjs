#!/usr/bin/env node
// Counts the source and test figures the README quotes, and rewrites them.
//
// Those numbers were hand-written and had drifted a long way in the direction
// that undersold the work — the README claimed 305 tests against 401, and 9k
// lines of source against 16k. A number nobody can recompute is a number that
// will be wrong again in a month, so CI runs this with `git diff --exit-code`
// and the README cannot go stale without the build saying so.
//
//   node scripts/stats.cjs          rewrite README.md in place
//   node scripts/stats.cjs --check  exit 1 if it would change anything

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const README = path.join(ROOT, 'README.md');
const CODE = /\.(js|jsx|cjs|mjs|ts|tsx|cts|mts)$/;
const IS_TEST = /\.(test|spec)\./;
// The end-to-end spec is a test file, but it is not one of the unit tests the
// README counts — `vitest list` never sees it, so counting its file here would
// report N tests across N+1 files and invite someone to go looking for the
// missing one. Its lines still count as test lines, because they are.
const IS_E2E = /^e2e\//;

/** Tracked files only: generated output and node_modules are not the project. */
function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function countLines(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').length;
}

/**
 * Ask vitest how many tests there are, rather than counting `it(` in the source.
 *
 * Grepping is faster but wrong: one `it.each` over four cases is a single
 * declaration and four tests, so a static count said 398 where `npm test` said
 * 401. The README quotes this number next to `npm test`, so it has to be the
 * number `npm test` prints. Takes about fifteen seconds, because collecting the
 * suite means loading it.
 *
 * This needs better-sqlite3 built for Node — the same prerequisite `npm test`
 * has, and CI already does that rebuild before it gets here.
 */
function countTests() {
  // Run vitest's own entry point under this node rather than going through
  // npx, which needs a shell on Windows and would mean concatenating arguments.
  const cli = require.resolve('vitest/vitest.mjs');
  const json = execFileSync(process.execPath, [cli, 'list', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(json).length;
}

function collect() {
  let sourceLines = 0;
  let testLines = 0;
  let testFiles = 0;

  for (const file of trackedFiles()) {
    if (!CODE.test(file)) continue;
    if (IS_TEST.test(file)) {
      if (!IS_E2E.test(file)) testFiles += 1;
      testLines += countLines(file);
    } else {
      sourceLines += countLines(file);
    }
  }
  return { sourceLines, testLines, testFiles, tests: countTests() };
}

/** 15,977 -> "16k". The README speaks in round numbers and should keep doing so. */
const thousands = n => `${Math.round(n / 1000)}k`;

// Each anchor must still match, or the README has been reworded and these
// figures are silently no longer being maintained. Failing loudly beats
// reporting "already current" about text that no longer exists.
const ANCHORS = [
  {
    pattern: /Roughly [\d.]+k lines of source and \*\*[\d,]+ unit tests\*\*/,
    replace: s => `Roughly ${thousands(s.sourceLines)} lines of source and **${s.tests} unit tests**`,
  },
  {
    pattern: /\| `npm test` \| Unit tests \([\d,]+\) \|/,
    replace: s => `| \`npm test\` | Unit tests (${s.tests}) |`,
  },
];

function rewrite(readme, s) {
  for (const { pattern, replace } of ANCHORS) {
    if (!pattern.test(readme)) {
      throw new Error(`stats.cjs found no match for ${pattern} in README.md — the wording it anchors on has changed`);
    }
    readme = readme.replace(pattern, replace(s));
  }
  return readme;
}

const stats = collect();
const current = fs.readFileSync(README, 'utf8');
const updated = rewrite(current, stats);

if (process.argv.includes('--check')) {
  if (updated !== current) {
    console.error('README figures are stale. Run: node scripts/stats.cjs');
    process.exit(1);
  }
  console.log('README figures are current.');
} else if (updated !== current) {
  fs.writeFileSync(README, updated);
  console.log('README updated.');
} else {
  console.log('README already current.');
}

console.log(
  `${stats.sourceLines} source lines, ${stats.testLines} test lines, `
  + `${stats.tests} tests across ${stats.testFiles} files`,
);
