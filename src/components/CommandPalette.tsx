// Ctrl/Cmd+K — go anywhere, or search the ledger, from one keystroke.
//
// The app has fourteen destinations and a search box buried inside one of them.
// This puts every page, the common actions, and merchant search behind a single
// shortcut, which matters most on the desktop app where there's no address bar
// to type into.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFinancial } from '../context/FinancialContext';
import { formatCurrency } from '../utils/calculations';
import { exportToCSV } from '../utils/exportUtils';
import type { PageId } from '../types/navigation';

/** One row of the list: a page, an action, or a merchant hit. */
interface PaletteItem {
  id: string;
  label: string;
  /** The page's terminal code (DSH, TXN…), shown in the left column. */
  code?: string;
  kind: string;
  /** A shortcut for an action, a total for a merchant. */
  hint?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: PageId) => void;
  onQuickAdd: () => void;
}

// Codes match the nav rail in Layout.tsx, so a page reads the same everywhere.
const PAGES: { id: PageId; label: string; code: string; keywords: string }[] = [
  { id: 'dashboard', label: 'Dashboard', code: 'DSH', keywords: 'home overview summary' },
  { id: 'transactions', label: 'Transactions', code: 'TXN', keywords: 'ledger history spending list' },
  { id: 'owed', label: 'Owed to Me', code: 'OWE', keywords: 'split repayment friends borrowed' },
  { id: 'budget', label: 'Budget', code: 'BGT', keywords: 'limits categories rollover' },
  { id: 'comparison', label: 'Comparison', code: 'CMP', keywords: 'budget vs actual variance' },
  { id: 'analytics', label: 'Analytics', code: 'ANL', keywords: 'insights trends forecast habits savings' },
  { id: 'goals', label: 'Goals', code: 'GOL', keywords: 'savings targets progress' },
  { id: 'income', label: 'Income', code: 'INC', keywords: 'salary earnings pay' },
  { id: 'investments', label: 'Investments', code: 'INV', keywords: 'portfolio accounts advisor tfsa rrsp' },
  { id: 'debts', label: 'Debts', code: 'DBT', keywords: 'loans credit card payoff avalanche snowball' },
  { id: 'recurring', label: 'Recurring', code: 'REC', keywords: 'subscriptions bills templates due' },
  { id: 'plan', label: 'Plan Ahead', code: 'PLN', keywords: 'retirement projection monte carlo house mortgage' },
  { id: 'reports', label: 'Reports', code: 'RPT', keywords: 'export summary ytd ai insights' },
  { id: 'settings', label: 'Settings', code: 'SET', keywords: 'api key backup restore demo data' },
];

// The right-hand column: what choosing the row does.
const KIND_LABELS: Record<string, string> = { page: 'GO', action: 'RUN', merchant: 'TXN' };

// Subsequence match, so "plah" finds "Plan Ahead" and "trans" finds
// Transactions. Cheap, predictable, and good enough for a list this size.
function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  const text = haystack.toLowerCase();
  const query = needle.toLowerCase();
  if (text.startsWith(query)) return 1000 - text.length;
  const index = text.indexOf(query);
  if (index !== -1) return 800 - index - text.length;
  let cursor = 0;
  let gaps = 0;
  for (const char of query) {
    const found = text.indexOf(char, cursor);
    if (found === -1) return -1;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 400 - gaps;
}

export default function CommandPalette({ open, onClose, onNavigate, onQuickAdd }: CommandPaletteProps) {
  const { state } = useFinancial();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Wait for the dialog to mount before taking focus.
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const results = useMemo(() => {
    // No `kind` yet: these are tagged as actions where they join the scored list.
    const actions: Omit<PaletteItem, 'kind'>[] = [
      {
        id: 'action-add', label: 'Add a transaction', hint: 'Ctrl+N', code: 'ADD',
        keywords: 'new expense record entry', run: () => onQuickAdd(),
      },
      {
        id: 'action-export', label: 'Export transactions to CSV', code: 'CSV',
        keywords: 'download backup spreadsheet',
        run: () => exportToCSV(state.transactions || []),
      },
    ];

    const pages: PaletteItem[] = PAGES.map(p => ({
      ...p, kind: 'page', run: () => onNavigate(p.id),
    }));

    // Merchant search: jumps to the ledger, and shows what it would find first.
    const merchants: PaletteItem[] = [];
    if (query.trim().length >= 2) {
      const totals = new Map<string, { total: number; count: number }>();
      (state.transactions || []).forEach(t => {
        if (!t.merchant || t.kind === 'savings') return;
        if (!t.merchant.toLowerCase().includes(query.trim().toLowerCase())) return;
        const entry = totals.get(t.merchant) || { total: 0, count: 0 };
        entry.total += Number(t.amount) || 0;
        entry.count += 1;
        totals.set(t.merchant, entry);
      });
      [...totals.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 4)
        .forEach(([merchant, { total, count }]) => merchants.push({
          id: `merchant-${merchant}`,
          kind: 'merchant',
          label: merchant,
          hint: `${count} transaction${count > 1 ? 's' : ''} · ${formatCurrency(total)}`,
          code: 'MCH',
          run: () => onNavigate('transactions'),
        }));
    }

    const scored = [...actions.map(a => ({ ...a, kind: 'action' })), ...pages]
      .map(item => ({ item, score: query ? fuzzyScore(`${item.label} ${item.keywords || ''}`, query) : 0 }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);

    return [...merchants, ...scored].slice(0, 9);
  }, [query, state.transactions, onNavigate, onQuickAdd]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--c-canvas)_72%,transparent)]" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-surface border border-line-strong shadow-overlay overflow-hidden font-mono">
        <div className="h-bar flex items-center gap-2.5 px-2.5 bg-surface-sunk border-b border-line">
          <span className="text-micro uppercase font-semibold text-ink">Command</span>
          <span className="ml-auto text-micro uppercase text-ink-muted">{results.length} {results.length === 1 ? 'MATCH' : 'MATCHES'}</span>
        </div>
        <div className="flex items-center gap-2 h-9 px-2.5 border-b border-line-strong bg-canvas">
          <span aria-hidden="true" className="text-accent font-semibold text-base leading-none">&gt;</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to a page, search a merchant, or run an action…"
            aria-label="Search pages, merchants and actions"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 h-full bg-transparent text-base text-ink caret-accent outline-none placeholder:text-ink-muted"
          />
          <kbd className="text-[10px] leading-[14px] uppercase tracking-[0.06em] text-ink-muted border border-line-strong rounded-control px-1">esc</kbd>
        </div>

        <ul ref={listRef} className="max-h-80 overflow-y-auto">
          {results.length === 0 && (
            <li className="px-2.5 py-3 font-sans text-sm text-ink-muted">Nothing matches “{query}”.</li>
          )}
          {results.map((item, index) => {
            const isActive = index === active;
            return (
              <li key={item.id} className="border-b border-line-faint last:border-b-0">
                <button
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                  className={`w-full flex items-center gap-2.5 h-[26px] px-2.5 text-sm text-left border-l-2
                    ${isActive ? 'bg-accent-tint text-accent-ink border-accent' : 'text-ink-secondary border-transparent hover:bg-surface-hover'}`}
                >
                  <span aria-hidden="true" className={`w-8 shrink-0 text-micro tracking-[0.04em] ${isActive ? 'text-accent-ink' : 'text-ink-muted'}`}>{item.code}</span>
                  <span className={`flex-1 min-w-0 truncate ${isActive ? '' : 'text-ink'}`}>{item.label}</span>
                  {item.kind === 'merchant' && <span className="text-caption text-ink-muted whitespace-nowrap">{item.hint}</span>}
                  {item.kind !== 'merchant' && item.hint && (
                    <kbd className="text-[10px] leading-[14px] uppercase tracking-[0.06em] text-ink-muted border border-line-strong rounded-control px-1">{item.hint}</kbd>
                  )}
                  <span aria-hidden="true" className={`w-8 shrink-0 text-right text-micro tracking-[0.06em] ${isActive ? 'text-accent' : 'text-ink-muted'}`}>
                    {isActive ? '↵' : KIND_LABELS[item.kind]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div aria-hidden="true" className="h-[22px] flex items-center gap-3 px-2.5 border-t border-line bg-surface-sunk text-micro uppercase tracking-[0.06em] text-ink-muted">
          <span>↑↓ Move</span>
          <span>↵ Open</span>
          <span>Esc Close</span>
          <span className="ml-auto">Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
