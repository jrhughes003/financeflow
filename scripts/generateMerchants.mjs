// Builds the merchant table with a local LLM. Development only — never shipped,
// never run by the app, and node-llama-cpp is a devDependency.
//
// Why generate rather than infer at runtime: measured on merchant-grouped folds,
// the hand-written keyword table scores 0.830 macro-F1 on merchants the model
// has never seen, against 0.257 for character n-grams and 0.254 for sentence
// embeddings. A curated table is the best categoriser in this repository by a
// wide margin, so the useful thing an LLM can do is make the table bigger — once,
// offline, into a file a human can read and correct. Shipping the model instead
// would cost a gigabyte of installer to lose to a JSON file.
//
// The weights are gitignored (multi-GB). To fetch the two this was built with:
//
//   npx -y node-llama-cpp pull --dir ./models //     hf:bartowski/Llama-3.2-3B-Instruct-GGUF/Llama-3.2-3B-Instruct-Q4_K_M.gguf
//   npx -y node-llama-cpp pull --dir ./models //     hf:bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf
//
// The 3B generates (fast, contaminated); the 8B verifies in scripts/
// verifyMerchants.mjs (slow, but its answer is one word so the slowness does
// not matter). Measured on the machine this was written on — an i7-1165G7 with
// Iris Xe — the 8B runs at 2.5 tok/s on the GPU and 2.9 tok/s on the CPU,
// because the integrated GPU shares system memory and buys nothing. Generating
// with it would have taken about five hours; the 3B takes fifteen minutes.
//
//   node scripts/generateMerchants.mjs --model models/<file>.gguf
//   node scripts/generateMerchants.mjs --model ... --limit 3   # a quick smoke run
//
// Resumable: existing rows in the output file are kept, and a (category,
// subcategory) pair that already has rows is skipped. Delete the file to start
// over. That matters because a full run takes a while on a laptop CPU.

import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'src', 'data', 'merchants.json');
const TAXONOMY = path.join(ROOT, 'src', 'utils', 'categorization.ts');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const MODEL = arg('model');
const CLEAN_ONLY = args.includes('--clean');
const PER_GROUP = Number(arg('per', 60));
const LIMIT = Number(arg('limit', Infinity));
if (!MODEL && !CLEAN_ONLY) throw new Error('pass --model <path to .gguf>, or --clean to re-filter the existing file');

// --- the taxonomy, read from the one place it is defined ---------------------
//
// Parsed out of the TypeScript rather than duplicated here. A second copy would
// drift the moment someone adds a category, and the failure would be silent:
// merchants generated for a category that no longer exists. The assertion below
// is the guard — if the shape of categorization.ts changes, this stops rather
// than quietly generating against a partial taxonomy.
function readTaxonomy() {
  const src = readFileSync(TAXONOMY, 'utf8');
  const body = src.slice(src.indexOf('export const CATEGORIES'), src.indexOf('export const FALLBACK_CATEGORY_ID'));
  const out = [];
  const re = /id: '([a-z_]+)',\s*\n\s*name: '([^']+)',[\s\S]*?subcategories: \[([^\]]*)\][\s\S]*?keywords: \[([\s\S]*?)\]\s*\n\s*\}/g;
  let m;
  const unquote = s => s.split(',')
    .map(x => x.trim().replace(/\/\/.*$/, '').trim())
    .map(x => x.replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  while ((m = re.exec(body)) !== null) {
    out.push({ id: m[1], name: m[2], subcategories: unquote(m[3]), keywords: unquote(m[4]) });
  }
  if (out.length < 5) throw new Error(`parsed only ${out.length} categories from categorization.ts — the parser needs updating`);
  return out;
}

/**
 * The app's own keyword matcher, as a veto on what the model claims.
 *
 * This is the strongest validation available and it costs nothing: the keyword
 * table is hand-written, it scores 0.830 macro-F1 on unseen merchants, and it
 * is already the thing the app trusts. So when the model offers "Loblaws" as a
 * dining_out merchant and the table says groceries, the table wins and the row
 * is dropped. A 3B model asked for "Coffee & Drinks" will reach for Coca-Cola
 * and Sobeys once it runs out of coffee chains, and without this check those
 * land in the wrong category permanently.
 *
 * Mirrors autoCategorize in src/utils/categorization.ts: first match wins, in
 * category order.
 */
function keywordCategory(categories, name, fallbackId) {
  const lower = String(name).toLowerCase();
  for (const cat of categories) {
    if (cat.keywords.some(kw => kw && lower.includes(kw))) return cat.id;
  }
  return fallbackId;
}

// --- normalisation, mirroring src/utils/ml/features.ts -----------------------
const normalise = raw => String(raw ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9&' ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Names too short or too generic to be useful.
 *
 * The table is matched on the whole normalised name, not as a substring, so a
 * short name is not dangerous the way a short keyword is — but "gas" or "the"
 * as a merchant is noise either way, and a one-character name is a parse
 * failure that got through.
 */
const GENERIC = new Set(['the', 'gas', 'store', 'shop', 'market', 'inc', 'ltd', 'company', 'n/a', 'none', 'other']);

/**
 * Words that describe a business rather than name one.
 *
 * A first pass produced "The Coffee Shop", "Café au Lait" and "Black's Coffee"
 * alongside Tim Hortons and Second Cup — the model filling its quota with
 * plausible-sounding descriptions once it ran out of real chains. A name built
 * entirely from these is a description, so it is dropped. "Boston Pizza" keeps
 * its "pizza" because "boston" is not in the list; "The Coffee Shop" has
 * nothing else left.
 */
const DESCRIPTIVE = new Set([
  'the', 'a', 'of', 'and', '&', 'my', 'your', 'local', 'city', 'town', 'corner',
  'coffee', 'shop', 'store', 'cafe', 'café', 'bar', 'grill', 'restaurant', 'diner',
  'bistro', 'kitchen', 'house', 'place', 'spot', 'market', 'mart', 'supermarket',
  'grocery', 'bakery', 'deli', 'pub', 'tavern', 'eatery', 'food', 'foods', 'company',
  'co', 'inc', 'ltd', 'clinic', 'centre', 'center', 'services', 'service', 'group',
  'salon', 'spa', 'gym', 'fitness', 'pharmacy', 'hardware', 'garden', 'pet', 'pets',
  'insurance', 'bank', 'hotel', 'motel', 'airlines', 'air', 'travel', 'agency',
  'au', 'lait', 'latte', 'espresso', 'tea', 'tolls', 'toll', 'transit', 'parking',
  'dental', 'denture', 'vision', 'optical', 'eyewear', 'smile', 'care', 'health',
  'online', 'shopping', 'water', 'works', 'power', 'generation', 'energy', 'utility',
  'wireless', 'mobile', 'telecom', 'rental', 'rentals', 'repair', 'repairs', 'supply',
  'supplies', 'outlet', 'depot', 'warehouse', 'wholesale', 'discount', 'general',
]);

/**
 * Suffixes the model adds to pad a list out to the number it was asked for.
 *
 * One request for dining produced Tim Hortons, Tim Hortons Canada, Tim Hortons
 * Restaurants and Tim's Restaurant — four rows for one brand — plus McDonald's
 * three times. Stripping these before the duplicate check collapses the family
 * back to one entry.
 */
const PADDING_SUFFIX = /\s+(canada|canadian|inc|incorporated|ltd|limited|corp|corporation|company|co|restaurants|restaurant|stores|store|wholesale|express|group|holdings)$/;

/** Regions, for the same reason: "Tolls Ontario", "Tolls BC", "Tolls Alberta"... */
const REGION = /\s+(canada|ontario|quebec|alberta|manitoba|saskatchewan|bc|british columbia|nova scotia|new brunswick|newfoundland|pei|prince edward island|yukon|nunavut|northwest territories)$/;

/** The brand under the padding: what two rows have to share to be one row. */
function canonical(name) {
  let n = normalise(name).replace(/^the\s+/, '');
  for (let i = 0; i < 3; i += 1) {
    const before = n;
    n = n.replace(REGION, '').replace(PADDING_SUFFIX, '').trim();
    if (n === before) break;
  }
  return n || normalise(name);
}

const usable = (name) => {
  const n = canonical(name);
  if (n.length < 3 || n.length > 40 || !/[a-z]/.test(n) || GENERIC.has(n)) return false;
  const words = n.split(' ').filter(Boolean);
  // Every word describes the trade, so nothing here identifies a business.
  if (words.every(w => DESCRIPTIVE.has(w))) return false;
  return true;
};

/**
 * Drop names that are another kept name plus extra words.
 *
 * Runs across the whole file rather than per category, because the padding
 * shows up in both places: "Costco" in groceries and "Costco Wholesale" in
 * shopping are one merchant. Shortest name wins, which is also the one a
 * statement is most likely to show.
 */
function dropPrefixFamilies(merchants) {
  const byLength = [...merchants].sort((a, b) => canonical(a.name).length - canonical(b.name).length
    || a.name.localeCompare(b.name));
  const kept = [];
  const keptCanon = [];
  const dropped = [];
  for (const m of byLength) {
    const c = canonical(m.name);
    if (keptCanon.some(k => c === k || c.startsWith(`${k} `))) { dropped.push(m.name); continue; }
    keptCanon.push(c);
    kept.push(m);
  }
  return { kept, dropped };
}

function loadExisting() {
  if (!existsSync(OUT)) return { merchants: [] };
  try {
    const parsed = JSON.parse(readFileSync(OUT, 'utf8'));
    return Array.isArray(parsed.merchants) ? parsed : { merchants: [] };
  } catch {
    throw new Error(`${OUT} exists but is not readable JSON — move it aside rather than losing it`);
  }
}

function save(data) {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const categories = readTaxonomy();
const fallbackId = 'products';
console.log(`taxonomy: ${categories.length} categories, ${categories.reduce((n, c) => n + c.subcategories.length, 0)} subcategories`);

const data = loadExisting();
const seen = new Map(data.merchants.map(m => [canonical(m.name), m]));
const done = new Set(data.merchants.map(m => m.category));
console.log(`resuming with ${data.merchants.length} merchants already generated`);

if (CLEAN_ONLY) {
  const before = data.merchants.length;
  const surviving = data.merchants.filter(m => usable(m.name));
  const { kept, dropped } = dropPrefixFamilies(surviving);
  data.merchants = kept.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  save(data);
  console.log(`cleaned: ${before} -> ${data.merchants.length}`);
  console.log(`  ${before - surviving.length} failed the name filter`);
  console.log(`  ${dropped.length} were padded variants: ${dropped.slice(0, 10).join(', ')}`);
  process.exit(0);
}

const llama = await getLlama();
const model = await llama.loadModel({ modelPath: path.resolve(MODEL) });
console.log(`model loaded: ${path.basename(MODEL)}`);

let processed = 0;
let added = 0;
let rejected = 0;
let vetoed = 0;
const conflicts = [];

// One prompt per CATEGORY, not per subcategory. Asking for a subcategory
// directly loses the category anchor when the subcategory name is ambiguous:
// "Coffee & Drinks" produced Coca-Cola, Pepsi, Loblaws and Walmart, which are
// not dining at all. Naming the category and letting the model file each
// result under a listed subcategory keeps the important half right, and costs
// 18 prompts instead of 84.
for (const category of categories) {
  if (processed >= LIMIT) break;
  const key = category.id;
  if (done.has(key)) { console.log(`skip ${key} (already done)`); continue; }
  processed += 1;

  // A fresh context per group: the model is being asked the same question
  // repeatedly, and letting the history accumulate both wastes context and
  // encourages it to echo earlier answers.
  const context = await model.createContext({ contextSize: 2048 });
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: 'You list real merchant and business names. You answer with names only, one per line, no numbering, no commentary, no explanations.',
  });

  const prompt = `Name real businesses that a person in Canada would see on a bank or credit card statement, for this spending category.

Category: ${category.name}
Put each one under exactly one of these: ${category.subcategories.join(', ')}

Format, one per line:
Name | Subcategory

Rules:
- Only chains, franchises or nationally known brands. If it has one location, leave it out.
- Write the brand name as a statement shows it: "Tim Hortons", "Canadian Tire", "Shoppers Drug Mart".
- Do NOT write descriptions. "The Coffee Shop", "Local Pharmacy" and "City Dental" are not names.
- Everything you list must belong to ${category.name}. Nothing from any other kind of spending.
- List at most ${PER_GROUP}. Listing ten real ones is better than forty with invented ones in it.
- If you run out of real examples, stop. Do not fill the list.
- No numbering, no bullets, no commentary.`;

  const t0 = Date.now();
  let answer = '';
  try {
    answer = await session.prompt(prompt, { maxTokens: 500, temperature: 0.3 });
  } catch (err) {
    console.error(`  ${key}: generation failed — ${err.message}`);
    await context.dispose();
    continue;
  }

  const offered = answer
    .split('\n')
    .map(line => line.replace(/^[\s*\-\d.)]+/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [rawName, rawSub] = line.split('|').map(s => (s ?? '').trim());
      // An unlisted or missing subcategory is a formatting slip, not a reason
      // to lose a good merchant name — the category is the part that matters.
      const sub = category.subcategories.find(s => s.toLowerCase() === (rawSub ?? '').toLowerCase());
      return { name: rawName, subcategory: sub ?? category.subcategories[0] };
    })
    .filter(r => r.name);

  let kept = 0;
  for (const { name, subcategory } of offered) {
    if (!usable(name)) { rejected += 1; continue; }

    // The hand-written table gets the final say. It only objects when it
    // actively recognises the name as something else — silence (the fallback)
    // is not a disagreement, since most generated names are new to it.
    const says = keywordCategory(categories, name, fallbackId);
    if (says !== fallbackId && says !== category.id) {
      vetoed += 1;
      conflicts.push({ name, claimed: category.id, keywordsSay: says });
      continue;
    }

    const norm = canonical(name);
    const prior = seen.get(norm);
    if (prior) {
      // The same merchant offered under two categories means the model is
      // unsure, and a table that claims both is worse than one claiming
      // neither. First answer wins, and the clash is reported for review.
      if (prior.category !== category.id) conflicts.push({ name, claimed: category.id, keywordsSay: `already ${prior.category}` });
      continue;
    }
    const row = { name: name.trim(), category: category.id, subcategory };
    seen.set(norm, row);
    data.merchants.push(row);
    kept += 1;
    added += 1;
  }

  console.log(`  ${key.padEnd(20)} +${String(kept).padStart(3)}  (${((Date.now() - t0) / 1000).toFixed(0)}s, ${offered.length} offered)`);
  await context.dispose();

  // Written after every group so a run that is interrupted — or that takes
  // longer than anyone wants to sit through — loses nothing.
  data.generatedAt = new Date().toISOString();
  data.model = path.basename(MODEL);
  data.merchants.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  save(data);
}

await model.dispose();

// One pass over everything at the end: padding families cross categories, so
// they cannot all be caught while a single category is being written.
const { kept, dropped } = dropPrefixFamilies(data.merchants);
data.merchants = kept.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
save(data);

console.log('');
if (dropped.length) console.log(`collapsed ${dropped.length} padded variants, e.g. ${dropped.slice(0, 6).join(', ')}`);
console.log(`added ${added} merchants, rejected ${rejected} unusable names, vetoed ${vetoed} by the keyword table, ${data.merchants.length} total`);
if (conflicts.length) {
  console.log(`${conflicts.length} merchants were offered under more than one category (first answer kept):`);
  conflicts.slice(0, 25).forEach(c => console.log(`  ${String(c.name).padEnd(28)} claimed ${String(c.claimed).padEnd(16)} but ${c.keywordsSay}`));
}
console.log(`written to ${path.relative(ROOT, OUT)}`);
