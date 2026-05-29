# Planning Prompt — FinanceFlow Optimization

> Paste everything below the line into a fresh Claude Code session opened at
> `C:\Users\jrhug\OneDrive\Documents\GitHub\Personal-Projects\financial_tracker_app`.
> Its job is to **produce a phased implementation plan** (enter plan mode), not to start coding.

---

You are picking up an existing personal-finance React app, **FinanceFlow**, and producing a detailed, phased implementation plan to optimize it. Do **not** write production code yet — investigate, then enter plan mode and present a plan for my approval. Ask clarifying questions only if you hit a genuine blocker; the key decisions are already made (see "Decisions locked").

## What the app is today
- **Stack:** React 18 + Vite, Tailwind CSS, Recharts, date-fns, lucide-react. No TypeScript, no tests, no backend.
- **Location:** `C:\Users\jrhug\OneDrive\Documents\GitHub\Personal-Projects\financial_tracker_app` (Windows, PowerShell).
- **Persistence:** All state lives in **`localStorage`** under key `financeflow_data`, written on every state change. No database.
- **State:** A single `useReducer` store in `src/context/FinancialContext.jsx` holding `transactions, budgets, incomes, savings_goals, investments, debts, recurringTemplates, customCategories, settings`. CRUD actions per entity plus `IMPORT_TRANSACTIONS`, `LOAD_DATA`, `RESET_DATA`, `UPDATE_SETTINGS`.
- **~3,600 lines** total across ~22 source files. Pages: Dashboard, Transactions, Budget, Comparison, Analytics, Goals, Income, Investments, Debts, Reports (routed by `src/App.jsx`).
- **Business logic** is centralized in `src/utils/calculations.js` (218 lines, generally sound), `src/utils/categorization.js` (keyword auto-categorizer), `src/utils/exportUtils.js` (robust CSV/JSON import-export).

## Goals (in priority order)
1. **Fix the planning/financial logic that doesn't make sense** (specifics below).
2. **Add a real database** to replace localStorage.
3. **Integrate an LLM** to make tracking easier.

## Decisions locked (do not re-litigate; plan around these)
- **Database:** Embedded **SQLite**, via wrapping the app as a **desktop app (Electron or Tauri)**. Must stay fully local — no cloud DB. In the plan, recommend Electron + `better-sqlite3` **vs** Tauri + SQLite plugin, weigh against the existing all-JS/React codebase (lean toward the lower-friction option and justify it), and define the migration path from the current localStorage blob to relational tables. Include a one-time **localStorage → SQLite migration** step so existing user data survives.
- **LLM provider:** **Anthropic API using the user's own API key** (`claude-sonnet-4-6` for routine calls, consider `claude-opus-4-8` for heavier reasoning). The key must be stored securely in the desktop app (e.g., OS keychain / Electron safeStorage / Tauri secure store), **never** bundled or committed.
- **LLM features (all four in scope, phase them):**
  1. **Smart auto-categorization** — augment/replace the keyword matcher in `categorization.js`; learn from user corrections.
  2. **Natural-language entry & queries** — "spent $40 on gas at Esso yesterday" → structured transaction; "how much on dining in March?" → answer grounded in DB.
  3. **Spending insights & advice** — narrative monthly summary, anomaly explanations, budget/savings recommendations grounded in real data.
  4. **Receipt/bank-statement parsing** — extract structured transactions from messy text (and consider images), beyond the current CSV parser.

## Privacy constraint to honor in the plan
The original README promises "privacy-first, nothing sent to a server." Local SQLite preserves this, **but** the Anthropic API necessarily sends transaction text off-device. The plan must:
- Add a global **"AI features" on/off toggle** in settings (off by default until a key is entered).
- **Minimize data sent** (send only the fields a given feature needs; prefer aggregates over raw ledgers where possible).
- **Update the README** to accurately describe what is and isn't sent off-device.

## Known planning-logic defects to fix (verify each against current code, then fix in the plan)
1. **Budget rollover is dead code.** `rollover` is stored on budgets and returned by `getBudgetStatus` (`calculations.js:82`) but **never applied** anywhere. Either implement real rollover (carry unused/over budget into the next month) or remove it from the UI. The checkbox exists in `BudgetManager.jsx` (~line 253).
2. **Savings goals never auto-sync.** `GoalsManager.jsx` + `projectGoalCompletion` rely on manually edited `currentAmount`/`monthlyContribution`; nothing derives contributions from transactions. Decide on a contribution mechanism (e.g., a "savings" transaction type or tag that feeds `currentAmount`) and make progress real.
3. **Scenario calculator is read-only** (`GoalsManager.jsx` ~126) — computes "what if I save $X/mo" but never persists or acts on it. Decide whether to wire it into the goal.
4. **`recurringTemplates` is unused** — the field exists in state but no feature reads/writes it. Either build recurring-transaction detection/templates or drop it.
5. **`BudgetManager` smart suggestions** propose budgets for **every** category including never-used ones (~line 92) — filter to categories with nonzero 3-month average.
6. **Debt `originalBalance` is editable**, which makes the "% paid off" bar (`DebtTracker.jsx:112`) jump when edited — protect or rethink this field.
7. **`BudgetComparison`** recomputes `getBudgetStatus` 3× per budget for the "consistently over" check (~line 52) — batch via trend data.
8. **Hardcoded magic numbers** scattered through `calculations.js` (anomaly threshold `avg > 10 && current > avg*2` at line 150; page size 25; flex defaults 10/5) — extract to constants and/or settings.
9. **"Now" vs sample data mismatch** — Dashboard/Reports use `new Date()` (current month) while sample budgets are zeroed and there are no sample transactions; confirm the empty-state and current-month behavior are coherent after the DB migration.

## What I want the plan to contain
- A **phased roadmap** (e.g., Phase 0 hardening/tests → Phase 1 desktop+SQLite migration → Phase 2 logic fixes → Phase 3 LLM features), with each phase independently shippable and ordered by risk/dependency.
- The **Electron-vs-Tauri recommendation** with rationale, and the concrete **data model** (proposed SQLite schema / tables and how current entities map to them).
- An **LLM integration design**: where the API client lives, how the key is stored, the prompt/tool-use shape for each of the four features, how grounding/data-minimization works, error/offline handling, and rough cost considerations.
- The **list of files** each phase touches, and any **new dependencies**.
- A **testing strategy** — at minimum unit tests for `calculations.js` and the new DB layer (the project currently has none).
- Call out **risks, open questions, and any assumptions** you had to make.

Investigate the codebase to confirm the above (line numbers may have shifted), then enter plan mode and present the plan. Do not begin implementation until I approve.
