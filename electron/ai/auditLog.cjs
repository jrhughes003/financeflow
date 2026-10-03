// A record of everything that left the machine.
//
// The README claims an allow-list decides exactly what each AI feature may
// send. That is a claim about a code path, and a user has no way to check it —
// so this records the actual HTTP request bodies and the Settings page shows
// them verbatim.
//
// Two decisions make it honest rather than decorative:
//
//   It wraps the SDK, not the payload gate. Recording what buildPayload
//   returned would be recording our own intention; this records what was handed
//   to the transport. Anything a later refactor adds between the two — a system
//   prompt, a tool result, a retry — appears here whether or not anyone
//   remembered to log it. Q&A is the case that matters: its first request
//   carries only the question, and the aggregates come back out in *subsequent*
//   turns as tool results. A payload-level log would show the question and
//   quietly omit the figures.
//
//   It lives in memory and is never written to disk. The log is a transcript of
//   the user's finances by construction, so persisting it would create exactly
//   the file this app exists to avoid. It dies with the process, and says so in
//   the UI.
//
// The API key is in the request *headers*, which are not part of what the SDK
// hands this wrapper, so it cannot end up here.

const MAX_ENTRIES = 20;

/** Newest first. */
const entries = [];

/**
 * Snapshot, because the caller keeps mutating the thing it passed.
 *
 * The Q&A loop builds one `messages` array and pushes each turn onto it, so a
 * record that held the reference would show every earlier request as if it had
 * contained the later turns' tool results. That is worse than not logging:
 * the panel would overstate what left the machine at that moment, and the
 * "the first request carries only the question" claim would be unverifiable
 * precisely where it matters.
 */
function snapshot(value) {
  try {
    return structuredClone(value);
  } catch {
    // A body with something unclonable in it (rare, but a function or a stream
    // would do it). JSON is lossy but honest about what it drops.
    try { return JSON.parse(JSON.stringify(value)); } catch { return { unserialisable: true }; }
  }
}

function record(entry) {
  entries.unshift({ ...entry, request: snapshot(entry.request) });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
}

/**
 * Wrap a client so every outbound request is recorded against a feature.
 *
 * The wrapper is a shallow proxy over `messages.create`; everything else on the
 * client is passed through untouched.
 */
function auditClient(client, feature) {
  const original = client.messages.create.bind(client.messages);

  const create = async (body, ...rest) => {
    const startedAt = Date.now();
    try {
      const response = await original(body, ...rest);
      record({
        feature,
        at: new Date(startedAt).toISOString(),
        ms: Date.now() - startedAt,
        request: body,
        model: response?.model ?? body?.model ?? null,
        usage: response?.usage ?? null,
        outcome: 'ok',
      });
      return response;
    } catch (err) {
      // A failed request still left the machine, so it still belongs here.
      record({
        feature,
        at: new Date(startedAt).toISOString(),
        ms: Date.now() - startedAt,
        request: body,
        model: body?.model ?? null,
        usage: null,
        outcome: 'error',
        error: err?.message || String(err),
      });
      throw err;
    }
  };

  return { ...client, messages: { ...client.messages, create } };
}

function getEntries() {
  return entries.map(e => ({ ...e }));
}

function clear() {
  entries.length = 0;
}

module.exports = { auditClient, getEntries, clear, MAX_ENTRIES };
