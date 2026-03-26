import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { useFinancial, useGetCategory } from '../context/FinancialContext';
import { CATEGORIES, getAllCategories, autoCategorize } from '../utils/categorization';

const EMPTY_FORM = {
  date: format(new Date(), 'yyyy-MM-dd'),
  merchant: '',
  amount: '',
  category: '',
  subcategory: '',
  notes: '',
  tags: '',
  isException: false,
};

const PRESET_COLORS = ['#f97316','#22c55e','#3b82f6','#8b5cf6','#f59e0b','#ec4899','#10b981','#0ea5e9','#ef4444','#84cc16'];

export default function TransactionEntry({ isModal = false, onClose, editTransaction = null }) {
  const { state, dispatch } = useFinancial();
  const customCategories = state.customCategories || [];
  const allCategories = getAllCategories(customCategories);

  const [form, setForm] = useState(editTransaction
    ? { ...editTransaction, tags: (editTransaction.tags || []).join(', '), amount: String(editTransaction.amount) }
    : EMPTY_FORM
  );
  const [suggestion, setSuggestion] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [errors, setErrors] = useState({});

  // New category creation state
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6366f1');

  const amountRef = useRef(null);
  useEffect(() => { if (amountRef.current) amountRef.current.focus(); }, []);

  const handleMerchantChange = (val) => {
    setForm(f => ({ ...f, merchant: val }));
    if (val.length >= 3) {
      const suggested = autoCategorize(val, customCategories);
      setSuggestion(suggested !== 'products' ? suggested : '');
    } else {
      setSuggestion('');
    }
  };

  const applySuggestion = () => {
    setForm(f => ({ ...f, category: suggestion, subcategory: '' }));
    setSuggestion('');
  };

  const handleCreateCategory = () => {
    if (!newCatName.trim()) return;
    const id = newCatName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const newCat = {
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
    const e = {};
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) e.amount = 'Enter a valid amount';
    if (!form.merchant.trim()) e.merchant = 'Merchant is required';
    if (!form.category) e.category = 'Select a category';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    const txData = {
      ...form,
      id: editTransaction ? editTransaction.id : `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      amount: parseFloat(form.amount),
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    };
    dispatch({ type: editTransaction ? 'UPDATE_TRANSACTION' : 'ADD_TRANSACTION', payload: txData });
    if (isModal && onClose) onClose();
    else setForm(EMPTY_FORM);
  };

  const selectedCat = allCategories.find(c => c.id === form.category);

  const content = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Amount */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Amount</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-400">$</span>
          <input
            ref={amountRef}
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            className={`w-full pl-10 pr-4 py-4 text-2xl font-bold border-2 rounded-xl focus:outline-none focus:border-blue-500 transition-colors ${errors.amount ? 'border-red-400' : 'border-gray-200'}`}
          />
        </div>
        {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount}</p>}
      </div>

      {/* Merchant */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Merchant / Description</label>
        <input
          type="text"
          placeholder="e.g. Uber Eats, Metro, Esso..."
          value={form.merchant}
          onChange={e => handleMerchantChange(e.target.value)}
          className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:border-blue-500 transition-colors ${errors.merchant ? 'border-red-400' : 'border-gray-200'}`}
        />
        {errors.merchant && <p className="text-xs text-red-500 mt-1">{errors.merchant}</p>}
        {suggestion && (
          <button type="button" onClick={applySuggestion} className="mt-1.5 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-lg">
            <Zap className="w-3 h-3" />
            Auto-categorize as "{allCategories.find(c => c.id === suggestion)?.name}"
          </button>
        )}
      </div>

      {/* Date */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Date</label>
        <input
          type="date"
          value={form.date}
          onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>

      {/* Category */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Category</label>
        <div className="flex gap-2">
          <select
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value, subcategory: '' }))}
            className={`flex-1 px-3 py-3 border-2 rounded-xl focus:outline-none focus:border-blue-500 transition-colors bg-white ${errors.category ? 'border-red-400' : 'border-gray-200'}`}
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
            className="px-3 py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category}</p>}

        {/* Inline new category form */}
        {showNewCat && (
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
            <p className="text-xs font-semibold text-blue-800">New Category</p>
            <input
              type="text"
              placeholder="Category name..."
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleCreateCategory())}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setNewCatColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${newCatColor === c ? 'border-gray-700 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={handleCreateCategory} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg font-medium">Create</button>
              <button type="button" onClick={() => { setShowNewCat(false); setNewCatName(''); }} className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded-lg hover:bg-white">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Subcategory */}
      {selectedCat && selectedCat.subcategories?.length > 0 && (
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Subcategory</label>
          <select
            value={form.subcategory}
            onChange={e => setForm(f => ({ ...f, subcategory: e.target.value }))}
            className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 transition-colors bg-white"
          >
            <option value="">None</option>
            {selectedCat.subcategories.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {/* Tags */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Tags (comma-separated)</label>
        <input
          type="text"
          placeholder="rbc, td, one-time..."
          value={form.tags}
          onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>

      {/* Notes */}
      <div>
        <button type="button" onClick={() => setShowNotes(s => !s)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
          {showNotes ? '– Hide Notes' : '+ Add Notes'}
        </button>
        {showNotes && (
          <textarea
            rows={2}
            placeholder="Optional notes..."
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="mt-2 w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 transition-colors resize-none"
          />
        )}
      </div>

      {/* Exception */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.isException}
          onChange={e => setForm(f => ({ ...f, isException: e.target.checked }))}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-600">Mark as exception (exclude from budget)</span>
      </label>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        {isModal && (
          <button type="button" onClick={onClose} className="flex-1 py-3 border-2 border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-50 transition-colors">
            Cancel
          </button>
        )}
        <button type="submit" className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors">
          {editTransaction ? 'Save Changes' : 'Add Transaction'}
        </button>
      </div>
    </form>
  );

  if (!isModal) {
    return (
      <div className="max-w-lg mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Add Transaction</h2>
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 animate-fade-in">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{editTransaction ? 'Edit Transaction' : 'Add Transaction'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5">{content}</div>
      </div>
    </div>
  );
}
