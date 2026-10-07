import React, { useMemo, useState } from 'react';
import { useFinancial } from '../../context/FinancialContext';
import type { LifePlan } from '../../types/lifeplan';
import { needsSetup } from '../../types/projection';
import { formatCurrency } from '../../utils/calculations';
import { runPlan } from '../../utils/lifeplan/engine';
import { normalizePlan, buildSnapshot } from '../../utils/lifeplan/snapshot';
import PlanSetup from './PlanSetup';
import PlanEvents from './PlanEvents';
import PlanProjection from './PlanProjection';
import PlanScenarios from './PlanScenarios';
import { Note } from './ui';

const TABS = [
  { id: 'setup', label: 'Setup' },
  { id: 'events', label: 'Life Events' },
  { id: 'projection', label: 'Projection' },
  { id: 'scenarios', label: 'Scenarios' },
];

/** Plan + saver, stored inside settings (no database change needed). */
export function usePlan() {
  const { state, dispatch } = useFinancial();
  const plan = useMemo(() => normalizePlan(state.settings?.lifePlan), [state.settings?.lifePlan]);
  const setPlan = (next: LifePlan) => dispatch({ type: 'UPDATE_SETTINGS', payload: { lifePlan: next } });
  // `as const` so the three slots keep their own types instead of collapsing
  // into a union when destructured.
  return [plan, setPlan, state] as const;
}

interface PlanStatus {
  tone: 'ok' | 'warn' | 'info';
  /** The outlined tag in front of the status sentence. */
  tag: string;
  text: string;
}

export default function LifePlanPage() {
  const [plan, setPlan, state] = usePlan();
  const [tab, setTab] = useState('setup');

  const snapshot = useMemo(() => buildSnapshot(state, plan), [state, plan]);
  const result = useMemo(() => runPlan(plan, snapshot), [plan, snapshot]);

  const me = plan.people.find(p => p.id === 'me');
  const retireYear = me?.birthYear ? Number(me.birthYear) + Number(me.retireAge || 65) : null;
  const status: PlanStatus = needsSetup(result)
    ? { tone: 'info', tag: 'Setup', text: 'Add your birth year below to start the projection.' }
    : result.firstShortfall
      ? {
        tone: 'warn', tag: 'Short',
        text: `Money runs out in ${result.firstShortfall.year} (age ${result.firstShortfall.year - Number(me?.birthYear)}). Adjust spending, income, or the timing of your plans below.`,
      }
      : {
        tone: 'ok', tag: 'Holds',
        text: result.retirementRow
          // Quoted in today's dollars, like the Projection tab.
          ? `The plan holds to age ${plan.assumptions.endAge}. Net worth at retirement (${retireYear}): ${formatCurrency(result.retirementRow.netWorth / result.retirementRow.inflationIndex)} in today's dollars.`
          : `The plan holds to age ${plan.assumptions.endAge}.`,
      };
  const tone = ({ ok: 'positive', warn: 'caution', info: 'accent' } as const)[status.tone];

  return (
    <div className="space-y-2 animate-fade-in">
      <div className="bg-surface border border-line px-2.5 py-1.5">
        <Note tag={status.tag} tone={tone}>
          <p className="text-sm font-medium text-ink">{status.text}</p>
          <p className="text-caption text-ink-muted mt-0.5">
            Estimates for planning, using Ontario and federal tax rules and your own spending history — not financial or tax advice.
          </p>
        </Note>
      </div>

      <div className="flex flex-wrap border border-line-strong bg-surface w-fit max-w-full">
        {TABS.map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}
            className={`h-7 px-3 text-caption font-medium uppercase tracking-[0.06em] border-l border-line-strong first:border-l-0 transition-colors ${tab === id ? 'bg-accent-tint text-accent-ink' : 'text-ink-muted hover:text-ink hover:bg-surface-hover'}`}>
            {label}
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
