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

// listPackage hands back rooted, platform-separated paths ("\electron\db\x.cjs"
// on Windows) and extractFile accepts neither the leading separator nor a
// rewritten one. So the separators are left alone and only the root is trimmed,
// with a forward-slash copy carried alongside for filtering and display.
//
// Getting this wrong is worse than it sounds: a path extractFile can't resolve
// raises "not found", which reads exactly like the corruption this script is
// here to detect. It reported every nested module as damaged when the archive
// was fine.
const stripRoot = p => p.replace(/^[\\/]+/, '');
const listed = asar.listPackage(archive).map((raw) => {
  const lookup = stripRoot(raw);
  return { lookup, name: lookup.split(path.sep).join('/') };
});

const modules = listed.filter(f => f.name.startsWith('electron/') && f.name.endsWith('.cjs'));
const tests = listed.filter(f => f.name.includes('.test.'));

if (modules.length === 0) {
  console.error(`no electron/*.cjs modules found in ${archive} — is this the right archive?`);
  process.exit(1);
}

let broken = 0;
console.log(`checking ${modules.length} packaged modules in ${archive}\n`);

for (const { lookup, name } of modules) {
  try {
    const body = asar.extractFile(archive, lookup).toString();
    if (!body.length) throw new Error('empty');
    // Compiling catches a file whose bytes came from the wrong offset — the
    // exact failure this script exists for.
    new Function(Module.wrap(body)); // throws on a torn or mis-sliced file
    console.log(`  ok   ${name.padEnd(34)} ${String(body.length).padStart(6)}B`);
  } catch (err) {
    broken += 1;
    console.log(`  BAD  ${name.padEnd(34)} ${err.message}`);
  }
}

console.log(`\ntest files packaged: ${tests.length}${tests.length ? ' (expected 0)' : ' ✓'}`);
console.log(broken ? `FAILED — ${broken} module(s) unreadable` : 'archive OK — every module extracts and parses');
process.exit(broken || tests.length ? 1 : 0);
