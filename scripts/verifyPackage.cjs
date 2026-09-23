// Verifies a packaged app.asar before it is installed.
//
// Added after a 1.6.0 build produced an archive whose index didn't match its
// contents — source files were edited while electron-builder was packaging, so
// `require` read bytes at stale offsets and the app died at startup with a
// syntax error from the middle of an unrelated file. The archive listed every
// file, so a file listing alone would not have caught it; each module has to be
// extracted and parsed.
//
//   node scripts/verifyPackage.cjs [path/to/app.asar]

const path = require('node:path');
const Module = require('node:module');
const asar = require('@electron/asar');

const archive = process.argv[2] || path.join('release', 'win-unpacked', 'resources', 'app.asar');

const listed = asar.listPackage(archive).map(f => f.replace(/\\/g, '/').replace(/^\//, ''));
const modules = listed.filter(f => f.startsWith('electron/') && f.endsWith('.cjs'));
const tests = listed.filter(f => f.includes('.test.'));

let broken = 0;
console.log(`checking ${modules.length} packaged modules in ${archive}\n`);

for (const file of modules) {
  try {
    const body = asar.extractFile(archive, file).toString();
    if (!body.length) throw new Error('empty');
    // Compiling catches a file whose bytes came from the wrong offset — the
    // exact failure this script exists for.
    new Function(Module.wrap(body)); // throws on a torn or mis-sliced file
    console.log(`  ok   ${file.padEnd(34)} ${String(body.length).padStart(6)}B`);
  } catch (err) {
    broken += 1;
    console.log(`  BAD  ${file.padEnd(34)} ${err.message}`);
  }
}

console.log(`\ntest files packaged: ${tests.length}${tests.length ? ' (expected 0)' : ' ✓'}`);
console.log(broken ? `FAILED — ${broken} module(s) unreadable` : 'archive OK — every module extracts and parses');
process.exit(broken || tests.length ? 1 : 0);
