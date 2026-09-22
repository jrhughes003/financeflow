import React, { useState } from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, DollarSign, PiggyBank, CreditCard, Activity } from 'lucide-react';
import { format } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import {
  getTotalIncome, getTotalExpenses, getBudgetStatus, getSavingsRate,
  getNetWorth, getBudgetHealthScore, detectAnomalies, formatCurrency
} from '../utils/calculations';
import { getAllCategories } from '../utils/categorization';
import { useGetCategory } from '../context/FinancialContext';
import FinancialHealthCard from './FinancialHealthCard';
import { getOwedSummary } from '../utils/reimbursements';
import { getIncomeSources } from '../utils/accounts';
import { HandCoins } from 'lucide-react';

function SummaryCard({ title, value, subtitle, icon: Icon, color, trend }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {trend !== undefined && (
          <span className={`text-sm font-medium flex items-center gap-1 ${trend >= 0 ? 'text-red-500' : 'text-green-500'}`}>
            {trend >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{title}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}

function BudgetProgressBar({ item, getCategory }) {
  const cat = getCategory(item.category);
  const pct = Math.min(item.percentUsed, 120);
  const barColor = item.status === 'danger' ? '#ef4444' : item.status === 'warning' ? '#f59e0b' : '#22c55e';
  return (
    <div className="py-3 border-b border-gray-50 last:border-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">{cat.name}</span>
          {item.status === 'danger' && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">Over</span>}
          {item.status === 'warning' && <span className="text-xs bg-yellow-100 text-yellow-600 px-1.5 py-0.5 rounded-full font-medium">Near</span>}
        </div>
        <span className={`text-sm font-semibold ${item.status === 'danger' ? 'text-red-600' : item.status === 'warning' ? 'text-yellow-600' : 'text-gray-700'}`}>
          {formatCurrency(item.actual)} <span className="text-gray-400 font-normal">/ {formatCurrency(item.budget)}</span>
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-gray-400">{item.percentUsed.toFixed(0)}% used</span>
        <span className="text-xs text-gray-400">{item.variance >= 0 ? formatCurrency(item.variance) + ' left' : formatCurrency(Math.abs(item.variance)) + ' over'}</span>
      </div>
    </div>
  );
}

function HealthGrade({ grade, percent, color }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: color + '20' }}>
        <span className="text-3xl font-black" style={{ color }}>{grade}</span>
      </div>
      <div>
        <p className="text-sm text-gray-500">Budget Health Score</p>
        <p className="text-xl font-bold text-gray-900">{percent}% categories on track</p>
        <p className="text-xs text-gray-400 mt-0.5">Based on this month's spending</p>
      </div>
    </div>
  );
}

export default function Dashboard({ onQuickAdd, onNavigate }) {
  const { state } = useFinancial();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const getCategory = useGetCategory();
  const { transactions, budgets, incomes, savings_goals, investments, debts } = state;

  const incomeSources = getIncomeSources(incomes, investments);
  const totalIncome = getTotalIncome(incomeSources);
  const totalExpenses = getTotalExpenses(transactions, month, year);
  const savingsRate = getSavingsRate(incomeSources, transactions, month, year);
  const netWorth = getNetWorth(investments, debts, savings_goals);
  const budgetStatuses = getBudgetStatus(budgets, transactions, month, year).filter(b => b.budget > 0);
  const health = getBudgetHealthScore(budgets, transactions, month, year);
  const anomalies = detectAnomalies(transactions, month, year);
  const owedSummary = getOwedSummary(transactions);
  const recent = [...transactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  const monthLabel = format(new Date(year, month, 1), 'MMMM yyyy');

  // Month navigation
  const changeMonth = (delta) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-lg hover:bg-gray-200 text-gray-600 transition-colors">‹</button>
        <span className="text-base font-semibold text-gray-700 min-w-32 text-center">{monthLabel}</span>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-lg hover:bg-gray-200 text-gray-600 transition-colors">›</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard title="Monthly Income"   value={formatCurrency(totalIncome)}   subtitle="All sources combined"    icon={DollarSign} color="bg-blue-500" />
        <SummaryCard title="Monthly Spending" value={formatCurrency(totalExpenses)} subtitle={monthLabel}             icon={CreditCard}  color="bg-orange-500" />
        <SummaryCard title="Savings Rate"     value={`${savingsRate.toFixed(1)}%`}  subtitle="Income minus expenses"  icon={PiggyBank}   color="bg-green-500" />
        <SummaryCard title="Net Worth"        value={formatCurrency(netWorth)}      subtitle="Assets minus liabilities" icon={TrendingUp} color="bg-purple-500" />
      </div>

      {/* Reminder: money others still owe for purchases the user fronted */}
      {owedSummary.outstanding > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <HandCoins className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="flex-1 text-sm text-emerald-900">
            You're owed <span className="font-semibold">{formatCurrency(owedSummary.outstanding)}</span> for {owedSummary.openCount} purchase{owedSummary.openCount > 1 ? 's' : ''} you fronted
            {owedSummary.open[0].ageDays >= 30 && <> — the oldest is from {format(new Date(owedSummary.oldestOpenDate + 'T00:00:00'), 'MMM d')}</>}.
          </p>
          {onNavigate && (
            <button onClick={() => onNavigate('owed')} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg">Record repayments</button>
          )}
        </div>
      )}

      <FinancialHealthCard />

      {/* Budget health grade */}
      <HealthGrade {...health} />

      {/* Anomaly Alerts */}
      {anomalies.length > 0 && (
        <div className="space-y-2">
          {anomalies.map((a, i) => (
            <div key={i} className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-yellow-800">{getCategory(a.category).name} Spending Alert</p>
                <p className="text-sm text-yellow-700">{a.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Budget Progress */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Budget Progress</h2>
          {budgetStatuses.length === 0
            ? <p className="text-sm text-gray-400 text-center py-4">No budgets set yet.</p>
            : budgetStatuses.map(item => <BudgetProgressBar key={item.category} item={item} getCategory={getCategory} />)
          }
        </div>

        {/* Savings Goals */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Savings Goals</h2>
          {savings_goals.length === 0
            ? <p className="text-sm text-gray-400 text-center py-4">No goals set yet.</p>
            : savings_goals.map(g => {
                const pct = Math.min((g.currentAmount / g.targetAmount) * 100, 100);
                const remaining = g.targetAmount - g.currentAmount;
                return (
                  <div key={g.id} className="py-3 border-b border-gray-50 last:border-0">
                    <div className="flex justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-800">{g.name}</span>
                      <span className="text-sm text-gray-600">{formatCurrency(g.currentAmount)} / {formatCurrency(g.targetAmount)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: g.color || '#3b82f6' }} />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-xs text-gray-400">{pct.toFixed(0)}% complete</span>
                      <span className="text-xs text-gray-400">{formatCurrency(remaining)} to go</span>
                    </div>
                  </div>
                );
              })
          }
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Recent Transactions</h2>
        {recent.length === 0
          ? <p className="text-sm text-gray-400 text-center py-4">No transactions yet.</p>
          : recent.map(t => {
              const cat = getCategory(t.category);
              return (
                <div key={t.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: cat.color + '20' }}>
                    <span className="text-xs" style={{ color: cat.color }}>●</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{t.merchant}</p>
                    <p className="text-xs text-gray-400">{cat.name} · {format(new Date(t.date), 'MMM d')}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-800">-{formatCurrency(t.amount)}</span>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}
