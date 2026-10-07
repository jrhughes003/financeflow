import * as chart from '../ui/chartTheme';
import React, { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useFinancial, useTaxonomy } from '../../context/FinancialContext';
import { formatCurrency } from '../../utils/calculations';
import { compareDebtStrategies } from '../../utils/planning';
import { runOptimize } from '../../utils/runOptimize';
import { getSavingsOpportunities } from '../../utils/insights';
import { requiredPayment, isInRepayment } from '../../utils/accounts';
import type { PayoffOptimization, RunningOptimize } from '../../types/worker';
import { Panel, Badge } from '../ui';

/** The three comparable strategies. `custom` is the optimiser's, not a card. */
type StrategyKey = 'minimum' | 'avalanche' | 'snowball';

const STRATEGIES: { key: StrategyKey; label: string; color: string; blurb: string }[] = [
  { key: 'minimum', label: 'Minimums only', color: 'var(--c-ink-muted)', blurb: 'Pay each debt its minimum, nothing more.' },
  { key: 'avalanche', label: 'Avalanche', color: 'var(--c-data-1)', blurb: 'Extra money to the highest interest rate first — least interest paid.' },
  { key: 'snowball', label: 'Snowball', color: 'var(--c-caution)', blurb: 'Extra money to the smallest balance first — quickest early wins.' },
];
const TH = 'font-medium h-[22px] px-2.5 border-b border-line bg-surface-sunk whitespace-nowrap';
const fmtMonth = (d: string | null): string => (d ? format(parseISO(d), 'MMM yyyy') : '—');
const duration = (m: number | null): string => {
  if (m === null) return 'Never';
  const y = Math.floor(m / 12), r = m % 12;
  return [y && `${y} yr`, r && `${r} mo`].filter(Boolean).join(' ') || '0 mo';
};

export default function DebtStrategyPanel({ className = 'col-span-12' }: { className?: string }) {
  const { state } = useFinancial();
  const taxonomy = useTaxonomy();
  const { debts = [], transactions, budgets, recurringTemplates = [] } = state;
  const owing = useMemo(() => debts.filter(d => (Number(d.balance) || 0) > 0), [debts]);
  const [extra, setExtra] = useState(0);

  // "Found money" from the Save Money tab, as a one-click extra payment.
  // Rounded to the slider's $10 step so the link and the slider agree.
  const potential = useMemo(() => Math.round(
    getSavingsOpportunities({ transactions, budgets, recurringTemplates , taxonomy })
      .filter(o => o.monthlySaving !== null)
      .reduce((s, o) => s + (o.monthlySaving ?? 0), 0) / 10,
  ) * 10, [transactions, budgets, recurringTemplates, taxonomy]);

  const cmp = useMemo(() => compareDebtStrategies(owing, { extra }), [owing, extra]);

  // Searched rather than sorted. With fixed rates this lands on avalanche and
  // says so; it only diverges when a rate changes partway — a promotional 0%
  // reverting to 25% — which neither heuristic can see.
  //
  // It used to be a bare useMemo, which put an exhaustive search over every
  // payoff order on the render path: 1.4s at eight debts, once per $10 step of
  // the slider above. It now runs in a worker, and the debounce matters as much
  // as the worker does — a single drag fires dozens of changes, and without it
  // they queue behind each other and the panel falls minutes behind the slider.
  const [optimal, setOptimal] = useState<PayoffOptimization>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (owing.length < 2) { setOptimal(null); setSearching(false); return; }
    setSearching(true);
    let run: RunningOptimize | null = null;
    const timer = setTimeout(() => {
      run = runOptimize(owing, { extra });
      run.promise
        .then(result => {
          if (result && 'cancelled' in result) return; // superseded
          setOptimal(result);
          setSearching(false);
        })
        .catch(() => { setSearching(false); });
    }, 250);
    return () => { clearTimeout(timer); run?.cancel(); };
  }, [owing, extra]);

  if (!owing.length) {
    return (
      <Panel title="Debt Payoff Strategy" className={className}>
        <p className="font-sans text-sm text-ink-muted p-3">No debts with a balance are tracked — nothing to plan here.</p>
      </Panel>
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
    <Panel
      title="Debt Payoff Strategy"
      meta={`${owing.length} DEBT${owing.length > 1 ? 'S' : ''} · ${formatCurrency(totalMin)}/MO MIN`}
      className={className}
    >
      <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">
        {owing.length} debt{owing.length > 1 ? 's' : ''} · {formatCurrency(owing.reduce((s, d) => s + Number(d.balance), 0))} total · {formatCurrency(totalMin)}/mo in minimums.
        When a debt is paid off, its minimum rolls into the next one.
        {deferredDebts.length > 0 && ` ${deferredDebts.map(d => d.name).join(', ')} ${deferredDebts.length > 1 ? 'are' : 'is'} deferred — ${deferredDebts.length > 1 ? 'they join' : 'it joins'} the plan when repayment starts.`}
      </p>

      {/* Extra payment */}
      <div className="px-2.5 py-1.5 border-b border-line">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption uppercase tracking-[0.03em] text-ink-secondary">Extra each month on top of minimums</span>
          <span className="text-sm font-semibold text-ink">{formatCurrency(extra)}/mo</span>
        </div>
        <input
          type="range" min={0} max={sliderMax} step={10} value={extra}
          onChange={e => setExtra(Number(e.target.value))}
          className="w-full h-4 accent-accent"
          aria-label="Extra monthly debt payment"
        />
        {potential > 0 && (
          <button onClick={() => setExtra(Math.min(sliderMax, potential))} className="text-micro uppercase tracking-[0.06em] text-accent-ink hover:underline font-medium">
            Use the ~{formatCurrency(potential)}/mo found in Save Money
          </button>
        )}
      </div>

      {/* Strategy comparison */}
      <div className="overflow-x-auto border-b border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="label-micro">
              <th scope="col" className={`${TH} text-left`}>Strategy</th>
              <th scope="col" className={`${TH} text-right`}>Debt-free</th>
              <th scope="col" className={`${TH} text-right`}>Time</th>
              <th scope="col" className={`${TH} text-right`}>Interest</th>
              <th scope="col" className={`${TH} w-28`}><span className="sr-only">Recommendation</span></th>
            </tr>
          </thead>
          <tbody>
            {STRATEGIES.map(s => {
              const r = cmp[s.key];
              const recommended = cmp.recommended === s.key && extra > 0;
              return (
                <tr key={s.key} className={recommended ? 'bg-accent-tint' : 'hover:bg-surface-hover'}>
                  <td className="px-2.5 py-1 border-b border-line align-top">
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      <span className="w-[7px] h-[7px] shrink-0" style={{ backgroundColor: s.color }} aria-hidden="true" />{s.label}
                    </span>
                    <span className="block font-sans text-caption text-ink-muted mt-0.5">{s.blurb}</span>
                  </td>
                  {r.feasible ? (
                    <>
                      <td className="px-2.5 py-1 border-b border-line text-right align-top whitespace-nowrap font-medium text-ink">{fmtMonth(r.debtFreeDate)}</td>
                      <td className="px-2.5 py-1 border-b border-line text-right align-top whitespace-nowrap text-ink-secondary" title={`Debt-free in ${duration(r.months)}`}>{duration(r.months)}</td>
                      <td className="px-2.5 py-1 border-b border-line text-right align-top whitespace-nowrap text-ink-secondary" title={`${formatCurrency(r.totalInterest)} interest`}>{formatCurrency(r.totalInterest)}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="px-2.5 py-1 border-b border-line text-right align-top">
                      <span className="inline-flex items-center gap-1.5 font-sans text-sm text-negative">
                        <Badge tone="negative">Never</Badge>Payments don't cover the interest{r.unpayable?.length ? ` on ${r.unpayable.map((u: { name: string }) => u.name).join(', ')}` : ''}.
                      </span>
                    </td>
                  )}
                  <td className="px-2.5 py-1 border-b border-line text-right align-top">
                    {recommended && <Badge tone="accent">Recommended</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {extra === 0 ? (
        <p className="font-sans text-sm text-ink-secondary px-2.5 py-1.5 border-b border-line">With no extra money, avalanche and snowball only differ by rolling paid-off minimums forward. Move the slider to see how much faster you could be debt-free.</p>
      ) : best.feasible && cmp.interestSaved !== null && (
        <p className="font-sans text-sm text-ink-secondary px-2.5 py-1.5 border-b border-line">
          Paying {formatCurrency(extra)}/mo extra with the <span className="font-semibold">{(STRATEGIES.find(s => s.key === cmp.recommended)?.label ?? '').toLowerCase()}</span> method
          gets you debt-free <span className="font-semibold">{duration(cmp.monthsSaved)} sooner</span> and saves <span className="font-semibold text-positive">{formatCurrency(cmp.interestSaved)}</span> in interest.
          {cmp.recommended === 'snowball' && ' It costs almost the same as avalanche but clears your first debt sooner.'}
        </p>
      )}

      {searching && !optimal && (
        <p className="text-caption uppercase tracking-[0.03em] text-ink-muted px-2.5 py-1.5 border-b border-line" aria-busy="true">Checking payoff orders…</p>
      )}

      {optimal?.feasible && optimal.savingVsAvalanche > 0.5 && (
        <div className="flex items-start gap-2.5 px-2.5 py-1.5 border-b border-line">
          <Badge tone="accent" className="shrink-0 w-12 justify-center mt-px">Order</Badge>
          <div>
            <p className="font-sans text-[12.5px] leading-snug text-ink">
              <span className="font-medium">A cheaper order exists.</span> Paying{' '}
              {(optimal.order ?? []).map(o => o.name).join(' → ')} costs{' '}
              <span className="font-medium text-positive">{formatCurrency(optimal.savingVsAvalanche)}</span> less interest than
              avalanche{optimal.exhaustive ? ', and no other order is cheaper' : ''}.
            </p>
            <p className="font-sans text-caption text-ink-muted mt-0.5">
              Avalanche sorts by today's rate, so it misses a promotional rate that is about to revert.
              {optimal.exhaustive
                ? ` All ${optimal.searched.toLocaleString()} possible orders were checked.`
                : ` ${optimal.searched} orders were checked — too many debts to try every one.`}
            </p>
          </div>
        </div>
      )}

      {optimal?.feasible && optimal.matchesAvalanche && extra > 0 && (
        <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">
          {optimal.exhaustive
            ? `Checked all ${optimal.searched.toLocaleString()} payoff orders: avalanche is the cheapest.`
            : 'Avalanche is the cheapest order found.'}
        </p>
      )}

      <div className="grid lg:grid-cols-3 gap-px bg-line">
        <div className="lg:col-span-2 bg-surface p-3">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={series} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid {...chart.grid} />
              <XAxis dataKey="month" {...chart.xAxis} tickFormatter={m => (m % 12 === 0 ? `${m / 12}y` : `${m}m`)} interval="preserveStartEnd" minTickGap={30} />
              <YAxis {...chart.yAxis} tickFormatter={v => `$${Math.round(v / 1000)}k`} />
              <Tooltip {...chart.tooltip} labelFormatter={m => `Month ${m}`} formatter={(v, name) => [formatCurrency(chart.asNumber(v)), name]} />
              <Legend iconType="plainline" iconSize={10} wrapperStyle={{ fontSize: 10.5, fontFamily: 'var(--font-numeric)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 6 }} />
              {STRATEGIES.map(s => (
                <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-surface">
          <p className="label-micro px-2.5 h-[22px] leading-[22px] bg-surface-sunk border-b border-line">Payoff order ({STRATEGIES.find(s => s.key === cmp.recommended)?.label})</p>
          {best.payoffs.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2 h-row px-2.5 border-b border-line text-sm">
              <span className="flex-1 min-w-0 truncate text-ink-secondary">{i + 1}. {p.name}</span>
              <span className="text-ink-muted whitespace-nowrap">month {p.month}</span>
            </div>
          ))}
          {!best.feasible && <p className="font-sans text-caption text-negative px-2.5 py-1.5">Some debts never get paid off at this payment level.</p>}
        </div>
      </div>
    </Panel>
  );
}
