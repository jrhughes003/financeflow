import type { SavingsOpportunity } from '../../utils/insights';
import React, { useMemo, useState } from 'react';
import { addMonths, format } from 'date-fns';
import { RotateCcw } from 'lucide-react';
import { useFinancial, useGetCategory, useTaxonomy } from '../../context/FinancialContext';
import { formatCurrency, getTotalIncome, getGoalProgress } from '../../utils/calculations';
import {
  getSavingsOpportunities, getCategoryAverages, simulateCuts, goalTimelineImpact,
} from '../../utils/insights';
import DuplicatesPanel from './DuplicatesPanel';
import { getIncomeSources } from '../../utils/accounts';
import {
  Panel, PanelGrid, KeyValue, Badge, Button, CategoryMark,
} from '../ui';
import type { BadgeTone } from '../ui';

// Each opportunity type as a short outlined tag, like the dashboard's signals.
const TYPE_TAG: Record<string, { tag: string; tone: BadgeTone } | undefined> = {
  over_budget: { tag: 'Over', tone: 'negative' },
  trending_up: { tag: 'Trend', tone: 'caution' },
  frequent_small: { tag: 'Small', tone: 'neutral' },
  price_increase: { tag: 'Price', tone: 'caution' },
  recurring_review: { tag: 'Recur', tone: 'neutral' },
};

const TH = 'font-medium h-[22px] px-2.5 border-b border-line bg-surface-sunk whitespace-nowrap';
const TD = 'h-row px-2.5 border-b border-line';

const SIM_CATEGORIES = 6;
const roundTo5 = (n: number): number => Math.min(100, Math.max(5, Math.round(n / 5) * 5));

// Plain-language title/detail for each opportunity type.
function describe(
  o: SavingsOpportunity,
  catName: (id: string) => string,
): { title: string; detail: string } {
  // Each case reads the fields its own `type` guarantees, but the opportunity
  // is one object rather than a union, so the checker cannot see that. These
  // keep the copy readable without asserting a guarantee nothing proves.
  const money = (n: number | undefined): string => formatCurrency(n ?? 0);
  const cat = (id: string | null | undefined): string => (id ? catName(id) : 'This category');

  switch (o.type) {
    case 'over_budget':
      return {
        title: `${cat(o.category)} runs over budget`,
        detail: `Averaging ${money(o.average)}/mo against a ${money(o.budget)} budget. Getting back to budget saves the difference.`,
      };
    case 'trending_up':
      return {
        title: `${cat(o.category)} is creeping up`,
        detail: `Up from ${money(o.previousAverage)}/mo to ${money(o.average)}/mo over the last few months. Returning to the earlier level saves the difference.`,
      };
    case 'frequent_small':
      return {
        title: `Small purchases at ${o.merchant} add up`,
        detail: `About ${o.perMonth} visits a month at ~${money(o.averageAmount)} each = ${money(o.monthlySpend)}/mo. Halving the visits saves the amount shown.`,
      };
    case 'price_increase':
      return {
        title: `${o.merchant} raised its price`,
        detail: `Went from ${money(o.before)} to ${money(o.after)}. Worth checking for a cheaper plan or cancelling.`,
      };
    default:
      return { title: '', detail: '' };
  }
}

export default function SavingsPanel() {
  const { state } = useFinancial();
  const taxonomy = useTaxonomy();
  const { transactions, budgets, incomes, savings_goals = [], recurringTemplates = [] } = state;
  const getCategory = useGetCategory();
  const catName = (id: string): string => getCategory(id).name;

  // Heavy scans — only recompute when the data changes, not on every slider move.
  const opportunities = useMemo(
    () => getSavingsOpportunities({ transactions, budgets, recurringTemplates, taxonomy }),
    [transactions, budgets, recurringTemplates, taxonomy],
  );
  const actionable = opportunities.filter(o => o.monthlySaving !== null);
  const review = opportunities.find(o => o.type === 'recurring_review');
  const totalPotential = actionable.reduce((s, o) => s + (o.annualSaving ?? 0), 0);

  // Simulator inputs
  const averages = useMemo(() => getCategoryAverages(transactions), [transactions]);
  const income = getTotalIncome(getIncomeSources(incomes, state.investments));
  const simCats = Object.entries(averages.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SIM_CATEGORIES)
    .map(([id]) => id);
  const [cuts, setCuts] = useState<Record<string, number>>({});
  const sim = simulateCuts(averages.byCategory, cuts, income);

  const openGoals = savings_goals.filter(g => getGoalProgress(g, transactions).percent < 100);
  const [goalId, setGoalId] = useState('');
  const goal = openGoals.find(g => g.id === goalId) || openGoals[0];
  const impact = goal ? goalTimelineImpact(goal, transactions, sim.monthlySaving) : null;
  const when = (months: number | null): string => (months === null ? 'not at the current pace' : months === 0 ? 'already reached' : `${format(addMonths(new Date(), months), 'MMM yyyy')} (${months} mo)`);

  const tryInSimulator = (o: SavingsOpportunity): void => {
    // Only offered for opportunities that name a category with an average to
    // cut against, which is what the button's own condition checks.
    const category = o.category;
    const avg = category ? averages.byCategory[category] : 0;
    if (!category || !avg) return;
    setCuts(c => ({ ...c, [category]: roundTo5(((o.monthlySaving ?? 0) / avg) * 100) }));
    document.getElementById('whatif-simulator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!averages.months) {
    return (
      <PanelGrid>
        <DuplicatesPanel />
        <Panel title="Savings Opportunities" className="col-span-12">
          <p className="font-sans text-sm text-ink-muted p-3">Savings suggestions appear once you have at least one full month of transactions.</p>
        </Panel>
      </PanelGrid>
    );
  }

  return (
    <PanelGrid className="grid-flow-row-dense">
      <DuplicatesPanel />

      {/* Opportunities */}
      <Panel
        title="Savings Opportunities"
        meta={`Based on your last ${averages.months} full month${averages.months > 1 ? 's' : ''} of spending`}
        className={`col-span-12 ${review ? 'xl:col-span-7' : ''}`}
      >
        {totalPotential > 0 && (
          <KeyValue label="Potential savings" strong>
            <span className="text-positive">{formatCurrency(totalPotential)}</span><span className="text-ink-muted">/yr</span>
          </KeyValue>
        )}

        {actionable.length === 0 ? (
          <div className="flex items-start gap-2.5 px-2.5 py-1.5">
            <Badge tone="positive" className="shrink-0 w-12 justify-center mt-px">OK</Badge>
            <p className="font-sans text-[12.5px] leading-snug text-ink">No obvious problem areas right now — spending is within budget and steady. Use the simulator below to explore cuts anyway.</p>
          </div>
        ) : (
          <ul>
            {actionable.map(o => {
              const { title, detail } = describe(o, catName);
              const canSimulate = o.type !== 'price_increase' && o.category && averages.byCategory[o.category] && simCats.includes(o.category);
              return (
                <li key={o.id} className="flex items-start gap-2.5 px-2.5 py-1.5 border-b border-line last:border-b-0">
                  <Badge tone={TYPE_TAG[o.type]?.tone ?? 'neutral'} className="shrink-0 w-12 justify-center mt-px">{TYPE_TAG[o.type]?.tag ?? 'TIP'}</Badge>
                  <div className="flex-1 min-w-0">
                    <p className="font-sans text-[12.5px] leading-snug font-semibold text-ink">{title}</p>
                    <p className="font-sans text-caption text-ink-muted mt-0.5">{detail}</p>
                    {canSimulate && (
                      <button onClick={() => tryInSimulator(o)} className="text-micro uppercase tracking-[0.06em] text-accent-ink hover:underline font-medium mt-1">
                        Try it in the simulator →
                      </button>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-positive">{formatCurrency(o.annualSaving ?? 0)}/yr</p>
                    <p className="text-caption text-ink-muted">{formatCurrency(o.monthlySaving ?? 0)}/mo</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* Recurring charges review */}
      {review && (
        <Panel
          title="Recurring Charges"
          meta={`${formatCurrency(review.monthlyTotal ?? 0)}/mo${income > 0 ? ` · ${Math.round(((review.monthlyTotal ?? 0) / income) * 100)}% of income` : ''}`}
          className="col-span-12 xl:col-span-5"
        >
          <KeyValue label="Per year" strong>
            {formatCurrency(review.annualTotal ?? 0)}<span className="text-ink-muted">/yr</span>
          </KeyValue>
          <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">{review.count} recurring charge{(review.count ?? 0) > 1 ? 's' : ''}, from your templates and ones detected in your history. Cancel any you don't use.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="label-micro">
                  <th scope="col" className={`${TH} text-left`}>Merchant</th>
                  <th scope="col" className={`${TH} text-left`}>Detail</th>
                  <th scope="col" className={`${TH} text-right`}>Yearly</th>
                  <th scope="col" className={`${TH} text-right`}>Monthly</th>
                </tr>
              </thead>
              <tbody>
                {(review.top ?? []).map(r => (
                  <tr key={`${r.source}-${r.merchant}`} className="hover:bg-surface-hover">
                    <td className={`${TD} text-ink-secondary`}>{r.merchant}</td>
                    <td className={`${TD} text-caption text-ink-muted`}>{catName(r.category)} · {r.frequency}{r.source === 'detected' && ' · detected'}</td>
                    <td className={`${TD} text-right text-ink whitespace-nowrap`}>{formatCurrency(r.annual)}/yr</td>
                    <td className={`${TD} text-right text-caption text-ink-muted whitespace-nowrap`}>{formatCurrency(r.monthly)}/mo</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* What-if simulator */}
      <div id="whatif-simulator" className="col-span-12 min-w-0 flex flex-col">
        <Panel
          title="What-If Simulator"
          className="flex-1"
          actions={Object.values(cuts).some(Boolean) && (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setCuts({})}>Reset</Button>
          )}
        >
          <div className="grid lg:grid-cols-2 gap-px bg-line">
            <div className="bg-surface">
              {simCats.map(id => {
                const cat = getCategory(id);
                const pct = cuts[id] || 0;
                const avg = averages.byCategory[id];
                return (
                  <div key={id} className="px-2.5 py-1.5 border-b border-line last:border-b-0">
                    <div className="flex justify-between items-baseline gap-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0 text-ink-secondary">
                        <CategoryMark color={cat.color} name={cat.name} />
                        <span className="text-caption text-ink-muted whitespace-nowrap">{formatCurrency(avg)}/mo</span>
                      </span>
                      <span className={`text-caption whitespace-nowrap ${pct ? 'text-positive' : 'text-ink-muted'}`}>
                        {pct ? `−${pct}% · saves ${formatCurrency(avg * pct / 100)}/mo` : 'no change'}
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={5} value={pct}
                      onChange={e => setCuts(c => ({ ...c, [id]: Number(e.target.value) }))}
                      className="w-full h-4 accent-accent"
                      aria-label={`Cut ${cat.name} by percent`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="bg-surface">
              <div className="grid grid-cols-2 gap-px bg-line border-b border-line">
                <div className="bg-surface px-2.5 py-1.5">
                  <p className="label-micro">Monthly savings</p>
                  <p className="text-xl font-medium text-positive mt-0.5 money">{formatCurrency(sim.monthlySaving)}</p>
                </div>
                <div className="bg-surface px-2.5 py-1.5">
                  <p className="label-micro">Yearly savings</p>
                  <p className="text-xl font-medium text-positive mt-0.5 money">{formatCurrency(sim.annualSaving)}</p>
                </div>
                <div className="bg-surface px-2.5 py-1.5">
                  <p className="label-micro">Monthly spending</p>
                  <p className="text-xl font-medium text-ink mt-0.5 money">{formatCurrency(sim.newSpend)}</p>
                  <p className="text-caption text-ink-muted">was {formatCurrency(sim.currentSpend)}</p>
                </div>
                <div className="bg-surface px-2.5 py-1.5">
                  <p className="label-micro">Savings rate</p>
                  {sim.newRate === null
                    ? <p className="font-sans text-sm text-ink-muted mt-1">Add income to see this</p>
                    : <>
                        <p className="text-xl font-medium text-ink mt-0.5">{sim.newRate}%</p>
                        <p className="text-caption text-ink-muted">was {sim.currentRate}%</p>
                      </>}
                </div>
              </div>

              {goal && impact && (
                <div className="px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="label-micro">If the savings go toward</p>
                    <select
                      value={goal.id}
                      onChange={e => setGoalId(e.target.value)}
                      className="h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink focus:outline-none focus:border-accent"
                    >
                      {openGoals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                  <p className="text-sm text-ink-secondary">
                    {formatCurrency(impact.remaining)} to go · currently saving {formatCurrency(impact.baseContribution)}/mo
                  </p>
                  <p className="text-sm text-ink-secondary mt-1">
                    Reached: <span className="text-ink-muted">{when(impact.currentMonths)}</span>
                    {sim.monthlySaving > 0 && <> → <span className="font-semibold text-positive">{when(impact.newMonths)}</span></>}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </PanelGrid>
  );
}
