import React, { useState } from 'react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import * as chart from './ui/chartTheme';
import { ChevronLeft, ChevronRight, Download, FileText } from 'lucide-react';
import { useFinancial, useGetCategory, useTaxonomy } from '../context/FinancialContext';
import {
  Panel, PanelGrid, Button, IconButton, Money, CategoryMark,
} from './ui';
import {
  getTotalIncome, getTotalExpenses, getSpendingByCategory,
  getBudgetStatus, getSavingsRate, getNetWorth, getBudgetHealthScore,
  getMonthlyTrend, formatCurrency
} from '../utils/calculations';
import { exportToCSV, exportToJSON } from '../utils/exportUtils';
import { withEffectiveAmount } from '../utils/reimbursements';
import { getIncomeSources } from '../utils/accounts';
import { runAi, buildSummary, taxonomy, aiSupported } from '../ai/ai';
import type { AppState } from '../types/state';

/** One local lookup the model made while answering. */
interface ConsultedTool {
  tool: string;
  input?: unknown;
}

// runAi is typed AiResult<unknown> because the bridge cannot know which feature
// was asked for, so each call site names the shape that feature returns.
interface InsightsData { narrative: string }
interface QueryData { answer: string; consulted?: ConsultedTool[] }

// Plain-language names for the local lookups an answer used, so the user can see
// what was consulted on their machine rather than taking the answer on trust.
const TOOL_LABELS: Record<string, string> = {
  get_spending: 'spending totals',
  get_merchant_spending: 'spending at a merchant',
  get_budget_status: 'budget vs actual',
  get_financial_position: 'goals, debts & net worth',
};

const TH = 'font-medium h-[22px] px-2.5 border-b border-line bg-surface-sunk whitespace-nowrap';
const TD = 'h-row px-2.5 border-b border-line';

export default function Reports() {
  const { state } = useFinancial();
  // Named for the budget roll-up it feeds; `taxonomy` above is the AI's
  // category list, which is a different thing with the same word.
  const budgetTaxonomy = useTaxonomy();
  const { transactions, budgets, incomes, savings_goals, investments, debts } = state;
  const getCategory = useGetCategory();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // AI insights & Q&A (desktop + AI enabled only).
  const aiEnabled = aiSupported && state.settings?.aiEnabled;
  const [aiBusy, setAiBusy] = useState(false);
  const [narrative, setNarrative] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [consulted, setConsulted] = useState<ConsultedTool[]>([]);
  const [aiErr, setAiErr] = useState('');

  const generateInsights = async () => {
    setAiBusy(true); setAiErr(''); setNarrative('');
    const res = await runAi('insights', { summary: buildSummary(state, month, year) });
    setAiBusy(false);
    if (res.ok) setNarrative((res.data as InsightsData).narrative);
    else setAiErr(res.error === 'no_key' ? 'Add an API key in Settings first.' : 'Insights unavailable right now.');
  };

  // Only the question is sent; the model calls local tools for any figures.
  const askQuestion = async () => {
    if (!question.trim()) return;
    setAiBusy(true); setAiErr(''); setAnswer(''); setConsulted([]);
    const res = await runAi('query', {
      question: question.trim(),
      today: format(new Date(), 'yyyy-MM-dd'),
      categories: taxonomy(state.customCategories),
    });
    setAiBusy(false);
    if (res.ok) {
      const data = res.data as QueryData;
      setAnswer(data.answer);
      setConsulted(data.consulted || []);
    } else {
      setAiErr(res.error === 'no_key' ? 'Add an API key in Settings first.' : 'Could not answer right now.');
    }
  };

  const incomeSources = getIncomeSources(incomes, investments);
  const income = getTotalIncome(incomeSources);
  const expenses = getTotalExpenses(transactions, month, year);
  const savingsRate = getSavingsRate(incomeSources, transactions, month, year);
  const netWorth = getNetWorth(investments, debts, savings_goals);
  const health = getBudgetHealthScore(budgets, transactions, month, year, budgetTaxonomy);
  const byCategory = getSpendingByCategory(transactions, month, year);
  const budgetStatus = getBudgetStatus(budgets, transactions, month, year, budgetTaxonomy);
  const trend = getMonthlyTrend(transactions, 12);

  // Top 5 categories for this month
  const topCats = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([id, value]) => ({ name: getCategory(id).name, value: Math.round(value), color: getCategory(id).color }));

  // Biggest variance (over budget)
  const biggestVariance = [...budgetStatus]
    .sort((a, b) => a.variance - b.variance) // most over first (lowest variance)
    .slice(0, 5);

  // YTD totals
  const ytdExpenses = Array.from({ length: now.getMonth() + 1 }, (_, m) =>
    getTotalExpenses(transactions, m, now.getFullYear())
  ).reduce((s, v) => s + v, 0);

  // Custom range report
  const customTx = customFrom && customTo
    ? transactions
      .filter(t => t.date >= customFrom && t.date <= customTo && !t.isException && t.kind !== 'savings')
      .map(withEffectiveAmount)
    : [];
  const customTotal = customTx.reduce((s, t) => s + t.amount, 0);
  const customByCategory: Record<string, number> = {};
  customTx.forEach(t => { customByCategory[t.category] = (customByCategory[t.category] || 0) + t.amount; });
  const customTopCats = Object.entries(customByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, value]) => ({ name: getCategory(id).name, value: Math.round(value), color: getCategory(id).color }));

  const changeMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  };

  const handleExportCSV = () => {
    const periodTx = transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === month && d.getFullYear() === year;
    });
    exportToCSV(periodTx, `financeflow_${format(new Date(year, month, 1), 'yyyy-MM')}.csv`);
  };

  const handleExportJSON = () => {
    // The whole state, not a hand-picked literal. This used to list six
    // collections and leave out recurringTemplates, customCategories and
    // settings — and settings is where the entire Plan Ahead configuration
    // lives. Restoring such a file succeeds silently, because the importer
    // fills anything missing with an empty array, so the omission read as a
    // wipe rather than an error.
    exportToJSON(state, 'financeflow_backup.json');
  };

  const monthLabel = format(new Date(year, month, 1), 'MMMM yyyy');

  return (
    <div className="space-y-2 animate-fade-in">
      {/* Period bar + export */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center border border-line-strong bg-surface">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => changeMonth(-1)} className="rounded-none" />
          <span className="px-2.5 h-6 leading-6 border-x border-line-strong text-sm font-medium text-ink uppercase tracking-[0.06em] min-w-[132px] text-center">{monthLabel}</span>
          <IconButton icon={ChevronRight} label="Next month" onClick={() => changeMonth(1)} className="rounded-none" />
        </div>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="secondary" icon={Download} onClick={handleExportCSV}>Export CSV</Button>
          <Button size="sm" variant="secondary" icon={FileText} onClick={handleExportJSON}>Backup JSON</Button>
        </div>
      </div>

      <PanelGrid className="grid-flow-row-dense">
        {/* Monthly summary */}
        <Panel title={`Monthly Report — ${monthLabel}`} className={`col-span-12 ${biggestVariance.length > 0 ? 'xl:col-span-8' : ''}`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border-b border-line">
            <div className="col-span-2 md:col-span-1 bg-surface px-2.5 py-1.5">
              <p className="label-micro">{income - expenses >= 0 ? 'Saved this month' : 'Overspent this month'}</p>
              <Money value={Math.abs(income - expenses)} size="display"
                className={`block mt-1 ${income - expenses >= 0 ? 'text-positive' : 'text-negative'}`} />
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Income</p>
              <Money value={income} size="lg" className="block mt-0.5" />
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Spent</p>
              <Money value={expenses} size="lg" className="block mt-0.5" />
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Savings rate</p>
              <p className="text-xl font-medium text-ink mt-0.5">{savingsRate.toFixed(1)}%</p>
            </div>
          </div>

          {/* Budget health */}
          <div className="flex items-center gap-2.5 h-row px-2.5 border-b border-line">
            <span className="text-sm font-semibold w-5 text-center" style={{ color: health.color }}>{health.grade}</span>
            <span className="text-caption uppercase tracking-[0.03em] text-ink">Budget Health: {health.percent}%</span>
            <span className="ml-auto text-caption text-ink-muted">{budgetStatus.filter(s => s.status === 'good').length} of {budgetStatus.length} categories on track</span>
          </div>

          {/* Top spending chart */}
          {topCats.length > 0 && (
            <div>
              <p className="label-micro px-2.5 h-[22px] leading-[22px] bg-surface-sunk border-b border-line">Top Spending Categories</p>
              <div className="p-3">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topCats} layout="vertical" margin={{ top: 0, right: 20, left: 60, bottom: 0 }}>
                    <CartesianGrid {...chart.grid} horizontal={false} vertical />
                    <XAxis type="number" {...chart.xAxis} tickFormatter={chart.compactMoney} />
                    <YAxis {...chart.yAxis} type="category" dataKey="name" width={60} />
                    <Tooltip {...chart.tooltip} formatter={v => formatCurrency(chart.asNumber(v))} />
                    <Bar dataKey="value" name="Amount" barSize={14}>
                      {topCats.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </Panel>

        {/* Biggest Variance */}
        {biggestVariance.length > 0 && (
          <Panel title="Biggest Budget Variances" meta={`TOP ${biggestVariance.length}`} className="col-span-12 xl:col-span-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="label-micro">
                    <th scope="col" className={`${TH} text-left`}>Category</th>
                    <th scope="col" className={`${TH} text-right`}>Variance</th>
                    <th scope="col" className={`${TH} text-right`}>Used</th>
                  </tr>
                </thead>
                <tbody>
                  {biggestVariance.map(s => {
                    const cat = getCategory(s.category);
                    return (
                      <tr key={s.category} className="hover:bg-surface-hover">
                        <td className={`${TD} text-ink`}><CategoryMark color={cat.color} name={cat.name} /></td>
                        <td className={`${TD} text-right whitespace-nowrap ${s.variance < 0 ? 'text-negative' : 'text-positive'}`}>
                          {s.variance < 0 ? '-' : '+'}{formatCurrency(Math.abs(s.variance))}
                        </td>
                        <td className={`${TD} text-right text-caption text-ink-muted whitespace-nowrap`}>({s.percentUsed.toFixed(0)}% used)</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* AI insights & Q&A */}
        {aiEnabled && (
          <Panel
            title="AI Insights"
            actions={(
              <Button size="sm" variant="primary" onClick={generateInsights} disabled={aiBusy}>
                {aiBusy ? 'Thinking…' : 'Generate summary'}
              </Button>
            )}
            className="col-span-12"
          >
            {narrative && <p className="font-sans text-sm text-ink-secondary whitespace-pre-line px-2.5 py-2 border-b border-line">{narrative}</p>}
            <div className="flex gap-1.5 px-2.5 py-1.5 border-b border-line">
              <input
                type="text"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); askQuestion(); } }}
                placeholder="Ask about this month's spending…"
                className="flex-1 min-w-0 h-7 px-2 bg-canvas border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
              />
              <Button size="md" variant="secondary" onClick={askQuestion} disabled={aiBusy || !question.trim()}>Ask</Button>
            </div>
            {answer && (
              <div className="px-2.5 py-2 border-b border-line">
                <p className="font-sans text-sm text-ink-secondary">{answer}</p>
                {consulted.length > 0 && (
                  <p className="text-caption text-ink-muted mt-1.5">
                    Looked up locally: {consulted.map(c => TOOL_LABELS[c.tool] || c.tool).join(' · ')}
                  </p>
                )}
              </div>
            )}
            {aiErr && <p className="font-sans text-caption text-negative px-2.5 py-1.5 border-b border-line">{aiErr}</p>}
            <p className="font-sans text-micro text-ink-muted px-2.5 py-1.5">Grounded only on aggregate totals for {monthLabel} — your raw transactions are not sent.</p>
          </Panel>
        )}

        {/* YTD Summary */}
        <Panel title={`Year-to-Date (${year})`} className="col-span-12 xl:col-span-6">
          <div className="grid grid-cols-2 gap-px bg-line border-b border-line">
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">YTD Expenses</p>
              <p className="text-xl font-medium text-ink mt-0.5 money">{formatCurrency(ytdExpenses)}</p>
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Net Worth</p>
              <p className={`text-xl font-medium mt-0.5 money ${netWorth >= 0 ? 'text-ink' : 'text-negative'}`}>{formatCurrency(netWorth)}</p>
            </div>
          </div>
          <div className="p-3">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={trend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="label" {...chart.xAxis} />
                <YAxis {...chart.yAxis} tickFormatter={chart.compactMoney} />
                <Tooltip {...chart.tooltip} formatter={v => formatCurrency(chart.asNumber(v))} />
                <Bar dataKey="total" fill={chart.SERIES.primary} name="Monthly Spending" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Custom report */}
        <Panel title="Custom Date Range Report" className="col-span-12 xl:col-span-6">
          <div className="flex flex-wrap items-end gap-2 px-2.5 py-2 border-b border-line">
            <div>
              <label htmlFor="report-from" className="label-micro block mb-1">From</label>
              <input id="report-from" type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-7 px-2 bg-canvas border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label htmlFor="report-to" className="label-micro block mb-1">To</label>
              <input id="report-to" type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-7 px-2 bg-canvas border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
            </div>
            {customFrom && customTo && (
              <Button size="md" variant="secondary" icon={Download} onClick={() => exportToCSV(customTx, `report_${customFrom}_to_${customTo}.csv`)}>Export</Button>
            )}
          </div>
          {customFrom && customTo && (
            <>
              <div className="grid grid-cols-2 gap-px bg-line border-b border-line">
                <div className="bg-surface px-2.5 py-1.5">
                  <p className="label-micro">Total Spending</p>
                  <p className="text-xl font-medium text-ink mt-0.5 money">{formatCurrency(customTotal)}</p>
                </div>
                <div className="bg-surface px-2.5 py-1.5">
                  <p className="label-micro">Transactions</p>
                  <p className="text-xl font-medium text-ink mt-0.5">{customTx.length}</p>
                </div>
              </div>
              {customTopCats.map(({ name, value, color }) => (
                <div key={name} className="flex items-center justify-between gap-2 h-row px-2.5 border-b border-line last:border-b-0">
                  <CategoryMark color={color} name={name} className="text-sm text-ink-secondary" />
                  <span className="text-sm text-ink">{formatCurrency(value)}</span>
                </div>
              ))}
            </>
          )}
        </Panel>
      </PanelGrid>
    </div>
  );
}
