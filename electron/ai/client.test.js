// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { runFeature } from './client.cjs';

// A fake Anthropic client whose messages.create returns a canned response and
// records the request, so we can assert on parsing and on what was sent.
function fakeClient(response) {
  const calls = [];
  return {
    calls,
    messages: {
      create: vi.fn(async (req) => { calls.push(req); return response; }),
    },
  };
}

const toolResponse = (name, input) => ({ content: [{ type: 'tool_use', name, input }] });
const textResponse = (text) => ({ content: [{ type: 'text', text }] });

describe('runFeature', () => {
  it('categorize returns the tool input', async () => {
    const client = fakeClient(toolResponse('categorize', { category: 'transportation', confidence: 0.92 }));
    const out = await runFeature(client, 'categorize', { merchant: 'Esso', categories: [{ id: 'transportation', name: 'Transportation' }] });
    expect(out).toEqual({ category: 'transportation', confidence: 0.92 });
    // Sonnet for routine calls.
    expect(client.calls[0].model).toMatch(/sonnet/);
  });

  it('parse_entry returns a structured transaction', async () => {
    const client = fakeClient(toolResponse('create_transaction', { date: '2026-05-28', merchant: 'Esso', amount: 40, category: 'transportation' }));
    const out = await runFeature(client, 'parse_entry', { text: 'spent $40 on gas at Esso yesterday', today: '2026-05-29', categories: [] });
    expect(out).toMatchObject({ merchant: 'Esso', amount: 40, category: 'transportation' });
  });

  it('insights returns narrative text and uses the reasoning model', async () => {
    const client = fakeClient(textResponse('You spent more on dining this month.'));
    const out = await runFeature(client, 'insights', { summary: { total: 100 } });
    expect(out).toEqual({ narrative: 'You spent more on dining this month.' });
    expect(client.calls[0].model).toMatch(/opus/);
  });

  it('query returns an answer plus the local lookups it used', async () => {
    // No tool_use in the response, so the loop finishes on the first turn.
    const client = fakeClient(textResponse('$240 on dining in March.'));
    const out = await runFeature(client, 'query', {
      question: 'How much on dining in March?', today: '2026-03-31', categories: [],
    });
    expect(out).toEqual({ answer: '$240 on dining in March.', consulted: [] });
    // The tools are offered, and the question travels without any figures.
    expect(client.calls[0].tools.map(t => t.name)).toContain('get_spending');
    expect(JSON.stringify(client.calls[0].messages)).not.toContain('summary');
  });

  it('extract returns the transactions array (defaults to empty)', async () => {
    const client = fakeClient(toolResponse('extract_transactions', { transactions: [{ merchant: 'Costco', amount: 84.21, category: 'groceries' }] }));
    const out = await runFeature(client, 'extract', { text: 'COSTCO 84.21', categories: [] });
    expect(out.transactions).toHaveLength(1);

    const empty = fakeClient(textResponse('no tools used'));
    const out2 = await runFeature(empty, 'extract', { text: '', categories: [] });
    expect(out2).toEqual({ transactions: [] });
  });

  it('throws on an unknown feature', async () => {
    await expect(runFeature(fakeClient({}), 'nope', {})).rejects.toThrow(/Unknown AI feature/);
  });
});
