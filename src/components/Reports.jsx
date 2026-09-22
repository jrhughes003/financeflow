import React, { useState } from 'react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Download, FileText } from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import {
  getTotalIncome, getTotalExpenses, getSpendingByCategory,
  getBudgetStatus, getSavingsRate, getNetWorth, getBudgetHealthScore,
  getMonthlyTrend, formatCurrency
} from '../utils/calculations';
import { getCategoryById } from '../utils/categorization';
import { useGetCategory } from '../context/FinancialContext';
import { exportToCSV, exportToJSON } from '../utils/exportUtils';
import { withEffectiveAmount } from '../utils/reimbursements';
import { getIncomeSources } from '../utils/accounts';
import { runAi, buildSummary, taxonomy, aiSupported } from '../ai/ai';
import { Sparkles } from 'lucide-react';

// Plain-language names for the local lookups an answer used, so the user can see
// what was consulted on their machine rather than taking the answer on trust.
const TOOL_LABELS = {
  get_spending: 'spending totals',
  get_merchant_spending: 'spending at a merchant',
  get_budget_status: 'budget vs actual',
  get_financial_position: 'goals, debts & net worth',
};

export default function Reports() {
  const { state } = useFinancial();
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
  const [consulted, setConsulted] = useState([]);
  const [aiErr, setAiErr] = useState('');

  const generateInsights = async () => {
    setAiBusy(true); setAiErr(''); setNarrative('');
    const res = await runAi('insights', { summary: buildSummary(state, month, year) });
    setAiBusy(false);
    if (res.ok) setNarrative(res.data.narrative);
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
      setAnswer(res.data.answer);
      setConsulted(res.data.consulted || []);
    } else {
      setAiErr(res.error === 'no_key' ? 'Add an API key in Settings first.' : 'Could not answer right now.');
    }
  };

  const incomeSources = getIncomeSources(incomes, investments);
  const income = getTotalIncome(incomeSources);
  const expenses = getTotalExpenses(transactions, month, year);
  const savingsRate = getSavingsRate(incomeSources, transactions, month, year);
  const netWorth = getNetWorth(investments, debts, savings_goals);
  const health = getBudgetHealthScore(budgets, transactions, month, year);
  const byCategory = getSpendingByCategory(transactions, month, year);
  const budgetStatus = getBudgetStatus(budgets, transactions, month, year);
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
  const customByCategory = {};
  customTx.forEach(t => { customByCategory[t.category] = (customByCategory[t.category] || 0) + t.amount; });
  const customTopCats = Object.entries(customByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, value]) => ({ name: getCategory(id).name, value: Math.round(value), color: getCategory(id).color }));

  const changeMonth = (delta) => {
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
    exportToJSON({ transactions, budgets, incomes, savings_goals, investments, debts }, 'financeflow_backup.json');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Month selector + export */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-lg hover:bg-gray-200 text-gray-600">‹</button>
        <span className="font-semibold text-gray-700 min-w-32 text-center">{format(new Date(year, month, 1), 'MMMM yyyy')}</span>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-lg hover:bg-gray-200 text-gray-600">›</button>
        <div className="ml-auto flex gap-2">
          <button onClick={handleExportCSV} className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button onClick={handleExportJSON} className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
            <FileText className="w-4 h-4" /> Backup JSON
          </button>
        </div>
      </div>

      {/* Monthly summary */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Monthly Report — {format(new Date(year, month, 1), 'MMMM yyyy')}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          {[
            { label: 'Income', value: formatCurrency(income), color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'Expenses', value: formatCurrency(expenses), color: 'text-orange-600', bg: 'bg-orange-50' },
            { label: 'Net Savings', value: formatCurrency(income - expenses), color: income - expenses >= 0 ? 'text-blue-600' : 'text-red-600', bg: 'bg-blue-50' },
            { label: 'Savings Rate', value: `${savingsRate.toFixed(1)}%`, color: 'text-purple-600', bg: 'bg-purple-50' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className={`text-lg font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Budget health */}
        <div className="flex items-center gap-3 mb-5 bg-gray-50 rounded-xl p-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: health.color + '20' }}>
            <span className="text-2xl font-black" style={{ color: health.color }}>{health.grade}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Budget Health: {health.percent}%</p>
            <p className="text-xs text-gray-500">{budgetStatus.filter(s => s.status === 'good').length} of {budgetStatus.length} categories on track</p>
          </div>
        </div>

        {/* Top spending chart */}
        {topCats.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">Top Spending Categories</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topCats} layout="vertical" margin={{ top: 0, right: 20, left: 60, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={60} />
                <Tooltip formatter={v => formatCurrency(v)} />
                <Bar dataKey="value" radius={[0,4,4,0]} name="Amount">
                  {topCats.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* AI insights & Q&A */}
      {aiEnabled && (
        <div className="bg-white rounded-2xl shadow-sm border border-purple-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <h2 className="text-base font-semibold text-gray-900">AI Insights</h2>
            </div>
            <button onClick={generateInsights} disabled={aiBusy} className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
              {aiBusy ? 'Thinking…' : 'Generate summary'}
            </button>
          </div>
          {narrative && <p className="text-sm text-gray-700 whitespace-pre-line bg-purple-50 rounded-xl p-3 mb-3">{narrative}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); askQuestion(); } }}
              placeholder="Ask about this month's spending…"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-purple-500"
            />
            <button onClick={askQuestion} disabled={aiBusy || !question.trim()} className="px-3 py-2 border border-purple-200 text-purple-600 hover:bg-purple-50 disabled:opacity-50 text-sm rounded-lg font-medium">Ask</button>
          </div>
          {answer && (
            <div className="mt-3 bg-gray-50 rounded-xl p-3">
              <p className="text-sm text-gray-700">{answer}</p>
              {consulted.length > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  Looked up locally: {consulted.map(c => TOOL_LABELS[c.tool] || c.tool).join(' · ')}
                </p>
              )}
            </div>
          )}
          {aiErr && <p className="text-xs text-red-500 mt-2">{aiErr}</p>}
          <p className="text-[11px] text-gray-400 mt-3">Grounded only on aggregate totals for {format(new Date(year, month, 1), 'MMMM yyyy')} — your raw transactions are not sent.</p>
        </div>
      )}

      {/* Biggest Variance */}
      {biggestVariance.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Biggest Budget Variances</h2>
          <div className="space-y-2">
            {biggestVariance.map(s => {
              const cat = getCategory(s.category);
              return (
                <div key={s.category} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm text-gray-800">{cat.name}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-semibold ${s.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {s.variance < 0 ? '-' : '+'}{formatCurrency(Math.abs(s.variance))}
                    </span>
                    <span className="text-xs text-gray-400 ml-1">({s.percentUsed.toFixed(0)}% used)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* YTD Summary */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Year-to-Date ({year})</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-orange-50 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-1">YTD Expenses</p>
            <p className="text-lg font-bold text-orange-600">{formatCurrency(ytdExpenses)}</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-1">Net Worth</p>
            <p className={`text-lg font-bold ${netWorth >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{formatCurrency(netWorth)}</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={trend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
            <Tooltip formatter={v => formatCurrency(v)} />
            <Bar dataKey="total" fill="#3b82f6" radius={[4,4,0,0]} name="Monthly Spending" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Custom report */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Custom Date Range Report</h2>
        <div className="flex flex-wrap gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
          {customFrom && customTo && (
            <button onClick={() => exportToCSV(customTx, `report_${customFrom}_to_${customTo}.csv`)} className="flex items-center gap-2 self-end px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          )}
        </div>
        {customFrom && customTo && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-orange-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Total Spending</p>
                <p className="text-lg font-bold text-orange-600">{formatCurrency(customTotal)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Transactions</p>
                <p className="text-lg font-bold text-gray-800">{customTx.length}</p>
              </div>
            </div>
            <div className="space-y-2">
              {customTopCats.map(({ name, value, color }) => (
                <div key={name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-sm text-gray-700">{name}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-800">{formatCurrency(value)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
