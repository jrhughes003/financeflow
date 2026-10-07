import React, { useState, useMemo, useRef, useId } from 'react';
import { Search, Filter, Download, Upload, Trash2, Edit2, ChevronUp, ChevronDown, Sparkles, CircleSlash } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import EmptyState from './EmptyState';
import { Money, CategoryMark, Badge, Button, Panel } from './ui';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { CATEGORIES, getAllCategories } from '../utils/categorization';
import { selectable } from '../utils/categoryTree';
import { useGetCategory } from '../context/FinancialContext';
import { exportToCSV, importFromCSV } from '../utils/exportUtils';
import { tagCounts } from '../utils/tags';
import { formatCurrency } from '../utils/calculations';
import { PAGE_SIZE } from '../utils/constants';
import { runAi, taxonomy, aiSupported } from '../ai/ai';
import TransactionEntry from './TransactionEntry';
import { getOwedStatus } from '../utils/reimbursements';
import type { IsoDate, Transaction } from '../types/domain';

/** The columns the table can sort on. Each one is a key of Transaction. */
type SortField = 'date' | 'merchant' | 'category' | 'amount';

/**
 * One row from the AI `extract` feature. Nothing validates what comes back,
 * so every field is optional and the mapping below supplies the fallbacks.
 */
interface ExtractedRow {
  date?: IsoDate;
  merchant?: string;
  amount?: number;
  category?: string;
}

// The blotter's shared cell, control and button classes.
const INPUT = 'h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent';
const TH = 'label-micro font-medium h-[22px] py-0 px-2.5 border-b border-line bg-surface-sunk whitespace-nowrap';
const TD = 'h-row py-0 px-2.5 border-b border-line align-middle';
const ROW_ACTION = 'inline-flex items-center justify-center w-6 h-6 rounded-control transition-colors';
// Matches <Button size="sm" variant="secondary">, for the two controls that
// can't be one: a toggle with its own active state, and the file <label>.
const TOOL = 'inline-flex items-center justify-center gap-1.5 h-6 px-2 border rounded-control text-micro font-medium uppercase tracking-[0.05em] whitespace-nowrap transition-colors';

// Status tag for fronted purchases, inline after the merchant.
function OwedBadge({ t }: { t: Transaction }) {
  const s = getOwedStatus(t);
  if (!s) return null;
  const label = s.status === 'settled' ? 'Paid back'
    : s.status === 'forgiven' ? 'Owed · forgiven'
    : `Owed ${formatCurrency(s.remaining)}`;
  return <Badge tone={s.isOpen ? 'positive' : 'neutral'} className="shrink-0 whitespace-nowrap">{label}</Badge>;
}

export default function TransactionHistory() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const importRef = useRef<HTMLInputElement | null>(null);
  const { transactions, customCategories = [] } = state;
  const getCategory = useGetCategory();
  const allCategories = getAllCategories(customCategories);
  const aiEnabled = aiSupported && state.settings?.aiEnabled;
  const uid = useId();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterMinAmt, setFilterMinAmt] = useState('');
  const [filterMaxAmt, setFilterMaxAmt] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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
      let va: string | number = a[sortField], vb: string | number = b[sortField];
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

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const handleDelete = (id: string) => {
    const transaction = transactions.find(t => t.id === id);
    if (transaction) removeItem({ type: 'transaction', item: transaction, label: transaction.merchant });
    setDeleteId(null);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txs = await importFromCSV(file, tagCounts(state.transactions).keys());
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
    // runAi resolves to `unknown` data; the extract feature answers with a
    // transactions array, read defensively because nothing has checked it.
    const rows = (res.data as { transactions?: (ExtractedRow | null)[] } | undefined)?.transactions || [];
    const parsed: Transaction[] = rows.filter((t): t is ExtractedRow => Boolean(t) && (t?.amount ?? 0) > 0).map((t, i) => ({
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

  const SortIcon = ({ field }: { field: SortField }) => sortField === field
    ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-0.5 -mt-px" /> : <ChevronDown className="w-3 h-3 inline ml-0.5 -mt-px" />)
    : null;

  const clearFilters = () => { setFilterCategory(''); setFilterDateFrom(''); setFilterDateTo(''); setFilterMinAmt(''); setFilterMaxAmt(''); setSearch(''); setPage(1); };

  return (
    <div className="space-y-2 animate-fade-in">
      {editTx && <TransactionEntry isModal editTransaction={editTx} onClose={() => setEditTx(null)} />}

      {/* Confirm delete */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--c-canvas)_72%,transparent)] px-4">
          <div className="bg-surface border border-line max-w-sm w-full shadow-overlay">
            <div className="h-bar flex items-center px-2.5 bg-surface-sunk border-b border-line">
              <p className="text-micro uppercase font-semibold text-ink">Delete this transaction?</p>
            </div>
            <p className="font-sans text-sm text-ink-secondary px-3 py-2.5">You can undo this from the toast that appears.</p>
            <div className="flex gap-1.5 px-3 pb-3">
              <Button onClick={() => setDeleteId(null)} className="flex-1">Cancel</Button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 inline-flex items-center justify-center h-7 px-2.5 rounded-control text-caption font-medium uppercase tracking-[0.05em] bg-negative text-ink-inverse hover:opacity-90 transition-opacity">Delete</button>
            </div>
          </div>
        </div>
      )}

      <Panel
        bordered
        title="Ledger"
        meta={<>{filtered.length} TXN · <Money value={total} size="caption" className="text-ink-secondary" /></>}
      >
        {/* Command row: search, filters and the import/export functions */}
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 border-b border-line">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search merchant, notes, tags..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className={`${INPUT} w-full pl-7`}
            />
          </div>
          <button
            onClick={() => setShowFilters(s => !s)}
            aria-pressed={showFilters}
            className={`${TOOL} ${showFilters ? 'border-accent text-accent-ink bg-accent-tint' : 'border-line-strong text-ink bg-surface hover:bg-surface-hover'}`}
          >
            <Filter className="w-3.5 h-3.5" aria-hidden="true" /> Filters
          </button>
          <Button size="sm" icon={Download} onClick={() => exportToCSV(filtered)}>Export</Button>
          <label className={`${TOOL} border-line-strong text-ink bg-surface hover:bg-surface-hover cursor-pointer`}>
            <Upload className="w-3.5 h-3.5" aria-hidden="true" /> Import CSV
            <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          </label>
          {aiEnabled && (
            <Button size="sm" icon={Sparkles} onClick={() => setShowPaste(s => !s)}>Paste receipt</Button>
          )}
        </div>

        {/* Filters: one compact strip under the command row */}
        {showFilters && (
          <div className="flex flex-wrap items-end gap-x-2.5 gap-y-1.5 px-2.5 py-1.5 border-b border-line bg-surface-sunk">
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-cat`}>Category</label>
              <select id={`${uid}-cat`} value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(1); }} className={`${INPUT} w-44`}>
                <option value="">All categories</option>
                {/* A filter lists what you can have recorded, minus the retired ones. */}
                {selectable(allCategories).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-from`}>From Date</label>
              <input id={`${uid}-from`} type="date" value={filterDateFrom} onChange={e => { setFilterDateFrom(e.target.value); setPage(1); }} className={`${INPUT} w-36`} />
            </div>
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-to`}>To Date</label>
              <input id={`${uid}-to`} type="date" value={filterDateTo} onChange={e => { setFilterDateTo(e.target.value); setPage(1); }} className={`${INPUT} w-36`} />
            </div>
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-min`}>Min Amount</label>
              <input id={`${uid}-min`} type="number" placeholder="$0" value={filterMinAmt} onChange={e => { setFilterMinAmt(e.target.value); setPage(1); }} className={`${INPUT} w-24 text-right`} />
            </div>
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-max`}>Max Amount</label>
              <input id={`${uid}-max`} type="number" placeholder="Any" value={filterMaxAmt} onChange={e => { setFilterMaxAmt(e.target.value); setPage(1); }} className={`${INPUT} w-24 text-right`} />
            </div>
            <Button onClick={clearFilters}>Clear Filters</Button>
          </div>
        )}

        {/* AI receipt / statement paste */}
        {aiEnabled && showPaste && (
          <div className="px-2.5 py-2 space-y-1.5 border-b border-line bg-surface-sunk">
            <p className="label-micro">Paste receipt or bank-statement text</p>
            <textarea
              rows={5}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="Paste messy text here — line items, amounts, dates…"
              className="w-full px-2 py-1.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent resize-y"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={handleParsePaste} disabled={pasteBusy || !pasteText.trim()}>
                {pasteBusy ? 'Parsing…' : 'Extract transactions'}
              </Button>
              {pasteMsg && <span className="font-sans text-caption text-negative">{pasteMsg}</span>}
            </div>
            <p className="font-sans text-caption text-ink-muted">The pasted text is sent to Anthropic to extract line items. Review imported items afterward.</p>
          </div>
        )}

        {/* The blotter */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {([['date', 'Date'], ['merchant', 'Merchant'], ['category', 'Category'], ['amount', 'Amount']] as const).map(([field, label]) => (
                  <th
                    key={field}
                    scope="col"
                    onClick={() => handleSort(field)}
                    aria-sort={sortField === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={`${TH} cursor-pointer hover:text-ink select-none ${sortField === field ? 'text-ink' : ''} ${field === 'amount' ? 'text-right' : 'text-left'}`}
                  >
                    {label}<SortIcon field={field} />
                  </th>
                ))}
                <th scope="col" className={`${TH} text-left`}>Tags</th>
                <th scope="col" className={`${TH} text-right w-[84px]`}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 && (
                <tr><td colSpan={6}>
                  {transactions.length === 0 ? (
                    <EmptyState
                      compact
                      title="No transactions yet"
                      description="Import a CSV from your bank, or add one by hand. Everything else in the app — budgets, trends, forecasts — builds on this ledger."
                      actionLabel="Import a CSV"
                      onAction={() => importRef.current?.click()}
                      secondary="No data to hand? Settings → Load demo data fills the app with a realistic example."
                    />
                  ) : (
                    <p className="font-sans px-3 py-6 text-center text-ink-muted text-sm">No transactions match these filters.</p>
                  )}
                </td></tr>
              )}
              {paged.map(t => {
                const cat = getCategory(t.category);
                return (
                  <tr key={t.id} className={`hover:bg-surface-hover ${t.isException ? 'opacity-55' : ''}`}>
                    <td className={`${TD} text-ink-muted whitespace-nowrap text-caption`}>{format(parseISO(t.date), 'dd MMM yyyy').toUpperCase()}</td>
                    <td className={`${TD} max-w-0 w-full min-w-[10rem]`}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-ink truncate">{t.merchant}</span>
                        {t.subcategory && <span className="text-ink-muted text-caption truncate">· {t.subcategory}</span>}
                        {t.isException && <span className="text-ink-muted text-caption whitespace-nowrap">· one-off</span>}
                        <OwedBadge t={t} />
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <CategoryMark color={cat.color} name={cat.name} className="text-ink-secondary text-caption" />
                    </td>
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      {t.kind === 'savings'
                        ? <Money value={t.amount} size="sm" signed className="text-positive" />
                        : <Money value={-t.amount} size="sm" />}
                    </td>
                    <td className={TD}>
                      <div className="flex gap-1 whitespace-nowrap">
                        {(t.tags || []).map(tag => (
                          <span key={tag} className="px-1 border border-line text-ink-muted text-[10px] leading-[14px]">{tag}</span>
                        ))}
                      </div>
                    </td>
                    <td className={`${TD} pr-1.5`}>
                      <div className="flex items-center justify-end gap-px">
                        <button
                          onClick={() => dispatch({ type: 'MARK_EXCEPTION', payload: t.id })}
                          title={t.isException
                            ? 'Counted as a one-off — click to include it in budgets again'
                            : 'Mark as a one-off so it stays out of budgets and averages'}
                          aria-label={t.isException ? 'Include in budgets' : 'Mark as one-off'}
                          aria-pressed={Boolean(t.isException)}
                          className={`${ROW_ACTION} ${t.isException
                            ? 'text-accent-ink bg-accent-tint'
                            : 'text-ink-muted hover:text-ink hover:bg-surface-hover'}`}
                        >
                          <CircleSlash className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditTx(t)} aria-label={`Edit ${t.merchant}`} title="Edit" className={`${ROW_ACTION} text-ink-muted hover:text-ink hover:bg-surface-hover`}><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setDeleteId(t.id)} aria-label={`Delete ${t.merchant}`} title="Delete" className={`${ROW_ACTION} text-ink-muted hover:text-negative hover:bg-negative-tint`}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination & total */}
        <div className="h-bar px-2.5 flex items-center justify-between gap-2 bg-surface-sunk">
          <span className="text-caption text-ink-secondary whitespace-nowrap">{filtered.length} transactions · <Money value={total} size="caption" className="text-ink font-medium" /></span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
            <span className="text-caption text-ink-secondary money">{page} / {Math.max(1, totalPages)}</span>
            <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
