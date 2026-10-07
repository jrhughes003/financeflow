import React, { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, Tag, Wallet } from 'lucide-react';
import { useFinancial, useGetCategory, useTaxonomy } from '../context/FinancialContext';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { CATEGORIES, getAllCategories } from '../utils/categorization';
import { groups as groupsOf, childrenOf, selectable } from '../utils/categoryTree';
import { getSpendingByCategory, getMonthlyTrend, getBudgetStatus, formatCurrency } from '../utils/calculations';
import { format } from 'date-fns';
import { Panel, PanelGrid, Button, IconButton, Money as MoneyFigure, Meter, CategoryMark, Table, Th, Td, Tr } from './ui';
import type { Budget, Money } from '../types/domain';

const PRESET_COLORS = ['var(--c-data-2)','var(--c-positive)','var(--c-data-1)','var(--c-data-5)','var(--c-caution)','var(--c-data-7)','var(--c-data-6)','var(--c-data-3)','var(--c-negative)','var(--c-data-6)'];

const INPUT = 'h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent';

/** Columns in the budget table; the edit row spans all of them. */
const COLS = 8;

interface BudgetRowProps {
  budget: Budget;
  spending: Money;
  carry?: Money;
  /** Absent when this category has no rollover-adjusted status for the month. */
  effectiveBudget?: Money;
  onEdit: (budget: Budget) => void;
  onDelete: (budget: Budget) => void;
  getCategory: ReturnType<typeof useGetCategory>;
}

function BudgetRow({ budget, spending, carry = 0, effectiveBudget, onEdit, onDelete, getCategory }: BudgetRowProps) {
  const [editing, setEditing] = useState(false);
  // The two number fields start as the stored numbers and become input strings
  // once edited, which is why save() re-parses them.
  const [form, setForm] = useState<{ amount: number | string; flex: number | string; rollover: boolean }>(
    { amount: budget.amount, flex: budget.flex || 0, rollover: budget.rollover || false },
  );
  const cat = getCategory(budget.category);
  // Measure usage against the rollover-adjusted limit when rollover is on.
  const limit = budget.rollover ? (effectiveBudget ?? budget.amount) : budget.amount;
  const pct = limit > 0 ? Math.min((spending / limit) * 100, 120) : 0;
  const status = pct > 100 + (budget.flex || 0) ? 'danger' : pct >= 80 ? 'warning' : 'good';
  const tone = status === 'danger' ? 'negative' : status === 'warning' ? 'caution' : 'positive';
  const toneText = status === 'danger' ? 'text-negative' : status === 'warning' ? 'text-caution' : 'text-ink';

  const save = () => {
    onEdit({ ...budget, amount: parseFloat(String(form.amount)) || 0, flex: parseFloat(String(form.flex)) || 0, rollover: form.rollover });
    setEditing(false);
  };

  return (
    <>
      <Tr className={editing ? 'bg-accent-tint hover:bg-accent-tint' : ''}>
        <Td className="text-ink-secondary"><CategoryMark color={cat.color} name={cat.name} /></Td>
        <Td numeric><MoneyFigure value={spending} size="sm" /></Td>
        <Td numeric>
          {budget.amount > 0
            ? <MoneyFigure value={budget.amount} size="sm" className="text-ink-muted" />
            : <span className="text-caption text-ink-muted">No limit set</span>}
        </Td>
        <Td numeric className={budget.amount > 0 ? toneText : 'text-ink-muted'}>
          {budget.amount > 0 ? `${pct.toFixed(0)}% used` : 'Track only'}
        </Td>
        <Td className="w-[22%] min-w-[96px]">
          {/* Capped at the limit so the flex band shows amber, not the meter's automatic red. */}
          {budget.amount > 0 && <Meter value={Math.min(spending, limit)} max={limit} tone={tone} />}
        </Td>
        <Td numeric className="hidden md:table-cell text-ink-muted">{budget.flex ? `${budget.flex}% flex` : '—'}</Td>
        <Td numeric className="hidden md:table-cell">
          {budget.rollover ? (
            <span className="text-caption text-accent-ink" title={`Effective limit ${formatCurrency(limit)} this month`}>
              {carry >= 0 ? `+${formatCurrency(carry)} rolled over` : `${formatCurrency(carry)} carried`}
            </span>
          ) : <span className="text-ink-muted">—</span>}
        </Td>
        <Td className="w-14 whitespace-nowrap text-right">
          <IconButton icon={Edit2} label={`Edit ${cat?.name || budget.category} budget`} onClick={() => setEditing(e => !e)} />
          <IconButton
            icon={Trash2}
            label={`Delete ${cat?.name || budget.category} budget`}
            title="Delete budget"
            onClick={() => onDelete(budget)}
            className="hover:text-negative"
          />
        </Td>
      </Tr>
      {editing && (
        <tr className="bg-accent-tint">
          <td colSpan={COLS} className="px-2.5 py-1.5 border-b border-line">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-2">
                <label className="label-micro">Budget</label>
                <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className={`${INPUT} w-28`} placeholder="0.00" />
              </div>
              <div className="flex items-center gap-2">
                <label className="label-micro">Flex %</label>
                <input type="number" min="0" max="50" value={form.flex} onChange={e => setForm(f => ({ ...f, flex: e.target.value }))} className={`${INPUT} w-20`} placeholder="0" />
              </div>
              <label className="flex items-center gap-2 text-caption text-ink-secondary">
                <input type="checkbox" checked={form.rollover} onChange={e => setForm(f => ({ ...f, rollover: e.target.checked }))} className="rounded-control" />
                Roll over unused budget
              </label>
              <div className="flex gap-1.5 ml-auto">
                <Button size="sm" variant="primary" icon={Check} onClick={save}>Save</Button>
                <Button size="sm" icon={X} onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function BudgetManager() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const getCategory = useGetCategory();
  const taxonomy = useTaxonomy();
  const { transactions, budgets, customCategories = [] } = state;
  const allCategories = getAllCategories(customCategories);
  // What a budget can be set against, and how much each one gathers up.
  const budgetable = groupsOf(selectable(allCategories), taxonomy.parentOverrides);
  const childCount = (id: string) =>
    childrenOf(id, selectable(allCategories), taxonomy.parentOverrides).length;

  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const spending = getSpendingByCategory(transactions, month, year);
  const trend = getMonthlyTrend(transactions, 3);
  // Rollover-aware status per category (carry + effective limit for this month).
  const statusByCategory = Object.fromEntries(
    getBudgetStatus(budgets, transactions, month, year, taxonomy).map(s => [s.category, s]),
  );

  // Smart suggestions from 3-month average
  const suggestions: Record<string, number> = {};
  allCategories.forEach(cat => {
    // A trend row carries `label` beside the category totals, so its index
    // signature admits a string; a category key is always a number.
    const avg = trend.reduce((s, m) => s + ((m[cat.id] as number) || 0), 0) / 3;
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
  const [newCatColor, setNewCatColor] = useState('var(--c-data-5)');

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

  const hasSuggestions = Object.keys(suggestions).length > 0;
  const hasSide = hasSuggestions || customCategories.length > 0;

  return (
    <div className="space-y-2 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption uppercase text-ink-muted">{format(new Date(year, month, 1), 'MMMM yyyy')} · {budgets.length} budgets</p>
        <div className="flex gap-1.5">
          <Button size="sm" icon={Tag} onClick={() => { setShowNewCat(s => !s); setShowAdd(false); }}>
            New Category
          </Button>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => { setShowAdd(s => !s); setShowNewCat(false); }}>
            Add Budget
          </Button>
        </div>
      </div>

      {/* Create new category panel */}
      {showNewCat && (
        <Panel title="Create New Category" bordered bodyClassName="p-3 space-y-2.5">
          <input
            type="text"
            placeholder="Category name (e.g. Healthcare, Travel...)"
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateCategory()}
            className={`${INPUT} w-full`}
            autoFocus
          />
          <div>
            <p className="label-micro mb-1.5">Pick a colour</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setNewCatColor(c)}
                  className={`w-5 h-5 rounded-control outline-offset-1 ${newCatColor === c ? 'outline outline-1 outline-accent' : ''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          {/* Preview */}
          {newCatName && (
            <div className="flex items-center h-row px-2 border border-line text-sm text-ink-secondary">
              <CategoryMark color={newCatColor} name={newCatName} />
            </div>
          )}
          <div className="flex gap-1.5">
            <Button variant="primary" onClick={handleCreateCategory}>Create Category</Button>
            <Button onClick={() => { setShowNewCat(false); setNewCatName(''); }}>Cancel</Button>
          </div>
        </Panel>
      )}

      {/* Add budget form */}
      {showAdd && (
        <Panel title="Set Monthly Budget" bordered bodyClassName="p-3 space-y-2.5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-2">
            <div>
              <label className="label-micro block mb-1">Category</label>
              <select value={newCat} onChange={e => setNewCat(e.target.value)} className={`${INPUT} w-full`}>
                <option value="">Select...</option>
                {/*
                  Groups only. Budgeting a child is possible — doing so makes
                  it a group, see categoryTree.effectiveOverrides — but it is
                  not what this control is for, and offering eighteen lines
                  here is the thing that made budgeting feel like admin.
                */}
                {budgetable.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{childCount(c.id) ? ` (incl. ${childCount(c.id)} more)` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-micro block mb-1">Monthly Budget ($)</label>
              <input type="number" placeholder="0" value={newAmt} onChange={e => setNewAmt(e.target.value)} className={`${INPUT} w-full`} />
            </div>
            <div>
              <label className="label-micro block mb-1">Flex Tolerance %</label>
              <input type="number" min="0" max="50" placeholder="10" value={newFlex} onChange={e => setNewFlex(e.target.value)} className={`${INPUT} w-full`} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 h-7 text-sm text-ink-secondary cursor-pointer">
                <input type="checkbox" checked={newRollover} onChange={e => setNewRollover(e.target.checked)} className="rounded-control" />
                Roll over unused
              </label>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button variant="primary" onClick={handleAdd}>Save Budget</Button>
            <Button onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </Panel>
      )}

      <PanelGrid className="grid-flow-row-dense">
        {/* Budget table */}
        <Panel
          title="Budgets"
          className={`col-span-12 ${hasSide ? 'xl:col-span-8' : ''}`}
        >
          {budgets.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No budgets yet"
              description="Set a monthly limit per category and the app tracks what's left, carries unused room forward, and tells you when a category is drifting."
              actionLabel="Add your first budget"
              onAction={() => setShowAdd(true)}
              secondary="Already have spending history? The Analytics tab can suggest limits from it."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th numeric>Spent</Th>
                  <Th numeric>Budget</Th>
                  <Th numeric>Used</Th>
                  <Th>Progress</Th>
                  <Th numeric className="hidden md:table-cell">Flex</Th>
                  <Th numeric className="hidden md:table-cell">Rollover</Th>
                  <Th><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
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
              </tbody>
            </Table>
          )}
        </Panel>

        {hasSide && (
          <div className="col-span-12 xl:col-span-4 flex flex-col gap-px bg-line">
            {/* Smart suggestions */}
            {hasSuggestions && (
              <Panel title="Smart Suggestions (3-month average)" meta={`${Object.keys(suggestions).length}`}>
                <div className="flex flex-wrap gap-1 p-2.5">
                  {Object.entries(suggestions).map(([catId, amt]) => {
                    const cat = getCategory(catId);
                    return (
                      <button key={catId} onClick={() => { setNewCat(catId); setNewAmt(String(amt)); setShowAdd(true); }}
                        className="inline-flex items-center h-6 px-1.5 border border-line-strong rounded-control text-caption text-ink-secondary hover:border-accent hover:text-accent-ink">
                        {cat.name}: {formatCurrency(amt)}
                      </button>
                    );
                  })}
                </div>
              </Panel>
            )}

            {/* Custom categories list (so user can delete them) */}
            {customCategories.length > 0 && (
              <Panel title="Your Custom Categories" meta={`${customCategories.length}`}>
                <div className="flex flex-wrap gap-1 p-2.5">
                  {/*
                    The category colour identifies the category; it is not a text
                    colour. A saturated hue as a label, or on a wash of itself, is
                    unreadable by construction: every one of the 18 category
                    colours came in under 4.5:1, the worst at 1.8:1. The hue stays,
                    as the square mark; the label takes --c-ink, which is what
                    rule 1 in tokens.css asks for.
                  */}
                  {customCategories.map(c => (
                    <div key={c.id} className="inline-flex items-center gap-1.5 h-6 pl-1.5 pr-0.5 border border-line-strong text-caption text-ink">
                      <CategoryMark color={c.color} name={c.name} />
                      <button
                        onClick={() => dispatch({ type: 'DELETE_CATEGORY', payload: c.id })}
                        title={`Delete ${c.name}`}
                        aria-label={`Delete ${c.name} category`}
                        className="w-5 h-5 inline-flex items-center justify-center rounded-control text-ink-muted hover:text-negative hover:bg-surface-hover leading-none"
                      >✕</button>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
            {/* Fills the rest of the column so the grid's line colour doesn't show through. */}
            <div className="flex-1 bg-surface" />
          </div>
        )}
      </PanelGrid>
    </div>
  );
}
