/*
 * The category list, and which budget each one counts toward.
 *
 * Until now nothing in the app showed the taxonomy. Categories appeared only
 * inside dropdowns, so when the list grew from 5 to 18 they looked like
 * options that existed nowhere else — you could pick Travel on a transaction
 * and then never see the word again, because every other screen iterates over
 * your budgets or your spending and looks categories up by id.
 *
 * It earns its place twice over now that budgets are set at group level: the
 * question "where does this money actually land?" has a real answer, and it is
 * the only place to change it. The shipped grouping cannot be right for
 * everyone — someone with a custom "Rent+Household" category wants Housing and
 * Utilities underneath it, and no default can know that.
 */

import React from 'react';
import { Layers, RotateCcw } from 'lucide-react';
import { useFinancial, useTaxonomy } from '../context/FinancialContext';
import { groups as groupsOf, childrenOf, selectable, groupOf } from '../utils/categoryTree';
import { formatCurrency } from '../utils/calculations';
import { getSpendingByCategory } from '../utils/calculations';

export default function CategoryGrouping() {
  const { state, dispatch } = useFinancial();
  const taxonomy = useTaxonomy();
  const overrides = state.settings?.categoryParents || {};

  const visible = selectable(taxonomy.categories);
  const groupList = groupsOf(visible, taxonomy.parentOverrides);

  // Spending over the last year, so a category that matters is obvious and one
  // that has never been used is too.
  const now = new Date();
  const spent: Record<string, number> = {};
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = getSpendingByCategory(state.transactions, d.getMonth(), d.getFullYear());
    for (const [id, v] of Object.entries(month)) spent[id] = (spent[id] || 0) + v;
  }

  const budgetedIds = new Set((state.budgets || []).map(b => b.category));

  const move = (categoryId: string, groupId: string) => {
    const next = { ...overrides };
    // An explicit "same as shipped" is still worth storing: it pins the choice
    // against a future change to the default.
    if (groupId === categoryId) delete next[categoryId];
    else next[categoryId] = groupId;
    dispatch({ type: 'UPDATE_SETTINGS', payload: { categoryParents: next } });
  };

  const reset = () => dispatch({ type: 'UPDATE_SETTINGS', payload: { categoryParents: {} } });

  return (
    <div className="bg-surface rounded-container border border-line p-5">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Layers className="w-4 h-4 text-ink-muted" />Categories &amp; budget groups
        </h2>
        {Object.keys(overrides).length > 0 && (
          <button
            onClick={reset}
            className="inline-flex items-center gap-1 text-caption text-accent hover:text-accent-ink font-medium shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />Reset to default
          </button>
        )}
      </div>
      <p className="text-caption text-ink-muted mb-4">
        You record transactions against any category, but budget against the groups below.
        Move a category to change which budget its spending counts toward. Spending shown is the last 12 months.
      </p>

      <div className="space-y-3">
        {groupList.map(group => {
          const children = childrenOf(group.id, visible, taxonomy.parentOverrides);
          const groupTotal = [group, ...children].reduce((s, c) => s + (spent[c.id] || 0), 0);
          return (
            <div key={group.id} className="border border-line rounded-container overflow-hidden">
              <div className="flex items-center gap-2 px-3 h-9 bg-surface-sunk border-b border-line">
                <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: group.color }} aria-hidden="true" />
                <span className="text-sm font-medium text-ink flex-1">{group.name}</span>
                {budgetedIds.has(group.id)
                  ? <span className="text-micro uppercase tracking-[0.07em] text-accent-ink bg-accent-tint px-1.5 py-0.5 rounded-control">Budgeted</span>
                  : <span className="text-micro uppercase tracking-[0.07em] text-ink-muted">No budget</span>}
                <span className="money text-sm text-ink-secondary tabular-nums">{formatCurrency(groupTotal)}</span>
              </div>

              <ul>
                {[group, ...children].map(c => (
                  <li key={c.id} className="flex items-center gap-2 px-3 h-row border-b border-line-faint last:border-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.color }} aria-hidden="true" />
                    <span className="text-sm text-ink flex-1">
                      {c.name}
                      {c.id === group.id && <span className="text-caption text-ink-muted"> · the group itself</span>}
                    </span>
                    <span className="money text-caption text-ink-muted tabular-nums w-24 text-right">
                      {spent[c.id] ? formatCurrency(spent[c.id]) : '—'}
                    </span>
                    {/*
                      A budgeted category is pinned as its own group — moving it
                      would orphan the budget — so the control says so rather
                      than silently refusing.
                    */}
                    {budgetedIds.has(c.id) && c.id !== group.id ? (
                      <span className="text-caption text-ink-muted w-40 text-right">budgeted separately</span>
                    ) : (
                      <select
                        aria-label={`Budget group for ${c.name}`}
                        value={groupOf(c.id, visible, taxonomy.parentOverrides)}
                        onChange={e => move(c.id, e.target.value)}
                        disabled={budgetedIds.has(c.id)}
                        className="w-40 h-7 px-2 bg-surface border border-line-strong rounded-control text-caption text-ink focus:outline-none focus:border-accent disabled:text-ink-muted"
                      >
                        {/* Its own id first: choosing that makes it a group. */}
                        <option value={c.id}>{c.name} (own group)</option>
                        {visible
                          .filter(g => g.id !== c.id && groupOf(g.id, visible, taxonomy.parentOverrides) === g.id)
                          .map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-caption text-ink-muted mt-3">
        Five categories — Health &amp; Personal Care, Insurance, Education, Pets and Home &amp; Garden — are retired.
        They no longer appear when you add a transaction, but anything already recorded against them still reads
        correctly, and merchants like pharmacies and hardware stores are still recognised and filed under the group
        shown above.
      </p>
    </div>
  );
}
