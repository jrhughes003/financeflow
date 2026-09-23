import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, CreditCard, PieChart, Target, TrendingUp, Wallet,
  BarChart3, FileText, Menu, X, Plus, DollarSign, Landmark, RefreshCw,
  Settings as SettingsIcon, HandCoins, Milestone, ChevronDown, Receipt, LineChart, PiggyBank
} from 'lucide-react';
import DemoBanner from './DemoBanner';

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
      className="shrink-0 px-1.5 py-0.5 rounded-control bg-caution-tint text-caution text-micro font-medium leading-none"
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
    w-full flex items-center gap-2.5 ${nested ? 'pl-8 pr-2.5' : 'px-2.5'} h-8 rounded-control mb-px
    text-sm transition-colors text-left
    ${currentPage === id
      ? 'bg-accent-tint text-accent-ink font-medium'
      : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'}
  `;

  return (
    <div className="flex h-screen bg-canvas overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-ink/25 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-30 w-60 bg-surface border-r border-line
        transform transition-transform duration-200 ease-in-out flex flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-line">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-accent rounded-control flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 text-ink-inverse" />
            </div>
            <span className="text-base font-semibold text-ink tracking-[-0.01em]">FinanceFlow</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-ink-muted hover:text-ink">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Add button */}
        <div className="px-3 py-3">
          <button
            onClick={() => { onQuickAdd(); setSidebarOpen(false); }}
            className="w-full inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse"
          >
            <Plus className="w-4 h-4" />
            Add transaction
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
                    w-full flex items-center gap-2.5 px-2.5 h-8 rounded-control text-sm
                    transition-colors text-left
                    ${holdsCurrent && !isOpen
                      ? 'text-accent-ink font-medium hover:bg-accent-tint'
                      : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'}
                  `}
                >
                  <Icon className="shrink-0" style={{ width: 18, height: 18 }} />
                  <span className="flex-1">{entry.label}</span>
                  {/* A collapsed group still shows where you are, and that
                      something inside is waiting on you. */}
                  {!isOpen && entry.items.some(i => badges[i.id]) && (
                    <span className="w-1.5 h-1.5 rounded-pill bg-caution shrink-0" title="Something inside needs attention" />
                  )}
                  {holdsCurrent && !isOpen && <span className="w-1.5 h-1.5 rounded-pill bg-accent shrink-0" />}
                  <ChevronDown
                    className={`shrink-0 text-ink-muted transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
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
        <div className="px-4 py-2.5 border-t border-line">
          <p className="text-caption text-ink-muted text-center">Your data stays on your device</p>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header */}
        <header className="bg-surface border-b border-line px-4 lg:px-6 h-14 flex items-center gap-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-ink-secondary hover:text-ink"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-base font-semibold text-ink tracking-[-0.01em]">
              {NAV_ITEMS.find(n => n.id === currentPage)?.label || 'FinanceFlow'}
            </h1>
            <p className="text-caption text-ink-muted">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={onQuickAdd}
              className="hidden sm:flex items-center gap-2 border border-line-strong hover:bg-surface-hover text-ink text-sm font-medium h-8 px-3 rounded-control transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Quick add
            </button>
          </div>
        </header>

        {/* Renders only in the deployed demo build; null everywhere else. */}
        <DemoBanner />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-5 bg-canvas">
          {children}
        </main>
      </div>

      {/* Mobile FAB */}
      <button
        onClick={onQuickAdd}
        className="sm:hidden fixed bottom-6 right-6 z-10 w-12 h-12 bg-accent hover:bg-accent-hover text-ink-inverse rounded-pill shadow-overlay flex items-center justify-center transition-colors"
      >
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
}
