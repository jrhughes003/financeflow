import React, { useState } from 'react';
import { Plus, Edit2, Trash2 , DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import * as chart from './ui/chartTheme';
import { format } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import { Card, PageLede, Stat, Money } from './ui';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { getTotalIncome, getTotalExpenses, toMonthlyAmount, formatCurrency } from '../utils/calculations';
import { getIncomeSources } from '../utils/accounts';

const FREQUENCIES = ['weekly', 'biweekly', 'semi-monthly', 'monthly', 'annual'];
const FREQ_LABELS = { weekly: 'Weekly', biweekly: 'Biweekly', 'semi-monthly': 'Semi-monthly', monthly: 'Monthly', annual: 'Annual' };

const EMPTY_FORM = { name: '', amount: '', frequency: 'monthly', source: 'employer', color: 'var(--c-data-1)' };
const COLORS = ['var(--c-data-1)','var(--c-positive)','var(--c-caution)','var(--c-data-7)','var(--c-data-5)','var(--c-data-2)'];

export default function IncomeManager() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const { incomes, transactions } = state;
  const now = new Date();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);

  // Scheduled withdrawals from tracked accounts count as income (set on the Investments page).
  const accountIncomes = getIncomeSources([], state.investments);
  const totalMonthly = getTotalIncome([...incomes, ...accountIncomes]);
  const totalExpenses = getTotalExpenses(transactions, now.getMonth(), now.getFullYear());
  const netAvailable = totalMonthly - totalExpenses;

  const openEdit = (inc) => {
    setForm({ ...inc, amount: String(inc.amount) });
    setEditId(inc.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name || !form.amount) return;
    const payload = {
      id: editId || `i_${Date.now()}`,
      name: form.name,
      amount: parseFloat(form.amount),
      frequency: form.frequency,
      source: form.source,
      color: form.color,
    };
    dispatch({ type: editId ? 'UPDATE_INCOME' : 'ADD_INCOME', payload });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditId(null);
  };

  const chartData = [
    { name: 'Income', amount: Math.round(totalMonthly) },
    { name: 'Expenses', amount: Math.round(totalExpenses) },
    { name: 'Available', amount: Math.round(Math.max(0, netAvailable)) },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Summary */}
      <Card>
        <PageLede
          label="Monthly income"
          supporting={(
            <>
              <Stat label="Spent this month"><Money value={totalExpenses} /></Stat>
              <Stat label="Net available">
                <Money value={netAvailable} colour />
              </Stat>
            </>
          )}
        >
          <Money value={totalMonthly} size="display" />
          <p className="text-caption text-ink-muted mt-2">
            across {incomes.length + accountIncomes.length} source{incomes.length + accountIncomes.length === 1 ? '' : 's'}
          </p>
        </PageLede>
      </Card>

      {/* Income vs Expenses chart */}
      <div className="bg-surface rounded-container border border-line p-5">
        <h2 className="text-lg font-semibold text-ink mb-4">Income vs. Spending ({format(now, 'MMMM yyyy')})</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid {...chart.grid} />
            <XAxis dataKey="name" {...chart.xAxis} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
            <Tooltip {...chart.tooltip} formatter={v => formatCurrency(v)} />
            <Bar dataKey="amount" radius={[6,6,0,0]} fill={chart.SERIES.primary} name="Amount">
              {chartData.map((entry, i) => (
                <rect key={i} fill={i === 0 ? 'var(--c-positive)' : i === 1 ? 'var(--c-data-2)' : 'var(--c-data-1)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Income sources list */}
      <div className="bg-surface rounded-container border border-line p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-ink">Income Sources</h2>
          <button onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); }} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">
            <Plus className="w-3.5 h-3.5" /> Add Source
          </button>
        </div>

        {showForm && (
          <div className="bg-accent-tint rounded-container p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label-micro block mb-1.5">Income Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Salary, Freelance..." className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Amount</label>
                <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="$0" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Frequency</label>
                <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))} className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent">
                  {FREQUENCIES.map(f => <option key={f} value={f}>{FREQ_LABELS[f]}</option>)}
                </select>
              </div>
              <div>
                <label className="label-micro block mb-1.5">Color</label>
                <div className="flex gap-1.5 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))} className={`w-6 h-6 rounded-full border-2 ${form.color === c ? 'border-line-strong scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">Save</button>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {accountIncomes.map(inc => (
            <div key={inc.id} className="flex items-center gap-4 p-3 rounded-container border border-dashed border-line-strong bg-surface-sunk/50">
              <div className="w-3 h-3 rounded-full shrink-0 bg-violet-500" />
              <div className="flex-1">
                <p className="font-medium text-ink text-sm">{inc.name}</p>
                <p className="text-caption text-ink-muted">Monthly withdrawal · managed on the Investments page</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-ink text-sm">{formatCurrency(inc.amount)}<span className="text-caption text-ink-muted font-normal">/mo</span></p>
              </div>
              <div className="w-[60px]" />
            </div>
          ))}
          {incomes.length === 0 && accountIncomes.length === 0
            ? <EmptyState
                compact
                icon={DollarSign}
                title="No income added yet"
                description="Add what you earn and how often. Everything downstream — savings rate, budgets, the long-range plan — needs it."
                actionLabel="Add income"
                onAction={() => setShowForm(true)}
              />
            : incomes.map(inc => {
                const monthly = toMonthlyAmount(inc.amount, inc.frequency);
                return (
                  <div key={inc.id} className="flex items-center gap-4 p-3 rounded-container border border-line hover:bg-surface-sunk">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: inc.color || 'var(--c-data-1)' }} />
                    <div className="flex-1">
                      <p className="font-medium text-ink text-sm">{inc.name}</p>
                      <p className="text-caption text-ink-muted">{FREQ_LABELS[inc.frequency]} · {formatCurrency(inc.amount)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-ink text-sm">{formatCurrency(monthly)}<span className="text-caption text-ink-muted font-normal">/mo</span></p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(inc)} className="p-1.5 text-ink-muted hover:text-accent hover:bg-accent-tint rounded-control"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => removeItem({ type: 'income', item: inc })} aria-label={`Delete ${inc.name}`} title={`Delete ${inc.name}`} className="p-1.5 text-ink-muted hover:text-negative hover:bg-negative-tint rounded-control"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              })
          }
        </div>

        {(incomes.length > 0 || accountIncomes.length > 0) && (
          <div className="mt-4 pt-3 border-t border-line flex justify-between">
            <span className="text-sm font-semibold text-ink-secondary">Total Monthly Income</span>
            <span className="text-sm font-bold text-positive">{formatCurrency(totalMonthly)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
