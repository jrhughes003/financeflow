# Development guide

FinanceFlow runs in two modes from one codebase:

- **Web** (`npm run dev`) — fast iteration in the browser; data persists to `localStorage`.
- **Desktop** (Electron) — data persists to a local **SQLite** database in the app's
  user-data directory. The renderer is the same Vite/React app; it talks to the
  database in the Electron main process over a small IPC bridge (`window.api.db.*`,
  see `electron/preload.cjs`). When `window.api` is absent (browser), the app
  automatically falls back to `localStorage` (`src/storage/storage.js`).

## Commands

| Command                | What it does                                                               |
| ---------------------- | -------------------------------------------------------------------------- |
| `npm run dev`          | Vite dev server (browser, localStorage).                                   |
| `npm test`             | Vitest unit tests (calculations, reducer, DB layer).                       |
| `npm run build`        | Production web build into `dist/` (relative asset paths for Electron).     |
| `npm run electron:dev` | Vite + Electron together (desktop dev, SQLite).                            |
| `npm run electron`     | Electron against an already-running dev server / built `dist/`.            |
| `npm run dist`         | Build the web bundle and package a desktop installer via electron-builder. |
| `npm run ai:mock`      | Local stand-in for the Anthropic API (see below).                          |
| `npm run electron:dev:mock` | Desktop dev wired to the mock — AI features with no key and no spend. |

## Testing the AI features without an API key

`electron/ai/mockServer.cjs` implements enough of `POST /v1/messages` to serve
this app, and `createClient` honours `FINANCEFLOW_AI_BASE_URL`, so the real
Anthropic SDK talks to it over real HTTP. Request serialization, `tool_use`
parsing and the SDK's typed errors are all exercised — only the model is fake.

```bash
npm run electron:dev:mock
```

Then in **Settings**, paste any non-empty string as the API key (it is encrypted
and stored exactly as a real one, but never leaves your machine) and turn AI on.
Replies are derived from the request — the merchant you actually typed, the
amounts actually in the text you pasted — so results look plausible.

**Failure modes are the more valuable half.** Every scenario below makes all
subsequent calls fail a specific way, so you can confirm the UI degrades
gracefully rather than hanging or crashing:

```bash
MOCK_SCENARIO=rate_limit npm run ai:mock            # start in a scenario
curl -X POST 127.0.0.1:8787/__scenario -d auth_error  # or switch at runtime
curl 127.0.0.1:8787/__scenario                        # read the current one
```

`ok`, `auth_error` (401), `rate_limit` (429), `server_error` (500),
`overloaded` (529), `malformed` (unparseable content), `empty` (no content
blocks), `bad_category` (a category id that doesn't exist), `slow` (delayed).

`electron/ai/mockServer.test.js` runs the whole feature set plus every failure
mode against it in CI-friendly fashion; no network and no key required.

## ⚠️ Native module ABI: `better-sqlite3`

`better-sqlite3` is a **compiled** native module with a versioned ABI. Node and
Electron embed different ABIs, and **one installed binary can only match one of
them at a time**. There are no prebuilt binaries for the Node version in use here,
so it is compiled from source on install.

- **To run the unit tests** (`npm test`) the binary must be built for **Node**:
  ```
  npm rebuild better-sqlite3 --build-from-source
  ```
- **To run the desktop app in dev** (`npm run electron:dev`) it must be built for
  **Electron**:
  ```
  npx electron-builder install-app-deps
  ```
  (Switching back to tests requires the `npm rebuild` above again.)
- **`npm run dist`** rebuilds for Electron automatically as part of packaging — no
  manual step needed for producing installers.

If you see `Error: ... NODE_MODULE_VERSION 1xx ... requires NODE_MODULE_VERSION 1yy`,
you're running with the binary built for the other runtime — rebuild as above.

> Tip: on Windows, a rebuild can fail with `EPERM: operation not permitted, unlink`
> when something still holds `better_sqlite3.node` open. Close any running Electron
> instance and retry. A file-syncing client (OneDrive, Dropbox) scanning the working
> copy can hold the same lock, so keep the repo outside a synced folder.

## Data & migration

- On first desktop launch the app seeds the sample defaults, or **migrates** an
  existing `financeflow_data` localStorage blob if one is present in that origin.
- The reliable cross-environment path (e.g. browser → desktop) is the JSON backup:
  **Export** a backup from the web app, then **Import** it in the desktop app
  (`exportToJSON` / `importFromJSON` in `src/utils/exportUtils.js`).
