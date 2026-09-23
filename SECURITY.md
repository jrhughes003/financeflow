# Security

## Reporting

Open a [security advisory](https://github.com/jrhughes003/financeflow/security/advisories/new),
or email jrhughes003@gmail.com. Please don't open a public issue for something
exploitable.

This is a personal project, not a service — there is no deployment to patch and
no user data held anywhere I control. So there's no SLA. I'll acknowledge when I
see it.

## What this app is, from a security point of view

FinanceFlow holds a complete picture of someone's finances and never sends it
anywhere. That shapes what is and isn't a risk here.

**There is no server.** No account, no sync, no telemetry, no analytics, no
crash reporting. The desktop build keeps a SQLite file under the OS user data
directory; the browser build uses `localStorage`. Neither leaves the machine.

**The live demo** at <https://jrhughes003.github.io/financeflow/> is the same
bundle built with `VITE_DEMO_MODE=true`. It seeds generated data and stores it
in the visitor's own browser. It is static hosting — nothing is uploaded, and
there is no backend to attack.

## The AI features, which are the only thing that talks to a network

They are off by default and do nothing without an API key that the user
supplies. When they are on:

**Every network call is made by the Electron main process**, never the
renderer. The packaged app's Content-Security-Policy sets `connect-src 'none'`,
which is accurate rather than aspirational: the renderer genuinely has no reason
to reach the network, so it is not allowed to.

**What may be sent is an allow-list in code**, not a policy in a document —
[`electron/ai/payload.cjs`](electron/ai/payload.cjs). Each feature names the
fields it may include, anything else is stripped, and an unrecognised feature
name throws rather than falling through to sending an unfiltered object. The
per-feature table is in the [README](README.md#privacy).

**Q&A sends the question and nothing else.** Figures reach the model only when
it calls a tool that computes an aggregate locally against the database
([`electron/ai/aggregates.cjs`](electron/ai/aggregates.cjs)). Those tools return
sums and counts — never a transaction, an id, a note, a tag, or a merchant name
the user didn't ask about. A merchant search returns how *many* matched, not
which.

**The API key** is encrypted through the OS keychain (DPAPI on Windows, Keychain
on macOS) via Electron's `safeStorage`, and stored as ciphertext. If the
platform reports encryption is unavailable, saving a key fails loudly rather
than falling back to plaintext. The key exists in the clear only in main-process
memory at call time; the renderer can ask whether a key exists, never what it
is.

## Desktop hardening

`contextIsolation` on, `nodeIntegration` off, `sandbox` on. The preload exposes
exactly eight IPC methods and never hands over `ipcRenderer` itself. Window
opening is denied outright and real web links go to the system browser;
navigation is blocked except to the dev server and `file:`. A packaged build
sends a Content-Security-Policy header, and the built HTML carries the same
policy as a `<meta>` backstop.

## Known limitations, stated rather than implied

- **The database is not encrypted at rest.** Anyone with your OS account, or
  your unlocked disk, can read it. The app protects your data in transit — by
  not transmitting it — not against someone who already has your machine.
- **A backup export is plaintext JSON.** That is the point of it, but treat the
  file as you would the ledger itself.
- **The AI features send data to Anthropic when enabled.** Minimised and
  allow-listed, but not zero. Leaving them off is the only way to send nothing.
- `npm audit` runs clean on production dependencies at the time of writing, and
  Dependabot watches weekly. Development dependencies may lag.

## Scope

Reports about the app, its build, or its dependencies are in scope. Reports
that amount to "someone with full access to the machine can read the database"
are the documented design, not a vulnerability.
