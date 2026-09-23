// Q&A eval runner.
//
//   npx vite-node eval/run.mjs -- --limit 3        # pilot
//   npx vite-node eval/run.mjs                     # full set
//   npx vite-node eval/run.mjs -- --mock           # free, against the mock server
//
// It drives the real code path — the same runFeature('query', …) and the same
// aggregates.cjs tools the desktop app uses — against the demo database, so
// what's measured is the shipped behaviour rather than a reimplementation.
//
// Results land in .claude/hillclimb/qa/<variant>/ as results.jsonl plus a trace
// per case, one row written as each case finishes so a crash costs nothing.

import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CASES } from './cases.mjs';
import { grade } from './grader.mjs';
import { state } from './groundTruth.mjs';
import { createClient, runFeature } from '../electron/ai/client.cjs';
import { executeTool } from '../electron/ai/aggregates.cjs';
import { buildPayload } from '../electron/ai/payload.cjs';
import { taxonomy } from '../src/ai/ai.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1]?.startsWith('--') ? true : args[i + 1] ?? true);
};

const VARIANT = flag('variant', 'baseline');
const LIMIT = Number(flag('limit', 0)) || 0;
const ONLY = flag('only');
const MOCK = Boolean(flag('mock', false));
const TODAY = '2026-09-22'; // the demo data's "now"
const CASE_TIMEOUT_MS = 90_000;

// The key never goes in the repo: either the environment or eval/.env.local,
// which .gitignore already covers.
function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const local = new URL('./.env.local', import.meta.url).pathname.replace(/^\//, '');
  if (existsSync(local)) {
    const match = readFileSync(local, 'utf8').match(/ANTHROPIC_API_KEY\s*=\s*(.+)/);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const outDir = join('.claude', 'hillclimb', 'qa', VARIANT);
mkdirSync(join(outDir, 'traces'), { recursive: true });
const resultsPath = join(outDir, 'results.jsonl');
const errorsPath = join(outDir, 'errors.jsonl');
writeFileSync(resultsPath, '');

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)),
]);

async function main() {
  const key = MOCK ? 'sk-ant-mock' : apiKey();
  if (!key) {
    console.error('No API key. Set ANTHROPIC_API_KEY, or put it in eval/.env.local, or pass --mock.');
    process.exit(1);
  }
  if (MOCK) process.env.FINANCEFLOW_AI_BASE_URL = process.env.FINANCEFLOW_AI_BASE_URL || 'http://127.0.0.1:8787';

  const client = createClient(key);
  const categories = taxonomy(state.customCategories);

  let cases = CASES;
  if (ONLY) cases = cases.filter(c => c.id === ONLY || c.tags.includes(ONLY));
  if (LIMIT) cases = cases.slice(0, LIMIT);

  console.log(`running ${cases.length} case(s) · variant=${VARIANT} · ${MOCK ? 'MOCK' : 'live API'}\n`);

  const started = Date.now();
  const rows = [];

  for (const testCase of cases) {
    const t0 = Date.now();
    // Every tool result is captured: it is what "was this number sourced?"
    // is decided against.
    const toolResults = [];
    const runTool = (name, input) => {
      const result = executeTool(state, name, input);
      toolResults.push({ tool: name, input, result });
      return result;
    };

    try {
      // Through the real gate, so the eval also proves what is being sent.
      const payload = buildPayload('query', {
        question: testCase.question,
        today: TODAY,
        categories,
        transactions: state.transactions, // must be stripped by the gate
      });
      if ('transactions' in payload) throw new Error('payload gate leaked the ledger');

      const data = await withTimeout(
        runFeature(client, 'query', payload, { runTool }),
        CASE_TIMEOUT_MS,
        testCase.id,
      );

      const graded = grade(testCase, data.answer, toolResults.map(t => t.result));
      const row = {
        prompt_id: testCase.id,
        prompt: testCase.question,
        tags: [testCase.tags[0], ...(testCase.seed ? ['seed'] : []), ...testCase.tags.slice(1)],
        status: 'ok',
        answer: data.answer,
        grade: graded.grade,
        explanation: graded.explanation,
        refused_when_answerable: graded.refusedWhenAnswerable,
        tool_calls: toolResults.length,
        tools_used: toolResults.map(t => t.tool),
        latency_s: Number(((Date.now() - t0) / 1000).toFixed(2)),
        model: data.model || null,
        usage: data.usage || null,
      };
      appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
      rows.push(row);

      writeFileSync(join(outDir, 'traces', `${testCase.id}_rep0.json`), JSON.stringify([
        { role: 'user', content: testCase.question },
        ...toolResults.flatMap(t => [
          { role: 'tool_call', name: t.tool, content: JSON.stringify(t.input, null, 1) },
          { role: 'tool_result', content: JSON.stringify(t.result, null, 1) },
        ]),
        { role: 'assistant', content: data.answer },
      ], null, 1));

      const mark = row.grade.trust === 0 ? 'TRUST✗' : row.grade.correct ? 'ok    ' : 'miss  ';
      console.log(`${mark} ${testCase.id.padEnd(22)} ${row.tool_calls} call(s) ${row.latency_s}s`);
      if (row.grade.trust === 0 || !row.grade.correct) console.log(`       ↳ ${row.explanation.correct}`);
    } catch (err) {
      appendFileSync(errorsPath, `${JSON.stringify({
        prompt_id: testCase.id, rep: 0, failure: /timeout/.test(err.message) ? 'timeout' : 'harness_or_api',
        error: err.message,
      })}\n`);
      console.log(`ERROR  ${testCase.id.padEnd(22)} ${err.message}`);
    }
  }

  // --- summary --------------------------------------------------------------
  const n = rows.length;
  const sum = k => rows.reduce((s, r) => s + (k(r) || 0), 0);
  const trust = sum(r => r.grade.trust);
  const correct = sum(r => r.grade.correct);
  const inTok = sum(r => r.usage?.input_tokens);
  const outTok = sum(r => r.usage?.output_tokens);

  console.log(`\n${'='.repeat(58)}`);
  console.log(`trust    ${trust}/${n}  (${n ? Math.round((trust / n) * 100) : 0}%)   ← no unsupported claims`);
  console.log(`correct  ${correct}/${n}  (${n ? Math.round((correct / n) * 100) : 0}%)`);
  console.log(`refused when answerable: ${sum(r => r.refused_when_answerable)}`);
  console.log(`tokens   ${inTok} in / ${outTok} out over ${n} case(s)`);
  console.log(`tool calls: ${sum(r => r.tool_calls)} total · wall clock ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`results → ${resultsPath}`);

  const failures = rows.filter(r => r.grade.trust === 0);
  if (failures.length) {
    console.log(`\ntrust failures (${failures.length}):`);
    failures.forEach(r => console.log(`  ${r.prompt_id}: ${r.explanation.trust}\n    "${r.answer.slice(0, 160)}"`));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
