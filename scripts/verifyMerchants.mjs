// Second opinion on the generated merchant table, from a larger model.
//
// Division of labour, decided by measurement rather than taste. The 3B model
// generates candidates quickly (~15 min for the whole taxonomy) but its recall
// is contaminated: a hand review of its 270 rows found product brands (Intel,
// Purina), US-only chains (CVS, Walgreens, GEICO), businesses that no longer
// exist (Sears Canada, Car2Go), plain descriptions ("Bank Fees", "Interest"),
// and at least one hallucination that merged two real banks into "BMO Bank of
// Nova Scotia".
//
// The keyword veto in generateMerchants.mjs catches the wrong CATEGORY. It
// cannot catch "this is not a merchant". That needs world knowledge, which is
// exactly what the 8B has and the 3B does not — and here its slowness does not
// matter, because the answer is one word per merchant. 270 merchants is about
// 1,400 output tokens, which even at 2.5 tok/s is under ten minutes.
//
//   node scripts/verifyMerchants.mjs --model models/<8B>.gguf
//   node scripts/verifyMerchants.mjs --model ... --apply    # actually remove
//
// Without --apply it only reports, because a verifier that silently deletes
// data is worse than no verifier.

import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'src', 'data', 'merchants.json');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const MODEL = arg('model');
const BATCH = Number(arg('batch', 18));
const APPLY = args.includes('--apply');
if (!MODEL) throw new Error('pass --model <path to .gguf>');

const data = JSON.parse(readFileSync(OUT, 'utf8'));
console.log(`verifying ${data.merchants.length} merchants with ${path.basename(MODEL)}`);
console.log(APPLY ? 'mode: APPLY (rows will be removed)' : 'mode: report only (pass --apply to remove)');

const llama = await getLlama();
const model = await llama.loadModel({ modelPath: path.resolve(MODEL) });

const verdicts = new Map();
const batches = [];
for (let i = 0; i < data.merchants.length; i += BATCH) batches.push(data.merchants.slice(i, i + BATCH));

for (const [index, batch] of batches.entries()) {
  const context = await model.createContext({ contextSize: 2048 });
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: 'You judge whether a name is a real business that appears on Canadian bank statements. You answer only in the requested format, one line per item, no commentary.',
  });

  const prompt = `For each name, answer KEEP or DROP.

KEEP only if ALL of these are true:
- It is a real, currently operating business.
- It has locations in Canada, or Canadians commonly buy from it online.
- It would appear as the merchant on a bank or credit card statement.

DROP if it is:
- A product or manufacturer brand rather than a place you pay (Intel, Purina, Hill's Science Diet).
- A chain that does not operate in Canada (CVS, Walgreens, GEICO).
- Closed or defunct (Sears Canada, Car2Go).
- A description rather than a name (Bank Fees, Interest, Online Shopping, Vision Care).
- Not a real company, or two companies mixed together.

Answer format, one per line, nothing else:
Name | KEEP
Name | DROP

Names:
${batch.map(m => m.name).join('\n')}`;

  const t0 = Date.now();
  let answer = '';
  try {
    answer = await session.prompt(prompt, { maxTokens: 400, temperature: 0 });
  } catch (err) {
    console.error(`  batch ${index + 1}: failed — ${err.message}`);
    await context.dispose();
    continue;
  }

  let seen = 0;
  for (const line of answer.split('\n')) {
    const [rawName, verdict] = line.split('|').map(s => (s ?? '').trim());
    if (!rawName || !verdict) continue;
    const match = batch.find(m => m.name.toLowerCase() === rawName.toLowerCase());
    if (!match) continue;
    verdicts.set(match.name, verdict.toUpperCase().startsWith('K'));
    seen += 1;
  }
  console.log(`  batch ${String(index + 1).padStart(2)}/${batches.length}  answered ${seen}/${batch.length}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  await context.dispose();
}

await model.dispose();

// A name the verifier never answered for is KEPT. Silence is not a verdict,
// and dropping rows because a batch got truncated would quietly shrink the
// table for a reason that has nothing to do with the data.
const dropped = data.merchants.filter(m => verdicts.get(m.name) === false);
const unanswered = data.merchants.filter(m => !verdicts.has(m.name));

console.log('');
console.log(`KEEP ${data.merchants.length - dropped.length - unanswered.length}  DROP ${dropped.length}  no answer ${unanswered.length} (kept)`);
console.log('');
const byCat = {};
dropped.forEach((m) => { (byCat[m.category] = byCat[m.category] || []).push(m.name); });
Object.entries(byCat).forEach(([c, names]) => console.log(`  ${c.padEnd(18)} ${names.join(', ')}`));

if (APPLY) {
  data.merchants = data.merchants.filter(m => verdicts.get(m.name) !== false);
  data.verifiedBy = path.basename(MODEL);
  data.verifiedAt = new Date().toISOString();
  writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`\napplied: ${data.merchants.length} merchants remain`);
} else {
  console.log('\nreport only — re-run with --apply to remove these');
}
