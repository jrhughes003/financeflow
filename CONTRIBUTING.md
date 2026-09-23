# Contributing

This is a personal project I built for my own finances, published because the
engineering in it is worth showing. I'm not looking for feature contributions,
but bug reports are genuinely welcome — especially anything that loses data or
prints a wrong number.

## Getting it running

```bash
npm install
npm run dev            # browser, localhost:5173
npm run electron:dev   # the desktop app
```

`npm run electron:dev` needs the native module built for Electron's ABI:

```bash
npx electron-builder install-app-deps
```

and `npm test` needs it built for Node's instead:

```bash
npm rebuild better-sqlite3
```

The two are mutually exclusive — one installed binary matches one runtime. If
the database tests fail with `NODE_MODULE_VERSION`, that's which one you have.
[DEVELOPMENT.md](DEVELOPMENT.md) covers it properly, along with running the AI
features against a local mock with no API key and no spend.

## Before you open a PR

```bash
npm run typecheck   # tsc -b across four projects
npm run lint        # eslint, flat config
npm test            # vitest
npm run build       # the bundle CI also checks the worker chunk in
npm run stats       # rewrites the README's figures; CI fails if they drift
```

CI runs all of that on Ubuntu and Windows.

## What the code expects of you

**Don't weaken a type to make something compile.** The domain types in
`src/types/` describe what is actually on disk, including records written by
older versions. If a fixture doesn't fit, use `src/test/factories.ts`; if a
value is genuinely nullable, handle the null.

**Derive shapes, don't restate them.** `ReturnType<typeof getBudgetSuggestions>`
rather than a hand-written interface that will drift.

**Data is guilty until proven innocent.** Anything arriving from SQLite, from
`localStorage`, or from a file the user chose is `unknown` until it has been
through `asAppState`. There is a reason for the rigidity: an earlier version
treated a failed load as "no data yet" and wrote an empty ledger over a database
that was merely unreadable.

**Money is rounded in one place and property-tested.** If you touch a total,
`src/utils/invariants.test.ts` is the file that will tell you whether you broke
it. It has caught three real rounding bugs.

**Tests should fail loudly.** Assert a null away with an explicit throw rather
than `!`, so a regression reports itself instead of hiding.

## Commit messages

Imperative subject, no prefix, no trailing period. The body explains *why* and
what it cost — the log is written to be read. `git log` shows the register; the
bar is that someone can understand the decision a year later without the diff.
