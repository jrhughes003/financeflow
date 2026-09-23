import React, { useMemo, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import * as chart from './ui/chartTheme';
import { HeartPulse, ChevronDown } from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import { getFinancialHealth, getHealthTrend, healthLabel } from '../utils/healthScore';

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
            <h2 className="text-base font-semibold text-ink">Financial Health</h2>
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
            <ResponsiveContainer width="100%" height={44}>
              <LineChart data={trend} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                <YAxis {...chart.yAxis} hide domain={[0, 100]} />
                <Tooltip formatter={v => [v === null ? '—' : `${v} · ${healthLabel(v).label}`, 'Score']} labelFormatter={(_, p) => p?.[0]?.payload?.label} />
                <Line dataKey="score" stroke={chart.SERIES.primary} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
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
