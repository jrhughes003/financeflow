# FinanceFlow — Personal Financial Planner

A comprehensive, privacy-first personal finance tool built with React. All data lives in your browser's localStorage — nothing is ever sent to a server.

## Quick Start

```bash
# Requires Node.js (use fnm/nvm if not installed)
npm install
npm run dev
# Open http://localhost:5173
```

## Features

| Page | What it does |
|------|-------------|
| Dashboard | Budget progress, savings goals, anomaly alerts, net worth, health score |
| Transactions | Full ledger with search/filter, CSV import/export, inline edit/delete |
| Budget | Set monthly limits per category with flex rules and rollover |
| Comparison | Side-by-side budget vs actual with grouped bar chart, 6-month trend table |
| Analytics | Pie chart, line trends, day-of-week patterns, category deep-dive |
| Goals | Savings goal cards with progress bars, scenario calculator |
| Income | Income sources, frequency normalization, income vs expense chart |
| Investments | Portfolio allocation, gain/loss tracking, compound growth projection |
| Debts | Payoff calculator, avalanche/snowball strategies, extra payment impact |
| Reports | Monthly summary, YTD, custom date range, CSV/JSON export |

## Keyboard Shortcuts
- `Ctrl+N` — Open quick-add transaction modal
- `Escape` — Close modal

## Data
- Stored in `localStorage` under key `financeflow_data`
- Ships with 3 months of realistic sample data (Jan–Mar 2026)
- Export full backup as JSON via Reports → Backup JSON
- Import bank CSV files via Transactions → Import CSV

## Tech Stack
- React 18 + Vite
- Recharts (charts)
- Tailwind CSS (styling)
- date-fns (date handling)
- lucide-react (icons)
