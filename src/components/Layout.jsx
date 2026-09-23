import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, CreditCard, PieChart, Target, TrendingUp, Wallet,
  BarChart3, FileText, Menu, X, Plus, DollarSign, Landmark, RefreshCw,
  Settings as SettingsIcon, HandCoins, Milestone, ChevronDown, Receipt, LineChart, PiggyBank
} from 'lucide-react';

// Dashboard and Settings stay pinned; everything else lives in a collapsible
// group, so the sidebar is six rows at rest instead of fourteen.
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    id: 'everyday',
    label: 'Everyday',
    icon: Receipt,
    items: [
      { id: 'transactions', label: 'Transactions', icon: CreditCard },
      { id: 'owed',         label: 'Owed to Me',   icon: HandCoins },
      { id: 'recurring',    label: 'Recurring',    icon: RefreshCw },
    ],
  },
  {
    id: 'budgeting',
    label: 'Budgeting',
    icon: PiggyBank,
    items: [
      { id: 'budget', label: 'Budget', icon: Wallet },
      { id: 'goals',  label: 'Goals',  icon: Target },
    ],
  },
  {
    id: 'analysis',
    label: 'Analysis',
    icon: LineChart,
    items: [
      { id: 'comparison', label: 'Comparison', icon: BarChart3 },
      { id: 'analytics',  label: 'Analytics',  icon: PieChart },
      { id: 'reports',    label: 'Reports',    icon: FileText },
    ],
  },
  {
    id: 'wealth',
    label: 'Wealth & Planning',
    icon: TrendingUp,
    items: [
      { id: 'income',      label: 'Income',      icon: DollarSign },
      { id: 'investments', label: 'Investments', icon: TrendingUp },
      { id: 'debts',       label: 'Debts',       icon: Landmark },
      { id: 'plan',        label: 'Plan Ahead',  icon: Milestone },
    ],
  },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

// Flat list, for looking up the current page's title.
const NAV_ITEMS = NAV.flatMap(entry => (entry.items ? entry.items : [entry]));

const groupIdFor = pageId => NAV.find(g => g.items?.some(i => i.id === pageId))?.id;

function NavBadge({ badge }) {
  return (
    <span
      title={badge.title}
      className="shrink-0 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold leading-none"
    >
      {badge.label}
    </span>
  );
}

const OPEN_GROUPS_KEY = 'financeflow_nav_groups';

// Which groups start expanded: whatever the user left open last time, else just
// the one holding the current page. Storage can throw (private mode, blocked
// site data), so every access is guarded and falls back to a sane default.
function loadOpenGroups(currentPage) {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY));
    if (Array.isArray(saved)) return saved;
  } catch { /* ignore — fall through to the default */ }
  const active = groupIdFor(currentPage);
  return active ? [active] : [];
}

export default function Layout({ currentPage, setCurrentPage, onQuickAdd, children, badges = {} }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState(() => loadOpenGroups(currentPage));

  useEffect(() => {
    try { localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(openGroups)); } catch { /* not critical */ }
  }, [openGroups]);

  // Navigating from elsewhere (a dashboard link, a keyboard shortcut) should
  // reveal where you landed.
  useEffect(() => {
    const group = groupIdFor(currentPage);
    if (group) setOpenGroups(prev => (prev.includes(group) ? prev : [...prev, group]));
  }, [currentPage]);

  const toggleGroup = (id) =>
    setOpenGroups(prev => (prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]));

  const handleNav = (id) => {
    setCurrentPage(id);
    setSidebarOpen(false);
  };

  const itemClasses = (id, nested) => `
    w-full flex items-center gap-3 ${nested ? 'pl-9 pr-3' : 'px-3'} py-2.5 rounded-xl mb-0.5
    text-sm font-medium transition-colors text-left
    ${currentPage === id
      ? 'bg-blue-50 text-blue-700'
      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}
  `;

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
          {NAV.map((entry) => {
            const Icon = entry.icon;

            // A pinned, top-level destination.
            if (!entry.items) {
              return (
                <button key={entry.id} onClick={() => handleNav(entry.id)} className={itemClasses(entry.id)}>
                  <Icon className="shrink-0" style={{ width: 18, height: 18 }} />
                  <span className="flex-1 text-left">{entry.label}</span>
                  {badges[entry.id] && <NavBadge badge={badges[entry.id]} />}
                </button>
              );
            }

            const isOpen = openGroups.includes(entry.id);
            const holdsCurrent = entry.items.some(i => i.id === currentPage);

            return (
              <div key={entry.id} className="mb-0.5">
                <button
                  onClick={() => toggleGroup(entry.id)}
                  aria-expanded={isOpen}
                  aria-controls={`nav-group-${entry.id}`}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                    transition-colors text-left
                    ${holdsCurrent && !isOpen
                      ? 'text-blue-700 hover:bg-blue-50'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}
                  `}
                >
                  <Icon className="shrink-0" style={{ width: 18, height: 18 }} />
                  <span className="flex-1">{entry.label}</span>
                  {/* A collapsed group still shows where you are, and that
                      something inside is waiting on you. */}
                  {!isOpen && entry.items.some(i => badges[i.id]) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Something inside needs attention" />
                  )}
                  {holdsCurrent && !isOpen && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />}
                  <ChevronDown
                    className={`shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
                    style={{ width: 16, height: 16 }}
                  />
                </button>

                {isOpen && (
                  <div id={`nav-group-${entry.id}`} className="mt-0.5">
                    {entry.items.map(({ id, label, icon: ItemIcon }) => (
                      <button key={id} onClick={() => handleNav(id)} className={itemClasses(id, true)}>
                        <ItemIcon className="shrink-0" style={{ width: 16, height: 16 }} />
                        <span className="flex-1">{label}</span>
                        {badges[id] && <NavBadge badge={badges[id]} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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
