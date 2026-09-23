import React, { useState, useMemo, useRef } from 'react';
import { Search, Filter, Download, Upload, Trash2, Edit2, ChevronUp, ChevronDown, Sparkles , CircleSlash , Receipt } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import EmptyState from './EmptyState';
import { Money, CategoryMark } from './ui';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { CATEGORIES, getAllCategories } from '../utils/categorization';
import { useGetCategory } from '../context/FinancialContext';
import { exportToCSV, importFromCSV } from '../utils/exportUtils';
import { formatCurrency } from '../utils/calculations';
import { PAGE_SIZE } from '../utils/constants';
import { runAi, taxonomy, aiSupported } from '../ai/ai';
import TransactionEntry from './TransactionEntry';
import { getOwedStatus } from '../utils/reimbursements';

// Small status pill for fronted purchases.
function OwedBadge({ t }) {
  const s = getOwedStatus(t);
  if (!s) return null;
  const label = s.status === 'settled' ? 'Paid back'
    : s.status === 'forgiven' ? 'Owed · forgiven'
    : `Owed ${formatCurrency(s.remaining)}`;
  const cls = s.isOpen ? 'bg-positive-tint text-positive' : 'bg-surface-hover text-ink-muted';
  return <span className={`inline-block mt-0.5 text-xs font-medium px-1.5 py-0.5 rounded ${cls}`}>{label}</span>;
}

export default function TransactionHistory() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const importRef = useRef(null);
  const { transactions, customCategories = [] } = state;
  const getCategory = useGetCategory();
  const allCategories = getAllCategories(customCategories);
  const aiEnabled = aiSupported && state.settings?.aiEnabled;

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterMinAmt, setFilterMinAmt] = useState('');
  const [filterMaxAmt, setFilterMaxAmt] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [editTx, setEditTx] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  // AI receipt / statement paste
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteMsg, setPasteMsg] = useState('');

  const filtered = useMemo(() => {
    let list = [...transactions];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.merchant.toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(q))
      );
    }
    if (filterCategory) list = list.filter(t => t.category === filterCategory);
    if (filterDateFrom) list = list.filter(t => t.date >= filterDateFrom);
    if (filterDateTo) list = list.filter(t => t.date <= filterDateTo);
    if (filterMinAmt) list = list.filter(t => t.amount >= parseFloat(filterMinAmt));
    if (filterMaxAmt) list = list.filter(t => t.amount <= parseFloat(filterMaxAmt));
    list.sort((a, b) => {
      let va = a[sortField], vb = b[sortField];
      if (sortField === 'amount') { va = a.amount; vb = b.amount; }
      if (sortField === 'date') { va = a.date; vb = b.date; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [transactions, search, filterCategory, filterDateFrom, filterDateTo, filterMinAmt, filterMaxAmt, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const total = filtered.reduce((s, t) => s + t.amount, 0);

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const handleDelete = (id) => {
    const transaction = transactions.find(t => t.id === id);
    if (transaction) removeItem({ type: 'transaction', item: transaction, label: transaction.merchant });
    setDeleteId(null);
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const txs = await importFromCSV(file);
      dispatch({ type: 'IMPORT_TRANSACTIONS', payload: txs });
    } catch { alert('Failed to import CSV. Check format.'); }
    e.target.value = '';
  };

  // AI: parse pasted receipt / statement text into transactions.
  const handleParsePaste = async () => {
    if (!pasteText.trim()) return;
    setPasteBusy(true); setPasteMsg('');
    const res = await runAi('extract', { text: pasteText.trim(), categories: taxonomy(customCategories) });
    setPasteBusy(false);
    if (!res.ok) {
      setPasteMsg(res.error === 'no_key' ? 'Add an API key in Settings first.' : 'Could not parse that text.');
      return;
    }
    const parsed = (res.data?.transactions || []).filter(t => t && t.amount > 0).map((t, i) => ({
      id: `ai_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      date: t.date || new Date().toISOString().slice(0, 10),
      merchant: t.merchant || 'Unknown',
      amount: Math.abs(Number(t.amount) || 0),
      category: t.category || 'products',
      subcategory: '',
      notes: 'Parsed by AI',
      tags: ['ai-imported'],
      isException: false,
    }));
    if (parsed.length === 0) { setPasteMsg('No transactions found in that text.'); return; }
    dispatch({ type: 'IMPORT_TRANSACTIONS', payload: parsed });
    setPasteText(''); setShowPaste(false);
  };

  const SortIcon = ({ field }) => sortField === field
    ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />)
    : null;

  return (
    <div className="space-y-4 animate-fade-in">
      {editTx && <TransactionEntry isModal editTransaction={editTx} onClose={() => setEditTx(null)} />}

      {/* Confirm delete */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 px-4">
          <div className="bg-surface rounded-container border border-line p-5 max-w-sm shadow-overlay">
            <p className="text-base font-semibold text-ink mb-1">Delete this transaction?</p>
            <p className="text-sm text-ink-secondary mb-4">You can undo this from the toast that appears.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-negative hover:opacity-90 text-ink-inverse">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Search & actions bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search merchant, notes, tags..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full h-9 pl-8 pr-3 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
          />
        </div>
        <button onClick={() => setShowFilters(s => !s)} className={`flex items-center gap-2 h-9 px-3 border rounded-control text-sm font-medium transition-colors ${showFilters ? 'border-accent text-accent-ink bg-accent-tint' : 'border-line-strong text-ink hover:bg-surface-hover'}`}>
          <Filter className="w-4 h-4" /> Filters
        </button>
        <button onClick={() => exportToCSV(filtered)} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover">
          <Download className="w-4 h-4" /> Export
        </button>
        <label className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover cursor-pointer">
          <Upload className="w-4 h-4" /> Import CSV
          <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
        </label>
        {aiEnabled && (
          <button onClick={() => setShowPaste(s => !s)} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover">
            <Sparkles className="w-4 h-4" /> Paste receipt
          </button>
        )}
      </div>

      {/* AI receipt / statement paste panel */}
      {aiEnabled && showPaste && (
        <div className="bg-surface-sunk border border-line rounded-container p-4 space-y-2">
          <p className="text-sm font-semibold text-ink">Paste receipt or bank-statement text</p>
          <textarea
            rows={5}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="Paste messy text here — line items, amounts, dates…"
            className="w-full px-2.5 py-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent resize-y"
          />
          <div className="flex items-center gap-2">
            <button onClick={handleParsePaste} disabled={pasteBusy || !pasteText.trim()} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">
              {pasteBusy ? 'Parsing…' : 'Extract transactions'}
            </button>
            {pasteMsg && <span className="text-caption text-negative">{pasteMsg}</span>}
          </div>
          <p className="text-caption text-ink-muted">The pasted text is sent to Anthropic to extract line items. Review imported items afterward.</p>
        </div>
      )}

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-surface-sunk border border-line rounded-container p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="label-micro block mb-1.5">Category</label>
            <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(1); }} className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent">
              <option value="">All categories</option>
              {allCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label-micro block mb-1.5">From Date</label>
            <input type="date" value={filterDateFrom} onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }} className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="label-micro block mb-1.5">To Date</label>
            <input type="date" value={filterDateTo} onChange={e => { setFilterDateTo(e.target.value); setPage(1); }} className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="label-micro block mb-1.5">Min Amount</label>
            <input type="number" placeholder="$0" value={filterMinAmt} onChange={e => { setFilterMinAmt(e.target.value); setPage(1); }} className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="label-micro block mb-1.5">Max Amount</label>
            <input type="number" placeholder="Any" value={filterMaxAmt} onChange={e => { setFilterMaxAmt(e.target.value); setPage(1); }} className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
          </div>
          <div className="flex items-end">
            <button onClick={() => { setFilterCategory(''); setFilterDateFrom(''); setFilterDateTo(''); setFilterMinAmt(''); setFilterMaxAmt(''); setSearch(''); setPage(1); }} className="w-full inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover">Clear Filters</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface rounded-container border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-sunk border-b border-line">
                {[['date','Date'],['merchant','Merchant'],['category','Category'],['amount','Amount']].map(([field, label]) => (
                  <th key={field} onClick={() => handleSort(field)} className={`label-micro font-medium py-2 px-3 cursor-pointer hover:text-ink select-none ${field === 'amount' ? 'text-right' : 'text-left'}`}>
                    {label}<SortIcon field={field} />
                  </th>
                ))}
                <th className="label-micro font-medium py-2 px-3 text-left">Tags</th>
                <th className="label-micro font-medium py-2 px-3 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 && (
                <tr><td colSpan={6}>
                  {transactions.length === 0 ? (
                    <EmptyState
                      icon={Receipt}
                      title="No transactions yet"
                      description="Import a CSV from your bank, or add one by hand. Everything else in the app — budgets, trends, forecasts — builds on this ledger."
                      actionLabel="Import a CSV"
                      onAction={() => importRef.current?.click()}
                      secondary="No data to hand? Settings → Load demo data fills the app with a realistic example."
                    />
                  ) : (
                    <p className="px-4 py-8 text-center text-ink-muted text-sm">No transactions match these filters.</p>
                  )}
                </td></tr>
              )}
              {paged.map(t => {
                const cat = getCategory(t.category);
                return (
                  <tr key={t.id} className={`border-b border-line-faint hover:bg-surface-hover transition-colors ${t.isException ? 'opacity-55' : ''}`}>
                    <td className="px-3 h-row text-ink-secondary whitespace-nowrap money text-caption">{format(parseISO(t.date), 'dd MMM yyyy')}</td>
                    <td className="px-3 h-row">
                      <span className="text-ink">{t.merchant}</span>
                      {t.subcategory && <span className="text-ink-muted text-caption"> · {t.subcategory}</span>}
                      {t.isException && <span className="text-ink-muted text-caption"> · one-off</span>}
                      <OwedBadge t={t} />
                    </td>
                    <td className="px-3 h-row">
                      <CategoryMark color={cat.color} name={cat.name} className="text-ink-secondary text-caption" />
                    </td>
                    <td className="px-3 h-row text-right whitespace-nowrap">
                      {t.kind === 'savings'
                        ? <Money value={t.amount} size="sm" signed className="text-positive" />
                        : <Money value={-t.amount} size="sm" />}
                    </td>
                    <td className="px-3 h-row">
                      <div className="flex flex-wrap gap-1">
                        {(t.tags || []).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 bg-surface-sunk border border-line text-ink-muted rounded-control text-caption">{tag}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 h-row">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => dispatch({ type: 'MARK_EXCEPTION', payload: t.id })}
                          title={t.isException
                            ? 'Counted as a one-off — click to include it in budgets again'
                            : 'Mark as a one-off so it stays out of budgets and averages'}
                          aria-label={t.isException ? 'Include in budgets' : 'Mark as one-off'}
                          aria-pressed={Boolean(t.isException)}
                          className={`p-1.5 rounded-control transition-colors ${t.isException
                            ? 'text-accent-ink bg-accent-tint'
                            : 'text-ink-muted hover:text-ink hover:bg-surface-hover'}`}
                        >
                          <CircleSlash className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditTx(t)} aria-label={`Edit ${t.merchant}`} title="Edit" className="text-ink-muted hover:text-ink transition-colors p-1.5 rounded-control hover:bg-surface-hover"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setDeleteId(t.id)} aria-label={`Delete ${t.merchant}`} title="Delete" className="text-ink-muted hover:text-negative transition-colors p-1.5 rounded-control hover:bg-negative-tint"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination & total */}
        <div className="px-4 py-2.5 border-t border-line flex flex-wrap items-center justify-between gap-2 bg-surface-sunk">
          <span className="text-caption text-ink-secondary">{filtered.length} transactions · <Money value={total} size="caption" className="text-ink font-medium" /></span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">Prev</button>
            <span className="text-caption text-ink-secondary money">{page} / {Math.max(1, totalPages)}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
