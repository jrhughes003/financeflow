import React, { useState } from 'react';
import {
  LayoutDashboard, CreditCard, PieChart, Target, TrendingUp, Wallet,
  BarChart3, FileText, Menu, X, Plus, DollarSign, Landmark, RefreshCw, Settings as SettingsIcon, HandCoins, Milestone
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', icon: CreditCard },
  { id: 'owed',         label: 'Owed to Me',   icon: HandCoins },
  { id: 'budget',       label: 'Budget',       icon: Wallet },
  { id: 'comparison',  label: 'Comparison',   icon: BarChart3 },
  { id: 'analytics',   label: 'Analytics',    icon: PieChart },
  { id: 'goals',       label: 'Goals',        icon: Target },
  { id: 'income',      label: 'Income',       icon: DollarSign },
  { id: 'investments', label: 'Investments',  icon: TrendingUp },
  { id: 'debts',       label: 'Debts',        icon: Landmark },
  { id: 'recurring',   label: 'Recurring',    icon: RefreshCw },
  { id: 'plan',        label: 'Plan Ahead',   icon: Milestone },
  { id: 'reports',     label: 'Reports',      icon: FileText },
  { id: 'settings',    label: 'Settings',     icon: SettingsIcon },
];

export default function Layout({ currentPage, setCurrentPage, onQuickAdd, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleNav = (id) => {
    setCurrentPage(id);
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200
        transform transition-transform duration-200 ease-in-out flex flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">FinanceFlow</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Add button */}
        <div className="px-4 py-4">
          <button
            onClick={() => { onQuickAdd(); setSidebarOpen(false); }}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Transaction
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 pb-4 overflow-y-auto">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleNav(id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-sm font-medium transition-colors
                ${currentPage === id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}
              `}
            >
              <Icon className="w-4.5 h-4.5 shrink-0" style={{ width: 18, height: 18 }} />
              {label}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center">Your data stays on your device</p>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header */}
        <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-4 flex items-center gap-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-500 hover:text-gray-700"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {NAV_ITEMS.find(n => n.id === currentPage)?.label || 'FinanceFlow'}
            </h1>
            <p className="text-xs text-gray-400">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={onQuickAdd}
              className="hidden sm:flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Quick Add
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>

      {/* Mobile FAB */}
      <button
        onClick={onQuickAdd}
        className="sm:hidden fixed bottom-6 right-6 z-10 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
      >
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
}
