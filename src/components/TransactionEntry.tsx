import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Zap, Plus, Sparkles, HandCoins } from 'lucide-react';
import { format } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import { getAllCategories, autoCategorize } from '../utils/categorization';
import { runAi, taxonomy, aiSupported } from '../ai/ai';
import { train, classify } from '../utils/ml/categorizer';
import { owedFromSplit, getOwedStatus, buildOwed } from '../utils/reimbursements';
import { formatCurrency } from '../utils/calculations';
import type { Category, IsoDate, Transaction, TransactionKind } from '../types/domain';

/**
 * The entry form. Every number is the text in its input until it is saved:
 * `amount` is parsed and `tags` split on submit.
 */
interface EntryForm {
  date: IsoDate;
  merchant: string;
  amount: string;
  category: string;
  subcategory: string;
  notes: string;
  tags: string;
  isException: boolean;
  kind: TransactionKind;
  goalId: string;
}

/** The fields validate() can reject, each with the message to show. */
type FormErrors = Partial<Record<'amount' | 'merchant' | 'category' | 'goalId' | 'owed', string>>;

/**
 * What the AI `parse_entry` feature fills in. Nothing validates the reply, so
 * every field is optional and the merge below falls back to what is typed.
 */
interface ParsedEntry {
  date?: IsoDate;
  merchant?: string;
  amount?: number;
  category?: string;
}

const EMPTY_FORM: EntryForm = {
  date: format(new Date(), 'yyyy-MM-dd'),
  merchant: '',
  amount: '',
  category: '',
  subcategory: '',
  notes: '',
  tags: '',
  isException: false,
  kind: 'expense',
  goalId: '',
};

const PRESET_COLORS = ['var(--c-data-2)','var(--c-positive)','var(--c-data-1)','var(--c-data-5)','var(--c-caution)','var(--c-data-7)','var(--c-data-6)','var(--c-data-3)','var(--c-negative)','var(--c-data-6)'];

export default function TransactionEntry({ isModal = false, onClose, editTransaction = null }: {
  isModal?: boolean;
  onClose?: () => void;
  editTransaction?: Transaction | null;
}) {
  const { state, dispatch } = useFinancial();
  const customCategories = state.customCategories || [];
  const savingsGoals = state.savings_goals || [];
  const allCategories = getAllCategories(customCategories);

  const [form, setForm] = useState<EntryForm>(editTransaction
    ? { ...EMPTY_FORM, ...editTransaction, tags: (editTransaction.tags || []).join(', '), amount: String(editTransaction.amount) }
    : EMPTY_FORM
  );
  const isSavings = form.kind === 'savings';
  const [suggestion, setSuggestion] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  // "They owe me" — fronted purchases. Kept out of `form` so these UI fields
  // never leak onto the saved transaction; the saved shape is `owed` only.
  const existingOwed = editTransaction?.owed;
  const existingStatus = editTransaction ? getOwedStatus(editTransaction) : null;
  const [owedEnabled, setOwedEnabled] = useState(!!existingStatus);
  const [owedMode, setOwedMode] = useState<'exact' | 'split'>(existingOwed && !existingOwed.people ? 'exact' : 'split');
  const [owedPeople, setOwedPeople] = useState(String(existingOwed?.people || 2));
  const [owedExact, setOwedExact] = useState(existingOwed && !existingOwed.people ? String(existingOwed.amount) : '');
  const owedValue = owedMode === 'split'
    ? owedFromSplit(parseFloat(form.amount), parseInt(owedPeople, 10))
    : Math.round((parseFloat(owedExact) || 0) * 100) / 100;

  // Natural-language entry (AI). Off unless the desktop app has AI enabled.
  const aiEnabled = aiSupported && (state.settings?.aiEnabled);
  const [nlText, setNlText] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [nlError, setNlError] = useState('');

  const parseNaturalLanguage = async () => {
    if (!nlText.trim()) return;
    setNlBusy(true); setNlError('');
    const res = await runAi('parse_entry', {
      text: nlText.trim(),
      today: format(new Date(), 'yyyy-MM-dd'),
      categories: taxonomy(customCategories),
    });
    setNlBusy(false);
    if (res.ok && res.data) {
      // runAi resolves to `unknown` data; parse_entry answers with these four
      // fields, read defensively because nothing has checked the reply.
      const d = res.data as ParsedEntry;
      setForm(f => ({
        ...f,
        kind: 'expense',
        date: d.date || f.date,
        merchant: d.merchant || f.merchant,
        amount: d.amount != null ? String(d.amount) : f.amount,
        category: d.category || f.category,
      }));
      setNlText('');
    } else {
      // This branch is also reached on ok-but-empty, where there is no error
      // to read; that falls through to the generic message exactly as before.
      setNlError(!res.ok && res.error === 'no_key' ? 'Add an API key in Settings first.' : 'Could not parse that — enter manually.');
    }
  };

  // New category creation state
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6366f1');

  const amountRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (amountRef.current) amountRef.current.focus(); }, []);

  // Learned merchant→category memory (from past user choices), kept in settings.
  const hints = state.settings?.merchantCategoryHints || {};
  const hintKey = (m: string | undefined): string => (m || '').toLowerCase().trim();

  const handleMerchantChange = (val: string) => {
    setForm(f => ({ ...f, merchant: val }));
    if (val.length >= 3) {
      // 1) a learned correction wins, 2) then the keyword matcher.
      const learned = hints[hintKey(val)];
      const suggested = learned || autoCategorize(val, customCategories);
      setSuggestion(suggested && suggested !== 'products' ? suggested : '');
    } else {
      setSuggestion('');
    }
  };

  // Three sources, cheapest first. Keywords handle the merchants someone wrote
  // a rule for. The local classifier handles the ones this ledger has seen —
  // the corner shop, the gym — which no keyword list would contain; it costs
  // nothing, works offline, and needs no API key. Only when neither has an
  // answer is it worth a network round trip.
  //
  // Measured on the demo ledger: where keywords fall back, the classifier is
  // right about three times in four (n=8), against zero for keywords. On a
  // merchant nobody has ever seen it is worse than keywords, which is why it
  // never overrides them.
  const localModel = useMemo(() => train(state.transactions), [state.transactions]);

  const categorizeOnBlur = async () => {
    if (isSavings) return;
    if (form.category || suggestion || form.merchant.trim().length < 3) return;
    if (autoCategorize(form.merchant, customCategories) !== 'products') return; // keywords handled it

    const local = classify(localModel, form.merchant.trim());
    if (local?.confident && local.category !== 'products') {
      setSuggestion(local.category);
      return;
    }

    if (!aiEnabled) return;
    const res = await runAi('categorize', { merchant: form.merchant.trim(), categories: taxonomy(customCategories) });
    if (!res.ok) return;
    // Same as above: the reply is `unknown`, and only its category is used.
    const suggested = (res.data as { category?: string } | undefined)?.category;
    if (suggested && suggested !== 'products') {
      setSuggestion(suggested);
    }
  };

  const applySuggestion = () => {
    setForm(f => ({ ...f, category: suggestion, subcategory: '' }));
    setSuggestion('');
  };

  const handleCreateCategory = () => {
    if (!newCatName.trim()) return;
    const id = newCatName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const newCat: Category = {
      id,
      name: newCatName.trim(),
      color: newCatColor,
      icon: 'Tag',
      subcategories: [],
      keywords: [],
    };
    dispatch({ type: 'ADD_CATEGORY', payload: newCat });
    setForm(f => ({ ...f, category: id, subcategory: '' }));
    setShowNewCat(false);
    setNewCatName('');
  };

  const validate = () => {
    const e: FormErrors = {};
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) e.amount = 'Enter a valid amount';
    if (isSavings) {
      if (!form.goalId) e.goalId = 'Choose a goal to contribute to';
    } else {
      if (!form.merchant.trim()) e.merchant = 'Merchant is required';
      if (!form.category) e.category = 'Select a category';
      if (owedEnabled) {
        if (owedMode === 'split' && !(parseInt(owedPeople, 10) >= 2)) e.owed = 'Split between at least 2 people';
        else if (owedValue <= 0) e.owed = 'Enter how much you are owed';
        else if (owedValue > parseFloat(form.amount)) e.owed = "Can't be owed more than the purchase amount";
        else if (existingStatus && owedValue < existingStatus.repaid) e.owed = `${formatCurrency(existingStatus.repaid)} has already been paid back — owed can't be less`;
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!validate()) return;
    const goal = savingsGoals.find(g => g.id === form.goalId);
    const txData: Transaction = {
      ...form,
      id: editTransaction ? editTransaction.id : `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      amount: parseFloat(form.amount),
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      // Savings contributions get a fixed category + a merchant fallback so they
      // read sensibly in the ledger; goalId links them to a goal for progress.
      ...(isSavings ? {
        category: 'savings',
        subcategory: '',
        merchant: form.merchant.trim() || (goal ? `Savings → ${goal.name}` : 'Savings'),
      } : { goalId: '' }),
    };
    const owed = isSavings ? undefined : buildOwed(existingOwed, {
      enabled: owedEnabled,
      amount: owedValue,
      // buildOwed coerces with Number(); passing it the same way keeps the
      // "2.5 people" and "not a number" cases behaving as they did.
      people: owedMode === 'split' ? Number(owedPeople) : null,
    });
    if (owed) txData.owed = owed;
    else delete txData.owed;
    dispatch({ type: editTransaction ? 'UPDATE_TRANSACTION' : 'ADD_TRANSACTION', payload: txData });
    // Learn the merchant→category mapping so future entries (and the AI fallback)
    // benefit from this correction. Local only — never sent anywhere.
    if (!isSavings && txData.merchant && txData.category) {
      dispatch({ type: 'UPDATE_SETTINGS', payload: { merchantCategoryHints: { ...hints, [hintKey(txData.merchant)]: txData.category } } });
    }
    if (isModal && onClose) onClose();
    else {
      setForm(EMPTY_FORM);
      setOwedEnabled(false);
      setOwedExact('');
      setOwedPeople('2');
    }
  };

  const selectedCat = allCategories.find(c => c.id === form.category);

  const content = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Natural-language entry (AI) */}
      {aiEnabled && !editTransaction && (
        <div className="bg-surface-sunk border border-line-strong rounded-container p-3">
          <label className="flex items-center gap-1.5 text-caption font-semibold text-ink-secondary mb-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Describe it in words
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={nlText}
              onChange={e => setNlText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); parseNaturalLanguage(); } }}
              placeholder="e.g. spent $40 on gas at Esso yesterday"
              className="flex-1 h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
            />
            <button type="button" onClick={parseNaturalLanguage} disabled={nlBusy || !nlText.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">
              {nlBusy ? '…' : 'Fill'}
            </button>
          </div>
          {nlError && <p className="text-caption text-negative mt-1">{nlError}</p>}
        </div>
      )}

      {/* Type toggle: expense vs savings contribution */}
      {savingsGoals.length > 0 && (
        <div className="flex gap-2 p-1 bg-surface-hover rounded-container">
          {([['expense', 'Expense'], ['savings', 'Savings']] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => { setForm(f => ({ ...f, kind: val })); setErrors({}); }}
              className={`flex-1 py-2 rounded-control text-sm font-medium transition-colors ${form.kind === val ? 'bg-surface  text-accent' : 'text-ink-muted hover:text-ink-secondary'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="label-micro block mb-1.5">Amount</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-ink-muted">$</span>
          <input
            ref={amountRef}
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            className={`w-full pl-10 pr-4 py-4 text-2xl font-bold border-2 rounded-container focus:outline-none focus:border-accent transition-colors ${errors.amount ? 'border-negative' : 'border-line-strong'}`}
          />
        </div>
        {errors.amount && <p className="text-caption text-negative mt-1">{errors.amount}</p>}
      </div>

      {/* Fronted for others */}
      {!isSavings && (
        <div className={`rounded-container border-2 transition-colors ${owedEnabled ? 'border-positive bg-positive-tint/50' : 'border-line'}`}>
          <label className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={owedEnabled}
              onChange={e => { setOwedEnabled(e.target.checked); setErrors(er => ({ ...er, owed: undefined })); }}
              className="w-4 h-4 rounded-[3px] border-line-strong text-accent focus:ring-accent"
            />
            <HandCoins className="w-4 h-4 text-positive" />
            <span className="text-sm text-ink-secondary font-medium">I paid for others — they owe me back</span>
          </label>
          {owedEnabled && (
            <div className="px-3 pb-3 space-y-2">
              <div className="flex gap-1 p-1 bg-surface rounded-control border border-line-strong text-caption font-medium">
                {([['split', 'Split evenly'], ['exact', 'Exact amount']] as const).map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setOwedMode(val)}
                    className={`flex-1 py-1.5 rounded-control transition-colors ${owedMode === val ? 'bg-positive text-ink-inverse' : 'text-ink-muted hover:text-ink-secondary'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {owedMode === 'split' ? (
                <div className="flex items-center gap-2 text-sm text-ink-secondary">
                  <span>Split between</span>
                  <input type="number" min="2" step="1" value={owedPeople} onChange={e => setOwedPeople(e.target.value)}
                    className="w-16 h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
                  <span>people, including you</span>
                </div>
              ) : (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">$</span>
                  <input type="number" min="0" step="0.01" placeholder="Amount owed to you" value={owedExact} onChange={e => setOwedExact(e.target.value)}
                    className="w-full h-9 pl-7 pr-3 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
                </div>
              )}
              {owedValue > 0 && parseFloat(form.amount) > 0 && (
                <p className="text-caption text-ink-secondary">
                  You're owed <span className="font-semibold text-positive">{formatCurrency(owedValue)}</span>
                  {' '}· your share {formatCurrency(Math.max(0, parseFloat(form.amount) - owedValue))}.
                  {' '}The full amount counts as spending until you're paid back.
                </p>
              )}
              {existingStatus && existingStatus.repaid > 0 && (
                <p className="text-caption text-ink-muted">{formatCurrency(existingStatus.repaid)} already paid back — record more on the Owed to Me page.</p>
              )}
              {errors.owed && <p className="text-caption text-negative">{errors.owed}</p>}
            </div>
          )}
        </div>
      )}

      {/* Savings goal selector (savings mode only) */}
      {isSavings && (
        <div>
          <label className="label-micro block mb-1.5">Contribute to Goal</label>
          <select
            value={form.goalId}
            onChange={e => setForm(f => ({ ...f, goalId: e.target.value }))}
            className={`w-full px-3 py-3 border-2 rounded-container focus:outline-none focus:border-accent transition-colors bg-surface ${errors.goalId ? 'border-negative' : 'border-line-strong'}`}
          >
            <option value="">Select a goal...</option>
            {savingsGoals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {errors.goalId && <p className="text-caption text-negative mt-1">{errors.goalId}</p>}
          <p className="text-micro text-ink-muted mt-1">Adds to the goal's progress; excluded from category spending.</p>
        </div>
      )}

      {/* Merchant */}
      {!isSavings && (
      <div>
        <label className="label-micro block mb-1.5">Merchant / Description</label>
        <input
          type="text"
          placeholder="e.g. Uber Eats, Metro, Esso..."
          value={form.merchant}
          onChange={e => handleMerchantChange(e.target.value)}
          onBlur={categorizeOnBlur}
          className={`w-full px-4 py-3 border-2 rounded-container focus:outline-none focus:border-accent transition-colors ${errors.merchant ? 'border-negative' : 'border-line-strong'}`}
        />
        {errors.merchant && <p className="text-caption text-negative mt-1">{errors.merchant}</p>}
        {suggestion && (
          <button type="button" onClick={applySuggestion} className="mt-1.5 flex items-center gap-1.5 text-caption text-accent hover:text-accent-ink bg-accent-tint px-2.5 py-1.5 rounded-control">
            <Zap className="w-3 h-3" />
            Auto-categorize as "{allCategories.find(c => c.id === suggestion)?.name}"
          </button>
        )}
      </div>
      )}

      {/* Date */}
      <div>
        <label className="label-micro block mb-1.5">Date</label>
        <input
          type="date"
          value={form.date}
          onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
          className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
        />
      </div>

      {/* Category */}
      {!isSavings && (
      <div>
        <label className="label-micro block mb-1.5">Category</label>
        <div className="flex gap-2">
          <select
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value, subcategory: '' }))}
            className={`flex-1 px-3 py-3 border-2 rounded-container focus:outline-none focus:border-accent transition-colors bg-surface ${errors.category ? 'border-negative' : 'border-line-strong'}`}
          >
            <option value="">Select category...</option>
            {allCategories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowNewCat(s => !s)}
            title="Create new category"
            className="h-9 px-3 border border-dashed border-line-strong rounded-control text-sm text-ink-muted hover:border-accent hover:text-accent transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {errors.category && <p className="text-caption text-negative mt-1">{errors.category}</p>}

        {/* Inline new category form */}
        {showNewCat && (
          <div className="mt-2 p-3 bg-accent-tint border border-accent rounded-container space-y-2">
            <p className="text-caption font-semibold text-accent-ink">New Category</p>
            <input
              type="text"
              placeholder="Category name..."
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleCreateCategory())}
              className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setNewCatColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${newCatColor === c ? 'border-line-strong scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={handleCreateCategory} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption bg-accent hover:bg-accent-hover text-ink-inverse">Create</button>
              <button type="button" onClick={() => { setShowNewCat(false); setNewCatName(''); }} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Subcategory */}
      {!isSavings && selectedCat && selectedCat.subcategories?.length > 0 && (
        <div>
          <label className="label-micro block mb-1.5">Subcategory</label>
          <select
            value={form.subcategory}
            onChange={e => setForm(f => ({ ...f, subcategory: e.target.value }))}
            className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
          >
            <option value="">None</option>
            {selectedCat.subcategories.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {/* Tags */}
      <div>
        <label className="label-micro block mb-1.5">Tags (comma-separated)</label>
        <input
          type="text"
          placeholder="rbc, td, one-time..."
          value={form.tags}
          onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
          className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
        />
      </div>

      {/* Notes */}
      <div>
        <button type="button" onClick={() => setShowNotes(s => !s)} className="text-caption text-accent hover:text-accent-ink font-medium">
          {showNotes ? '– Hide Notes' : '+ Add Notes'}
        </button>
        {showNotes && (
          <textarea
            rows={2}
            placeholder="Optional notes..."
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="mt-2 w-full px-2.5 py-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent resize-y"
          />
        )}
      </div>

      {/* Exception */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.isException}
          onChange={e => setForm(f => ({ ...f, isException: e.target.checked }))}
          className="w-4 h-4 rounded-[3px] border-line-strong text-accent focus:ring-accent"
        />
        <span className="text-sm text-ink-secondary">Mark as exception (exclude from budget)</span>
      </label>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        {isModal && (
          <button type="button" onClick={onClose} className="flex-1 inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-10 px-4 text-sm border border-line-strong text-ink hover:bg-surface-hover">
            Cancel
          </button>
        )}
        <button type="submit" className="flex-1 inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-10 px-4 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">
          {editTransaction ? 'Save Changes' : 'Add Transaction'}
        </button>
      </div>
    </form>
  );

  if (!isModal) {
    return (
      <div className="max-w-lg mx-auto">
        <h2 className="text-xl font-bold text-ink mb-6">Add Transaction</h2>
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-ink/25 animate-fade-in">
      <div className="bg-surface w-full sm:max-w-md sm:rounded-container rounded-t-2xl shadow-overlay max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-line">
          <h2 className="text-lg font-bold text-ink">{editTransaction ? 'Edit Transaction' : 'Add Transaction'}</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink-secondary"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5">{content}</div>
      </div>
    </div>
  );
}
