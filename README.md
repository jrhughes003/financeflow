# FinanceFlow — Personal Financial Planner

A comprehensive personal-finance tool built with React. It runs two ways from the
same codebase:

- **Web** (`npm run dev`) — data lives entirely in your browser's `localStorage`.
- **Desktop** (Electron) — data lives in a local **SQLite** database on your
  machine, and optional **AI features** are available using your own Anthropic API key.

Both keep your financial data on your device. See **Privacy** below for exactly
what the optional AI features send off-device.

## Quick Start

```bash
# Requires Node.js (use fnm/nvm if not installed)
npm install
npm run dev          # web app at http://localhost:5173
```

Desktop app and tests: see [DEVELOPMENT.md](./DEVELOPMENT.md) (notably the
`better-sqlite3` rebuild step when switching between running tests and the desktop app).

```bash
npm test             # unit tests (calculations, reducer, DB layer, AI payload/client)
npm run electron:dev # desktop app (SQLite) in development
npm run dist         # package a desktop installer
```

## Features

| Page | What it does |
|------|-------------|
| Dashboard | Budget progress, savings goals, anomaly alerts, net worth, health score |
| Transactions | Full ledger with search/filter, CSV import/export, inline edit/delete, AI receipt paste |
| Budget | Monthly limits per category with flex rules and **real rollover** (prior month's unused/overage carries forward) |
| Comparison | Side-by-side budget vs actual with grouped bar chart, 6-month trend table |
| Analytics | Pie chart, line trends, day-of-week patterns, category deep-dive |
| Goals | Goal cards with progress **derived from savings transactions**, scenario calculator (one-click apply) |
| Income | Income sources, frequency normalization, income vs expense chart |
| Investments | Portfolio allocation, gain/loss tracking, compound growth projection |
| Debts | Payoff calculator, avalanche/snowball strategies; original balance locked after creation |
| Recurring | Detects recurring charges and lets you create templates that post on schedule |
| Reports | Monthly summary, YTD, custom date range, CSV/JSON export, AI insights & Q&A |
| Settings | API key management, AI on/off toggle, JSON backup/restore, reset |

## Savings & recurring

- **Savings goals** update automatically: log a transaction of type *Savings* against
  a goal (in the add-transaction form) and it feeds that goal's progress. Savings
  transfers are excluded from category spending so they don't distort budgets.
- **Recurring** charges are detected from history; confirm them as templates and post
  due items with one click.

## AI features (desktop only, opt-in)

Off by default. Enable in **Settings** by entering an Anthropic API key (stored
encrypted via your OS keychain through Electron `safeStorage` — never bundled or
committed) and turning on the toggle. Four features:

1. **Smart auto-categorization** — keyword matching first; on a miss, the model
   suggests a category. Your manual corrections are remembered locally and applied first.
2. **Natural-language entry** — type "spent $40 on gas at Esso yesterday" and it fills
   the transaction form.
3. **Insights & Q&A** — a narrative monthly summary and grounded answers about your spending.
4. **Receipt / statement parsing** — paste messy text and extract structured transactions.

## Privacy — what is and isn't sent off-device

- **Your data stays local.** localStorage (web) and SQLite (desktop) never leave your machine.
- **No AI = nothing sent.** With AI off (the default), or with no API key, no data is
  ever transmitted. Every AI path falls back to deterministic behavior if AI is off or offline.
- **With AI on, only the minimum per feature is sent to Anthropic** (enforced by an
  explicit allow-list in `electron/ai/payload.cjs`):
  - *Categorization*: the merchant name + the category list. Not amounts or other transactions.
  - *Natural-language entry*: your typed note + today's date + the category list.
  - *Insights & Q&A*: **aggregate totals only** (monthly/category sums, budget status,
    anomalies) — **not** your individual transactions.
  - *Receipt parsing*: the text you paste (unavoidable) + the category list.

## Keyboard Shortcuts
- `Ctrl+N` — Open quick-add transaction modal
- `Escape` — Close modal

## Data & migration
- Web: `localStorage` key `financeflow_data`. Desktop: SQLite at the app's user-data dir.
- On first desktop launch, an existing localStorage blob is migrated automatically;
  otherwise the reliable cross-environment path is **Settings → Export backup** (web)
  then **Settings → Restore backup** (desktop).

## Tech Stack
- React 18 + Vite, Tailwind CSS, Recharts, date-fns, lucide-react
- Electron + better-sqlite3 (desktop persistence)
- @anthropic-ai/sdk (optional AI features)
- Vitest + Testing Library (tests)
