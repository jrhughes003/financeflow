# Privacy: what the AI features can send

FinanceFlow keeps your ledger on your machine: SQLite in the desktop app, `localStorage`
in the browser. The only thing that talks to a network is the optional AI features, which
exist only in the desktop build. This page says exactly what they send, and where in the
code that is enforced.

## With AI off, nothing is sent

AI is off by default and needs an Anthropic API key that you supply.
- The renderer only offers or triggers an AI feature when the **Settings** toggle is on.
- The main process refuses every AI call when no key is stored.
- Apart from those AI calls, the desktop app makes no network requests. The packaged
  renderer runs under a Content-Security-Policy with `connect-src 'none'`.

## With AI on, a per-feature allow-list decides what leaves

Every outbound request is built in [`electron/ai/payload.cjs`](../electron/ai/payload.cjs)
from an explicit allow-list per feature:
- A field that is not listed is stripped.
- An unknown feature name throws, rather than falling through to an unfiltered object.

The prompts themselves are in [`electron/ai/client.cjs`](../electron/ai/client.cjs).

| Feature | What is sent |
|---|---|
| Categorization | The merchant name you typed, plus the category list. No amounts, no other transactions. It runs when you leave the merchant field, and only if neither the keyword rules nor the local classifier has a confident answer. |
| Natural-language entry | The text you typed, today's date, and the category list. |
| Insights | One aggregate summary of the month. It contains:<br>• totals, per-category sums and budget status;<br>• category-level anomalies and the month-end projection;<br>• a cash-flow outlook;<br>• savings opportunities, each as a type, a category and a dollar amount;<br>• **counts** of flagged items (possible duplicates, periodic bills);<br>• your goals and debts **by name**, with their progress, balances and rates.<br>Never an individual transaction or a merchant name. Built by `buildSummary` in [`src/ai/ai.ts`](../src/ai/ai.ts). |
| Q&A | The first request carries your question, today's date and the category ids. Every figure after that arrives as a **tool result the model asked for**, computed locally (see below). |
| Receipt parsing | The text you paste (unavoidable) and the category list. |

## Q&A: never a raw transaction, only the aggregates the model asks for

The obvious design for Q&A sends a summary of the ledger with every question. That sends
data whether or not the question needs it, and it still can't answer "how much at Tim
Hortons?", because merchant detail isn't in the summary.

Instead, the model gets four **tools**
([`electron/ai/aggregates.cjs`](../electron/ai/aggregates.cjs)) that run against the local
database:
- `get_spending`
- `get_merchant_spending`
- `get_budget_status`
- `get_financial_position`

Each answers with figures computed on this machine, and only those figures go back to the
API.

What a tool result can contain:
- totals, counts and averages, optionally broken down by category or month;
- budget versus actual per category;
- your financial position: total monthly income, each savings goal and debt by name with
  its figures, the investment total, and net worth.

What it never contains:
- a transaction, an id, a note or a tag;
- a merchant name you didn't type yourself. A merchant search reports totals and *how
  many* merchants matched, never which ones.

**One caveat.** An aggregate over a narrow enough filter can describe a single purchase.
For example, a merchant you visited once has a "total" that is that one charge. The tools
never return a transaction record, but they don't stop the model asking a narrow question.

Each Q&A answer lists the lookups it used, so you can check where its figures came from.

## You can see what was actually sent

**Settings → What was sent** shows the most recent AI requests (up to 20) from the current
session, with their verbatim request bodies.
- It records by wrapping the SDK client, not the payload gate
  ([`electron/ai/auditLog.cjs`](../electron/ai/auditLog.cjs)). So it shows what was
  handed to the transport, including the tool results that Q&A sends in later turns.
- It is held in memory only and cleared when the app closes. A file of those requests
  would be the thing this app exists not to keep.
- The API key travels in request headers, which the wrapper never sees, so it cannot
  appear in the log.

## The API key

The key is encrypted with OS-backed storage (DPAPI on Windows) through Electron
`safeStorage`, and stored only as ciphertext.
- If encryption is unavailable, saving a key fails rather than falling back to plaintext.
- The key is decrypted only in the main process at call time.
- The renderer can ask whether a key exists, never what it is.

See [SECURITY.md](../SECURITY.md) for the threat model and the known limitations. For
example, the database is not encrypted at rest.
