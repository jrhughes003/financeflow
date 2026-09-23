import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Target, Plane, Car, Shield, Home, Star } from 'lucide-react';
import { format, addMonths, parseISO, differenceInMonths } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { projectGoalCompletion, getGoalProgress, formatCurrency } from '../utils/calculations';

const ICONS = { Shield, Plane, Car, Home, Star, Target };
const ICON_LIST = ['Target', 'Plane', 'Car', 'Shield', 'Home', 'Star'];
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#10b981', '#f97316', '#0ea5e9'];

function GoalCard({ goal, transactions, onEdit, onDelete }) {
  // Progress is derived: the opening balance plus every savings transaction
  // logged against this goal (kind: 'savings', goalId === goal.id).
  const progress = getGoalProgress(goal, transactions);
  const currentAmount = progress.currentAmount;
  const derivedGoal = { ...goal, currentAmount };
  const pct = progress.percent;
  const remaining = goal.targetAmount - currentAmount;
  const Icon = ICONS[goal.icon] || Target;
  const projection = projectGoalCompletion(derivedGoal, goal.monthlyContribution);
  const targetDate = parseISO(goal.targetDate);
  const monthsLeft = differenceInMonths(targetDate, new Date());
  const onTrack = projection && differenceInMonths(projection.completionDate, targetDate) <= 0;
  const completed = currentAmount >= goal.targetAmount;

  return (
    <div className={`bg-white rounded-2xl shadow-sm border p-5 ${completed ? 'border-green-300' : 'border-gray-100'}`}>
      {completed && (
        <div className="mb-3 bg-green-50 border border-green-200 rounded-xl p-3 text-center">
          <p className="text-sm font-semibold text-green-700">🎉 Goal Achieved! Congratulations!</p>
        </div>
      )}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: (goal.color || '#3b82f6') + '20' }}>
            <Icon className="w-5 h-5" style={{ color: goal.color || '#3b82f6' }} />
          </div>
          <div>
            <p className="font-semibold text-gray-900">{goal.name}</p>
            <p className="text-xs text-gray-400">Target: {format(targetDate, 'MMM d, yyyy')}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onEdit(goal)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => onDelete(goal)} aria-label={`Delete goal ${goal.name}`} title={`Delete ${goal.name}`} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1.5">
          <span className="font-bold text-gray-900">{formatCurrency(currentAmount)}</span>
          <span className="text-gray-500">of {formatCurrency(goal.targetAmount)}</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, backgroundColor: goal.color || '#3b82f6' }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-400">{pct.toFixed(1)}% complete</span>
          <span className="text-xs text-gray-400">{formatCurrency(remaining)} remaining</span>
        </div>
        {progress.contributed > 0 && (
          <p className="text-[11px] text-gray-400 mt-1">
            {formatCurrency(progress.opening)} opening + {formatCurrency(progress.contributed)} from savings transactions
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-gray-50 rounded-lg p-2.5">
          <p className="text-gray-400 mb-0.5">Monthly savings</p>
          <p className="font-semibold text-gray-800">{formatCurrency(goal.monthlyContribution)}/mo</p>
        </div>
        <div className={`rounded-lg p-2.5 ${onTrack ? 'bg-green-50' : 'bg-yellow-50'}`}>
          <p className={`mb-0.5 ${onTrack ? 'text-green-500' : 'text-yellow-500'}`}>
            {onTrack ? '✓ On Track' : '⚠ Behind'}
          </p>
          <p className={`font-semibold ${onTrack ? 'text-green-700' : 'text-yellow-700'}`}>
            {projection ? format(projection.completionDate, 'MMM yyyy') : 'N/A'}
          </p>
        </div>
      </div>

      {/* Scenario */}
      {!completed && (
        <div className="mt-3 text-xs text-gray-400 bg-gray-50 rounded-lg p-2.5">
          At {formatCurrency(goal.monthlyContribution)}/mo → reach goal in <strong>{projection?.months ?? '?'} months</strong>
          {!onTrack && monthsLeft > 0 && (
            <span className="block mt-1 text-yellow-600">
              Need {formatCurrency(Math.ceil(remaining / monthsLeft))}/mo to hit target date
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const EMPTY_FORM = { name: '', targetAmount: '', currentAmount: '', monthlyContribution: '', targetDate: '', color: '#3b82f6', icon: 'Target' };

export default function GoalsManager() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const { savings_goals, transactions } = state;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [scenarioGoal, setScenarioGoal] = useState(null);
  const [scenarioAmt, setScenarioAmt] = useState('');

  const openEdit = (goal) => {
    setForm({ ...goal, targetAmount: String(goal.targetAmount), currentAmount: String(goal.currentAmount), monthlyContribution: String(goal.monthlyContribution) });
    setEditId(goal.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name || !form.targetAmount || !form.targetDate) return;
    const payload = {
      id: editId || `g_${Date.now()}`,
      name: form.name,
      targetAmount: parseFloat(form.targetAmount) || 0,
      currentAmount: parseFloat(form.currentAmount) || 0,
      monthlyContribution: parseFloat(form.monthlyContribution) || 0,
      targetDate: form.targetDate,
      color: form.color,
      icon: form.icon,
    };
    dispatch({ type: editId ? 'UPDATE_GOAL' : 'ADD_GOAL', payload });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditId(null);
  };

  const scenarioProjection = scenarioGoal && scenarioAmt
    ? projectGoalCompletion(scenarioGoal, parseFloat(scenarioAmt))
    : null;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{savings_goals.length} active goals</p>
        <button onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">
          <Plus className="w-4 h-4" /> New Goal
        </button>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-blue-900">{editId ? 'Edit Goal' : 'Create New Goal'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Goal Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Emergency Fund" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Target Amount</label>
              <input type="number" value={form.targetAmount} onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))} placeholder="$0" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Opening Balance</label>
              <input type="number" value={form.currentAmount} onChange={e => setForm(f => ({ ...f, currentAmount: e.target.value }))} placeholder="$0" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 bg-white" />
              <p className="text-[11px] text-gray-400 mt-1">Starting amount. Log savings transactions to add more.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Monthly Contribution</label>
              <input type="number" value={form.monthlyContribution} onChange={e => setForm(f => ({ ...f, monthlyContribution: e.target.value }))} placeholder="$0" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Target Date</label>
              <input type="date" value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))} className={`w-6 h-6 rounded-full border-2 transition-all ${form.color === c ? 'border-gray-600 scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Icon</label>
              <select value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-blue-500">
                {ICON_LIST.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-xl font-medium">Save Goal</button>
            <button onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); }} className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-white">Cancel</button>
          </div>
        </div>
      )}

      {/* Goals grid */}
      {savings_goals.length === 0
        ? <EmptyState
            icon={Target}
            title="No savings goals yet"
            description="Name what you're saving for and the app tracks progress from your actual savings transactions — not a number you have to keep updating."
            actionLabel="Create a goal"
            onAction={() => { setShowForm(true); setEditId(null); }}
          />
        : <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {savings_goals.map(g => (
              <GoalCard key={g.id} goal={g} transactions={transactions} onEdit={openEdit} onDelete={() => removeItem({ type: 'goal', item: g })} />
            ))}
          </div>
      }

      {/* Scenario calculator */}
      {savings_goals.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Scenario Calculator</h2>
          <p className="text-sm text-gray-500 mb-3">See how changing your monthly contribution affects your goal timeline.</p>
          <div className="flex flex-wrap gap-3">
            <select value={scenarioGoal?.id || ''} onChange={e => setScenarioGoal(savings_goals.find(g => g.id === e.target.value) || null)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-blue-500">
              <option value="">Select a goal...</option>
              {savings_goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <input type="number" placeholder="Monthly savings amount" value={scenarioAmt} onChange={e => setScenarioAmt(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500" />
          </div>
          {scenarioProjection && scenarioGoal && (
            <div className="mt-3 bg-blue-50 rounded-xl p-4">
              <p className="text-sm text-blue-800">
                If you save <strong>{formatCurrency(parseFloat(scenarioAmt))}/month</strong> toward <strong>{scenarioGoal.name}</strong>,
                you'll reach your goal in <strong>{scenarioProjection.months} months</strong> — by <strong>{format(scenarioProjection.completionDate, 'MMMM yyyy')}</strong>.
              </p>
              <button
                onClick={() => {
                  dispatch({ type: 'UPDATE_GOAL', payload: { ...scenarioGoal, monthlyContribution: parseFloat(scenarioAmt) } });
                  setScenarioGoal({ ...scenarioGoal, monthlyContribution: parseFloat(scenarioAmt) });
                }}
                className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium"
              >
                Apply as monthly contribution
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
