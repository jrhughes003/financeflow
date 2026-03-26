import React, { useState } from 'react';
import { Plus, Edit2, Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useFinancial } from '../context/FinancialContext';
import { projectInvestmentValue, formatCurrency } from '../utils/calculations';

const TYPES = ['stocks', 'bonds', 'crypto', 'retirement', 'real_estate', 'cash', 'other'];
const TYPE_LABELS = { stocks: 'Stocks', bonds: 'Bonds', crypto: 'Crypto', retirement: 'Retirement', real_estate: 'Real Estate', cash: 'Cash', other: 'Other' };
const TYPE_COLORS = { stocks: '#3b82f6', bonds: '#22c55e', crypto: '#f59e0b', retirement: '#8b5cf6', real_estate: '#ec4899', cash: '#10b981', other: '#94a3b8' };

const EMPTY_FORM = { name: '', type: 'stocks', currentValue: '', costBasis: '', annualReturn: '7', color: '#3b82f6' };

export default function InvestmentTracker() {
  const { state, dispatch } = useFinancial();
  const { investments } = state;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [projYears, setProjYears] = useState(10);

  const totalValue = investments.reduce((s, i) => s + i.currentValue, 0);
  const totalCost = investments.reduce((s, i) => s + (i.costBasis || 0), 0);
  const totalGain = totalValue - totalCost;
  const totalReturn = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  // Allocation by type
  const byType = {};
  investments.forEach(inv => {
    byType[inv.type] = (byType[inv.type] || 0) + inv.currentValue;
  });
  const pieData = Object.entries(byType).map(([type, value]) => ({
    name: TYPE_LABELS[type] || type,
    value: Math.round(value),
    color: TYPE_COLORS[type] || '#94a3b8',
    type,
  }));

  const projectedTotal = investments.reduce((s, inv) =>
    s + projectInvestmentValue(inv.currentValue, inv.annualReturn || 7, projYears), 0
  );

  const openEdit = (inv) => {
    setForm({ ...inv, currentValue: String(inv.currentValue), costBasis: String(inv.costBasis || ''), annualReturn: String(inv.annualReturn || 7) });
    setEditId(inv.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name || !form.currentValue) return;
    const payload = {
      id: editId || `inv_${Date.now()}`,
      name: form.name,
      type: form.type,
      currentValue: parseFloat(form.currentValue) || 0,
      costBasis: parseFloat(form.costBasis) || 0,
      annualReturn: parseFloat(form.annualReturn) || 7,
      color: TYPE_COLORS[form.type] || '#94a3b8',
    };
    dispatch({ type: editId ? 'UPDATE_INVESTMENT' : 'ADD_INVESTMENT', payload });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditId(null);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Value', value: formatCurrency(totalValue), color: 'text-blue-700', bg: 'bg-blue-50' },
          { label: 'Total Cost Basis', value: formatCurrency(totalCost), color: 'text-gray-700', bg: 'bg-gray-50' },
          { label: 'Total Gain/Loss', value: `${totalGain >= 0 ? '+' : ''}${formatCurrency(totalGain)}`, color: totalGain >= 0 ? 'text-green-600' : 'text-red-600', bg: totalGain >= 0 ? 'bg-green-50' : 'bg-red-50' },
          { label: 'Total Return', value: `${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(1)}%`, color: totalReturn >= 0 ? 'text-green-600' : 'text-red-600', bg: totalReturn >= 0 ? 'bg-green-50' : 'bg-red-50' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4`}>
            <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Allocation pie */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Portfolio Allocation</h2>
          {pieData.length === 0
            ? <p className="text-sm text-gray-400 text-center py-8">No investments tracked.</p>
            : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" paddingAngle={2}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={v => formatCurrency(v)} />
                  <Legend formatter={(val, entry) => `${val}: ${((entry.payload.value / totalValue) * 100).toFixed(1)}%`} />
                </PieChart>
              </ResponsiveContainer>
            )
          }
        </div>

        {/* Projection calculator */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Growth Projection</h2>
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-2">Years to Project: <strong>{projYears}</strong></label>
            <input type="range" min="1" max="40" value={projYears} onChange={e => setProjYears(Number(e.target.value))} className="w-full accent-blue-600" />
          </div>
          <div className="bg-blue-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Current value</span>
              <span className="font-semibold">{formatCurrency(totalValue)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">In {projYears} years (blended return)</span>
              <span className="font-bold text-blue-700 text-base">{formatCurrency(projectedTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Projected gain</span>
              <span className="font-semibold text-green-600">+{formatCurrency(projectedTotal - totalValue)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Investment cards */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Holdings</h2>
          <button onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); }} className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">
            <Plus className="w-3.5 h-3.5" /> Add Investment
          </button>
        </div>

        {showForm && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Investment Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Vanguard S&P 500" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500">
                  {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Current Value</label>
                <input type="number" value={form.currentValue} onChange={e => setForm(f => ({ ...f, currentValue: e.target.value }))} placeholder="$0" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Cost Basis</label>
                <input type="number" value={form.costBasis} onChange={e => setForm(f => ({ ...f, costBasis: e.target.value }))} placeholder="$0" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Expected Annual Return %</label>
                <input type="number" value={form.annualReturn} onChange={e => setForm(f => ({ ...f, annualReturn: e.target.value }))} placeholder="7" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium">Save</button>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-white">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {investments.length === 0
            ? <p className="text-sm text-gray-400 text-center py-4">No investments tracked yet.</p>
            : investments.map(inv => {
                const gain = inv.currentValue - (inv.costBasis || 0);
                const gainPct = inv.costBasis > 0 ? (gain / inv.costBasis) * 100 : 0;
                const positive = gain >= 0;
                return (
                  <div key={inv.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: (TYPE_COLORS[inv.type] || '#94a3b8') + '20' }}>
                      {positive ? <TrendingUp className="w-4 h-4" style={{ color: TYPE_COLORS[inv.type] || '#94a3b8' }} /> : <TrendingDown className="w-4 h-4 text-red-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 text-sm">{inv.name}</p>
                      <p className="text-xs text-gray-400">{TYPE_LABELS[inv.type]} · {inv.annualReturn}% expected return</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-gray-900 text-sm">{formatCurrency(inv.currentValue)}</p>
                      <p className={`text-xs font-medium ${positive ? 'text-green-600' : 'text-red-500'}`}>
                        {positive ? '+' : ''}{formatCurrency(gain)} ({gainPct.toFixed(1)}%)
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(inv)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => dispatch({ type: 'DELETE_INVESTMENT', payload: inv.id })} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              })
          }
        </div>
      </div>
    </div>
  );
}
