import React, { useState, useEffect, useCallback } from 'react';
import { FinancialProvider } from './context/FinancialContext';
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

function Toast({ toasts, removeToast }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium pointer-events-auto animate-fade-in ${t.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
          {t.message}
          <button onClick={() => removeToast(t.id)} className="ml-2 opacity-70 hover:opacity-100 text-white">✕</button>
        </div>
      ))}
    </div>
  );
}

function AppContent() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  const removeToast = useCallback((id) => setToasts(t => t.filter(x => x.id !== id)), []);

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
            addToast('Transaction added!');
          }}
        />
      )}
      <Toast toasts={toasts} removeToast={removeToast} />
    </>
  );
}

export default function App() {
  return (
    <FinancialProvider>
      <AppContent />
    </FinancialProvider>
  );
}
