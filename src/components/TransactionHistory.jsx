import React, { useState, useMemo, useRef } from 'react';
import { Search, Filter, Download, Upload, Trash2, Edit2, ChevronUp, ChevronDown, Sparkles , CircleSlash , Receipt } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { CATEGORIES, getAllCategories, getCategoryById } from '../utils/categorization';
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
  const cls = s.isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500';
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-6 max-w-sm mx-4 shadow-xl">
            <p className="text-base font-semibold text-gray-900 mb-2">Delete this transaction?</p>
            <p className="text-sm text-gray-500 mb-4">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Search & actions bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search merchant, notes, tags..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <button onClick={() => setShowFilters(s => !s)} className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-sm font-medium transition-colors ${showFilters ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          <Filter className="w-4 h-4" /> Filters
        </button>
        <button onClick={() => exportToCSV(filtered)} className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
          <Download className="w-4 h-4" /> Export
        </button>
        <label className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 cursor-pointer">
          <Upload className="w-4 h-4" /> Import CSV
          <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
        </label>
        {aiEnabled && (
          <button onClick={() => setShowPaste(s => !s)} className="flex items-center gap-2 px-3 py-2.5 border border-purple-200 text-purple-600 rounded-xl text-sm font-medium hover:bg-purple-50">
            <Sparkles className="w-4 h-4" /> Paste receipt
          </button>
        )}
      </div>

      {/* AI receipt / statement paste panel */}
      {aiEnabled && showPaste && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-purple-800">Paste receipt or bank-statement text</p>
          <textarea
            rows={5}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="Paste messy text here — line items, amounts, dates…"
            className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm bg-white focus:outline-none focus:border-purple-500 resize-y"
          />
          <div className="flex items-center gap-2">
            <button onClick={handleParsePaste} disabled={pasteBusy || !pasteText.trim()} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
              {pasteBusy ? 'Parsing…' : 'Extract transactions'}
            </button>
            {pasteMsg && <span className="text-xs text-red-500">{pasteMsg}</span>}
          </div>
          <p className="text-[11px] text-purple-400">The pasted text is sent to Anthropic to extract line items. Review imported items afterward.</p>
        </div>
      )}

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
            <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(1); }} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500">
              <option value="">All categories</option>
              {allCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input type="date" value={filterDateFrom} onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input type="date" value={filterDateTo} onChange={e => { setFilterDateTo(e.target.value); setPage(1); }} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Min Amount</label>
            <input type="number" placeholder="$0" value={filterMinAmt} onChange={e => { setFilterMinAmt(e.target.value); setPage(1); }} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Max Amount</label>
            <input type="number" placeholder="Any" value={filterMaxAmt} onChange={e => { setFilterMaxAmt(e.target.value); setPage(1); }} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div className="flex items-end">
            <button onClick={() => { setFilterCategory(''); setFilterDateFrom(''); setFilterDateTo(''); setFilterMinAmt(''); setFilterMaxAmt(''); setSearch(''); setPage(1); }} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-white">Clear Filters</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {[['date','Date'],['merchant','Merchant'],['category','Category'],['amount','Amount']].map(([field, label]) => (
                  <th key={field} onClick={() => handleSort(field)} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none">
                    {label}<SortIcon field={field} />
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Tags</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
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
                    <p className="px-4 py-8 text-center text-gray-400 text-sm">No transactions match these filters.</p>
                  )}
                </td></tr>
              )}
              {paged.map(t => {
                const cat = getCategory(t.category);
                return (
                  <tr key={t.id} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${t.isException ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{format(parseISO(t.date), 'MMM d, yyyy')}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{t.merchant}</p>
                      {t.subcategory && <p className="text-xs text-gray-400">{t.subcategory}</p>}
                      {t.isException && <span className="text-xs text-purple-500 font-medium">Exception</span>}
                      <OwedBadge t={t} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: cat.color + '20', color: cat.color }}>
                        {cat.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap">{formatCurrency(t.amount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(t.tags || []).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{tag}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => dispatch({ type: 'MARK_EXCEPTION', payload: t.id })}
                          title={t.isException
                            ? 'Counted as a one-off — click to include it in budgets again'
                            : 'Mark as a one-off so it stays out of budgets and averages'}
                          aria-label={t.isException ? 'Include in budgets' : 'Mark as one-off'}
                          aria-pressed={Boolean(t.isException)}
                          className={`p-1.5 rounded transition-colors ${t.isException
                            ? 'text-purple-600 bg-purple-50 hover:bg-purple-100'
                            : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50'}`}
                        >
                          <CircleSlash className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditTx(t)} className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded hover:bg-blue-50"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setDeleteId(t.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination & total */}
        <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 bg-gray-50">
          <span className="text-sm text-gray-500">{filtered.length} transactions · Total: <strong>{formatCurrency(total)}</strong></span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white">Prev</button>
            <span className="text-sm text-gray-600">{page} / {Math.max(1, totalPages)}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
