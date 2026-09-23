import React, { useState, useEffect, useCallback } from 'react';
import { FinancialProvider } from './context/FinancialContext';
import { ToastProvider, useToast } from './context/ToastContext';
import Layout from './components/Layout';
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
  const { toast } = useToast();

  // Global keyboard shortcut Ctrl+N = quick add
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
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
      <Layout currentPage={currentPage} setCurrentPage={setCurrentPage} onQuickAdd={() => setShowQuickAdd(true)}>
        {pages[currentPage] || pages.dashboard}
      </Layout>
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
