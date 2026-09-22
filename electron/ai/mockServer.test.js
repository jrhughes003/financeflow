// @vitest-environment node
//
// Integration coverage for the AI path. Unlike client.test.js — which hands
// runFeature a hand-written fake object — these tests start the mock server and
// drive it through the real Anthropic SDK over real HTTP. That covers request
// serialization, the wire response shape, tool_use parsing and the SDK's error
// classes: the wiring a fake client can't reach.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createMockServer } from './mockServer.cjs';
import { createClient, runFeature } from './client.cjs';

const CATEGORIES = [
  { id: 'dining_out', name: 'Dining Out' },
  { id: 'groceries', name: 'Groceries' },
  { id: 'transportation', name: 'Transportation' },
  { id: 'products', name: 'Products' },
];

let server;
let client;

beforeAll(async () => {
  server = createMockServer({ delayMs: 50 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  process.env.FINANCEFLOW_AI_BASE_URL = `http://127.0.0.1:${port}`;
  client = createClient('sk-ant-mock-key');
});

afterAll(async () => {
  delete process.env.FINANCEFLOW_AI_BASE_URL;
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => server.setScenario('ok'));

describe('AI features against the mock server (real SDK, real HTTP)', () => {
  it('categorize routes a merchant to a real category id', async () => {
    const out = await runFeature(client, 'categorize', { merchant: 'Esso', categories: CATEGORIES });
    expect(out.category).toBe('transportation');
    expect(out.confidence).toBeGreaterThan(0);
  });

  it('parse_entry turns a sentence into a structured transaction', async () => {
    const out = await runFeature(client, 'parse_entry', {
      text: 'spent $40 on gas at Esso yesterday',
      today: '2026-09-22',
      categories: CATEGORIES,
    });
    expect(out).toMatchObject({ merchant: 'Esso', amount: 40, category: 'transportation' });
    expect(out.date).toBe('2026-09-21'); // "yesterday" resolved against today
  });

  it('extract pulls line items out of pasted receipt text', async () => {
    const out = await runFeature(client, 'extract', {
      text: ['METRO 54.12', 'Tim Hortons 6.40', 'TOTAL 60.52'].join('\n'),
      categories: CATEGORIES,
    });
    expect(out.transactions).toHaveLength(2); // the TOTAL line is skipped
    expect(out.transactions[0]).toMatchObject({ merchant: 'METRO', amount: 54.12, category: 'groceries' });
  });

  it('insights returns a narrative grounded in the summary it was given', async () => {
    const out = await runFeature(client, 'insights', {
      summary: { totalExpenses: 3339.5, savingsRate: 47, byCategory: { housing: 1803.51, dining_out: 565.55 } },
    });
    expect(out.narrative).toContain('3339.5');
    expect(out.narrative).toContain('housing');
  });

  it('query answers by calling a local tool, and reports what it consulted', async () => {
    const calls = [];
    const runTool = (name, input) => {
      calls.push({ name, input });
      return { total: 3339.5, transactionCount: 42 };
    };
    const out = await runFeature(
      client,
      'query',
      { question: 'How much did I spend this year?', today: '2026-09-22', categories: CATEGORIES },
      { runTool },
    );
    expect(calls[0].name).toBe('get_spending');
    expect(out.answer).toContain('3339.5');
    expect(out.consulted).toEqual([{ tool: 'get_spending', input: calls[0].input }]);
  });

  it('query never sends the ledger — only the question crosses the wire', async () => {
    server.requests.length = 0;
    await runFeature(
      client,
      'query',
      { question: 'How much at Tim Hortons?', today: '2026-09-22', categories: CATEGORIES },
      { runTool: () => ({ total: 40.74, transactionCount: 7, matchedMerchantCount: 1 }) },
    );
    const firstRequest = JSON.stringify(server.requests[0]);
    expect(firstRequest).toContain('How much at Tim Hortons?'); // the user's own words
    expect(firstRequest).not.toContain('"transactions"');
    expect(firstRequest).not.toContain('totalExpenses'); // no summary blob any more
  });

  it('query degrades to an honest answer when the tools are unavailable', async () => {
    const out = await runFeature(
      client,
      'query',
      { question: 'How much did I spend?', today: '2026-09-22', categories: CATEGORIES },
      {}, // no runTool — e.g. a context where the database isn't reachable
    );
    expect(out.answer).toMatch(/unavailable|could not/i);
    expect(out.consulted).toEqual([]);
  });

  it('sends only the model and payload the app intends', async () => {
    server.requests.length = 0;
    await runFeature(client, 'categorize', { merchant: 'Metro', categories: CATEGORIES });
    await runFeature(client, 'insights', { summary: { totalExpenses: 1 } });
    expect(server.requests[0].model).toBe('claude-sonnet-5');
    expect(server.requests[1].model).toBe('claude-opus-5');
    // The merchant is sent; nothing resembling a ledger is.
    expect(JSON.stringify(server.requests[0])).toContain('Metro');
    expect(JSON.stringify(server.requests[0])).not.toContain('transactions');
  });
});

describe('failure modes surface as errors the app can handle', () => {
  const cases = [
    ['auth_error', 401],
    ['rate_limit', 429],
    ['server_error', 500],
    ['overloaded', 529],
  ];

  it.each(cases)('%s produces an SDK error carrying status %i', async (scenario, status) => {
    server.setScenario(scenario);
    await expect(
      runFeature(client, 'categorize', { merchant: 'Esso', categories: CATEGORIES }),
    ).rejects.toMatchObject({ status });
  });

  it('an empty response resolves to null rather than throwing', async () => {
    server.setScenario('empty');
    await expect(runFeature(client, 'categorize', { merchant: 'Esso', categories: CATEGORIES }))
      .resolves.toBeNull();
  });

  it('a malformed response degrades instead of crashing', async () => {
    server.setScenario('malformed');
    // extract defends itself with a default; categorize reports "no tool call".
    await expect(runFeature(client, 'extract', { text: 'x', categories: CATEGORIES }))
      .resolves.toEqual({ transactions: [] });
    await expect(runFeature(client, 'categorize', { merchant: 'x', categories: CATEGORIES }))
      .resolves.toBeNull();
  });

  it('bad_category returns an id the caller must validate before trusting', async () => {
    server.setScenario('bad_category');
    const out = await runFeature(client, 'categorize', { merchant: 'Esso', categories: CATEGORIES });
    expect(CATEGORIES.map(c => c.id)).not.toContain(out.category);
  });
});
