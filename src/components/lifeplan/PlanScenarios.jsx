import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import * as chart from '../ui/chartTheme';
import { Copy, Trash2, Upload, RefreshCw, Dices, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../utils/calculations';
import { runPlan } from '../../utils/lifeplan/engine';
import { runMonteCarlo } from '../../utils/lifeplan/montecarlo';
import { buildSnapshot, scenarioFromPlan, normalizePlan } from '../../utils/lifeplan/snapshot';
import { Card, NumberField, Stat, inputCls } from './ui';

// Fixed order so a scenario keeps its colour when others are toggled off.
const LINE_COLORS = ['var(--c-data-1)', 'var(--c-caution)', '#16a34a', '#db2777', '#0891b2'];
const money = v => formatCurrency(Math.round(v));
const compact = v => `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1000000 ? `${(Math.abs(v) / 1000000).toFixed(1)}M` : `${Math.round(Math.abs(v) / 1000)}k`}`;
const fmtDate = s => (s ? format(parseISO(s), 'MMM d, yyyy') : '');

function summarize(plan, state, label) {
  const snapshot = buildSnapshot(state, plan);
  const res = runPlan(plan, snapshot, {});
  const me = plan.people.find(p => p.id === 'me');
  const retireYear = me.birthYear ? Number(me.birthYear) + Number(me.retireAge || 65) : null;
  const today$ = (row, v) => (row ? v / row.inflationIndex : 0);
  return {
    label,
    plan,
    snapshot,
    res,
    retireYear,
    retirementNetWorth: res.retirementRow ? today$(res.retirementRow, res.retirementRow.netWorth) : null,
    endNetWorth: res.finalRow ? today$(res.finalRow, res.finalRow.netWorth) : null,
    lifetimeTax: (res.rows || []).reduce((s, r) => s + r.tax / r.inflationIndex, 0),
    firstShortfall: res.firstShortfall,
    houses: (plan.events || []).filter(e => e.type === 'house' && e.enabled !== false && e.date),
  };
}

export default function PlanScenarios({ plan, setPlan, state, result }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [confirmLoad, setConfirmLoad] = useState(null);
  const [mc, setMc] = useState(null);
  const [mcBusy, setMcBusy] = useState(false);
  const [volatility, setVolatility] = useState(12);
  const [trials, setTrials] = useState(300);

  const scenarios = plan.scenarios || [];
  const toggle = id => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const comparisons = useMemo(() => {
    if (result.needsSetup) return [];
    const picked = scenarios.filter(sc => selected.includes(sc.id));
    return [
      summarize(plan, state, 'Current plan'),
      ...picked.map(sc => summarize(normalizePlan(sc.plan), state, sc.name)),
    ];
  }, [plan, state, scenarios, selected, result.needsSetup]);

  const chartData = useMemo(() => {
    if (comparisons.length < 2) return [];
    const years = new Map();
    comparisons.forEach((c, i) => {
      (c.res.rows || []).forEach(r => {
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
  const updateFromCurrent = id => setPlan({
    ...plan,
    scenarios: scenarios.map(sc => (sc.id === id ? { ...scenarioFromPlan(plan, sc.name), id: sc.id } : sc)),
  });
  const load = sc => {
    setPlan({ ...normalizePlan(sc.plan), scenarios });
    setConfirmLoad(null);
  };
  const remove = id => {
    setPlan({ ...plan, scenarios: scenarios.filter(sc => sc.id !== id) });
    setSelected(s => s.filter(x => x !== id));
  };

  const runMc = () => {
    setMcBusy(true);
    setTimeout(() => {
      const snapshot = buildSnapshot(state, plan);
      setMc(runMonteCarlo(plan, snapshot, { trials: Number(trials), volatilityPct: Number(volatility) }));
      setMcBusy(false);
    }, 20);
  };

  const mcData = mc?.bands?.map(b => ({ year: b.year, age: b.age, range: [b.p10, b.p90], p50: b.p50 })) || [];

  if (result.needsSetup) {
    return <Card><p className="text-sm text-ink-muted text-center py-8">Add your birth year in Setup first.</p></Card>;
  }

  return (
    <div className="space-y-5">
      {/* Saved scenarios */}
      <Card
        title="Scenarios"
        subtitle="Save a copy of the whole plan, change something, and compare them side by side."
        actions={
          <div className="flex items-center gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. House in 2029" className={`${inputCls} w-52`} />
            <button onClick={save} className="flex items-center gap-1.5 px-3 py-2 bg-accent hover:bg-accent-hover text-ink-inverse rounded-container text-sm font-medium">
              <Copy className="w-3.5 h-3.5" />Save current
            </button>
          </div>
        }
      >
        {scenarios.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-4">
            No saved scenarios yet. Save the plan as it stands, then try moving the house date or changing the salary to see the difference.
          </p>
        ) : (
          <div className="space-y-2">
            {scenarios.map(sc => (
              <div key={sc.id} className="flex flex-wrap items-center gap-3 border border-line rounded-container p-3">
                <label className="flex items-center gap-2 cursor-pointer select-none flex-1 min-w-48">
                  <input type="checkbox" checked={selected.includes(sc.id)} onChange={() => toggle(sc.id)}
                    className="w-4 h-4 rounded-[3px] border-line-strong text-accent focus:ring-accent" />
                  <span>
                    <span className="text-sm font-medium text-ink">{sc.name}</span>
                    <span className="block text-caption text-ink-muted">saved {fmtDate(sc.savedAt)}</span>
                  </span>
                </label>
                {confirmLoad === sc.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-caption text-ink-secondary">Replace the current plan with this one?</span>
                    <button onClick={() => load(sc)} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption bg-accent hover:bg-accent-hover text-ink-inverse">Load it</button>
                    <button onClick={() => setConfirmLoad(null)} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateFromCurrent(sc.id)} className="flex items-center gap-1 px-2.5 py-1.5 border border-line-strong text-ink-secondary text-caption rounded-control hover:bg-surface-sunk" title="Overwrite with the current plan">
                      <RefreshCw className="w-3.5 h-3.5" />Update
                    </button>
                    <button onClick={() => setConfirmLoad(sc.id)} className="flex items-center gap-1 px-2.5 py-1.5 border border-accent text-accent-ink text-caption font-medium rounded-control hover:bg-accent-tint">
                      <Upload className="w-3.5 h-3.5" />Load
                    </button>
                    <button onClick={() => remove(sc.id)} className="p-1.5 text-ink-muted hover:text-negative hover:bg-negative-tint rounded-control"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Comparison */}
      {comparisons.length > 1 && (
        <Card title="Side by side" subtitle="All figures in today's dollars.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-caption text-ink-muted border-b border-line">
                  <th className="text-left font-medium py-2">Measure</th>
                  {comparisons.map((c, i) => (
                    <th key={c.label} className="text-right font-medium py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }} />{c.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Status', c => (c.firstShortfall ? `Runs short ${c.firstShortfall.year}` : 'Holds up')],
                  ['Net worth at retirement', c => (c.retirementNetWorth === null ? '—' : money(c.retirementNetWorth))],
                  [`Net worth at the end`, c => (c.endNetWorth === null ? '—' : money(c.endNetWorth))],
                  ['Lifetime tax', c => money(c.lifetimeTax)],
                  ['Home purchase', c => (c.houses.length ? c.houses.map(h => `${h.name}: ${h.date}`).join(', ') : 'none')],
                ].map(([label, get]) => (
                  <tr key={label} className="border-b border-line-faint">
                    <td className="py-2 text-ink-secondary">{label}</td>
                    {comparisons.map(c => <td key={c.label} className="py-2 text-right text-ink">{get(c)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{ top: 15, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid {...chart.grid} />
              <XAxis dataKey="year" {...chart.xAxis} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
              <YAxis {...chart.yAxis} tick={{ fontSize: 11 }} tickFormatter={compact} width={55} />
              <ReferenceLine y={0} stroke="var(--c-ink-muted)" />
              <Tooltip formatter={(v, n) => [money(v), comparisons[Number(n.slice(1))]?.label || n]} labelFormatter={y => `${y}`} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={n => comparisons[Number(n.slice(1))]?.label || n} />
              {comparisons.map((c, i) => (
                <Line key={c.label} dataKey={`s${i}`} name={`s${i}`} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Monte Carlo */}
      <Card
        title="What if markets don't cooperate?"
        subtitle="Runs the plan many times with a random return each year instead of the same return every year."
      >
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <NumberField label="Market swing (volatility)" value={volatility} onChange={setVolatility} suffix="%" step="1"
            hint="Year-to-year variation. A balanced portfolio is roughly 10–12%; all stocks closer to 16–18%." className="w-56" />
          <div className="w-40">
            <label className="label-micro block mb-1.5">Runs</label>
            <select value={trials} onChange={e => setTrials(e.target.value)} className={inputCls}>
              {[100, 300, 500, 1000].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button onClick={runMc} disabled={mcBusy} className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-ink-inverse rounded-container text-sm font-medium">
            <Dices className="w-4 h-4" />{mcBusy ? 'Running…' : 'Run'}
          </button>
        </div>

        {!mc ? (
          <p className="text-sm text-ink-muted">
            The projection elsewhere assumes a steady {plan.assumptions.returnPct}% every year. Real markets don't do that — this shows how often the plan still works.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <Stat label="Plans that hold up" value={`${Math.round(mc.successRate * 100)}%`}
                accent={mc.successRate >= 0.85 ? 'text-positive' : mc.successRate >= 0.6 ? 'text-caution' : 'text-negative'}
                sub={`${mc.trials - mc.failures} of ${mc.trials} runs`} />
              <Stat label="Typical outcome" value={mcData.length ? money(mcData[mcData.length - 1].p50) : '—'} sub="Median net worth at the end" />
              <Stat label="Unlucky (bottom 10%)" value={mcData.length ? money(mcData[mcData.length - 1].range[0]) : '—'} />
              <Stat label="Lucky (top 10%)" value={mcData.length ? money(mcData[mcData.length - 1].range[1]) : '—'} />
            </div>
            {mc.depletionYears && (
              <p className="flex items-start gap-2 text-sm text-caution bg-caution-tint border border-caution rounded-container p-3 mb-4">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                In the {mc.failures} run{mc.failures > 1 ? 's' : ''} that ran out, money typically lasted until {mc.depletionYears.p50} (earliest cases {mc.depletionYears.p10}).
              </p>
            )}
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={mcData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="year" {...chart.xAxis} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
                <YAxis {...chart.yAxis} tick={{ fontSize: 11 }} tickFormatter={compact} width={55} />
                <ReferenceLine y={0} stroke="var(--c-ink-muted)" />
                <Tooltip formatter={(v, n) => [Array.isArray(v) ? `${money(v[0])} – ${money(v[1])}` : money(v), n === 'range' ? 'Middle 80% of outcomes' : 'Typical (median)']} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={n => (n === 'range' ? 'Middle 80% of outcomes' : 'Typical (median)')} />
                <Area dataKey="range" stroke="none" fill={chart.SERIES.primary} fillOpacity={0.15} isAnimationActive={false} />
                <Line dataKey="p50" stroke={chart.SERIES.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-caption text-ink-muted mt-2">
              Net worth in today's dollars across {mc.trials} runs at {mc.volatilityPct}% volatility. Returns are drawn independently each year,
              so this shows the effect of market swings, not crashes that run several years.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
