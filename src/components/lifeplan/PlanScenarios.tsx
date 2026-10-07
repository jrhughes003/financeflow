import React, { useId, useMemo, useState, useRef, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import * as chart from '../ui/chartTheme';
import { Copy, Trash2, Upload, RefreshCw, Dices } from 'lucide-react';
import { Button, IconButton, Meter, Table, Th, Td, Tr } from '../ui';
import { formatCurrency } from '../../utils/calculations';
import { runPlan } from '../../utils/lifeplan/engine';
import { runSimulation } from '../../utils/lifeplan/runSimulation';
import { buildSnapshot, scenarioFromPlan, normalizePlan } from '../../utils/lifeplan/snapshot';
import type { LifePlan, PlanScenario } from '../../types/lifeplan';
import type { AppState } from '../../types/state';
import type { PlanOutcome, PlanRow, SimulationResult } from '../../types/projection';
import { needsSetup } from '../../types/projection';
import { Card, NumberField, Stat, Note, inputCls } from './ui';

// Fixed order so a scenario keeps its colour when others are toggled off.
const LINE_COLORS = ['var(--c-data-1)', 'var(--c-caution)', 'var(--c-data-6)', 'var(--c-data-7)', 'var(--c-data-3)'];
const money = (v: number): string => formatCurrency(Math.round(v));
const compact = (v: number): string => `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1000000 ? `${(Math.abs(v) / 1000000).toFixed(1)}M` : `${Math.round(Math.abs(v) / 1000)}k`}`;
const fmtDate = (s: string | null | undefined): string => (s ? format(parseISO(s), 'MMM d, yyyy') : '');

function summarize(plan: LifePlan, state: AppState, label: string) {
  const snapshot = buildSnapshot(state, plan);
  const res = runPlan(plan, snapshot, {});
  // A saved scenario can be missing a birth year even when the current plan
  // has one, so this run may come back as the needs-setup marker.
  const projection = needsSetup(res) ? null : res;
  const me = plan.people.find(p => p.id === 'me');
  const retireYear = me?.birthYear ? Number(me.birthYear) + Number(me.retireAge || 65) : null;
  const today$ = (row: PlanRow | null, v: number) => (row ? v / row.inflationIndex : 0);
  return {
    label,
    plan,
    snapshot,
    res,
    retireYear,
    retirementNetWorth: projection?.retirementRow ? today$(projection.retirementRow, projection.retirementRow.netWorth) : null,
    endNetWorth: projection?.finalRow ? today$(projection.finalRow, projection.finalRow.netWorth) : null,
    lifetimeTax: (projection?.rows || []).reduce((s, r) => s + r.tax / r.inflationIndex, 0),
    firstShortfall: projection?.firstShortfall,
    houses: (plan.events || []).filter(e => e.type === 'house' && e.enabled !== false && e.date),
  };
}

type Comparison = ReturnType<typeof summarize>;

interface PlanScenariosProps {
  plan: LifePlan;
  setPlan: (next: LifePlan) => void;
  state: AppState;
  result: PlanOutcome;
}

export default function PlanScenarios({ plan, setPlan, state, result }: PlanScenariosProps) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null);
  const [mc, setMc] = useState<SimulationResult | null>(null);
  const [mcBusy, setMcBusy] = useState(false);
  const [mcProgress, setMcProgress] = useState({ completed: 0, total: 0 });
  const cancelRef = useRef<(() => void) | null>(null);
  // Both fields hand back the raw input string, which `Number(...)` coerces
  // at every read below.
  const [volatility, setVolatility] = useState<number | string>(12);
  const [trials, setTrials] = useState<number | string>(300);
  const runsId = useId();

  // See PlanProjection: a fresh [] each render would defeat the memo below.
  const scenarios = useMemo(() => plan.scenarios || [], [plan.scenarios]);
  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const planNeedsSetup = needsSetup(result);
  const comparisons = useMemo(() => {
    if (planNeedsSetup) return [];
    const picked = scenarios.filter(sc => selected.includes(sc.id));
    return [
      summarize(plan, state, 'Current plan'),
      ...picked.map(sc => summarize(normalizePlan(sc.plan), state, sc.name)),
    ];
  }, [plan, state, scenarios, selected, planNeedsSetup]);

  const chartData = useMemo(() => {
    if (comparisons.length < 2) return [];
    const years = new Map<number, Record<string, number>>();
    comparisons.forEach((c, i) => {
      (needsSetup(c.res) ? [] : c.res.rows || []).forEach(r => {
        const row = years.get(r.year) || { year: r.year };
        row[`s${i}`] = Math.round(r.netWorth / r.inflationIndex);
        years.set(r.year, row);
      });
    });
    return [...years.values()].sort((a, b) => a.year - b.year);
  }, [comparisons]);

  const save = () => {
    setPlan({ ...plan, scenarios: [...scenarios, scenarioFromPlan(plan, name.trim() || `Scenario ${scenarios.length + 1}`)] });
    setName('');
  };
  const updateFromCurrent = (id: string) => setPlan({
    ...plan,
    scenarios: scenarios.map(sc => (sc.id === id ? { ...scenarioFromPlan(plan, sc.name), id: sc.id } : sc)),
  });
  const load = (sc: PlanScenario) => {
    setPlan({ ...normalizePlan(sc.plan), scenarios });
    setConfirmLoad(null);
  };
  const remove = (id: string) => {
    setPlan({ ...plan, scenarios: scenarios.filter(sc => sc.id !== id) });
    setSelected(s => s.filter(x => x !== id));
  };

  // The simulation runs in a worker, so the window stays usable and the run can
  // be abandoned. Higher trial counts are the point: the interval at 300 trials
  // is about ±5 points, and tightening it used to mean freezing the UI longer.
  const runMc = () => {
    if (mcBusy) { cancelRef.current?.(); return; }
    setMcBusy(true);
    setMcProgress({ completed: 0, total: Number(trials) });

    const snapshot = buildSnapshot(state, plan);
    const { promise, cancel } = runSimulation(
      plan, snapshot,
      { trials: Number(trials), volatilityPct: Number(volatility) },
      setMcProgress,
    );
    cancelRef.current = cancel;

    promise
      // Named `res` rather than `result`, which is the component's own prop.
      .then(res => {
        // Cancelling resolves with { cancelled: true } rather than rejecting.
        if (!res || 'cancelled' in res) return;
        // The needs-setup marker cannot arrive here — this card sits behind
        // the projection's own needs-setup guard below.
        setMc(res as SimulationResult);
      })
      .catch(() => { /* surfaced by the run staying empty */ })
      .finally(() => { setMcBusy(false); cancelRef.current = null; });
  };

  // Abandon an in-flight run if the user leaves the page.
  useEffect(() => () => cancelRef.current?.(), []);

  const mcData = mc?.bands?.map(b => ({ year: b.year, age: b.age, range: [b.p10, b.p90], p50: b.p50 })) || [];

  if (planNeedsSetup) {
    return <Card><p className="font-sans text-sm text-ink-muted">Add your birth year in Setup first.</p></Card>;
  }

  return (
    <div className="space-y-2">
      {/* Saved scenarios */}
      <Card
        title="Scenarios"
        subtitle="Save a copy of the whole plan, change something, and compare them side by side."
        meta={scenarios.length ? `${scenarios.length} SAVED · ${selected.length} COMPARED` : undefined}
        flush
      >
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2 border-b border-line bg-surface-sunk">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. House in 2029" aria-label="Scenario name" className={`${inputCls} w-52`} />
          <Button variant="primary" icon={Copy} onClick={save}>Save current</Button>
        </div>
        {scenarios.length === 0 ? (
          <p className="font-sans text-sm text-ink-muted p-3">
            No saved scenarios yet. Save the plan as it stands, then try moving the house date or changing the salary to see the difference.
          </p>
        ) : (
          <ul>
            {scenarios.map(sc => (
              <li key={sc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-row px-2.5 py-1 border-b border-line last:border-b-0 hover:bg-surface-hover">
                <label className="flex items-center gap-2 cursor-pointer select-none flex-1 min-w-48">
                  <input type="checkbox" checked={selected.includes(sc.id)} onChange={() => toggle(sc.id)}
                    className="w-3.5 h-3.5 rounded-control border-line-strong accent-[var(--c-accent)]" />
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-ink">{sc.name}</span>
                    <span className="text-caption text-ink-muted">saved {fmtDate(sc.savedAt)}</span>
                  </span>
                </label>
                {confirmLoad === sc.id ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-sans text-caption text-ink-secondary">Replace the current plan with this one?</span>
                    <Button size="sm" variant="primary" onClick={() => load(sc)}>Load it</Button>
                    <Button size="sm" onClick={() => setConfirmLoad(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button size="sm" icon={RefreshCw} onClick={() => updateFromCurrent(sc.id)} title="Overwrite with the current plan">Update</Button>
                    <Button size="sm" icon={Upload} onClick={() => setConfirmLoad(sc.id)} className="text-accent-ink">Load</Button>
                    <IconButton icon={Trash2} label={`Delete ${sc.name}`} variant="danger" onClick={() => remove(sc.id)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Comparison */}
      {comparisons.length > 1 && (
        <Card title="Side by side" subtitle="All figures in today's dollars." meta={`${comparisons.length} PLANS`} flush>
          <Table>
            <thead>
              <tr>
                <Th>Measure</Th>
                {comparisons.map((c, i) => (
                  <Th key={c.label} numeric>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-[7px] h-[7px] shrink-0" style={{ backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }} aria-hidden="true" />{c.label}
                    </span>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                ['Status', c => (c.firstShortfall ? `Runs short ${c.firstShortfall.year}` : 'Holds up')],
                ['Net worth at retirement', c => (c.retirementNetWorth === null ? '—' : money(c.retirementNetWorth))],
                [`Net worth at the end`, c => (c.endNetWorth === null ? '—' : money(c.endNetWorth))],
                ['Lifetime tax', c => money(c.lifetimeTax)],
                ['Home purchase', c => (c.houses.length ? c.houses.map(h => `${h.name}: ${h.date}`).join(', ') : 'none')],
              ] as [string, (c: Comparison) => string][]).map(([label, get]) => (
                <Tr key={label}>
                  <Td className="text-caption uppercase tracking-[0.03em] text-ink-secondary whitespace-nowrap">{label}</Td>
                  {comparisons.map(c => {
                    const v = get(c);
                    const tone = label === 'Status' ? (c.firstShortfall ? 'text-caution' : 'text-positive') : 'text-ink';
                    return <Td key={c.label} numeric className={tone}>{v}</Td>;
                  })}
                </Tr>
              ))}
            </tbody>
          </Table>

          <div className="p-2">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 15, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="year" {...chart.xAxis} interval="preserveStartEnd" minTickGap={40} />
                <YAxis {...chart.yAxis} tickFormatter={compact} />
                <ReferenceLine y={0} stroke="var(--c-line-strong)" />
                {/* The series keys are `s0`, `s1`, … — the index maps back to the comparison. */}
                <Tooltip {...chart.tooltip} formatter={(v, n) => [money(chart.asNumber(v)), comparisons[Number(String(n).slice(1))]?.label || n]} labelFormatter={y => `${y}`} />
                <Legend wrapperStyle={chart.legend.wrapperStyle} iconSize={chart.legend.iconSize} formatter={n => comparisons[Number(String(n).slice(1))]?.label || n} />
                {comparisons.map((c, i) => (
                  <Line key={c.label} dataKey={`s${i}`} name={`s${i}`} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Monte Carlo */}
      <Card
        title="What if markets don't cooperate?"
        subtitle="Runs the plan many times over uncertain markets, and reports how often it survives — with the range that estimate is good to."
        meta={mc ? `${mc.trials} RUNS · ${mc.volatilityPct}% VOL` : undefined}
        flush
      >
        <div className="flex flex-wrap items-start gap-2 px-2.5 py-2 border-b border-line bg-surface-sunk">
          <NumberField label="Market swing (volatility)" value={volatility} onChange={setVolatility} suffix="%" step="1"
            hint="Year-to-year variation. A balanced portfolio is roughly 10–12%; all stocks closer to 16–18%." className="w-56" />
          <div className="w-32">
            <label htmlFor={runsId} className="label-micro block mb-1">Runs</label>
            <select id={runsId} value={trials} onChange={e => setTrials(e.target.value)} className={inputCls}>
              {[100, 300, 500, 1000].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Button variant="primary" icon={Dices} onClick={runMc} className="mt-[18px]">
            {mcBusy
              ? `Cancel (${Math.round((mcProgress.completed / Math.max(1, mcProgress.total)) * 100)}%)`
              : 'Run'}
          </Button>
        </div>

        {mcBusy && (
          <div className="px-2.5 py-1.5 border-b border-line">
            <Meter value={mcProgress.completed} max={Math.max(1, mcProgress.total)} />
            <p className="text-caption text-ink-muted mt-1.5">
              {mcProgress.completed} of {mcProgress.total} runs — the window stays usable while this works.
            </p>
          </div>
        )}

        {!mc ? (
          <p className="font-sans text-sm text-ink-muted p-3">
            The projection elsewhere assumes a steady {plan.assumptions.returnPct}% every year. Real markets don't do that — this shows how often the plan still works.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border-b border-line">
              {/* The interval matters as much as the estimate: at a few hundred
                  runs the sampling error is several points wide, and rounding it
                  to a bare percentage implies a precision the run doesn't have. */}
              <Stat label="Plans that hold up" value={`${Math.round(mc.successRate * 100)}%`}
                accent={mc.successRate >= 0.85 ? 'text-positive' : mc.successRate >= 0.6 ? 'text-caution' : 'text-negative'}
                sub={mc.successInterval
                  ? `${Math.round(mc.successInterval.low * 100)}–${Math.round(mc.successInterval.high * 100)}% likely, from ${mc.trials} runs`
                  : `${mc.trials - mc.failures} of ${mc.trials} runs`} />
              <Stat label="Typical outcome" value={mcData.length ? money(mcData[mcData.length - 1].p50) : '—'} sub="Median net worth at the end" />
              <Stat label="Unlucky (bottom 10%)" value={mcData.length ? money(mcData[mcData.length - 1].range[0]) : '—'} />
              <Stat label="Lucky (top 10%)" value={mcData.length ? money(mcData[mcData.length - 1].range[1]) : '—'} />
            </div>
            {mc.depletionYears && (
              <Note tag="Depleted" tone="caution" className="px-2.5 py-1.5 border-b border-line">
                <span className="text-sm text-caution">
                  In the {mc.failures} run{mc.failures > 1 ? 's' : ''} that ran out, money typically lasted until {mc.depletionYears.p50} (earliest cases {mc.depletionYears.p10}).
                </span>
              </Note>
            )}
            <div className="p-2">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={mcData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid {...chart.grid} />
                  <XAxis dataKey="year" {...chart.xAxis} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis {...chart.yAxis} tickFormatter={compact} />
                  <ReferenceLine y={0} stroke="var(--c-line-strong)" />
                  <Tooltip {...chart.tooltip} formatter={(v, n) => [Array.isArray(v) ? `${money(Number(v[0]))} – ${money(Number(v[1]))}` : money(chart.asNumber(v)), n === 'range' ? 'Middle 80% of outcomes' : 'Typical (median)']} />
                  <Legend wrapperStyle={chart.legend.wrapperStyle} iconSize={chart.legend.iconSize} formatter={n => (n === 'range' ? 'Middle 80% of outcomes' : 'Typical (median)')} />
                  <Area dataKey="range" stroke="none" fill={chart.SERIES.primary} fillOpacity={0.15} isAnimationActive={false} />
                  <Line dataKey="p50" stroke={chart.SERIES.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-t border-line">
              Net worth in today's dollars across {mc.trials} runs at {mc.volatilityPct}% volatility.
              Returns are drawn from a fat-tailed distribution with year-to-year persistence, so bad years
              can cluster — the sequence risk that matters once you're withdrawing. Runs are paired so each
              pair explores a path and its mirror image, which sharpens the estimate for the same number of runs.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
