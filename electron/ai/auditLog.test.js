// The audit log backs a claim the README makes, so these tests are about
// whether it would actually catch the claim being false.
//
// The one that matters is the Q&A case. Its first request carries only the
// question; the aggregates leave the machine in *later* turns, as tool results.
// A log that recorded what the payload gate produced would show the question
// and silently omit the figures — which is exactly the shape of a privacy panel
// that reassures without informing. Wrapping the transport instead means the
// later turns are recorded whether or not anyone remembered them.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { auditClient, getEntries, clear, MAX_ENTRIES } from './auditLog.cjs';
import { runFeature } from './client.cjs';

const response = (content, extra = {}) => ({
  content, model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 4 }, ...extra,
});

/** A fake SDK client that answers with whatever is queued. */
function fakeClient(...responses) {
  const queue = [...responses];
  return {
    messages: { create: vi.fn(async () => queue.shift() ?? response([{ type: 'text', text: 'done' }])) },
    somethingElse: 'passed through',
  };
}

beforeEach(() => clear());

describe('recording a request', () => {
  it('keeps the body verbatim, with the model, timing and usage', async () => {
    const client = auditClient(fakeClient(), 'insights');
    await client.messages.create({ model: 'claude-opus-5', messages: [{ role: 'user', content: 'hello' }] });

    const [entry] = getEntries();
    expect(entry.feature).toBe('insights');
    expect(entry.request).toEqual({ model: 'claude-opus-5', messages: [{ role: 'user', content: 'hello' }] });
    expect(entry.model).toBe('claude-sonnet-5'); // what answered, not what was asked for
    expect(entry.usage).toEqual({ input_tokens: 10, output_tokens: 4 });
    expect(entry.outcome).toBe('ok');
    expect(typeof entry.ms).toBe('number');
    expect(Date.parse(entry.at)).not.toBeNaN();
  });

  it('passes the response through untouched, and leaves the rest of the client alone', async () => {
    const original = response([{ type: 'text', text: 'the answer' }]);
    const client = auditClient(fakeClient(original), 'query');
    const result = await client.messages.create({ messages: [] });
    expect(result).toBe(original);
    expect(client.somethingElse).toBe('passed through');
  });

  it('records a failed request too — it still left the machine', async () => {
    const failing = { messages: { create: vi.fn(async () => { throw new Error('rate limited'); }) } };
    const client = auditClient(failing, 'categorize');

    await expect(client.messages.create({ model: 'm', messages: [] })).rejects.toThrow('rate limited');
    const [entry] = getEntries();
    expect(entry.outcome).toBe('error');
    expect(entry.error).toBe('rate limited');
    expect(entry.request).toEqual({ model: 'm', messages: [] });
  });

  it('keeps the newest first and forgets beyond the cap', async () => {
    const client = auditClient(fakeClient(), 'categorize');
    for (let i = 0; i < MAX_ENTRIES + 5; i += 1) {
      await client.messages.create({ marker: i, messages: [] });
    }
    const entries = getEntries();
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[0].request.marker).toBe(MAX_ENTRIES + 4); // newest first
  });

  it('hands out copies, so a caller cannot edit the record', async () => {
    const client = auditClient(fakeClient(), 'insights');
    await client.messages.create({ messages: [] });
    getEntries()[0].feature = 'tampered';
    expect(getEntries()[0].feature).toBe('insights');
  });
});

describe('the Q&A case the panel exists for', () => {
  it('captures the tool results, which leave in a later turn than the question', async () => {
    // Turn 1: the model asks for a figure. Turn 2: it answers.
    const client = auditClient(fakeClient(
      response([{ type: 'tool_use', id: 't1', name: 'get_spending', input: { start: '2026-09-01', end: '2026-09-30' } }], { stop_reason: 'tool_use' }),
      response([{ type: 'text', text: 'You spent $3,339.50.' }]),
    ), 'query');

    await runFeature(
      client,
      'query',
      { question: 'How much did I spend this month?', today: '2026-09-22', categories: [] },
      { runTool: () => ({ total: 3339.5, transactionCount: 42 }) },
    );

    const entries = getEntries();
    expect(entries).toHaveLength(2);

    // The first request carries the question and no figures…
    const first = JSON.stringify(entries[1].request);
    expect(first).toContain('How much did I spend this month?');
    expect(first).not.toContain('3339.5');

    // …and the aggregate leaves on the second. A payload-level log would have
    // stopped at the question and called that the whole story.
    expect(JSON.stringify(entries[0].request)).toContain('3339.5');
  });
});
