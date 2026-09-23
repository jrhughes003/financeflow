import React, { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, Lightbulb, Tag } from 'lucide-react';
import { useFinancial, useGetCategory } from '../context/FinancialContext';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { CATEGORIES, getAllCategories } from '../utils/categorization';
import { getSpendingByCategory, getMonthlyTrend, getBudgetStatus, formatCurrency } from '../utils/calculations';
import { format } from 'date-fns';

const PRESET_COLORS = ['#f97316','#22c55e','#3b82f6','#8b5cf6','#f59e0b','#ec4899','#10b981','#0ea5e9','#ef4444','#84cc16'];

function BudgetRow({ budget, spending, carry = 0, effectiveBudget, onEdit, onDelete, getCategory }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ amount: budget.amount, flex: budget.flex || 0, rollover: budget.rollover || false });
  const cat = getCategory(budget.category);
  // Measure usage against the rollover-adjusted limit when rollover is on.
  const limit = budget.rollover ? (effectiveBudget ?? budget.amount) : budget.amount;
  const pct = limit > 0 ? Math.min((spending / limit) * 100, 120) : 0;
  const status = pct > 100 + (budget.flex || 0) ? 'danger' : pct >= 80 ? 'warning' : 'good';
  const barColor = status === 'danger' ? '#ef4444' : status === 'warning' ? '#f59e0b' : '#22c55e';

  const save = () => {
    onEdit({ ...budget, amount: parseFloat(form.amount) || 0, flex: parseFloat(form.flex) || 0, rollover: form.rollover });
    setEditing(false);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
          <span className="font-semibold text-gray-800 text-sm">{cat.name}</span>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setEditing(e => !e)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(budget)} aria-label={`Delete ${cat?.name || budget.category} budget`} title="Delete budget" className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500 w-20 shrink-0">Budget</label>
            <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" placeholder="0.00" />
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500 w-20 shrink-0">Flex %</label>
            <input type="number" min="0" max="50" value={form.flex} onChange={e => setForm(f => ({ ...f, flex: e.target.value }))} className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" placeholder="0" />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={form.rollover} onChange={e => setForm(f => ({ ...f, rollover: e.target.checked }))} className="rounded" />
            Roll over unused budget
          </label>
          <div className="flex gap-2 pt-1">
            <button onClick={save} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"><Check className="w-3 h-3" /> Save</button>
            <button onClick={() => setEditing(false)} className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded-lg hover:bg-gray-50"><X className="w-3 h-3" /> Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-gray-600">{formatCurrency(spending)} spent</span>
            <span className="font-semibold text-gray-800">{budget.amount > 0 ? formatCurrency(budget.amount) : <span className="text-gray-400 font-normal">No limit set</span>}</span>
          </div>
          {budget.amount > 0 && (
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }} />
            </div>
          )}
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-400">{budget.amount > 0 ? `${pct.toFixed(0)}% used` : 'Track only'}{budget.flex ? ` · ${budget.flex}% flex` : ''}</span>
            {budget.rollover && (
              <span className="text-xs text-blue-500" title={`Effective limit ${formatCurrency(limit)} this month`}>
                {carry >= 0 ? `+${formatCurrency(carry)} rolled over` : `${formatCurrency(carry)} carried`}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function BudgetManager() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const getCategory = useGetCategory();
  const { transactions, budgets, customCategories = [] } = state;
  const allCategories = getAllCategories(customCategories);

  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const spending = getSpendingByCategory(transactions, month, year);
  const trend = getMonthlyTrend(transactions, 3);
  // Rollover-aware status per category (carry + effective limit for this month).
  const statusByCategory = Object.fromEntries(
    getBudgetStatus(budgets, transactions, month, year).map(s => [s.category, s]),
  );

  // Smart suggestions from 3-month average
  const suggestions = {};
  allCategories.forEach(cat => {
    const avg = trend.reduce((s, m) => s + (m[cat.id] || 0), 0) / 3;
    if (avg > 0) suggestions[cat.id] = Math.ceil(avg / 10) * 10;
  });

  // Add budget form
  const [showAdd, setShowAdd] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [newAmt, setNewAmt] = useState('');
  const [newFlex, setNewFlex] = useState('10');
  const [newRollover, setNewRollover] = useState(false);

  // Create new category form (accessible from the budget manager too)
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6366f1');

  const handleCreateCategory = () => {
    if (!newCatName.trim()) return;
    const id = newCatName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    dispatch({ type: 'ADD_CATEGORY', payload: { id, name: newCatName.trim(), color: newCatColor, icon: 'Tag', subcategories: [], keywords: [] } });
    setNewCat(id);
    setShowNewCat(false);
    setNewCatName('');
    setShowAdd(true);
  };

  const handleAdd = () => {
    if (!newCat || newAmt === '') return;
    const existing = budgets.find(b => b.category === newCat);
    dispatch({
      type: 'SET_BUDGET',
      payload: { id: existing?.id || `b_${Date.now()}`, category: newCat, amount: parseFloat(newAmt) || 0, flex: parseFloat(newFlex) || 0, rollover: newRollover },
    });
    setShowAdd(false);
    setNewCat(''); setNewAmt(''); setNewFlex('10'); setNewRollover(false);
  };

  // Categories that don't have a budget yet
  const categoriesWithoutBudget = allCategories.filter(c => !budgets.find(b => b.category === c.id));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">{format(new Date(year, month, 1), 'MMMM yyyy')} · {budgets.length} budgets</p>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowNewCat(s => !s); setShowAdd(false); }}
            className="flex items-center gap-2 px-3 py-2 border-2 border-dashed border-gray-300 hover:border-blue-400 text-gray-500 hover:text-blue-600 rounded-xl text-sm font-medium transition-colors"
          >
            <Tag className="w-3.5 h-3.5" /> New Category
          </button>
          <button
            onClick={() => { setShowAdd(s => !s); setShowNewCat(false); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Budget
          </button>
        </div>
      </div>

      {/* Create new category panel */}
      {showNewCat && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-purple-900 flex items-center gap-2"><Tag className="w-4 h-4" /> Create New Category</h3>
          <input
            type="text"
            placeholder="Category name (e.g. Healthcare, Travel...)"
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateCategory()}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-purple-500"
            autoFocus
          />
          <div>
            <p className="text-xs text-gray-500 mb-1.5">Pick a colour</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setNewCatColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${newCatColor === c ? 'border-gray-700 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          {/* Preview */}
          {newCatName && (
            <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-gray-100">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: newCatColor }} />
              <span className="text-sm font-medium text-gray-700">{newCatName}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={handleCreateCategory} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-xl font-medium">Create Category</button>
            <button onClick={() => { setShowNewCat(false); setNewCatName(''); }} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-white">Cancel</button>
          </div>
        </div>
      )}

      {/* Custom categories list (so user can delete them) */}
      {customCategories.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Your Custom Categories</p>
          <div className="flex flex-wrap gap-2">
            {customCategories.map(c => (
              <div key={c.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm font-medium" style={{ borderColor: c.color, color: c.color, backgroundColor: c.color + '15' }}>
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
                <button onClick={() => dispatch({ type: 'DELETE_CATEGORY', payload: c.id })} className="ml-1 opacity-50 hover:opacity-100 text-xs leading-none">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Smart suggestions */}
      {Object.keys(suggestions).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-amber-800">Smart Suggestions (3-month average)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(suggestions).map(([catId, amt]) => {
              const cat = getCategory(catId);
              return (
                <button key={catId} onClick={() => { setNewCat(catId); setNewAmt(String(amt)); setShowAdd(true); }}
                  className="text-xs bg-white border border-amber-200 text-amber-700 px-2.5 py-1 rounded-lg hover:bg-amber-100">
                  {cat.name}: {formatCurrency(amt)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Add budget form */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-blue-800">Set Monthly Budget</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
              <select value={newCat} onChange={e => setNewCat(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500">
                <option value="">Select...</option>
                {allCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Monthly Budget ($)</label>
              <input type="number" placeholder="0" value={newAmt} onChange={e => setNewAmt(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Flex Tolerance %</label>
              <input type="number" min="0" max="50" placeholder="10" value={newFlex} onChange={e => setNewFlex(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={newRollover} onChange={e => setNewRollover(e.target.checked)} className="rounded" />
                Roll over unused
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium">Save Budget</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-white">Cancel</button>
          </div>
        </div>
      )}

      {/* Budget grid */}
      {budgets.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-base font-medium">No budgets set</p>
          <p className="text-sm mt-1">Click "Add Budget" to set a monthly spending limit.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {budgets.map(b => (
            <BudgetRow
              key={b.id}
              budget={b}
              spending={spending[b.category] || 0}
              carry={statusByCategory[b.category]?.carry || 0}
              effectiveBudget={statusByCategory[b.category]?.effectiveBudget}
              getCategory={getCategory}
              onEdit={payload => dispatch({ type: 'SET_BUDGET', payload })}
              onDelete={budget => removeItem({ type: 'budget', item: budget, label: getCategory(budget.category)?.name })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
