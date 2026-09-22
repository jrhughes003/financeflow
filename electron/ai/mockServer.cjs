// A local stand-in for the Anthropic API, so every AI path can be exercised
// without an API key and without spending anything.
//
//   npm run ai:mock              # serves on http://127.0.0.1:8787
//   npm run electron:dev:mock    # desktop app wired to it
//
// It speaks enough of POST /v1/messages for this app: it reads the real request
// the SDK sends, then answers in the real response shape. Because the SDK itself
// stays in the path, this covers serialization, tool_use parsing and the SDK's
// error classes — the parts a hand-written fake client skips.
//
// Replies are derived from the request (the merchant actually sent, the amounts
// actually in the pasted text), so the app shows plausible results instead of a
// fixed string.
//
// Failure modes are the other half of the point. Set a scenario to make every
// subsequent call fail a specific way, and check the UI degrades gracefully:
//
//   MOCK_SCENARIO=rate_limit npm run ai:mock
//   curl -X POST 127.0.0.1:8787/__scenario -d auth_error   # switch at runtime
//   curl 127.0.0.1:8787/__scenario                         # read current one

const http = require('node:http');

const DEFAULT_PORT = 8787;

// Every scenario except `ok` is a way the real API can fail on a user.
const SCENARIOS = [
  'ok',
  'auth_error',    // 401 — bad or revoked key
  'rate_limit',    // 429 — too many requests
  'server_error',  // 500 — upstream trouble
  'overloaded',    // 529 — Anthropic overloaded
  'malformed',     // 200 with content the app must not crash on
  'empty',         // 200 with no content blocks at all
  'bad_category',  // a tool call naming a category that doesn't exist
  'slow',          // a delayed response, for timeout/spinner behaviour
];

const ERROR_STATUS = {
  auth_error: [401, 'authentication_error', 'invalid x-api-key'],
  rate_limit: [429, 'rate_limit_error', 'rate limit exceeded'],
  server_error: [500, 'api_error', 'internal server error'],
  overloaded: [529, 'overloaded_error', 'overloaded'],
};

const round2 = n => Math.round(n * 100) / 100;

// --- deriving plausible answers from the actual request ---------------------

// The category ids offered in the prompt, in order.
function categoryIds(text) {
  return [...text.matchAll(/^- ([a-z0-9_]+):/gm)].map(m => m[1]);
}

// Crude keyword routing — enough to look right in a demo, and deterministic.
const KEYWORDS = {
  dining_out: ['restaurant', 'sushi', 'pizza', 'coffee', 'tim hortons', 'starbucks', 'uber eats', 'doordash', 'grill', 'cafe', 'pho'],
  groceries: ['metro', 'fortinos', 'no frills', 'costco', 'farm boy', 'grocery', 'supermarket', 'loblaws'],
  transportation: ['esso', 'shell', 'petro', 'gas', 'uber', 'lyft', 'presto', 'transit', 'parking', 'insurance'],
  subscriptions: ['netflix', 'spotify', 'disney', 'subscription', 'prime', 'youtube'],
  housing: ['rent', 'hydro', 'rogers', 'bell', 'internet', 'landlord'],
  health: ['gym', 'goodlife', 'pharmacy', 'shoppers', 'dental'],
  products: ['amazon', 'best buy', 'indigo', 'winners', 'canadian tire'],
};

function guessCategory(merchant, available) {
  const m = (merchant || '').toLowerCase();
  for (const [id, words] of Object.entries(KEYWORDS)) {
    if (available.includes(id) && words.some(w => m.includes(w))) return id;
  }
  return available.includes('products') ? 'products' : (available[0] || 'products');
}

function firstAmount(text) {
  const m = (text || '').match(/\$?\s*(\d+(?:[.,]\d{1,2})?)/);
  return m ? round2(Number(m[1].replace(',', '.'))) : 0;
}

// "Today is 2026-09-22." — the app always sends it for relative-date resolution.
function todayFrom(text) {
  const m = (text || '').match(/Today is (\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : new Date().toISOString().slice(0, 10);
}

function shiftDate(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Resolve the handful of relative dates a person actually types.
function resolveDate(text, today) {
  const t = (text || '').toLowerCase();
  if (t.includes('yesterday')) return shiftDate(today, -1);
  if (t.includes('last night')) return shiftDate(today, -1);
  const daysAgo = t.match(/(\d+) days? ago/);
  if (daysAgo) return shiftDate(today, -Number(daysAgo[1]));
  const explicit = t.match(/(\d{4}-\d{2}-\d{2})/);
  if (explicit) return explicit[1];
  return today;
}

// "spent $40 on gas at Esso yesterday" → Esso
function guessMerchant(text) {
  const at = (text || '').match(/\bat\s+([A-Za-z0-9'&.\- ]{2,40}?)(?:\s+(?:yesterday|today|last night|on|for)\b|[.,]|$)/i);
  if (at) return at[1].trim();
  const on = (text || '').match(/\bon\s+([A-Za-z0-9'&.\- ]{2,40}?)(?:\s+(?:at|yesterday|today)\b|[.,]|$)/i);
  return on ? on[1].trim() : 'Unknown merchant';
}

// Receipt/statement lines that look like "MERCHANT ... 12.34".
function extractLines(text, available) {
  return (text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^(total|subtotal|tax|hst|gst|balance|thank you)/i.test(line))
    .map(line => {
      const m = line.match(/^(.*?)[\s.$]+(\d+(?:[.,]\d{2}))\s*$/);
      if (!m) return null;
      const merchant = m[1].replace(/[\s.*-]+$/, '').trim();
      if (!merchant) return null;
      const date = (line.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
      return {
        merchant,
        amount: round2(Number(m[2].replace(',', '.'))),
        category: guessCategory(merchant, available),
        ...(date ? { date } : {}),
      };
    })
    .filter(Boolean);
}

function summaryFrom(text) {
  const m = (text || '').match(/Summary \(JSON\):\s*(\{[\s\S]*?\})\s*(?:\n\nQuestion:|$)/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// --- response shapes --------------------------------------------------------

function message(model, content) {
  return {
    id: `msg_mock_${Math.random().toString(36).slice(2, 12)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 420, output_tokens: 96 },
  };
}

const toolUse = (name, input) => ({ type: 'tool_use', id: `toolu_mock_${name}`, name, input });
const textBlock = text => ({ type: 'text', text });

// Build the reply for one request body.
function replyFor(body, scenario) {
  const model = body.model || 'claude-sonnet-5';
  const prompt = String(body.messages?.[0]?.content ?? '');
  const system = Array.isArray(body.system)
    ? body.system.map(s => s.text).join(' ')
    : String(body.system || '');
  const available = categoryIds(prompt);
  const forced = body.tool_choice?.name;

  if (scenario === 'empty') return message(model, []);
  if (scenario === 'malformed') {
    // Right envelope, useless content — the app must fall back, not throw.
    return message(model, [textBlock('```json\n{ not really json ]\n```')]);
  }

  if (forced === 'categorize') {
    const merchant = (prompt.match(/Merchant: "(.*)"/) || [])[1] || '';
    const category = scenario === 'bad_category'
      ? 'nonexistent_category'
      : guessCategory(merchant, available);
    return message(model, [toolUse('categorize', { category, confidence: 0.86 })]);
  }

  if (forced === 'create_transaction') {
    const note = (prompt.match(/Note: "(.*)"/) || [])[1] || '';
    const today = todayFrom(prompt);
    const merchant = guessMerchant(note);
    return message(model, [toolUse('create_transaction', {
      date: resolveDate(note, today),
      merchant,
      amount: firstAmount(note),
      category: scenario === 'bad_category' ? 'nonexistent_category' : guessCategory(merchant, available),
    })]);
  }

  if (forced === 'extract_transactions') {
    const text = (prompt.split(/Text:\n/)[1] || '');
    return message(model, [toolUse('extract_transactions', { transactions: extractLines(text, available) })]);
  }

  // Text features: insights (analyst system prompt) and Q&A.
  const summary = summaryFrom(prompt);
  if (/personal-finance analyst/i.test(system)) {
    const total = summary?.totalExpenses ?? 0;
    const rate = summary?.savingsRate ?? 0;
    const top = Object.entries(summary?.byCategory || {}).sort((a, b) => b[1] - a[1])[0];
    return message(model, [textBlock(
      `[mock] You spent $${total} this period, saving about ${rate}% of income.`
      + (top ? ` ${top[0].replace(/_/g, ' ')} was the largest category at $${top[1]}.` : '')
      + ' Consider setting a firmer cap on the categories that ran over,'
      + ' and moving the difference into your highest-priority goal.',
    )]);
  }

  const question = (prompt.match(/Question: (.*)$/m) || [])[1] || 'that';
  const total = summary?.totalExpenses;
  return message(model, [textBlock(
    `[mock] Answering "${question}"`
    + (total != null ? ` — total spending in the summary is $${total}.` : ' — the summary has no figure for that.'),
  )]);
}

// --- server -----------------------------------------------------------------

function createMockServer({ scenario = 'ok', delayMs = 1500 } = {}) {
  let current = SCENARIOS.includes(scenario) ? scenario : 'ok';
  const requests = []; // exposed for tests: what the app actually sent

  const server = http.createServer((req, res) => {
    const send = (status, payload) => {
      const json = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) });
      res.end(json);
    };

    if (req.url.startsWith('/__scenario')) {
      if (req.method === 'GET') return send(200, { scenario: current, available: SCENARIOS });
      return readBody(req, raw => {
        const next = raw.trim().replace(/^"|"$/g, '');
        if (!SCENARIOS.includes(next)) return send(400, { error: `unknown scenario: ${next}`, available: SCENARIOS });
        current = next;
        return send(200, { scenario: current });
      });
    }

    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
      return send(404, { type: 'error', error: { type: 'not_found_error', message: `no route for ${req.method} ${req.url}` } });
    }

    return readBody(req, async raw => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      requests.push(body);

      const failure = ERROR_STATUS[current];
      if (failure) {
        const [status, type, msg] = failure;
        return send(status, { type: 'error', error: { type, message: `[mock] ${msg}` } });
      }

      if (current === 'slow') await new Promise(r => setTimeout(r, delayMs));
      return send(200, replyFor(body, current));
    });
  });

  server.requests = requests;
  server.getScenario = () => current;
  server.setScenario = s => { current = s; };
  return server;
}

function readBody(req, done) {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => done(raw));
}

// Run directly: node electron/ai/mockServer.cjs
if (require.main === module) {
  const port = Number(process.env.MOCK_PORT || DEFAULT_PORT);
  const scenario = process.env.MOCK_SCENARIO || 'ok';
  const server = createMockServer({ scenario });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[mock anthropic] http://127.0.0.1:${port}  scenario=${server.getScenario()}`);
    console.log(`[mock anthropic] point the app at it:  FINANCEFLOW_AI_BASE_URL=http://127.0.0.1:${port}`);
    console.log(`[mock anthropic] scenarios: ${SCENARIOS.join(', ')}`);
  });
}

module.exports = { createMockServer, SCENARIOS, DEFAULT_PORT };
