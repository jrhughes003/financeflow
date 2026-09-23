import * as chart from '../ui/chartTheme';
import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Landmark, AlertTriangle, Sparkles } from 'lucide-react';
import { useFinancial } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { compareDebtStrategies } from '../../utils/planning';
import { optimizePayoff } from '../../utils/optimizePayoff';
import { getSavingsOpportunities } from '../../utils/insights';
import { requiredPayment, isInRepayment } from '../../utils/accounts';

/** The three comparable strategies. `custom` is the optimiser's, not a card. */
type StrategyKey = 'minimum' | 'avalanche' | 'snowball';

const STRATEGIES: { key: StrategyKey; label: string; color: string; blurb: string }[] = [
  { key: 'minimum', label: 'Minimums only', color: 'var(--c-ink-muted)', blurb: 'Pay each debt its minimum, nothing more.' },
  { key: 'avalanche', label: 'Avalanche', color: 'var(--c-data-1)', blurb: 'Extra money to the highest interest rate first — least interest paid.' },
  { key: 'snowball', label: 'Snowball', color: 'var(--c-caution)', blurb: 'Extra money to the smallest balance first — quickest early wins.' },
];
const fmtMonth = (d: string | null): string => (d ? format(parseISO(d), 'MMM yyyy') : '—');
const duration = (m: number | null): string => {
  if (m === null) return 'Never';
  const y = Math.floor(m / 12), r = m % 12;
  return [y && `${y} yr`, r && `${r} mo`].filter(Boolean).join(' ') || '0 mo';
};

export default function DebtStrategyPanel() {
  const { state } = useFinancial();
  const { debts = [], transactions, budgets, recurringTemplates = [] } = state;
  const owing = useMemo(() => debts.filter(d => (Number(d.balance) || 0) > 0), [debts]);
  const [extra, setExtra] = useState(0);

  // "Found money" from the Save Money tab, as a one-click extra payment.
  // Rounded to the slider's $10 step so the link and the slider agree.
  const potential = useMemo(() => Math.round(
    getSavingsOpportunities({ transactions, budgets, recurringTemplates })
      .filter(o => o.monthlySaving !== null)
      .reduce((s, o) => s + (o.monthlySaving ?? 0), 0) / 10,
  ) * 10, [transactions, budgets, recurringTemplates]);

  const cmp = useMemo(() => compareDebtStrategies(owing, { extra }), [owing, extra]);

  // Searched rather than sorted. With fixed rates this lands on avalanche and
  // says so; it only diverges when a rate changes partway — a promotional 0%
  // reverting to 25% — which neither heuristic can see.
  const optimal = useMemo(() => optimizePayoff(owing, { extra }), [owing, extra]);

  if (!owing.length) {
    return (
      <div className="bg-surface rounded-container border border-line p-5">
        <div className="flex items-center gap-2 mb-1">
          <Landmark className="w-4 h-4 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">Debt Payoff Strategy</h2>
        </div>
        <p className="text-sm text-ink-muted">No debts with a balance are tracked — nothing to plan here.</p>
      </div>
    );
  }

  const best = cmp[cmp.recommended];
  const totalMin = owing.reduce((s, d) => s + requiredPayment(d), 0);
  const deferredDebts = owing.filter(d => !isInRepayment(d));
  const sliderMax = Math.max(500, Math.ceil((totalMin * 2) / 50) * 50, Math.ceil(potential / 50) * 50);

  // One row per month with each strategy's remaining balance.
  const len = Math.max(...STRATEGIES.map(s => cmp[s.key].timeline.length));
  const series = Array.from({ length: len }, (_, i) => {
    const row: { month: number } & Partial<Record<StrategyKey, number>> = { month: i };
    STRATEGIES.forEach(s => { const p = cmp[s.key].timeline[i]; if (p) row[s.key] = p.balance; });
    return row;
  });

  return (
    <div className="bg-surface rounded-container border border-line p-5">
      <div className="flex items-start gap-2 mb-4">
        <Landmark className="w-4 h-4 text-ink-muted mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold text-ink">Debt Payoff Strategy</h2>
          <p className="text-caption text-ink-muted mt-0.5">
            {owing.length} debt{owing.length > 1 ? 's' : ''} · {formatCurrency(owing.reduce((s, d) => s + Number(d.balance), 0))} total · {formatCurrency(totalMin)}/mo in minimums.
            When a debt is paid off, its minimum rolls into the next one.
            {deferredDebts.length > 0 && ` ${deferredDebts.map(d => d.name).join(', ')} ${deferredDebts.length > 1 ? 'are' : 'is'} deferred — ${deferredDebts.length > 1 ? 'they join' : 'it joins'} the plan when repayment starts.`}
          </p>
        </div>
      </div>

      {/* Extra payment */}
      <div className="bg-surface-sunk rounded-container p-3 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <span className="text-sm text-ink-secondary">Extra each month on top of minimums</span>
          <span className="text-sm font-semibold text-ink">{formatCurrency(extra)}/mo</span>
        </div>
        <input
          type="range" min={0} max={sliderMax} step={10} value={extra}
          onChange={e => setExtra(Number(e.target.value))}
          className="w-full accent-blue-600"
          aria-label="Extra monthly debt payment"
        />
        {potential > 0 && (
          <button onClick={() => setExtra(Math.min(sliderMax, potential))} className="inline-flex items-center gap-1 text-caption text-accent hover:text-accent-ink font-medium mt-1">
            <Sparkles className="w-3.5 h-3.5" />Use the ~{formatCurrency(potential)}/mo found in Save Money
          </button>
        )}
      </div>

      {/* Strategy cards */}
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        {STRATEGIES.map(s => {
          const r = cmp[s.key];
          const recommended = cmp.recommended === s.key && extra > 0;
          return (
            <div key={s.key} className={`rounded-container p-3 border ${recommended ? 'border-accent bg-accent-tint/50' : 'border-line'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />{s.label}
                </span>
                {recommended && <span className="text-micro font-medium uppercase tracking-[0.06em] text-accent-ink bg-accent-tint px-1.5 py-0.5 rounded-control">Recommended</span>}
              </div>
              <p className="text-caption text-ink-muted mb-2">{s.blurb}</p>
              {r.feasible ? (
                <>
                  <p className="text-lg font-bold text-ink">{fmtMonth(r.debtFreeDate)}</p>
                  <p className="text-caption text-ink-muted">Debt-free in {duration(r.months)} · {formatCurrency(r.totalInterest)} interest</p>
                </>
              ) : (
                <p className="text-sm text-negative flex items-start gap-1"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />Payments don't cover the interest{r.unpayable?.length ? ` on ${r.unpayable.map((u: { name: string }) => u.name).join(', ')}` : ''}.</p>
              )}
            </div>
          );
        })}
      </div>

      {extra === 0 ? (
        <p className="text-sm text-ink-secondary mb-4">With no extra money, avalanche and snowball only differ by rolling paid-off minimums forward. Move the slider to see how much faster you could be debt-free.</p>
      ) : best.feasible && cmp.interestSaved !== null && (
        <p className="text-sm text-ink-secondary mb-4">
          Paying {formatCurrency(extra)}/mo extra with the <span className="font-semibold">{(STRATEGIES.find(s => s.key === cmp.recommended)?.label ?? '').toLowerCase()}</span> method
          gets you debt-free <span className="font-semibold">{duration(cmp.monthsSaved)} sooner</span> and saves <span className="font-semibold">{formatCurrency(cmp.interestSaved)}</span> in interest.
          {cmp.recommended === 'snowball' && ' It costs almost the same as avalanche but clears your first debt sooner.'}
        </p>
      )}

      {optimal?.feasible && optimal.savingVsAvalanche > 0.5 && (
        <div className="bg-accent-tint rounded-container p-4 mb-4">
          <p className="text-sm text-accent-ink">
            <span className="font-medium">A cheaper order exists.</span> Paying{' '}
            {(optimal.order ?? []).map(o => o.name).join(' → ')} costs{' '}
            <span className="font-medium">{formatCurrency(optimal.savingVsAvalanche)}</span> less interest than
            avalanche{optimal.exhaustive ? ', and no other order is cheaper' : ''}.
          </p>
          <p className="text-caption text-accent-ink/70 mt-1">
            Avalanche sorts by today's rate, so it misses a promotional rate that is about to revert.
            {optimal.exhaustive
              ? ` All ${optimal.searched.toLocaleString()} possible orders were checked.`
              : ` ${optimal.searched} orders were checked — too many debts to try every one.`}
          </p>
        </div>
      )}

      {optimal?.feasible && optimal.matchesAvalanche && extra > 0 && (
        <p className="text-caption text-ink-muted mb-4">
          {optimal.exhaustive
            ? `Checked all ${optimal.searched.toLocaleString()} payoff orders: avalanche is the cheapest.`
            : 'Avalanche is the cheapest order found.'}
        </p>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={series} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid {...chart.grid} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={m => (m % 12 === 0 ? `${m / 12}y` : `${m}m`)} interval="preserveStartEnd" minTickGap={30} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${Math.round(v / 1000)}k`} />
              <Tooltip labelFormatter={m => `Month ${m}`} formatter={(v, name) => [formatCurrency(chart.asNumber(v)), name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {STRATEGIES.map(s => (
                <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink-secondary mb-2">Payoff order ({STRATEGIES.find(s => s.key === cmp.recommended)?.label})</p>
          {best.payoffs.map((p, i) => (
            <div key={p.id} className="flex justify-between py-1.5 border-b border-line-faint text-sm">
              <span className="text-ink-secondary">{i + 1}. {p.name}</span>
              <span className="text-ink-muted">month {p.month}</span>
            </div>
          ))}
          {!best.feasible && <p className="text-caption text-negative mt-2">Some debts never get paid off at this payment level.</p>}
        </div>
      </div>
    </div>
  );
}
