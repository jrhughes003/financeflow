import React, { useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, HandCoins } from 'lucide-react';
import { format } from 'date-fns';
import { useFinancial, useGetCategory } from '../context/FinancialContext';
import {
  getTotalIncome, getTotalExpenses, getBudgetStatus, getSavingsRate,
  getNetWorth, getBudgetHealthScore, detectAnomalies,
} from '../utils/calculations';
import FinancialHealthCard from './FinancialHealthCard';
import { getOwedSummary } from '../utils/reimbursements';
import { getIncomeSources } from '../utils/accounts';
import {
  Card, CardHeader, Button, IconButton, Money, Stat, Badge, Meter, PageLede, CategoryMark,
} from './ui';

// One line per budget: the category, what's left, and a rule showing how far in
// the month has gone. A card per category buried the comparison that matters.
function BudgetLine({ item, getCategory }) {
  const cat = getCategory(item.category);
  const over = item.status === 'danger';
  return (
    <div className="py-2.5 border-b border-line-faint last:border-0">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <CategoryMark color={cat.color} name={cat.name} className="text-sm text-ink" />
        <span className="text-sm shrink-0">
          <Money value={item.actual} size="sm" className={over ? 'text-negative' : 'text-ink'} />
          <span className="text-ink-muted"> / </span>
          <Money value={item.effectiveBudget} size="sm" className="text-ink-muted" />
        </span>
      </div>
      <Meter value={item.actual} max={item.effectiveBudget} />
      <div className="flex justify-between mt-1 text-caption text-ink-muted">
        <span>{item.percentUsed.toFixed(0)}% used</span>
        <span>
          {item.variance >= 0
            ? <><Money value={item.variance} size="caption" className="text-ink-secondary" /> left</>
            : <><Money value={Math.abs(item.variance)} size="caption" className="text-negative" /> over</>}
        </span>
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
  const recent = [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);

  const budgetTotal = budgetStatuses.reduce((s, b) => s + b.effectiveBudget, 0);
  const monthLabel = format(new Date(year, month, 1), 'MMMM yyyy');

  const changeMonth = (delta) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl">
      {/* The question this page answers is "how much have I spent", so that
          figure leads and everything else supports it. */}
      <Card>
        <div className="flex items-center gap-1 mb-5">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => changeMonth(-1)} />
          <span className="text-sm font-medium text-ink-secondary min-w-[130px] text-center">{monthLabel}</span>
          <IconButton icon={ChevronRight} label="Next month" onClick={() => changeMonth(1)} />
        </div>

        <PageLede
          label="Spent this month"
          supporting={(
            <>
              <Stat label="Income"><Money value={totalIncome} /></Stat>
              <Stat label="Savings rate">{savingsRate.toFixed(1)}%</Stat>
              <Stat label="Net worth"><Money value={netWorth} /></Stat>
            </>
          )}
        >
          <Money value={totalExpenses} size="display" />
          {budgetTotal > 0 && (
            <p className="text-caption text-ink-muted mt-2">
              {Math.round((totalExpenses / budgetTotal) * 100)}% of the{' '}
              <Money value={budgetTotal} size="caption" className="text-ink-secondary" /> you budgeted
            </p>
          )}
        </PageLede>
      </Card>

      {owedSummary.outstanding > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-accent-tint border border-accent/15 rounded-container px-4 py-3">
          <HandCoins className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-accent-ink">
            You're owed <Money value={owedSummary.outstanding} size="sm" className="font-medium" /> across{' '}
            {owedSummary.openCount} purchase{owedSummary.openCount > 1 ? 's' : ''} you fronted
            {owedSummary.open[0].ageDays >= 30 && <> — the oldest since {format(new Date(`${owedSummary.oldestOpenDate}T00:00:00`), 'MMM d')}</>}.
          </p>
          {onNavigate && <Button size="sm" variant="secondary" onClick={() => onNavigate('owed')}>Record repayments</Button>}
        </div>
      )}

      <FinancialHealthCard />

      {anomalies.length > 0 && (
        <div className="space-y-2">
          {anomalies.map((a, i) => (
            <div key={i} className="flex items-start gap-3 bg-caution-tint border border-caution/20 rounded-container px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-caution shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-ink">
                <span className="font-medium">{getCategory(a.category).name}</span> — {a.message}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader
            title="Budgets"
            subtitle={`${health.percent}% of categories on track`}
          >
            {onNavigate && <Button size="sm" variant="ghost" onClick={() => onNavigate('budget')}>Manage</Button>}
          </CardHeader>
          {budgetStatuses.length === 0
            ? <p className="text-sm text-ink-muted py-3">No budgets set yet.</p>
            : budgetStatuses.map(item => <BudgetLine key={item.category} item={item} getCategory={getCategory} />)}
        </Card>

        <Card>
          <CardHeader title="Goals">
            {onNavigate && <Button size="sm" variant="ghost" onClick={() => onNavigate('goals')}>Manage</Button>}
          </CardHeader>
          {savings_goals.length === 0
            ? <p className="text-sm text-ink-muted py-3">No goals set yet.</p>
            : savings_goals.map(g => {
                const pct = g.targetAmount > 0 ? Math.min((g.currentAmount / g.targetAmount) * 100, 100) : 0;
                return (
                  <div key={g.id} className="py-2.5 border-b border-line-faint last:border-0">
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      <span className="text-sm text-ink truncate">{g.name}</span>
                      <span className="text-sm shrink-0">
                        <Money value={g.currentAmount} size="sm" />
                        <span className="text-ink-muted"> / </span>
                        <Money value={g.targetAmount} size="sm" className="text-ink-muted" />
                      </span>
                    </div>
                    <Meter value={g.currentAmount} max={g.targetAmount} />
                    <div className="flex justify-between mt-1 text-caption text-ink-muted">
                      <span>{pct.toFixed(0)}% complete</span>
                      <span><Money value={Math.max(0, g.targetAmount - g.currentAmount)} size="caption" /> to go</span>
                    </div>
                  </div>
                );
              })}
        </Card>
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Recent activity">
            {onNavigate && <Button size="sm" variant="ghost" onClick={() => onNavigate('transactions')}>View ledger</Button>}
          </CardHeader>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-ink-muted px-5 pb-5">
            Nothing recorded yet. <button onClick={onQuickAdd} className="text-accent underline underline-offset-2">Add a transaction</button>.
          </p>
        ) : (
          <div className="pb-1">
            {recent.map(t => {
              const cat = getCategory(t.category);
              const isSaving = t.kind === 'savings';
              return (
                <div key={t.id} className="flex items-center gap-4 px-5 h-row border-t border-line-faint">
                  <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: cat.color }} aria-hidden="true" />
                  <span className="flex-1 min-w-0 text-sm text-ink truncate">{t.merchant}</span>
                  <span className="hidden sm:block text-caption text-ink-muted w-32 truncate">{cat.name}</span>
                  <span className="text-caption text-ink-muted w-14 text-right">{format(new Date(`${t.date}T00:00:00`), 'MMM d')}</span>
                  <span className="w-24 text-right">
                    {isSaving
                      ? <Money value={t.amount} size="sm" signed className="text-positive" />
                      : <Money value={-t.amount} size="sm" />}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
