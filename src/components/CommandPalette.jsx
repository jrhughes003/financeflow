// Ctrl/Cmd+K — go anywhere, or search the ledger, from one keystroke.
//
// The app has fourteen destinations and a search box buried inside one of them.
// This puts every page, the common actions, and merchant search behind a single
// shortcut, which matters most on the desktop app where there's no address bar
// to type into.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, CornerDownLeft, LayoutDashboard, CreditCard, HandCoins, Wallet, BarChart3,
  PieChart, Target, DollarSign, TrendingUp, Landmark, RefreshCw, Milestone, FileText,
  Settings as SettingsIcon, Plus, Download, Receipt,
} from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import { formatCurrency } from '../utils/calculations';
import { exportToCSV } from '../utils/exportUtils';

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home overview summary' },
  { id: 'transactions', label: 'Transactions', icon: CreditCard, keywords: 'ledger history spending list' },
  { id: 'owed', label: 'Owed to Me', icon: HandCoins, keywords: 'split repayment friends borrowed' },
  { id: 'budget', label: 'Budget', icon: Wallet, keywords: 'limits categories rollover' },
  { id: 'comparison', label: 'Comparison', icon: BarChart3, keywords: 'budget vs actual variance' },
  { id: 'analytics', label: 'Analytics', icon: PieChart, keywords: 'insights trends forecast habits savings' },
  { id: 'goals', label: 'Goals', icon: Target, keywords: 'savings targets progress' },
  { id: 'income', label: 'Income', icon: DollarSign, keywords: 'salary earnings pay' },
  { id: 'investments', label: 'Investments', icon: TrendingUp, keywords: 'portfolio accounts advisor tfsa rrsp' },
  { id: 'debts', label: 'Debts', icon: Landmark, keywords: 'loans credit card payoff avalanche snowball' },
  { id: 'recurring', label: 'Recurring', icon: RefreshCw, keywords: 'subscriptions bills templates due' },
  { id: 'plan', label: 'Plan Ahead', icon: Milestone, keywords: 'retirement projection monte carlo house mortgage' },
  { id: 'reports', label: 'Reports', icon: FileText, keywords: 'export summary ytd ai insights' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, keywords: 'api key backup restore demo data' },
];

// Subsequence match, so "plah" finds "Plan Ahead" and "trans" finds
// Transactions. Cheap, predictable, and good enough for a list this size.
function fuzzyScore(haystack, needle) {
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

export default function CommandPalette({ open, onClose, onNavigate, onQuickAdd }) {
  const { state } = useFinancial();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

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
    const actions = [
      {
        id: 'action-add', label: 'Add a transaction', hint: 'Ctrl+N', icon: Plus,
        keywords: 'new expense record entry', run: () => onQuickAdd(),
      },
      {
        id: 'action-export', label: 'Export transactions to CSV', icon: Download,
        keywords: 'download backup spreadsheet',
        run: () => exportToCSV(state.transactions || []),
      },
    ];

    const pages = PAGES.map(p => ({
      ...p, kind: 'page', run: () => onNavigate(p.id),
    }));

    // Merchant search: jumps to the ledger, and shows what it would find first.
    const merchants = [];
    if (query.trim().length >= 2) {
      const totals = new Map();
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
          icon: Receipt,
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

  const choose = (item) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to a page, search a merchant, or run an action…"
            aria-label="Search pages, merchants and actions"
            className="flex-1 py-3.5 text-sm outline-none placeholder:text-gray-400"
          />
          <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <ul ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-400">Nothing matches “{query}”.</li>
          )}
          {results.map((item, index) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors
                    ${index === active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                  {Icon && <Icon className="w-4 h-4 shrink-0 opacity-70" />}
                  <span className="flex-1">{item.label}</span>
                  {item.kind === 'merchant' && <span className="text-xs text-gray-400">{item.hint}</span>}
                  {item.kind !== 'merchant' && item.hint && (
                    <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">{item.hint}</kbd>
                  )}
                  {index === active && <CornerDownLeft className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
