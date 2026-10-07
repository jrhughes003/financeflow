# Features

| Page | What it does |
|------|-------------|
| **Dashboard** | Budget progress, savings goals, anomaly alerts, net worth, financial health score |
| **Transactions** | Full ledger with search/filter, CSV import/export, inline edit, AI receipt paste |
| **Owed to Me** | Purchases fronted for other people: split evenly or by amount, track partial repayments, forgive the remainder |
| **Budget** | Monthly limits per category, flex thresholds, and real rollover (prior month's unused or overage carries forward) |
| **Comparison** | Budget vs actual side by side, grouped bar chart, 6-month trend table |
| **Analytics** | What changed, cash-flow forecast, savings opportunities, duplicate charges, irregular/seasonal bills, budget tune-up, goal check, spending habits, tags |
| **Goals** | Progress derived from actual savings transactions, scenario calculator, pace vs. required contribution |
| **Income** | Multiple sources, frequency normalization, income vs expense chart |
| **Investments** | Allocation, gain/loss, compound projection, and tracked "advisor" accounts that grow from a statement balance with logged deposits/withdrawals |
| **Debts** | Payoff calculator, avalanche vs snowball comparison, interest-free and deferred loans (accrue nothing / pay nothing until repayment starts) |
| **Recurring** | Detects recurring charges from history, then posts them on schedule from confirmed templates |
| **Plan Ahead** | Long-range monthly projection to retirement: house purchase (CMHC, land transfer tax, FHSA/HBP), car financing, one-off and recurring life events, Canadian tax, saved scenarios, and a Monte Carlo success rate |
| **Reports** | Monthly, YTD and custom-range summaries, CSV/JSON export, AI insights and Q&A |
| **Settings** | API key management, AI toggle, "What was sent" log, demo data, JSON backup/restore |

## Screenshots

**Plan Ahead.** A month-by-month projection from today's balances to age 95. It includes
salary growth and RRSP contributions, a car in 2027, a wedding in 2028 and a first home in
2029. Ontario and federal tax are applied each year, and CPP/OAS start at the chosen ages.
![Plan Ahead projection: net worth over time split into savings, home equity and debt, with a retirement marker](screenshots/plan-projection.png)

**Monte Carlo.** The same plan, run a few hundred times with a random return each year
instead of the same return every year, to see how often it holds up.
![Monte Carlo: 67% of 300 runs hold up, with a median outcome and a middle-80% band to 2094](screenshots/plan-montecarlo.png)

**Analytics.** What changed this month, measured against your own baseline rather than a
fixed budget.
![Analytics: waterfall of category changes vs the 3-month average](screenshots/analytics.png)

**Budget, with real rollover.** Unused room carries forward (`+$160.88 rolled over`), and
an overage carries as a deduction (`-$135.63 carried`). The percentages track the
*effective* limit.
![Budget page with per-category progress, flex thresholds and rollover](screenshots/budget.png)

**Owed to Me.** A dinner split four ways, with two repayments logged. The full amount
counts as your spending until it comes back, and each repayment lowers that purchase's
month.
![Owed to Me: partly repaid split expense with payment chips](screenshots/owed-to-me.png)

**Debts.** An interest-free OSAP loan still in deferment: nothing is due until repayment
starts, and no interest accrues meanwhile.
![Debts page showing a deferred interest-free loan and payoff projections](screenshots/debts.png)

**Plan setup**
![Plan Ahead setup: birth year, retirement age, CPP/OAS start, TFSA/RRSP room and FHSA contributions](screenshots/plan-setup.png)

**Transactions**
![Transaction ledger with search, filters, CSV import/export and tags](screenshots/transactions.png)

**Goals**
![Goals with progress derived from savings transactions and pace vs required contribution](screenshots/goals.png)

**Budget vs actual**
![Budget vs actual comparison table with a 6-month trend by category](screenshots/comparison.png)
