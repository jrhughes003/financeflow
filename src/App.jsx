import React, { useState, useEffect, useMemo } from 'react';
import { FinancialProvider, useFinancial } from './context/FinancialContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { isTemplateDue } from './utils/recurring';
import { getOwedSummary } from './utils/reimbursements';
import { formatCurrency } from './utils/calculations';
import Layout from './components/Layout';
import CommandPalette from './components/CommandPalette';
import Dashboard from './components/Dashboard';
import TransactionEntry from './components/TransactionEntry';
import TransactionHistory from './components/TransactionHistory';
import BudgetManager from './components/BudgetManager';
import BudgetComparison from './components/BudgetComparison';
import SpendingAnalytics from './components/SpendingAnalytics';
import GoalsManager from './components/GoalsManager';
import IncomeManager from './components/IncomeManager';
import InvestmentTracker from './components/InvestmentTracker';
import DebtTracker from './components/DebtTracker';
import RecurringManager from './components/RecurringManager';
import Reports from './components/Reports';
import Settings from './components/Settings';
import OwedManager from './components/OwedManager';
import LifePlanPage from './components/lifeplan/LifePlanPage';

function AppContent() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const { toast } = useToast();
  const { state } = useFinancial();

  // Two things in this app are waiting on the user rather than just sitting
  // there: recurring charges that are due to post, and money other people owe
  // back. Surfacing them in the nav turns it into a short to-do list.
  const navBadges = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const due = (state.recurringTemplates || []).filter(t => isTemplateDue(t, today)).length;
    const owed = getOwedSummary(state.transactions || []);
    return {
      ...(due ? { recurring: { label: String(due), title: `${due} recurring charge${due > 1 ? 's' : ''} due to post` } } : {}),
      ...(owed.outstanding > 0
        ? { owed: { label: formatCurrency(owed.outstanding).replace(/\.00$/, ''), title: `${formatCurrency(owed.outstanding)} still owed to you` } }
        : {}),
    };
  }, [state.recurringTemplates, state.transactions]);

  // Global shortcuts: Ctrl+K opens the command palette, Ctrl+N quick-adds.
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowPalette(open => !open);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowQuickAdd(true);
      }
      if (e.key === 'Escape') setShowQuickAdd(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const pages = {
    dashboard:    <Dashboard onQuickAdd={() => setShowQuickAdd(true)} onNavigate={setCurrentPage} />,
    transactions: <TransactionHistory />,
    owed:         <OwedManager />,
    budget:       <BudgetManager />,
    comparison:   <BudgetComparison />,
    analytics:    <SpendingAnalytics />,
    goals:        <GoalsManager />,
    income:       <IncomeManager />,
    investments:  <InvestmentTracker />,
    debts:        <DebtTracker />,
    recurring:    <RecurringManager />,
    plan:         <LifePlanPage />,
    reports:      <Reports />,
    settings:     <Settings />,
  };

  return (
    <>
      <Layout currentPage={currentPage} setCurrentPage={setCurrentPage} onQuickAdd={() => setShowQuickAdd(true)} badges={navBadges}>
        {pages[currentPage] || pages.dashboard}
      </Layout>
      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        onNavigate={setCurrentPage}
        onQuickAdd={() => setShowQuickAdd(true)}
      />
      {showQuickAdd && (
        <TransactionEntry
          isModal
          onClose={() => {
            setShowQuickAdd(false);
            toast('Transaction added');
          }}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <FinancialProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </FinancialProvider>
  );
}
