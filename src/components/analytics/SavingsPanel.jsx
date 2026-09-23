import React, { useMemo, useState } from 'react';
import { addMonths, format } from 'date-fns';
import { AlertTriangle, TrendingUp, Coffee, BadgeDollarSign, Repeat, SlidersHorizontal, RotateCcw, Lightbulb } from 'lucide-react';
import { useFinancial, useGetCategory } from '../../context/FinancialContext';
import { formatCurrency, getTotalIncome, getGoalProgress } from '../../utils/calculations';
import {
  getSavingsOpportunities, getCategoryAverages, simulateCuts, goalTimelineImpact,
} from '../../utils/insights';
import DuplicatesPanel from './DuplicatesPanel';
import { getIncomeSources } from '../../utils/accounts';

const TYPE_ICON = {
  over_budget: AlertTriangle,
  trending_up: TrendingUp,
  frequent_small: Coffee,
  price_increase: BadgeDollarSign,
  recurring_review: Repeat,
};

const SIM_CATEGORIES = 6;
const roundTo5 = n => Math.min(100, Math.max(5, Math.round(n / 5) * 5));

// Plain-language title/detail for each opportunity type.
function describe(o, catName) {
  switch (o.type) {
    case 'over_budget':
      return {
        title: `${catName(o.category)} runs over budget`,
        detail: `Averaging ${formatCurrency(o.average)}/mo against a ${formatCurrency(o.budget)} budget. Getting back to budget saves the difference.`,
      };
    case 'trending_up':
      return {
        title: `${catName(o.category)} is creeping up`,
        detail: `Up from ${formatCurrency(o.previousAverage)}/mo to ${formatCurrency(o.average)}/mo over the last few months. Returning to the earlier level saves the difference.`,
      };
    case 'frequent_small':
      return {
        title: `Small purchases at ${o.merchant} add up`,
        detail: `About ${o.perMonth} visits a month at ~${formatCurrency(o.averageAmount)} each = ${formatCurrency(o.monthlySpend)}/mo. Halving the visits saves the amount shown.`,
      };
    case 'price_increase':
      return {
        title: `${o.merchant} raised its price`,
        detail: `Went from ${formatCurrency(o.before)} to ${formatCurrency(o.after)}. Worth checking for a cheaper plan or cancelling.`,
      };
    default:
      return { title: '', detail: '' };
  }
}

export default function SavingsPanel() {
  const { state } = useFinancial();
  const { transactions, budgets, incomes, savings_goals = [], recurringTemplates = [] } = state;
  const getCategory = useGetCategory();
  const catName = id => getCategory(id).name;

  // Heavy scans — only recompute when the data changes, not on every slider move.
  const opportunities = useMemo(
    () => getSavingsOpportunities({ transactions, budgets, recurringTemplates }),
    [transactions, budgets, recurringTemplates],
  );
  const actionable = opportunities.filter(o => o.monthlySaving !== null);
  const review = opportunities.find(o => o.type === 'recurring_review');
  const totalPotential = actionable.reduce((s, o) => s + o.annualSaving, 0);

  // Simulator inputs
  const averages = useMemo(() => getCategoryAverages(transactions), [transactions]);
  const income = getTotalIncome(getIncomeSources(incomes, state.investments));
  const simCats = Object.entries(averages.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SIM_CATEGORIES)
    .map(([id]) => id);
  const [cuts, setCuts] = useState({});
  const sim = simulateCuts(averages.byCategory, cuts, income);

  const openGoals = savings_goals.filter(g => getGoalProgress(g, transactions).percent < 100);
  const [goalId, setGoalId] = useState('');
  const goal = openGoals.find(g => g.id === goalId) || openGoals[0];
  const impact = goal ? goalTimelineImpact(goal, transactions, sim.monthlySaving) : null;
  const when = months => (months === null ? 'not at the current pace' : months === 0 ? 'already reached' : `${format(addMonths(new Date(), months), 'MMM yyyy')} (${months} mo)`);

  const tryInSimulator = o => {
    const avg = averages.byCategory[o.category];
    if (!avg) return;
    setCuts(c => ({ ...c, [o.category]: roundTo5((o.monthlySaving / avg) * 100) }));
    document.getElementById('whatif-simulator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!averages.months) {
    return (
      <div className="space-y-6">
      <DuplicatesPanel />
      <div className="bg-surface rounded-container border border-line p-5">
        <h2 className="text-base font-semibold text-ink mb-1">Savings Opportunities</h2>
        <p className="text-sm text-ink-muted">Savings suggestions appear once you have at least one full month of transactions.</p>
      </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DuplicatesPanel />

      {/* Opportunities */}
      <div className="bg-surface rounded-container border border-line p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Savings Opportunities</h2>
            <p className="text-caption text-ink-muted mt-0.5">Based on your last {averages.months} full month{averages.months > 1 ? 's' : ''} of spending</p>
          </div>
          {totalPotential > 0 && (
            <div className="text-right">
              <p className="text-caption text-ink-muted">Potential savings</p>
              <p className="text-xl font-bold text-positive">{formatCurrency(totalPotential)}<span className="text-sm font-medium text-ink-muted">/yr</span></p>
            </div>
          )}
        </div>

        {actionable.length === 0 ? (
          <div className="flex items-start gap-3 bg-positive-tint border border-positive rounded-container p-3">
            <Lightbulb className="w-4 h-4 text-positive shrink-0 mt-0.5" />
            <p className="text-sm text-positive">No obvious problem areas right now — spending is within budget and steady. Use the simulator below to explore cuts anyway.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {actionable.map(o => {
              const Icon = TYPE_ICON[o.type];
              const { title, detail } = describe(o, catName);
              const canSimulate = o.type !== 'price_increase' && o.category && averages.byCategory[o.category] && simCats.includes(o.category);
              return (
                <div key={o.id} className="flex items-start gap-3 border border-line rounded-container p-3">
                  <div className="w-8 h-8 rounded-control bg-surface-sunk flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-ink-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink">{title}</p>
                    <p className="text-caption text-ink-muted mt-0.5">{detail}</p>
                    {canSimulate && (
                      <button onClick={() => tryInSimulator(o)} className="text-caption text-accent hover:text-accent-ink font-medium mt-1.5">
                        Try it in the simulator →
                      </button>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-positive">{formatCurrency(o.annualSaving)}/yr</p>
                    <p className="text-caption text-ink-muted">{formatCurrency(o.monthlySaving)}/mo</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recurring charges review */}
      {review && (
        <div className="bg-surface rounded-container border border-line p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Recurring Charges</h2>
              <p className="text-caption text-ink-muted mt-0.5">{review.count} recurring charge{review.count > 1 ? 's' : ''}, from your templates and ones detected in your history. Cancel any you don't use.</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-ink">{formatCurrency(review.annualTotal)}<span className="text-sm font-medium text-ink-muted">/yr</span></p>
              <p className="text-caption text-ink-muted">{formatCurrency(review.monthlyTotal)}/mo{income > 0 && ` · ${Math.round((review.monthlyTotal / income) * 100)}% of income`}</p>
            </div>
          </div>
          {review.top.map(r => (
            <div key={`${r.source}-${r.merchant}`} className="flex justify-between items-center py-1.5 border-b border-line-faint">
              <div>
                <p className="text-sm text-ink-secondary">{r.merchant}</p>
                <p className="text-caption text-ink-muted">{catName(r.category)} · {r.frequency}{r.source === 'detected' && ' · detected'}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-ink">{formatCurrency(r.annual)}/yr</p>
                <p className="text-caption text-ink-muted">{formatCurrency(r.monthly)}/mo</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* What-if simulator */}
      <div id="whatif-simulator" className="bg-surface rounded-container border border-line p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-ink-muted" />
            <h2 className="text-base font-semibold text-ink">What-If Simulator</h2>
          </div>
          {Object.values(cuts).some(Boolean) && (
            <button onClick={() => setCuts({})} className="flex items-center gap-1 text-caption text-ink-muted hover:text-ink-secondary">
              <RotateCcw className="w-3.5 h-3.5" />Reset
            </button>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            {simCats.map(id => {
              const cat = getCategory(id);
              const pct = cuts[id] || 0;
              const avg = averages.byCategory[id];
              return (
                <div key={id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="flex items-center gap-2 text-ink-secondary">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                      {cat.name}
                      <span className="text-caption text-ink-muted">{formatCurrency(avg)}/mo</span>
                    </span>
                    <span className="text-ink font-medium">
                      {pct ? `−${pct}% · saves ${formatCurrency(avg * pct / 100)}/mo` : 'no change'}
                    </span>
                  </div>
                  <input
                    type="range" min={0} max={100} step={5} value={pct}
                    onChange={e => setCuts(c => ({ ...c, [id]: Number(e.target.value) }))}
                    className="w-full accent-blue-600"
                    aria-label={`Cut ${cat.name} by percent`}
                  />
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-positive-tint rounded-container p-3">
                <p className="text-caption text-positive">Monthly savings</p>
                <p className="text-lg font-bold text-positive">{formatCurrency(sim.monthlySaving)}</p>
              </div>
              <div className="bg-positive-tint rounded-container p-3">
                <p className="text-caption text-positive">Yearly savings</p>
                <p className="text-lg font-bold text-positive">{formatCurrency(sim.annualSaving)}</p>
              </div>
              <div className="bg-surface-sunk rounded-container p-3">
                <p className="text-caption text-ink-muted">Monthly spending</p>
                <p className="text-lg font-bold text-ink">{formatCurrency(sim.newSpend)}</p>
                <p className="text-caption text-ink-muted">was {formatCurrency(sim.currentSpend)}</p>
              </div>
              <div className="bg-surface-sunk rounded-container p-3">
                <p className="text-caption text-ink-muted">Savings rate</p>
                {sim.newRate === null
                  ? <p className="text-sm text-ink-muted mt-1">Add income to see this</p>
                  : <>
                      <p className="text-lg font-bold text-ink">{sim.newRate}%</p>
                      <p className="text-caption text-ink-muted">was {sim.currentRate}%</p>
                    </>}
              </div>
            </div>

            {goal && impact && (
              <div className="border border-line rounded-container p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-caption text-ink-muted">If the savings go toward</p>
                  <select
                    value={goal.id}
                    onChange={e => setGoalId(e.target.value)}
                    className="text-sm border border-line-strong rounded-control px-2 py-1 bg-surface focus:outline-none focus:border-accent"
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
      </div>
    </div>
  );
}
