import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
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

import GoalsManager from './components/GoalsManager';

import DebtTracker from './components/DebtTracker';
import RecurringManager from './components/RecurringManager';

import Settings from './components/Settings';
import OwedManager from './components/OwedManager';
import ErrorBoundary from './components/ErrorBoundary';
import { exportToJSON } from './utils/exportUtils';

// Chart-heavy pages are split out: Recharts and the life-plan engine are most
// of the bundle, and none of these is the first screen anyone sees.
const BudgetComparison = lazy(() => import('./components/BudgetComparison'));
const SpendingAnalytics = lazy(() => import('./components/SpendingAnalytics'));
const InvestmentTracker = lazy(() => import('./components/InvestmentTracker'));
const Reports = lazy(() => import('./components/Reports'));
const IncomeManager = lazy(() => import('./components/IncomeManager'));
const LifePlanPage = lazy(() => import('./components/lifeplan/LifePlanPage'));

function PageFallback() {
  return <div className="text-sm text-ink-muted py-12 text-center">Loading…</div>;
}

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
        {/* Scoped to the page area so a failure leaves the nav usable, and
            reset by navigation so one bad page doesn't trap the session. */}
        <ErrorBoundary resetKey={currentPage} onExport={() => exportToJSON(state)}>
          <Suspense fallback={<PageFallback />}>
            {pages[currentPage] || pages.dashboard}
          </Suspense>
        </ErrorBoundary>
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
    // ToastProvider is outermost so FinancialProvider can raise a toast when a
    // save fails. It holds no financial state, so the order costs nothing.
    <ToastProvider>
      <FinancialProvider>
        <AppContent />
      </FinancialProvider>
    </ToastProvider>
  );
}
