import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Target, Plane, Car, Shield, Home, Star } from 'lucide-react';
import { format, parseISO, differenceInMonths } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import { Card, PageLede, Stat as UiStat, Money } from './ui';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { projectGoalCompletion, getGoalProgress, formatCurrency } from '../utils/calculations';
import type { LucideIcon } from 'lucide-react';
import type { Goal, Transaction } from '../types/domain';

const ICONS: Record<string, LucideIcon> = { Shield, Plane, Car, Home, Star, Target };
const ICON_LIST = ['Target', 'Plane', 'Car', 'Shield', 'Home', 'Star'];
const COLORS = ['var(--c-data-1)', 'var(--c-positive)', 'var(--c-caution)', 'var(--c-data-7)', 'var(--c-data-5)', 'var(--c-data-6)', 'var(--c-data-2)', 'var(--c-data-3)'];

interface GoalCardProps {
  goal: Goal;
  transactions: Transaction[];
  onEdit: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
}

function GoalCard({ goal, transactions, onEdit, onDelete }: GoalCardProps) {
  // Progress is derived: the opening balance plus every savings transaction
  // logged against this goal (kind: 'savings', goalId === goal.id).
  const progress = getGoalProgress(goal, transactions);
  const currentAmount = progress.currentAmount;
  const derivedGoal = { ...goal, currentAmount };
  const pct = progress.percent;
  const remaining = goal.targetAmount - currentAmount;
  const Icon = ICONS[goal.icon ?? ''] || Target;
  const projection = projectGoalCompletion(derivedGoal, goal.monthlyContribution);
  const targetDate = parseISO(goal.targetDate);
  const monthsLeft = differenceInMonths(targetDate, new Date());
  const onTrack = projection && differenceInMonths(projection.completionDate, targetDate) <= 0;
  const completed = currentAmount >= goal.targetAmount;

  return (
    <div className={`bg-surface rounded-container  border p-5 ${completed ? 'border-positive' : 'border-line'}`}>
      {completed && (
        <div className="mb-3 bg-positive-tint border border-positive rounded-container p-3 text-center">
          <p className="text-sm font-semibold text-positive">🎉 Goal Achieved! Congratulations!</p>
        </div>
      )}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-container flex items-center justify-center" style={{ backgroundColor: (goal.color || 'var(--c-data-1)') + '20' }}>
            <Icon className="w-5 h-5" style={{ color: goal.color || 'var(--c-data-1)' }} />
          </div>
          <div>
            <p className="font-semibold text-ink">{goal.name}</p>
            <p className="text-caption text-ink-muted">Target: {format(targetDate, 'MMM d, yyyy')}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onEdit(goal)} className="p-1.5 text-ink-muted hover:text-accent hover:bg-accent-tint rounded-control"><Edit2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => onDelete(goal)} aria-label={`Delete goal ${goal.name}`} title={`Delete ${goal.name}`} className="p-1.5 text-ink-muted hover:text-negative hover:bg-negative-tint rounded-control"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1.5">
          <span className="font-bold text-ink">{formatCurrency(currentAmount)}</span>
          <span className="text-ink-muted">of {formatCurrency(goal.targetAmount)}</span>
        </div>
        <div className="h-3 bg-surface-hover rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, backgroundColor: goal.color || 'var(--c-data-1)' }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-caption text-ink-muted">{pct.toFixed(1)}% complete</span>
          <span className="text-caption text-ink-muted">{formatCurrency(remaining)} remaining</span>
        </div>
        {progress.contributed > 0 && (
          <p className="text-micro text-ink-muted mt-1">
            {formatCurrency(progress.opening)} opening + {formatCurrency(progress.contributed)} from savings transactions
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-caption">
        <div className="bg-surface-sunk rounded-control p-2.5">
          <p className="text-ink-muted mb-0.5">Monthly savings</p>
          <p className="font-semibold text-ink">{formatCurrency(goal.monthlyContribution)}/mo</p>
        </div>
        <div className={`rounded-control p-2.5 ${onTrack ? 'bg-positive-tint' : 'bg-caution-tint'}`}>
          <p className={`mb-0.5 ${onTrack ? 'text-positive' : 'text-caution'}`}>
            {onTrack ? '✓ On Track' : '⚠ Behind'}
          </p>
          <p className={`font-semibold ${onTrack ? 'text-positive' : 'text-caution'}`}>
            {projection ? format(projection.completionDate, 'MMM yyyy') : 'N/A'}
          </p>
        </div>
      </div>

      {/* Scenario */}
      {!completed && (
        <div className="mt-3 text-caption text-ink-muted bg-surface-sunk rounded-control p-2.5">
          At {formatCurrency(goal.monthlyContribution)}/mo → reach goal in <strong>{projection?.months ?? '?'} months</strong>
          {!onTrack && monthsLeft > 0 && (
            <span className="block mt-1 text-caution">
              Need {formatCurrency(Math.ceil(remaining / monthsLeft))}/mo to hit target date
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The edit form. Mirrors Goal, but every figure is the raw input string and
 *  the spread in openEdit carries the id of the goal being edited. */
interface GoalForm {
  id?: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  monthlyContribution: string;
  targetDate: string;
  color?: string;
  icon?: string;
}

const EMPTY_FORM: GoalForm = { name: '', targetAmount: '', currentAmount: '', monthlyContribution: '', targetDate: '', color: 'var(--c-data-1)', icon: 'Target' };

export default function GoalsManager() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const { savings_goals, transactions } = state;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [scenarioGoal, setScenarioGoal] = useState<Goal | null>(null);
  const [scenarioAmt, setScenarioAmt] = useState('');

  const openEdit = (goal: Goal) => {
    setForm({ ...goal, targetAmount: String(goal.targetAmount), currentAmount: String(goal.currentAmount), monthlyContribution: String(goal.monthlyContribution) });
    setEditId(goal.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name || !form.targetAmount || !form.targetDate) return;
    const payload: Goal = {
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

  const goalTotals = savings_goals.reduce((acc, g) => {
    const progress = getGoalProgress(g, transactions);
    acc.saved += progress.currentAmount;
    acc.target += Number(g.targetAmount) || 0;
    acc.monthly += Number(g.monthlyContribution) || 0;
    return acc;
  }, { saved: 0, target: 0, monthly: 0 });

  const scenarioProjection = scenarioGoal && scenarioAmt
    ? projectGoalCompletion(scenarioGoal, parseFloat(scenarioAmt))
    : null;

  return (
    <div className="space-y-5 animate-fade-in">
      <Card>
        <PageLede
          label="Saved toward goals"
          supporting={(
            <>
              <UiStat label="Target total"><Money value={goalTotals.target} /></UiStat>
              <UiStat label="Still to go"><Money value={Math.max(0, goalTotals.target - goalTotals.saved)} /></UiStat>
              <UiStat label="Per month"><Money value={goalTotals.monthly} /></UiStat>
            </>
          )}
        >
          <Money value={goalTotals.saved} size="display" />
          {goalTotals.target > 0 && (
            <p className="text-caption text-ink-muted mt-2">
              {Math.round((goalTotals.saved / goalTotals.target) * 100)}% of everything you're saving for
            </p>
          )}
        </PageLede>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">{savings_goals.length} active goal{savings_goals.length === 1 ? '' : 's'}</p>
        <button onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); }} className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-ink-inverse rounded-container text-sm font-medium">
          <Plus className="w-4 h-4" /> New Goal
        </button>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="bg-accent-tint border border-accent rounded-container p-5 space-y-3">
          <h3 className="text-sm font-semibold text-accent-ink">{editId ? 'Edit Goal' : 'Create New Goal'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label-micro block mb-1.5">Goal Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Emergency Fund" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="label-micro block mb-1.5">Target Amount</label>
              <input type="number" value={form.targetAmount} onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))} placeholder="$0" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="label-micro block mb-1.5">Opening Balance</label>
              <input type="number" value={form.currentAmount} onChange={e => setForm(f => ({ ...f, currentAmount: e.target.value }))} placeholder="$0" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
              <p className="text-micro text-ink-muted mt-1">Starting amount. Log savings transactions to add more.</p>
            </div>
            <div>
              <label className="label-micro block mb-1.5">Monthly Contribution</label>
              <input type="number" value={form.monthlyContribution} onChange={e => setForm(f => ({ ...f, monthlyContribution: e.target.value }))} placeholder="$0" className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="label-micro block mb-1.5">Target Date</label>
              <input type="date" value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="label-micro block mb-1.5">Color</label>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))} className={`w-6 h-6 rounded-full border-2 transition-all ${form.color === c ? 'border-line-strong scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <div>
              <label className="label-micro block mb-1.5">Icon</label>
              <select value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} className="w-full h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent">
                {ICON_LIST.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">Save Goal</button>
            <button onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); }} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
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
        <div className="bg-surface rounded-container border border-line p-5">
          <h2 className="text-lg font-semibold text-ink mb-4">Scenario Calculator</h2>
          <p className="text-sm text-ink-muted mb-3">See how changing your monthly contribution affects your goal timeline.</p>
          <div className="flex flex-wrap gap-3">
            <select value={scenarioGoal?.id || ''} onChange={e => setScenarioGoal(savings_goals.find(g => g.id === e.target.value) || null)} className="h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent">
              <option value="">Select a goal...</option>
              {savings_goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <input type="number" placeholder="Monthly savings amount" value={scenarioAmt} onChange={e => setScenarioAmt(e.target.value)} className="h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
          </div>
          {scenarioProjection && scenarioGoal && (
            <div className="mt-3 bg-accent-tint rounded-container p-4">
              <p className="text-sm text-accent-ink">
                If you save <strong>{formatCurrency(parseFloat(scenarioAmt))}/month</strong> toward <strong>{scenarioGoal.name}</strong>,
                you'll reach your goal in <strong>{scenarioProjection.months} months</strong> — by <strong>{format(scenarioProjection.completionDate, 'MMMM yyyy')}</strong>.
              </p>
              <button
                onClick={() => {
                  dispatch({ type: 'UPDATE_GOAL', payload: { ...scenarioGoal, monthlyContribution: parseFloat(scenarioAmt) } });
                  setScenarioGoal({ ...scenarioGoal, monthlyContribution: parseFloat(scenarioAmt) });
                }}
                className="mt-3 px-4 py-2 bg-accent hover:bg-accent-hover text-ink-inverse text-sm rounded-control font-medium"
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
