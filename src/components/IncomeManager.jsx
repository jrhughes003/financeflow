import React, { useState } from 'react';
import { Plus, Edit2, Trash2 , DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { getTotalIncome, getTotalExpenses, toMonthlyAmount, formatCurrency } from '../utils/calculations';
import { getIncomeSources } from '../utils/accounts';

const FREQUENCIES = ['weekly', 'biweekly', 'semi-monthly', 'monthly', 'annual'];
const FREQ_LABELS = { weekly: 'Weekly', biweekly: 'Biweekly', 'semi-monthly': 'Semi-monthly', monthly: 'Monthly', annual: 'Annual' };

const EMPTY_FORM = { name: '', amount: '', frequency: 'monthly', source: 'employer', color: '#3b82f6' };
const COLORS = ['#3b82f6','#22c55e','#f59e0b','#ec4899','#8b5cf6','#f97316'];

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
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Total Monthly Income</p>
          <p className="text-xl font-bold text-green-700">{formatCurrency(totalMonthly)}</p>
        </div>
        <div className="bg-orange-50 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 mb-1">This Month's Spending</p>
          <p className="text-xl font-bold text-orange-600">{formatCurrency(totalExpenses)}</p>
        </div>
        <div className={`rounded-xl p-4 ${netAvailable >= 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
          <p className="text-xs font-medium text-gray-500 mb-1">Net Available</p>
          <p className={`text-xl font-bold ${netAvailable >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{formatCurrency(netAvailable)}</p>
        </div>
      </div>

      {/* Income vs Expenses chart */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Income vs. Spending ({format(now, 'MMMM yyyy')})</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
            <Tooltip formatter={v => formatCurrency(v)} />
            <Bar dataKey="amount" radius={[6,6,0,0]} fill="#3b82f6" name="Amount">
              {chartData.map((entry, i) => (
                <rect key={i} fill={i === 0 ? '#22c55e' : i === 1 ? '#f97316' : '#3b82f6'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Income sources list */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Income Sources</h2>
          <button onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); }} className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">
            <Plus className="w-3.5 h-3.5" /> Add Source
          </button>
        </div>

        {showForm && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Income Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Salary, Freelance..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
                <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="$0" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Frequency</label>
                <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500">
                  {FREQUENCIES.map(f => <option key={f} value={f}>{FREQ_LABELS[f]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
                <div className="flex gap-1.5 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))} className={`w-6 h-6 rounded-full border-2 ${form.color === c ? 'border-gray-600 scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium">Save</button>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-white">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {accountIncomes.map(inc => (
            <div key={inc.id} className="flex items-center gap-4 p-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/50">
              <div className="w-3 h-3 rounded-full shrink-0 bg-violet-500" />
              <div className="flex-1">
                <p className="font-medium text-gray-800 text-sm">{inc.name}</p>
                <p className="text-xs text-gray-400">Monthly withdrawal · managed on the Investments page</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-800 text-sm">{formatCurrency(inc.amount)}<span className="text-xs text-gray-400 font-normal">/mo</span></p>
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
                  <div key={inc.id} className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 hover:bg-gray-50">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: inc.color || '#3b82f6' }} />
                    <div className="flex-1">
                      <p className="font-medium text-gray-800 text-sm">{inc.name}</p>
                      <p className="text-xs text-gray-400">{FREQ_LABELS[inc.frequency]} · {formatCurrency(inc.amount)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-800 text-sm">{formatCurrency(monthly)}<span className="text-xs text-gray-400 font-normal">/mo</span></p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(inc)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => removeItem({ type: 'income', item: inc })} aria-label={`Delete ${inc.name}`} title={`Delete ${inc.name}`} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              })
          }
        </div>

        {(incomes.length > 0 || accountIncomes.length > 0) && (
          <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between">
            <span className="text-sm font-semibold text-gray-700">Total Monthly Income</span>
            <span className="text-sm font-bold text-green-600">{formatCurrency(totalMonthly)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
