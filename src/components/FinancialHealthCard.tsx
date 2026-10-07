import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import { getFinancialHealth, getHealthTrend, healthLabel } from '../utils/healthScore';
import { Panel, Button } from './ui';

type TrendPoint = ReturnType<typeof getHealthTrend>[number];
/** A month that actually scored. The sparkline is only ever given these. */
type ScoredTrendPoint = TrendPoint & { score: number };

// Six months of score, drawn on a fixed 0-100 scale so the slope means
// something. Each month carries a title, which is the hover detail a chart
// tooltip would have given.
function Sparkline({ points }: { points: ScoredTrendPoint[] }) {
  const w = 152;
  const h = 36;
  const pad = 4;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const y = (score: number) => h - pad - (Math.max(0, Math.min(100, score)) / 100) * (h - pad * 2);
  const coords = points.map((p, i) => [pad + i * step, y(p.score)]);
  const path = coords.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${yy.toFixed(1)}`).join(' ');

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
      role="img" aria-label={`Health score over the last ${points.length} months`}>
      {/* The 50 line, so "above or below middling" reads without an axis. */}
      <line x1={pad} x2={w - pad} y1={y(50)} y2={y(50)} stroke="var(--c-line)" strokeWidth="1"
        strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <path d={path} fill="none" stroke="var(--c-data-1)" strokeWidth="1.5"
        strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />
      {coords.map(([x, yy], i) => (
        <rect key={points[i].label} x={x - 1.5} y={yy - 1.5} width="3" height="3" fill="var(--c-data-1)">
          <title>{`${points[i].label}: ${points[i].score} · ${healthLabel(points[i].score).label}`}</title>
        </rect>
      ))}
    </svg>
  );
}

// The score as a square rule: fill length is the 0–100 score, in its band colour.
function ScoreBar({ score, color }: { score: number | null; color: string }) {
  return (
    <div className="relative h-1.5 bg-line" role="presentation">
      {score !== null && <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, score))}%`, backgroundColor: color }} />}
    </div>
  );
}

export default function FinancialHealthCard() {
  const { state } = useFinancial();
  const [open, setOpen] = useState(false);
  const health = useMemo(() => getFinancialHealth(state), [state]);
  const trend = useMemo(() => getHealthTrend(state), [state]);
  // A predicate rather than a plain filter: the months with no score are what
  // the change and the sparkline below would otherwise have to guard against.
  const scoredTrend = trend.filter((t): t is ScoredTrendPoint => t.score !== null);
  const change = scoredTrend.length >= 2 ? scoredTrend[scoredTrend.length - 1].score - scoredTrend[0].score : null;
  const weakest = health.components.filter(c => c.available && c.tip).sort((a, b) => a.score - b.score)[0];

  return (
    <Panel
      bordered
      title="Financial Health"
      meta={health.label}
      actions={(
        <Button size="sm" variant="ghost" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? 'Hide' : 'See'} breakdown <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </Button>
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_200px] gap-px bg-line border-b border-line">
        <div className="bg-surface px-2.5 py-1.5">
          <p className="label-micro">Score</p>
          <p className="mt-0.5 flex items-baseline gap-2">
            <span className="figure-display" style={{ color: health.color }}>{health.score === null ? '—' : health.score}</span>
            <span className="text-caption text-ink-muted">/100</span>
            <span className="text-caption uppercase tracking-[0.04em]" style={{ color: health.color }}>{health.label}</span>
          </p>
          <ScoreBar score={health.score} color={health.color} />
        </div>
        {scoredTrend.length >= 2 && (
          <div className="bg-surface px-2.5 py-1.5">
            <p className="label-micro flex justify-between">
              <span>Last {scoredTrend.length} months</span>
              {change !== null && change !== 0 && (
                <span className={change > 0 ? 'text-positive' : 'text-negative'}>{change > 0 ? '+' : ''}{change}</span>
              )}
            </p>
            <Sparkline points={scoredTrend} />
          </div>
        )}
      </div>

      <p className="font-sans text-sm text-ink-muted px-2.5 py-1.5">
        {health.score === null
          ? 'Record at least one full month of spending to get a score.'
          : weakest
            ? `Biggest opportunity — ${weakest.label.toLowerCase()}: ${weakest.tip}`
            : 'Every part of your score is in good shape.'}
      </p>

      {open && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="label-micro text-left">
                <th scope="col" className="font-medium h-[22px] px-2.5 border-b border-line bg-surface-sunk">Component</th>
                <th scope="col" className="font-medium px-2.5 border-b border-line bg-surface-sunk text-right">Wt</th>
                <th scope="col" className="font-medium px-2.5 border-b border-line bg-surface-sunk text-right">Value</th>
                <th scope="col" className="font-medium px-2.5 border-b border-line bg-surface-sunk w-[22%]">Score</th>
                <th scope="col" className="font-medium px-2.5 border-b border-line bg-surface-sunk text-right">Pts</th>
                <th scope="col" className="font-medium px-2.5 border-b border-line bg-surface-sunk">Detail</th>
              </tr>
            </thead>
            <tbody>
              {health.components.map(c => {
                const lbl = healthLabel(c.available ? c.score : null);
                return (
                  <tr key={c.key} className="hover:bg-surface-hover align-top">
                    <td className="h-row px-2.5 py-1 border-b border-line text-ink-secondary whitespace-nowrap">{c.label}</td>
                    <td className="px-2.5 py-1 border-b border-line text-right text-ink-muted">{c.weight}%</td>
                    <td className="px-2.5 py-1 border-b border-line text-right text-ink whitespace-nowrap">{c.available ? c.value : '—'}</td>
                    <td className="px-2.5 py-1 border-b border-line">
                      {c.available ? <div className="pt-1.5"><ScoreBar score={c.score} color={lbl.color} /></div> : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="px-2.5 py-1 border-b border-line text-right whitespace-nowrap" style={{ color: lbl.color }}>
                      {c.available ? <>{c.score}/100 · <span className="uppercase text-caption">{lbl.label}</span></> : <span className="text-caption uppercase">{lbl.label}</span>}
                    </td>
                    <td className="px-2.5 py-1 border-b border-line">
                      <p className="text-caption text-ink-muted">{c.detail}</p>
                      {c.available && c.tip && <p className="font-sans text-caption text-ink-secondary mt-0.5">{c.tip}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
