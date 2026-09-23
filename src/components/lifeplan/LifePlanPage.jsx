import React, { useMemo, useState } from 'react';
import { SlidersHorizontal, Flag, LineChart as LineChartIcon, GitCompare, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useFinancial } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { runPlan } from '../../utils/lifeplan/engine';
import { normalizePlan, buildSnapshot } from '../../utils/lifeplan/snapshot';
import PlanSetup from './PlanSetup';
import PlanEvents from './PlanEvents';
import PlanProjection from './PlanProjection';
import PlanScenarios from './PlanScenarios';

const TABS = [
  { id: 'setup', label: 'Setup', icon: SlidersHorizontal },
  { id: 'events', label: 'Life Events', icon: Flag },
  { id: 'projection', label: 'Projection', icon: LineChartIcon },
  { id: 'scenarios', label: 'Scenarios', icon: GitCompare },
];

/** Plan + saver, stored inside settings (no database change needed). */
export function usePlan() {
  const { state, dispatch } = useFinancial();
  const plan = useMemo(() => normalizePlan(state.settings?.lifePlan), [state.settings?.lifePlan]);
  const setPlan = next => dispatch({ type: 'UPDATE_SETTINGS', payload: { lifePlan: next } });
  return [plan, setPlan, state];
}

export default function LifePlanPage() {
  const [plan, setPlan, state] = usePlan();
  const [tab, setTab] = useState('setup');

  const snapshot = useMemo(() => buildSnapshot(state, plan), [state, plan]);
  const result = useMemo(() => runPlan(plan, snapshot), [plan, snapshot]);

  const me = plan.people.find(p => p.id === 'me');
  const retireYear = me.birthYear ? Number(me.birthYear) + Number(me.retireAge || 65) : null;
  const status = result.needsSetup
    ? { tone: 'info', icon: Info, text: 'Add your birth year below to start the projection.' }
    : result.firstShortfall
      ? {
        tone: 'warn', icon: AlertTriangle,
        text: `Money runs out in ${result.firstShortfall.year} (age ${result.firstShortfall.year - Number(me.birthYear)}). Adjust spending, income, or the timing of your plans below.`,
      }
      : {
        tone: 'ok', icon: CheckCircle2,
        text: result.retirementRow
          // Quoted in today's dollars, like the Projection tab.
          ? `The plan holds to age ${plan.assumptions.endAge}. Net worth at retirement (${retireYear}): ${formatCurrency(result.retirementRow.netWorth / result.retirementRow.inflationIndex)} in today's dollars.`
          : `The plan holds to age ${plan.assumptions.endAge}.`,
      };
  const toneCls = { ok: 'bg-positive-tint border-positive text-positive', warn: 'bg-caution-tint border-caution text-caution', info: 'bg-accent-tint border-accent text-accent-ink' }[status.tone];
  const StatusIcon = status.icon;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className={`flex items-start gap-3 rounded-container border p-4 ${toneCls}`}>
        <StatusIcon className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium">{status.text}</p>
          <p className="text-caption opacity-75 mt-0.5">
            Estimates for planning, using Ontario and federal tax rules and your own spending history — not financial or tax advice.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap bg-surface-hover rounded-container p-1 w-fit max-w-full">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-control text-sm font-medium transition-colors ${tab === id ? 'bg-surface  text-accent' : 'text-ink-muted hover:text-ink-secondary'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'setup' && <PlanSetup plan={plan} setPlan={setPlan} state={state} snapshot={snapshot} />}
      {tab === 'events' && <PlanEvents plan={plan} setPlan={setPlan} snapshot={snapshot} result={result} />}
      {tab === 'projection' && <PlanProjection plan={plan} result={result} />}
      {tab === 'scenarios' && <PlanScenarios plan={plan} setPlan={setPlan} state={state} result={result} />}
    </div>
  );
}
