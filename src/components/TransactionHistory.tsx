import React, { useState, useMemo, useRef, useId } from 'react';
import { Search, Filter, Download, Upload, Trash2, Edit2, ChevronUp, ChevronDown, Sparkles, CircleSlash, Bookmark, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import EmptyState from './EmptyState';
import { Money, CategoryMark, Badge, Button, Panel } from './ui';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { CATEGORIES, getAllCategories, resolveCategoryId, fallbackCategoryId } from '../utils/categorization';
import { selectable } from '../utils/categoryTree';
import { useGetCategory } from '../context/FinancialContext';
import { exportToCSV, importFromCSV } from '../utils/exportUtils';
import { tagCounts } from '../utils/tags';
import { formatCurrency } from '../utils/calculations';
import { PAGE_SIZE } from '../utils/constants';
import { runAi, taxonomy, aiSupported } from '../ai/ai';
import TransactionEntry from './TransactionEntry';
import ImportPreview from './ImportPreview';
import { useToast } from '../context/ToastContext';
import { getOwedStatus } from '../utils/reimbursements';
import type { IsoDate, Transaction } from '../types/domain';
import { usePersistentState } from '../hooks/usePersistentState';
import {
  EMPTY_FILTERS, applyLedgerFilters, builtInViews, viewFilters, matchesView, savableFilters, activeFilterCount,
  type LedgerFilters, type LedgerView,
} from '../utils/ledgerFilters';
import { canonicaliseTags } from '../utils/tags';

/** The columns the table can sort on. Each one is a key of Transaction. */
type SortField = LedgerFilters['sortField'];

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
  const { toast } = useToast();
  // A parsed CSV waiting for review. Nothing reaches the ledger until confirmed.
  const [pendingImport, setPendingImport] = useState<{ fileName: string; rows: Transaction[] } | null>(null);

  // Remembered between visits and restarts: coming back to the ledger finds it
  // as it was left, rather than reset to everything, newest first.
  const [filters, setFilters] = usePersistentState<LedgerFilters>('ledgerFilters', EMPTY_FILTERS);
  const [showFilters, setShowFilters] = usePersistentState('ledgerShowFilters', false);
  const [page, setPage] = useState(1);
  const setF = (patch: Partial<LedgerFilters>) => { setFilters(f => ({ ...f, ...patch })); setPage(1); };
  const { search, category: filterCategory, from: filterDateFrom, to: filterDateTo, min: filterMinAmt, max: filterMaxAmt, sortField, sortDir } = filters;

  // Rows ticked for a bulk change.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkTag, setBulkTag] = useState('');

  const savedViews: LedgerView[] = state.settings?.savedLedgerViews || [];
  const views = useMemo(
    () => builtInViews(new Date(), fallbackCategoryId(customCategories)),
    [customCategories],
  );
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // AI receipt / statement paste
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteMsg, setPasteMsg] = useState('');

  const filtered = useMemo(() => applyLedgerFilters(transactions, filters), [transactions, filters]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const total = filtered.reduce((s, t) => s + t.amount, 0);

  const handleSort = (field: SortField) => {
    if (sortField === field) setFilters(f => ({ ...f, sortDir: f.sortDir === 'asc' ? 'desc' : 'asc' }));
    else setFilters(f => ({ ...f, sortField: field, sortDir: 'asc' }));
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
      // The importer maps to the built-in ids; follow any the ledger retired.
      const custom = state.customCategories || [];
      if (txs.length === 0) {
        toast(`${file.name} has no rows with an amount to import.`, { type: 'error', duration: 8000 });
      } else {
        setPendingImport({ fileName: file.name, rows: txs.map(t => ({ ...t, category: resolveCategoryId(t.category, custom) })) });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast(`Couldn't import ${file.name}: ${reason}`, { type: 'error', duration: 12000 });
    }
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

  const clearFilters = () => { setFilters(f => ({ ...EMPTY_FILTERS, sortField: f.sortField, sortDir: f.sortDir })); setPage(1); };

  const applyView = (view: LedgerView) => { setFilters(f => viewFilters(view, f)); setPage(1); setSelected(new Set()); };

  const saveView = () => {
    const filtersToSave = savableFilters(filters);
    if (Object.keys(filtersToSave).length === 0) { toast('Set some filters first, then save them as a view.', { type: 'error' }); return; }
    const name = window.prompt('Name this view', '')?.trim();
    if (!name) return;
    const view: LedgerView = { id: `view_${Date.now()}`, name, filters: filtersToSave };
    dispatch({ type: 'UPDATE_SETTINGS', payload: { savedLedgerViews: [...savedViews, view] } });
    toast(`Saved view "${name}"`);
  };

  const deleteView = (view: LedgerView) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { savedLedgerViews: savedViews.filter(v => v.id !== view.id) } });
    toast(`Removed view "${view.name}"`, {
      type: 'neutral',
      action: { label: 'Undo', onClick: () => dispatch({ type: 'UPDATE_SETTINGS', payload: { savedLedgerViews: savedViews } }) },
    });
  };

  // --- Bulk changes. Each is one action and one undo. -------------------------
  const selectedTxs = transactions.filter(t => selected.has(t.id));
  const pageIds = paged.map(t => t.id);
  const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const toggleRow = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const togglePage = () => setSelected(prev => {
    const next = new Set(prev);
    if (allOnPage) pageIds.forEach(id => next.delete(id)); else pageIds.forEach(id => next.add(id));
    return next;
  });
  const selectAllFiltered = () => setSelected(new Set(filtered.map(t => t.id)));

  const bulkUpdate = (change: (t: Transaction) => Transaction, label: string) => {
    const before = selectedTxs;
    if (before.length === 0) return;
    dispatch({ type: 'UPDATE_TRANSACTIONS', payload: before.map(change) });
    toast(`${label} on ${before.length} transaction${before.length === 1 ? '' : 's'}`, {
      type: 'neutral',
      action: { label: 'Undo', onClick: () => dispatch({ type: 'UPDATE_TRANSACTIONS', payload: before }) },
    });
  };

  const bulkSetCategory = () => {
    if (!bulkCategory) return;
    const name = allCategories.find(c => c.id === bulkCategory)?.name ?? bulkCategory;
    bulkUpdate(t => (t.kind === 'savings' ? t : { ...t, category: bulkCategory, subcategory: '' }), `Category set to ${name}`);
    setBulkCategory('');
  };

  const bulkAddTag = () => {
    const raw = bulkTag.trim();
    if (!raw) return;
    const tag = canonicaliseTags([raw], tagCounts(transactions).keys())[0] ?? raw;
    bulkUpdate(t => ({
      ...t,
      tags: (t.tags || []).some(x => x.toLowerCase() === tag.toLowerCase()) ? t.tags : [...(t.tags || []), tag],
    }), `Tagged "${tag}"`);
    setBulkTag('');
  };

  const bulkRemoveTag = (tag: string) => bulkUpdate(t => ({ ...t, tags: (t.tags || []).filter(x => x !== tag) }), `Removed "${tag}"`);

  const bulkOneOff = (value: boolean) => bulkUpdate(t => ({ ...t, isException: value }), value ? 'Marked one-off' : 'Counted in budgets again');

  const bulkDelete = () => {
    const before = selectedTxs;
    if (before.length === 0) return;
    if (before.length > 1 && !window.confirm(`Delete ${before.length} transactions? You can undo this from the toast.`)) return;
    dispatch({ type: 'DELETE_TRANSACTIONS', payload: before.map(t => t.id) });
    setSelected(new Set());
    toast(`Deleted ${before.length} transaction${before.length === 1 ? '' : 's'}`, {
      type: 'neutral',
      action: { label: 'Undo', onClick: () => dispatch({ type: 'IMPORT_TRANSACTIONS', payload: before }) },
    });
  };

  const selectedTags = [...new Set(selectedTxs.flatMap(t => t.tags || []))].sort();
  const filterCount = activeFilterCount(filters);

  return (
    <div className="space-y-2 animate-fade-in">
      {editTx && (
        <TransactionEntry
          isModal
          editTransaction={editTx}
          onClose={() => setEditTx(null)}
          onSaved={() => {
            const before = editTx;
            toast(`Saved ${before.merchant}`, {
              action: { label: 'Undo', onClick: () => dispatch({ type: 'UPDATE_TRANSACTION', payload: before }) },
            });
          }}
        />
      )}

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

      {pendingImport && (
        <ImportPreview
          fileName={pendingImport.fileName}
          rows={pendingImport.rows}
          existing={transactions}
          customCategories={customCategories}
          onClose={() => setPendingImport(null)}
          onConfirm={rows => {
            dispatch({ type: 'IMPORT_TRANSACTIONS', payload: rows });
            setPendingImport(null);
            const skipped = pendingImport.rows.length - rows.length;
            toast(`Imported ${rows.length} transaction${rows.length === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`);
          }}
        />
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
              onChange={e => setF({ search: e.target.value })}
              className={`${INPUT} w-full pl-7`}
            />
          </div>
          <button
            onClick={() => setShowFilters(s => !s)}
            aria-pressed={showFilters}
            className={`${TOOL} ${showFilters ? 'border-accent text-accent-ink bg-accent-tint' : 'border-line-strong text-ink bg-surface hover:bg-surface-hover'}`}
          >
            <Filter className="w-3.5 h-3.5" aria-hidden="true" /> Filters{filterCount > 0 ? ` (${filterCount})` : ''}
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

        <datalist id={`${uid}-tags`}>{[...tagCounts(transactions).keys()].map(t => <option key={t} value={t} />)}</datalist>

        {/* Views: one click to a filter set, built in or saved */}
        <div className="flex flex-wrap items-center gap-1 px-2.5 py-1 border-b border-line">
          <span className="label-micro mr-1">Views</span>
          {[...views, ...savedViews].map(view => {
            const active = matchesView(filters, view);
            const saved = savedViews.includes(view);
            return (
              <span key={view.id} className={`inline-flex items-center h-6 border rounded-control text-caption ${active ? 'border-accent bg-accent-tint text-accent-ink' : 'border-line-strong text-ink-secondary hover:text-ink hover:bg-surface-hover'}`}>
                <button type="button" onClick={() => (active ? clearFilters() : applyView(view))} aria-pressed={active} className="px-2 h-full">
                  {view.name}
                </button>
                {saved && (
                  <button type="button" onClick={() => deleteView(view)} aria-label={`Remove view ${view.name}`} title="Remove this view" className="pr-1.5 h-full text-ink-muted hover:text-negative">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            );
          })}
          {(filterCount > 0 || search) && (
            <button type="button" onClick={clearFilters} className="ml-1 text-caption text-ink-muted hover:text-ink underline underline-offset-2">Show all</button>
          )}
        </div>

        {/* Bulk changes for the ticked rows */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 border-b border-accent bg-accent-tint">
            <span className="text-caption text-accent-ink font-medium mr-1">{selected.size} selected</span>
            {selected.size < filtered.length && (
              <button type="button" onClick={selectAllFiltered} className="text-caption text-accent-ink underline underline-offset-2 mr-1">Select all {filtered.length}</button>
            )}
            <select value={bulkCategory} onChange={e => setBulkCategory(e.target.value)} className={`${INPUT} w-44 h-6`} aria-label="Category for selected">
              <option value="">Set category…</option>
              {selectable(allCategories).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button size="sm" onClick={bulkSetCategory} disabled={!bulkCategory}>Apply</Button>
            <input
              type="text"
              value={bulkTag}
              onChange={e => setBulkTag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') bulkAddTag(); }}
              placeholder="Add tag…"
              list={`${uid}-tags`}
              className={`${INPUT} w-28 h-6`}
              aria-label="Tag to add to selected"
            />
            <Button size="sm" onClick={bulkAddTag} disabled={!bulkTag.trim()}>Tag</Button>
            {selectedTags.length > 0 && (
              <select value="" onChange={e => { if (e.target.value) bulkRemoveTag(e.target.value); }} className={`${INPUT} w-32 h-6`} aria-label="Remove a tag from selected">
                <option value="">Remove tag…</option>
                {selectedTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <Button size="sm" onClick={() => bulkOneOff(true)}>Mark one-off</Button>
            <Button size="sm" onClick={() => bulkOneOff(false)}>Count in budgets</Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={bulkDelete}>Delete</Button>
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-caption text-accent-ink underline underline-offset-2">Clear selection</button>
          </div>
        )}

        {/* Filters: one compact strip under the command row */}
        {showFilters && (
          <div className="flex flex-wrap items-end gap-x-2.5 gap-y-1.5 px-2.5 py-1.5 border-b border-line bg-surface-sunk">
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-cat`}>Category</label>
              <select id={`${uid}-cat`} value={filterCategory} onChange={e => setF({ category: e.target.value })} className={`${INPUT} w-44`}>
                <option value="">All categories</option>
                {/* A filter lists what you can have recorded, minus the retired ones. */}
                {selectable(allCategories).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-from`}>From Date</label>
              <input id={`${uid}-from`} type="date" value={filterDateFrom} onChange={e => setF({ from: e.target.value })} className={`${INPUT} w-36`} />
            </div>
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-to`}>To Date</label>
              <input id={`${uid}-to`} type="date" value={filterDateTo} onChange={e => setF({ to: e.target.value })} className={`${INPUT} w-36`} />
            </div>
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-min`}>Min Amount</label>
              <input id={`${uid}-min`} type="number" placeholder="$0" value={filterMinAmt} onChange={e => setF({ min: e.target.value })} className={`${INPUT} w-24 text-right`} />
            </div>
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-max`}>Max Amount</label>
              <input id={`${uid}-max`} type="number" placeholder="Any" value={filterMaxAmt} onChange={e => setF({ max: e.target.value })} className={`${INPUT} w-24 text-right`} />
            </div>
            <div>
              <label className="label-micro block mb-0.5" htmlFor={`${uid}-tag`}>Tag</label>
              <input id={`${uid}-tag`} type="text" list={`${uid}-tags`} placeholder="Any" value={filters.tag} onChange={e => setF({ tag: e.target.value })} className={`${INPUT} w-28`} />
            </div>
            <label className="inline-flex items-center gap-1.5 h-7 text-caption text-ink-secondary">
              <input type="checkbox" checked={filters.exceptionsOnly} onChange={e => setF({ exceptionsOnly: e.target.checked })} />
              One-offs only
            </label>
            <Button onClick={clearFilters}>Clear Filters</Button>
            <Button icon={Bookmark} onClick={saveView}>Save as view</Button>
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
                <th scope="col" className={`${TH} w-7 pr-0`}>
                  <input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Select every transaction on this page" />
                </th>
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
                <tr><td colSpan={7}>
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
                  <tr key={t.id} className={`hover:bg-surface-hover ${t.isException ? 'opacity-55' : ''} ${selected.has(t.id) ? 'bg-accent-tint' : ''}`}>
                    <td className={`${TD} pr-0`}>
                      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleRow(t.id)} aria-label={`Select ${t.merchant} on ${t.date}`} />
                    </td>
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
