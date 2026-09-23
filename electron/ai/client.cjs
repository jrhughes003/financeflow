// Anthropic API client and the four AI features. Runs only in the Electron main
// process, so the API key and all network calls stay out of the renderer.
//
// Routine calls (categorize, parse, extract) use Sonnet; the heavier reasoning
// pass (insights) uses Opus. System prompts + the category taxonomy are marked
// cacheable to cut cost on repeated calls.

const Anthropic = require('@anthropic-ai/sdk');

const MODELS = {
  routine: 'claude-sonnet-5',
  reasoning: 'claude-opus-5',
};

// Pointing FINANCEFLOW_AI_BASE_URL at the local mock server (npm run ai:mock)
// exercises this entire path — SDK serialization, tool_use parsing, error
// handling — with no API key and no spend. Unset in a packaged build.
function createClient(apiKey) {
  const baseURL = process.env.FINANCEFLOW_AI_BASE_URL;
  if (!baseURL) return new Anthropic({ apiKey });
  // No retries against the mock, so simulated 429/500s surface immediately.
  return new Anthropic({ apiKey, baseURL, maxRetries: 0 });
}

// Pull the first tool_use input out of a response, or null.
function firstToolInput(message) {
  const block = (message.content || []).find(b => b.type === 'tool_use');
  return block ? block.input : null;
}

// Concatenate text blocks of a response.
function textOf(message) {
  return (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

function categoryList(categories) {
  return (categories || []).map(c => `- ${c.id}: ${c.name}`).join('\n');
}

// 1. Smart auto-categorization -------------------------------------------------
async function categorize(client, { merchant, categories }) {
  const msg = await client.messages.create({
    model: MODELS.routine,
    max_tokens: 256,
    system: [{
      type: 'text',
      text: 'You categorize a single financial transaction by merchant name. '
        + 'Choose the single best category id from the provided list. If unsure, '
        + 'pick the closest and lower the confidence.',
      cache_control: { type: 'ephemeral' },
    }],
    tools: [{
      name: 'categorize',
      description: 'Return the chosen category id and a confidence score.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'A category id from the list' },
          confidence: { type: 'number', description: '0.0 to 1.0' },
        },
        required: ['category', 'confidence'],
      },
    }],
    tool_choice: { type: 'tool', name: 'categorize' },
    messages: [{
      role: 'user',
      content: `Categories:\n${categoryList(categories)}\n\nMerchant: "${merchant}"`,
    }],
  });
  return firstToolInput(msg);
}

// 2a. Natural-language entry ---------------------------------------------------
async function parseEntry(client, { text, today, categories }) {
  const msg = await client.messages.create({
    model: MODELS.routine,
    max_tokens: 512,
    system: [{
      type: 'text',
      text: 'Convert a natural-language spending note into one structured transaction. '
        + `Resolve relative dates against today's date. Choose a category id from the list. `
        + 'Amounts are positive numbers.',
      cache_control: { type: 'ephemeral' },
    }],
    tools: [{
      name: 'create_transaction',
      description: 'Emit the structured transaction parsed from the note.',
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          merchant: { type: 'string' },
          amount: { type: 'number' },
          category: { type: 'string', description: 'A category id from the list' },
        },
        required: ['date', 'merchant', 'amount', 'category'],
      },
    }],
    tool_choice: { type: 'tool', name: 'create_transaction' },
    messages: [{
      role: 'user',
      content: `Today is ${today}.\nCategories:\n${categoryList(categories)}\n\nNote: "${text}"`,
    }],
  });
  return firstToolInput(msg);
}

// 2b. Grounded Q&A, answered through local aggregate tools --------------------
//
// Only the question leaves the device. To answer it the model must call the
// tools in aggregates.cjs, which run here against the local database and return
// sums and counts — never transactions. That makes the ledger reachable for
// reasoning without it ever being sent, and it means the model can answer
// merchant- and period-level questions that a fixed summary blob could not.
//
// `ctx.runTool(name, input)` is supplied by the main process; without it the
// feature degrades to answering from general knowledge of what it can't see.
const MAX_QUERY_TURNS = 6;

async function query(client, { question, today, categories }, ctx = {}) {
  const { TOOLS } = require('./aggregates.cjs');
  const runTool = ctx.runTool;

  const system = [{
    type: 'text',
    text: 'You answer questions about the user\'s own finances. You cannot see their '
      + 'transactions: every figure must come from the tools, which return aggregates '
      + 'computed locally on the user\'s machine.\n\n'
      + 'Call a tool for anything factual — never estimate, extrapolate or invent a '
      + 'number, and never claim knowledge of an individual purchase. Several tool '
      + 'calls are fine when a question needs comparison (e.g. two periods). Spending '
      + 'figures exclude savings transfers and flagged one-off exceptions and are net '
      + 'of repayments from other people; say so only if it matters to the answer.\n\n'
      + 'If the tools cannot answer, say plainly what you cannot see rather than '
      + 'guessing. Answer in 1-3 sentences, quoting the figures you were given, and '
      + 'name the period you used.',
    cache_control: { type: 'ephemeral' },
  }];

  const messages = [{
    role: 'user',
    content: `Today is ${today}.\nCategory ids: ${(categories || []).map(c => c.id).join(', ')}\n\n`
      + `Question: ${question}`,
  }];

  // What was consulted, so the UI can show it and the user can verify it.
  const consulted = [];
  // Summed across the loop's turns — a tool-using answer costs more than one
  // call, and anything measuring cost needs the whole total.
  const usage = { input_tokens: 0, output_tokens: 0 };
  let servedModel = null;

  for (let turn = 0; turn < MAX_QUERY_TURNS; turn += 1) {
    const msg = await client.messages.create({
      model: MODELS.routine,
      max_tokens: 1024,
      system,
      tools: TOOLS,
      messages,
    });

    usage.input_tokens += msg.usage?.input_tokens || 0;
    usage.output_tokens += msg.usage?.output_tokens || 0;
    servedModel = msg.model || servedModel;

    const toolUses = (msg.content || []).filter(b => b.type === 'tool_use');
    if (!toolUses.length || msg.stop_reason !== 'tool_use') {
      return { answer: textOf(msg), consulted, usage, model: servedModel };
    }

    if (!runTool) {
      return {
        answer: textOf(msg) || 'I could not look that up — the local data tools are unavailable.',
        consulted, usage, model: servedModel,
      };
    }

    // Answer every tool call from this turn in one user message.
    const results = toolUses.map(use => {
      consulted.push({ tool: use.name, input: use.input });
      try {
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(runTool(use.name, use.input)),
        };
      } catch (err) {
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: JSON.stringify({ error: err.message || 'tool failed' }),
        };
      }
    });

    messages.push({ role: 'assistant', content: msg.content });
    messages.push({ role: 'user', content: results });
  }

  return {
    answer: 'That took too many lookups to answer — try asking about a narrower period.',
    consulted, usage, model: servedModel,
    truncated: true,
  };
}

// 3. Spending insights & advice (heavier reasoning) ---------------------------
async function insights(client, { summary }) {
  const msg = await client.messages.create({
    model: MODELS.reasoning,
    max_tokens: 900,
    system: [{
      type: 'text',
      text: 'You are a personal-finance analyst. You are given an aggregate monthly '
        + 'summary that already contains the app\'s own analysis: `whatChanged` compares '
        + 'this month with the user\'s own recent baseline (not a budget), '
        + '`monthEndProjection` is where the month lands at the current pace, '
        + '`cashFlowOutlook` is the months ahead, `savingsOpportunities` are quantified '
        + 'in dollars, `flagged` counts things worth reviewing, and `goals`/`debts` carry '
        + 'pacing and payoff status.\n\n'
        + 'Write 3-5 sentences. Lead with the single most decision-relevant fact. Quote '
        + 'the figures you are given rather than deriving new ones, and never recompute '
        + 'or infer totals. Prefer a change against the baseline over a raw total, and '
        + 'name the dollar amount for any suggestion. Finish with one or two concrete '
        + 'actions tied to a goal, a debt or a specific category.\n\n'
        + 'The summary is aggregate-only by design: it has no individual transactions and '
        + 'no merchant names. Never ask for them, and never invent one — when something '
        + 'is only a count (e.g. flagged duplicates), say how many and point the user at '
        + 'the relevant page.',
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{
      role: 'user',
      content: `Summary (JSON):\n${JSON.stringify(summary)}`,
    }],
  });
  return { narrative: textOf(msg) };
}

// 4. Receipt / bank-statement parsing -----------------------------------------
async function extract(client, { text, categories }) {
  const msg = await client.messages.create({
    model: MODELS.routine,
    max_tokens: 2048,
    system: [{
      type: 'text',
      text: 'Extract individual purchase line items from messy receipt or bank-statement '
        + 'text into structured transactions. Skip totals, taxes, and non-purchase lines. '
        + 'Choose a category id from the list for each.',
      cache_control: { type: 'ephemeral' },
    }],
    tools: [{
      name: 'extract_transactions',
      description: 'Emit all transactions found in the text.',
      input_schema: {
        type: 'object',
        properties: {
          transactions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'YYYY-MM-DD, best guess if absent' },
                merchant: { type: 'string' },
                amount: { type: 'number' },
                category: { type: 'string' },
              },
              required: ['merchant', 'amount', 'category'],
            },
          },
        },
        required: ['transactions'],
      },
    }],
    tool_choice: { type: 'tool', name: 'extract_transactions' },
    messages: [{
      role: 'user',
      content: `Categories:\n${categoryList(categories)}\n\nText:\n${text}`,
    }],
  });
  const out = firstToolInput(msg);
  return out || { transactions: [] };
}

const FEATURES = { categorize, parse_entry: parseEntry, query, insights, extract };

// Dispatch a feature against an already-minimized payload. `ctx` carries
// capabilities the main process grants a feature — currently only runTool, for
// the Q&A tool loop.
async function runFeature(client, feature, payload, ctx = {}) {
  const fn = FEATURES[feature];
  if (!fn) throw new Error(`Unknown AI feature: ${feature}`);
  return fn(client, payload, ctx);
}

module.exports = { createClient, runFeature, categorize, parseEntry, query, insights, extract, MODELS };
