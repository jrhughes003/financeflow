import React, { useMemo, useState } from 'react';
import { HeartPulse, ChevronDown } from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import { getFinancialHealth, getHealthTrend, healthLabel } from '../utils/healthScore';

// Six months of score, drawn on a fixed 0-100 scale so the slope means
// something. Each month carries a title, which is the hover detail a chart
// tooltip would have given.
function Sparkline({ points }) {
  const w = 152;
  const h = 44;
  const pad = 4;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const y = score => h - pad - (Math.max(0, Math.min(100, score)) / 100) * (h - pad * 2);
  const coords = points.map((p, i) => [pad + i * step, y(p.score)]);
  const path = coords.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${yy.toFixed(1)}`).join(' ');

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
      role="img" aria-label={`Health score over the last ${points.length} months`}>
      <path d={path} fill="none" stroke="var(--c-data-1)" strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {coords.map(([x, yy], i) => (
        <circle key={points[i].label} cx={x} cy={yy} r="2" fill="var(--c-data-1)">
          <title>{`${points[i].label}: ${points[i].score} · ${healthLabel(points[i].score).label}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// Score ring: stroke length encodes the 0–100 score; the number sits inside.
function Ring({ score, color }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const filled = score === null ? 0 : (score / 100) * c;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={score === null ? 'No score yet' : `Score ${score} of 100`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--c-line-faint)" strokeWidth="8" />
      {filled > 0 && (
        <circle
          cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`} transform="rotate(-90 44 44)"
        />
      )}
      <text x="44" y="50" textAnchor="middle" className="fill-gray-900" style={{ fontSize: 22, fontWeight: 800 }}>
        {score === null ? '—' : score}
      </text>
    </svg>
  );
}

export default function FinancialHealthCard() {
  const { state } = useFinancial();
  const [open, setOpen] = useState(false);
  const health = useMemo(() => getFinancialHealth(state), [state]);
  const trend = useMemo(() => getHealthTrend(state), [state]);
  const scoredTrend = trend.filter(t => t.score !== null);
  const change = scoredTrend.length >= 2 ? scoredTrend[scoredTrend.length - 1].score - scoredTrend[0].score : null;
  const weakest = health.components.filter(c => c.available && c.tip).sort((a, b) => a.score - b.score)[0];

  return (
    <div className="bg-surface rounded-container border border-line p-5">
      <div className="flex flex-wrap items-center gap-5">
        <Ring score={health.score} color={health.color} />
        <div className="flex-1 min-w-48">
          <div className="flex items-center gap-2">
            <HeartPulse className="w-4 h-4 text-ink-muted" />
            <h2 className="text-lg font-semibold text-ink">Financial Health</h2>
          </div>
          <p className="text-lg font-bold mt-0.5" style={{ color: health.color }}>{health.label}</p>
          {health.score === null ? (
            <p className="text-caption text-ink-muted">Record at least one full month of spending to get a score.</p>
          ) : weakest ? (
            <p className="text-caption text-ink-muted">Biggest opportunity — {weakest.label.toLowerCase()}: {weakest.tip}</p>
          ) : (
            <p className="text-caption text-ink-muted">Every part of your score is in good shape.</p>
          )}
        </div>

        {scoredTrend.length >= 2 && (
          <div className="w-40">
            <p className="text-caption text-ink-muted text-right">
              Last {scoredTrend.length} months{change !== null && change !== 0 && (
                <span className={change > 0 ? 'text-positive font-medium' : 'text-negative font-medium'}> {change > 0 ? '+' : ''}{change}</span>
              )}
            </p>
            <Sparkline points={scoredTrend} />
          </div>
        )}

        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-caption text-accent hover:text-accent-ink font-medium" aria-expanded={open}>
          {open ? 'Hide' : 'See'} breakdown <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-3 mt-4 pt-4 border-t border-line">
          {health.components.map(c => {
            const lbl = healthLabel(c.available ? c.score : null);
            return (
              <div key={c.key} className="bg-surface-sunk rounded-container p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-caption font-medium text-ink-secondary">{c.label}</p>
                  <p className="text-caption text-ink-muted">{c.weight}%</p>
                </div>
                {c.available ? (
                  <>
                    <p className="text-lg font-bold text-ink">{c.value}</p>
                    <p className="text-caption text-ink-muted">{c.detail}</p>
                    <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden mt-2">
                      <div className="h-full rounded-full" style={{ width: `${c.score}%`, backgroundColor: lbl.color }} />
                    </div>
                    <p className="text-caption mt-1" style={{ color: lbl.color }}>{c.score}/100 · {lbl.label}</p>
                    {c.tip && <p className="text-caption text-ink-secondary mt-1.5">{c.tip}</p>}
                  </>
                ) : (
                  <p className="text-caption text-ink-muted mt-1">{c.detail}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
