import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { format } from 'date-fns';
import DemoBanner from './DemoBanner';
import { isElectron } from '../storage/storage';
import type { NavBadge as Badge, NavBadges, PageId } from '../types/navigation';

// The shell is laid out like a trading terminal: a strip of the figures that
// matter across the top of every screen, pages listed by a short code down the
// left, a command line above the page, and the keys along the bottom.
//
// The nav is flat. It used to collapse into groups to keep the sidebar at six
// rows, but at 24px a row all fifteen pages fit on any screen, and seeing
// every destination at once is the point of a terminal.

/** A destination in the nav. */
interface NavItem {
  id: PageId;
  /** Three letters, shown before the name and in the command line. */
  code: string;
  label: string;
}

interface NavSection {
  /** Absent for the pinned first entry. */
  label?: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  { items: [{ id: 'dashboard', code: 'DSH', label: 'Dashboard' }] },
  {
    label: 'Everyday',
    items: [
      { id: 'transactions', code: 'TXN', label: 'Transactions' },
      { id: 'owed',         code: 'OWE', label: 'Owed to Me' },
      { id: 'recurring',    code: 'REC', label: 'Recurring' },
    ],
  },
  {
    label: 'Budgeting',
    items: [
      { id: 'budget', code: 'BGT', label: 'Budget' },
      { id: 'goals',  code: 'GOL', label: 'Goals' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { id: 'comparison', code: 'CMP', label: 'Comparison' },
      { id: 'analytics',  code: 'ANL', label: 'Analytics' },
      { id: 'reports',    code: 'RPT', label: 'Reports' },
    ],
  },
  {
    label: 'Wealth & Planning',
    items: [
      { id: 'income',      code: 'INC', label: 'Income' },
      { id: 'investments', code: 'INV', label: 'Investments' },
      { id: 'debts',       code: 'DBT', label: 'Debts' },
      { id: 'cashflow',    code: 'CFL', label: 'Cash Flow' },
      { id: 'plan',        code: 'PLN', label: 'Plan Ahead' },
    ],
  },
  { label: 'System', items: [{ id: 'settings', code: 'SET', label: 'Settings' }] },
];

const NAV_ITEMS: NavItem[] = NAV.flatMap(s => s.items);

/** One figure in the status strip. */
export interface StatusItem {
  label: string;
  value: React.ReactNode;
  /** A short change or context after the value. */
  delta?: React.ReactNode;
  deltaTone?: 'positive' | 'negative' | 'caution' | 'muted';
}

const DELTA_TONES = {
  positive: 'text-positive', negative: 'text-negative', caution: 'text-caution', muted: 'text-ink-muted',
} as const;

function NavBadge({ badge }: { badge: Badge }) {
  return (
    <span title={badge.title} className="shrink-0 text-micro font-medium text-caution">
      {badge.label}
    </span>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1 border border-line-strong text-ink-secondary text-[10px] leading-[14px] font-[inherit]">
      {children}
    </kbd>
  );
}

export default function Layout({
  currentPage, setCurrentPage, onQuickAdd, onOpenPalette, children, badges = {}, status = [],
}: {
  currentPage: PageId;
  setCurrentPage: (page: PageId) => void;
  onQuickAdd: () => void;
  /** Opens the command palette; the command line is a button for it. */
  onOpenPalette?: () => void;
  children?: React.ReactNode;
  badges?: NavBadges;
  /** The figures across the top of every screen. */
  status?: StatusItem[];
}) {
  const [navOpen, setNavOpen] = useState(false);
  const current = NAV_ITEMS.find(n => n.id === currentPage);

  const handleNav = (id: PageId): void => {
    setCurrentPage(id);
    setNavOpen(false);
  };

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden text-sm">
      {/* Status strip */}
      <div className="shrink-0 flex items-stretch h-[26px] bg-surface border-b border-line-strong overflow-x-auto whitespace-nowrap">
        <span className="flex items-center px-3 border-r border-line font-semibold tracking-[0.1em] text-accent-ink">
          FINANCEFLOW
        </span>
        {status.map(s => (
          <span key={s.label} className="flex items-center gap-2 px-3 border-r border-line">
            <span className="label-micro">{s.label}</span>
            <span className="font-medium text-ink">{s.value}</span>
            {s.delta && <span className={`text-caption ${DELTA_TONES[s.deltaTone ?? 'muted']}`}>{s.delta}</span>}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3 px-3 text-caption text-ink-muted">
          <span className="hidden md:inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-positive" aria-hidden="true" />
            {isElectron ? 'LOCAL · SQLITE' : 'LOCAL · BROWSER'}
          </span>
          <span className="text-ink-secondary">{format(new Date(), 'EEE dd MMM yyyy').toUpperCase()}</span>
        </span>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Mobile overlay */}
        {navOpen && (
          <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--c-canvas)_72%,transparent)] z-20 lg:hidden" onClick={() => setNavOpen(false)} />
        )}

        {/* Navigation */}
        <aside className={`
          fixed lg:static inset-y-0 left-0 z-30 w-52 lg:w-48 bg-surface border-r border-line
          transform transition-transform duration-150 flex flex-col
          ${navOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="flex items-center gap-1 p-2 border-b border-line">
            <button
              onClick={() => { onQuickAdd(); setNavOpen(false); }}
              className="flex-1 h-7 inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-ink-inverse text-caption font-semibold tracking-[0.06em] uppercase rounded-control transition-colors"
            >
              + Add transaction
            </button>
            <button onClick={() => setNavOpen(false)} className="lg:hidden w-7 h-7 inline-flex items-center justify-center text-ink-muted hover:text-ink" aria-label="Close menu">
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav aria-label="Pages" className="flex-1 overflow-y-auto pb-3">
            {NAV.map((section, i) => (
              <div key={section.label ?? i}>
                {section.label && <p className="label-micro px-2.5 pt-3 pb-1">{section.label}</p>}
                {section.items.map(({ id, code, label }) => {
                  const active = currentPage === id;
                  return (
                    <button
                      key={id}
                      onClick={() => handleNav(id)}
                      aria-current={active ? 'page' : undefined}
                      className={`w-full flex items-center gap-2 h-6 px-2.5 text-left text-sm transition-colors ${
                        active
                          ? 'bg-accent-tint text-ink shadow-[inset_2px_0_0_var(--c-accent)]'
                          : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'
                      }`}
                    >
                      <span aria-hidden="true" className={`w-8 text-micro tracking-[0.04em] ${active ? 'text-accent-ink' : 'text-ink-muted'}`}>{code}</span>
                      <span className="flex-1 truncate">{label}</span>
                      {badges[id] && <NavBadge badge={badges[id] as Badge} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* Page */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Command line */}
          <header className="shrink-0 flex items-center gap-2.5 px-2.5 h-9 bg-surface border-b border-line">
            <button onClick={() => setNavOpen(true)} className="lg:hidden text-ink-secondary hover:text-ink" aria-label="Open menu">
              <Menu className="w-4 h-4" />
            </button>
            <span aria-hidden="true" className="font-semibold tracking-[0.08em] text-accent-ink">{current?.code ?? 'DSH'}</span>
            <span aria-hidden="true" className="text-ink-muted">›</span>
            <h1 className="text-sm font-medium text-ink uppercase tracking-[0.06em] whitespace-nowrap">
              {current?.label || 'FinanceFlow'}
            </h1>
            {onOpenPalette && (
              <button
                onClick={onOpenPalette}
                className="ml-auto sm:ml-4 flex-1 max-w-md hidden sm:flex items-center gap-2 h-6 px-2 border border-line-strong bg-canvas text-ink-muted hover:text-ink-secondary text-left"
              >
                <span className="text-accent-ink" aria-hidden="true">&gt;</span>
                <span className="flex-1 truncate">Go to a page or run a command…</span>
                <Key>CTRL K</Key>
              </button>
            )}
            <button
              onClick={onQuickAdd}
              className="ml-auto hidden sm:inline-flex items-center gap-2 h-6 px-2 border border-line-strong text-caption uppercase tracking-[0.05em] text-ink hover:bg-surface-hover"
            >
              + New <Key>CTRL N</Key>
            </button>
          </header>

          {/* Renders only in the deployed demo build; null everywhere else. */}
          <DemoBanner />

          <main className="flex-1 overflow-y-auto p-2 bg-canvas">
            {children}
          </main>

          {/* Keys */}
          <footer className="shrink-0 hidden sm:flex items-center gap-4 px-2.5 h-6 bg-surface border-t border-line text-caption text-ink-muted whitespace-nowrap overflow-hidden">
            <span><Key>CTRL K</Key> COMMAND</span>
            <span><Key>CTRL N</Key> NEW TRANSACTION</span>
            <span><Key>ESC</Key> CLOSE</span>
            <span className="ml-auto">YOUR DATA STAYS ON THIS DEVICE</span>
          </footer>
        </div>
      </div>

      {/* Mobile quick add */}
      <button
        onClick={onQuickAdd}
        aria-label="Add transaction"
        className="sm:hidden fixed bottom-5 right-5 z-10 w-11 h-11 bg-accent hover:bg-accent-hover text-ink-inverse shadow-overlay flex items-center justify-center text-xl"
      >
        +
      </button>
    </div>
  );
}
