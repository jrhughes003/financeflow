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

// 2b. Grounded Q&A over an aggregate summary ----------------------------------
async function query(client, { question, summary }) {
  const msg = await client.messages.create({
    model: MODELS.routine,
    max_tokens: 512,
    system: [{
      type: 'text',
      text: 'Answer questions about the user\'s spending using ONLY the provided '
        + 'aggregate summary. If the summary lacks the answer, say so plainly. Be concise.',
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{
      role: 'user',
      content: `Summary (JSON):\n${JSON.stringify(summary)}\n\nQuestion: ${question}`,
    }],
  });
  return { answer: textOf(msg) };
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

// Dispatch a feature against an already-minimized payload.
async function runFeature(client, feature, payload) {
  const fn = FEATURES[feature];
  if (!fn) throw new Error(`Unknown AI feature: ${feature}`);
  return fn(client, payload);
}

module.exports = { createClient, runFeature, categorize, parseEntry, query, insights, extract, MODELS };
