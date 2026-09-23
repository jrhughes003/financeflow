# Changelog

Notable changes. Bug entries say what the bug actually did, because "fixed an
issue" tells you nothing about whether it affected you.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Fixed — data loss

- **A failed startup load could delete the database.** The load wrapped its work
  in `try`/`finally` with no `catch`, so a load that threw still unlocked
  persistence while the in-memory state was the empty placeholder. The next
  keystroke wrote that over the real data: `saveAll` runs `DELETE FROM` across
  every table before re-inserting. The trigger was cheap — `loadAll` parsed
  every row unguarded, so one truncated cell turned a single damaged record into
  total loss. Rows are now parsed individually and skipped if unreadable, and a
  load that fails blocks the UI instead of unlocking writes.
- **Saves could fail silently.** A full disk, a locked database or blocked
  browser storage left you editing a copy that was never written, discovered on
  next launch. Failures now surface as an error.
- **The Reports page's "Backup JSON" wrote an incomplete backup** — it omitted
  recurring templates, custom categories and all settings, which is where the
  Plan Ahead configuration lives. Restoring such a file did not fail: the
  importer fills anything missing with an empty array, so the omission landed as
  a silent wipe.

### Fixed — things that did not work

- **The Recurring page threw on every render.** It used four UI components and a
  helper it never imported.
- **Deleting a tracked investment account did nothing** — and said it had
  worked. The button passed an id where the handler expected the record, so the
  delete dispatched an undefined payload, matched nothing, and still raised a
  confirmation toast.
- **Two charts rendered without their theme.** In three components a local
  variable named `chart` shadowed the `chart` theme module, so the grid and axis
  props spread `undefined` and Recharts fell back to its own defaults.
- **`scripts/verifyPackage.cjs` reported a healthy archive as corrupt.** It had
  never been run. Paths were normalised before extraction, which made every
  nested module look missing — indistinguishable from the corruption it exists
  to detect.
- **The Q&A eval harness could not run at all.** Also never run until now.

### Fixed — wrong numbers

- **Currency was computed three different ways.** `<Money>` hard-coded CAD while
  `formatCurrency` followed the stored setting and `healthScore` was pinned to
  USD. All three now read one source, and the currency setting finally has a UI.
- **The Monte Carlo biased its success rate low** on odd trial counts: it
  reported `pairs × 2` paths when the last antithetic pair runs only one, so the
  phantom path counted as a failure and dragged the Wilson interval with it.
- **A debt with no original balance showed "$NaN paid off."**
- **`buildSummary` ignored the date it was given**, passing a bare `Date` where
  an options object was expected, so it silently used the current date.

### Changed — performance

- **The payoff optimiser no longer runs on the render path.** It searched every
  ordering of your debts inside a `useMemo`, so each $10 step of the
  extra-payment slider froze the window. The module claimed 8 debts took "well
  under a second"; measured, it takes 1.4s on a structured set and up to 3.9s on
  harder ones. Dropping to the cheaper greedy search was measured first, because
  it would have been free — but over 25 randomised 8-debt sets greedy found the
  cheapest order only 5 times and cost up to 22% more interest, so the search
  moved to a worker instead of being given up. Verified in a browser: 40 rapid
  slider steps, longest frame gap 24ms.

### Added

- **A live demo** at <https://jrhughes003.github.io/financeflow/> — the same
  bundle, seeded with generated data, published from CI.
- **TypeScript throughout.** Every source file, with domain types derived from
  what the code actually writes. Four projects, because the renderer, the
  worker, the Electron main process and the eval harness need different libs and
  module resolution.
- **Quality gates in CI**: ESLint, typecheck, working coverage with per-directory
  thresholds, a Windows matrix leg, Dependabot, and a check that the README's
  quoted figures still match the repository.
- **Guards against migration mistakes**: a test asserting every test file still
  matches a vitest glob, and an IPC contract test comparing the channel names in
  the preload, the main process and the typed bridge.
- **Documentation for the Q&A eval**, which scores trust and correctness
  separately and refuses to average them.
- `SECURITY.md`, `CONTRIBUTING.md`, issue and PR templates, and a release
  workflow that builds and verifies the Windows installer from a clean checkout.

### Changed

- React 18 → 19, `@anthropic-ai/sdk` 0.32 → 0.128, `date-fns` 3 → 4, and the
  GitHub Actions to current majors.
- Form controls in Plan Ahead have real labels — 27 of 30 now have an accessible
  name, up from none — and inputs have a visible focus ring.
- CI no longer force-builds `better-sqlite3` from source. `npm ci` installs a
  prebuilt binary matching the job's Node; the forced build is a local fix for
  an Electron-ABI binary and it failed outright on Windows.

### Known limitations

- 37 of 39 components still have no test. Branch and function coverage sit near
  80% because the logic they render is covered thoroughly; statement coverage is
  lower, and that gap is the honest reading of the number.
- The whole state is rewritten on every change. Fine at personal-ledger scale;
  the first thing to change if it grew.
- Schema migrations have a version field and no runner.
- Vite is held at 5. Moving to 8 needs `@vitejs/plugin-react` and vitest to move
  with it, and vitest 5 recomputes coverage on a different basis — a toolchain
  migration, not a dependency bump.

## [1.8.0] and earlier

Before this changelog existed. The commit log is the record, and it is a good
one — see `git log` for the payoff optimiser, the property tests over the money
rules and the three bugs they found, the Monte Carlo's return model and error
bar, the local merchant classifier, and the design-system rebuild.
