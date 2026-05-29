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

> Tip: on Windows, OneDrive sync can lock `better_sqlite3.node` and cause an
> `EPERM: operation not permitted, unlink` error during rebuild. Close any running
> Electron instance (and pause OneDrive if needed), then retry.

## Data & migration

- On first desktop launch the app seeds the sample defaults, or **migrates** an
  existing `financeflow_data` localStorage blob if one is present in that origin.
- The reliable cross-environment path (e.g. browser → desktop) is the JSON backup:
  **Export** a backup from the web app, then **Import** it in the desktop app
  (`exportToJSON` / `importFromJSON` in `src/utils/exportUtils.js`).
