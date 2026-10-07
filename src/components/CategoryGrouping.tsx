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
import { RotateCcw } from 'lucide-react';
import { useFinancial, useTaxonomy } from '../context/FinancialContext';
import { groups as groupsOf, childrenOf, selectable, groupOf } from '../utils/categoryTree';
import { formatCurrency } from '../utils/calculations';
import { getSpendingByCategory } from '../utils/calculations';
import { Panel, Button, Badge, CategoryMark } from './ui';

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
    <Panel
      title="Categories & budget groups"
      meta={`${groupList.length} GROUPS · SPEND 12M`}
      actions={Object.keys(overrides).length > 0 && (
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Reset to default</Button>
      )}
      bordered
    >
      <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">
        You record transactions against any category, but budget against the groups below.
        Move a category to change which budget its spending counts toward. Spending shown is the last 12 months.
      </p>

      {groupList.map(group => {
        const children = childrenOf(group.id, visible, taxonomy.parentOverrides);
        const groupTotal = [group, ...children].reduce((s, c) => s + (spent[c.id] || 0), 0);
        return (
          <div key={group.id} className="border-b border-line">
            <div className="flex items-center gap-2 px-2.5 h-row bg-surface-sunk border-b border-line">
              <CategoryMark color={group.color} name={group.name} className="flex-1 text-sm font-medium text-ink" />
              {budgetedIds.has(group.id)
                ? <Badge tone="accent">Budgeted</Badge>
                : <span className="text-micro uppercase tracking-[0.07em] text-ink-muted">No budget</span>}
              <span className="money text-sm text-ink-secondary tabular-nums w-24 text-right">{formatCurrency(groupTotal)}</span>
              {/* Lines the total up over the column of selects below. */}
              <span className="w-40 hidden sm:block" aria-hidden="true" />
            </div>

            <ul>
              {[group, ...children].map(c => (
                <li key={c.id} className="flex items-center gap-2 pl-5 pr-2.5 h-row border-b border-line-faint last:border-0 hover:bg-surface-hover">
                  <span className="text-sm text-ink flex-1 min-w-0 truncate">
                    <CategoryMark color={c.color} name={c.name} className="align-middle" />
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
                      className="w-40 h-[22px] px-1.5 bg-surface border border-line-strong rounded-control text-caption text-ink focus:outline-none focus:border-accent disabled:text-ink-muted disabled:border-line"
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

      <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5">
        Five categories — Health &amp; Personal Care, Insurance, Education, Pets and Home &amp; Garden — are retired.
        They no longer appear when you add a transaction, but anything already recorded against them still reads
        correctly, and merchants like pharmacies and hardware stores are still recognised and filed under the group
        shown above.
      </p>
    </Panel>
  );
}
