import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Target, Plane, Car, Shield, Home, Star } from 'lucide-react';
import { format, parseISO, differenceInMonths } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import {
  Panel, PanelGrid, Button, IconButton, Money, Meter, Badge, Table, Th, Td, Tr,
} from './ui';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { projectGoalCompletion, getGoalProgress, formatCurrency } from '../utils/calculations';
import type { LucideIcon } from 'lucide-react';
import type { Goal, Transaction } from '../types/domain';

const ICONS: Record<string, LucideIcon> = { Shield, Plane, Car, Home, Star, Target };
const ICON_LIST = ['Target', 'Plane', 'Car', 'Shield', 'Home', 'Star'];
const COLORS = ['var(--c-data-1)', 'var(--c-positive)', 'var(--c-caution)', 'var(--c-data-7)', 'var(--c-data-5)', 'var(--c-data-6)', 'var(--c-data-2)', 'var(--c-data-3)'];

const INPUT = 'h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent';

interface GoalRowProps {
  goal: Goal;
  transactions: Transaction[];
  onEdit: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
}

function GoalRow({ goal, transactions, onEdit, onDelete }: GoalRowProps) {
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
  const breakdown = `${formatCurrency(progress.opening)} opening + ${formatCurrency(progress.contributed)} from savings transactions`;

  return (
    <Tr>
      <Td className="text-ink">
        <span className="inline-flex items-center gap-2 min-w-0">
          {/* The goal's chosen icon, in its chosen colour: the goal's mark. */}
          <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: goal.color || 'var(--c-data-1)' }} aria-hidden="true" />
          <span className="truncate">{goal.name}</span>
        </span>
      </Td>
      <Td numeric className="text-ink-muted" title={`Target: ${format(targetDate, 'MMM d, yyyy')}`}>
        {format(targetDate, 'MMM d, yyyy')}
      </Td>
      <Td numeric title={progress.contributed > 0 ? breakdown : undefined}>
        <Money value={currentAmount} size="sm" />
      </Td>
      <Td numeric className="hidden lg:table-cell text-ink-muted" title={progress.contributed > 0 ? breakdown : undefined}>
        {progress.contributed > 0 ? <Money value={progress.contributed} size="sm" signed /> : '—'}
      </Td>
      <Td numeric><Money value={goal.targetAmount} size="sm" className="text-ink-muted" /></Td>
      <Td numeric><Money value={remaining} size="sm" className={remaining < 0 ? 'text-positive' : ''} /></Td>
      <Td className="w-[16%] min-w-[110px]">
        <span className="flex items-center gap-2">
          <Meter value={currentAmount} max={goal.targetAmount} tone="positive" className="flex-1" />
          <span className="w-12 text-right text-caption text-ink-secondary">{pct.toFixed(1)}%</span>
        </span>
      </Td>
      <Td numeric><Money value={goal.monthlyContribution} size="sm" /><span className="text-caption text-ink-muted">/mo</span></Td>
      <Td numeric className="text-ink-secondary">
        {completed ? '—' : projection ? `${projection.months} mo · ${format(projection.completionDate, 'MMM yyyy')}` : 'N/A'}
      </Td>
      <Td numeric className="text-caution">
        {!completed && !onTrack && monthsLeft > 0
          ? <span title="Needed per month to hit the target date">{formatCurrency(Math.ceil(remaining / monthsLeft))}/mo</span>
          : <span className="text-ink-muted">—</span>}
      </Td>
      <Td>
        {completed
          ? <Badge tone="positive">Goal Achieved</Badge>
          : onTrack ? <Badge tone="positive">On Track</Badge> : <Badge tone="caution">Behind</Badge>}
      </Td>
      <Td className="w-14 whitespace-nowrap text-right">
        <IconButton icon={Edit2} label={`Edit goal ${goal.name}`} onClick={() => onEdit(goal)} />
        <IconButton icon={Trash2} label={`Delete goal ${goal.name}`} title={`Delete ${goal.name}`} onClick={() => onDelete(goal)} className="hover:text-negative" />
      </Td>
    </Tr>
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
    <div className="space-y-2 animate-fade-in">
      {/* Add/Edit form */}
      {showForm && (
        <Panel title={editId ? 'Edit Goal' : 'Create New Goal'} bordered bodyClassName="p-3 space-y-2.5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-2">
            <div className="col-span-2">
              <label className="label-micro block mb-1">Goal Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Emergency Fund" className={`${INPUT} w-full`} />
            </div>
            <div>
              <label className="label-micro block mb-1">Target Amount</label>
              <input type="number" value={form.targetAmount} onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))} placeholder="$0" className={`${INPUT} w-full`} />
            </div>
            <div>
              <label className="label-micro block mb-1">Opening Balance</label>
              <input type="number" value={form.currentAmount} onChange={e => setForm(f => ({ ...f, currentAmount: e.target.value }))} placeholder="$0" className={`${INPUT} w-full`} />
              <p className="font-sans text-caption text-ink-muted mt-1">Starting amount. Log savings transactions to add more.</p>
            </div>
            <div>
              <label className="label-micro block mb-1">Monthly Contribution</label>
              <input type="number" value={form.monthlyContribution} onChange={e => setForm(f => ({ ...f, monthlyContribution: e.target.value }))} placeholder="$0" className={`${INPUT} w-full`} />
            </div>
            <div>
              <label className="label-micro block mb-1">Target Date</label>
              <input type="date" value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} className={`${INPUT} w-full`} />
            </div>
            <div>
              <label className="label-micro block mb-1">Color</label>
              <div className="flex flex-wrap gap-1.5 h-7 items-center">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))} className={`w-5 h-5 rounded-control outline-offset-1 ${form.color === c ? 'outline outline-1 outline-accent' : ''}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <div>
              <label className="label-micro block mb-1">Icon</label>
              <select value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} className={`${INPUT} w-full`}>
                {ICON_LIST.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button variant="primary" onClick={handleSave}>Save Goal</Button>
            <Button onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); }}>Cancel</Button>
          </div>
        </Panel>
      )}

      <PanelGrid>
        <Panel
          title="Goals"
          meta={`${savings_goals.length} active goal${savings_goals.length === 1 ? '' : 's'}`}
          actions={(
            <Button size="sm" variant="primary" icon={Plus} onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); }}>
              New Goal
            </Button>
          )}
          className="col-span-12"
        >
          {/* Totals strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border-b border-line">
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Saved toward goals</p>
              <Money value={goalTotals.saved} size="lg" className="block mt-0.5" />
              {goalTotals.target > 0 && (
                <p className="text-caption text-ink-muted mt-0.5">
                  {Math.round((goalTotals.saved / goalTotals.target) * 100)}% of everything you're saving for
                </p>
              )}
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Target total</p>
              <Money value={goalTotals.target} size="lg" className="block mt-0.5" />
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Still to go</p>
              <Money value={Math.max(0, goalTotals.target - goalTotals.saved)} size="lg" className="block mt-0.5" />
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Per month</p>
              <Money value={goalTotals.monthly} size="lg" className="block mt-0.5" />
            </div>
          </div>

          {/* Goals table */}
          {savings_goals.length === 0
            ? <EmptyState
                icon={Target}
                title="No savings goals yet"
                description="Name what you're saving for and the app tracks progress from your actual savings transactions — not a number you have to keep updating."
                actionLabel="Create a goal"
                onAction={() => { setShowForm(true); setEditId(null); }}
              />
            : (
              <Table>
                <thead>
                  <tr>
                    <Th>Goal</Th>
                    <Th numeric>Target date</Th>
                    <Th numeric>Saved</Th>
                    <Th numeric className="hidden lg:table-cell">Logged</Th>
                    <Th numeric>Target</Th>
                    <Th numeric>Remaining</Th>
                    <Th>Progress</Th>
                    <Th numeric>Monthly</Th>
                    <Th numeric>Reach goal</Th>
                    <Th numeric>Need</Th>
                    <Th>Status</Th>
                    <Th><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {savings_goals.map(g => (
                    <GoalRow key={g.id} goal={g} transactions={transactions} onEdit={openEdit} onDelete={() => removeItem({ type: 'goal', item: g })} />
                  ))}
                </tbody>
              </Table>
            )}
        </Panel>

        {/* Scenario calculator */}
        {savings_goals.length > 0 && (
          <Panel title="Scenario Calculator" className="col-span-12">
            <p className="font-sans text-sm text-ink-muted px-2.5 pt-2">See how changing your monthly contribution affects your goal timeline.</p>
            <div className="flex flex-wrap gap-1.5 p-2.5">
              <select value={scenarioGoal?.id || ''} onChange={e => setScenarioGoal(savings_goals.find(g => g.id === e.target.value) || null)} className={INPUT}>
                <option value="">Select a goal...</option>
                {savings_goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <input type="number" placeholder="Monthly savings amount" value={scenarioAmt} onChange={e => setScenarioAmt(e.target.value)} className={`${INPUT} w-56`} />
            </div>
            {scenarioProjection && scenarioGoal && (
              <div className="flex flex-wrap items-start gap-2.5 px-2.5 py-1.5 border-t border-line">
                <span className="shrink-0 w-12 text-center border border-current text-[10px] leading-[14px] tracking-[0.06em] mt-px text-accent-ink">CALC</span>
                <p className="flex-1 min-w-0 font-sans text-[12.5px] leading-snug text-ink">
                  If you save <strong>{formatCurrency(parseFloat(scenarioAmt))}/month</strong> toward <strong>{scenarioGoal.name}</strong>,
                  you'll reach your goal in <strong>{scenarioProjection.months} months</strong> — by <strong>{format(scenarioProjection.completionDate, 'MMMM yyyy')}</strong>.
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    dispatch({ type: 'UPDATE_GOAL', payload: { ...scenarioGoal, monthlyContribution: parseFloat(scenarioAmt) } });
                    setScenarioGoal({ ...scenarioGoal, monthlyContribution: parseFloat(scenarioAmt) });
                  }}
                >
                  Apply as monthly contribution
                </Button>
              </div>
            )}
          </Panel>
        )}
      </PanelGrid>
    </div>
  );
}
