/*
 * Two levels of category: what you record against, and what you budget.
 *
 * The taxonomy went from 5 categories to 18 because the auto-categoriser
 * needed the resolution — more categories meant better keyword coverage and a
 * jump from 0.632 to 0.830 macro-F1. Budgeting wants the opposite. Eighteen
 * budget lines is not a finer plan than six, it is six plans and twelve
 * reminders that you have not made up your mind.
 *
 * So a category can point at another category as its `parent`. A category with
 * no parent is a *group*: the thing you set a budget against. Everything else
 * rolls up into one. Transactions always carry the fine-grained id, so nothing
 * is lost — Travel is still Travel in the ledger and in Analytics; it just
 * counts against the Transportation budget.
 *
 * Why a pointer on the category rather than a separate list of groups: a group
 * is not a different kind of thing, it is a category nobody rolled up. That
 * keeps one id space, so an existing budget, an existing transaction and an
 * existing custom category all keep meaning without migration. The alternative
 * — a `groups` table — would have made every stored `category` ambiguous about
 * which space it lived in.
 *
 * The default shape is in categorization.ts. Users override it, because the
 * right grouping is personal: someone with a custom "Rent+Household" category
 * wants Housing and Utilities underneath it, and no shipped default can know
 * that.
 */

import type { Category } from '../types/domain';
import { getAllCategories } from './categorization';

/** A user's overrides: category id -> the id it rolls up into. */
export type ParentOverrides = Record<string, string>;

/**
 * Budgeting a category makes it a group.
 *
 * Without this rule, introducing the default parents would have quietly
 * emptied existing budgets: someone who had budgeted Utilities would keep the
 * budget and the spending, but the spending would roll past it into Housing
 * and the Utilities line would read zero spent. The budget would look met
 * while the money was being counted somewhere else — the worst available
 * outcome, because it is wrong in the reassuring direction.
 *
 * Reading it the other way round, it is also just what a budget means. Setting
 * one against a category is a statement that you want to watch it on its own,
 * and the parent's budget then excludes it rather than double-counting it.
 *
 * Explicit user overrides are layered on top, so someone who deliberately puts
 * a budgeted category under another group still gets what they asked for.
 */
export function effectiveOverrides(
  budgets: { category: string }[],
  userOverrides: ParentOverrides = {},
): ParentOverrides {
  const out: ParentOverrides = {};
  for (const b of budgets || []) if (b?.category) out[b.category] = b.category;
  return { ...out, ...userOverrides };
}

/**
 * Walk up to the group a category belongs to.
 *
 * Returns the category's own id when it is already a group, and when the chain
 * is broken — a parent that points at a category which no longer exists is
 * treated as no parent at all, which keeps the spending visible under its own
 * name rather than silently dropping it out of every budget.
 *
 * Cycles are survivable by construction: the walk is bounded by the number of
 * categories and returns the last id it stood on. A user can create one
 * through the overrides (A under B, B under A), and a finance app that hung or
 * blew the stack over a dropdown choice would be worse than one that picks an
 * arbitrary-but-stable answer.
 */
export function groupOf(
  categoryId: string,
  categories: Category[],
  overrides: ParentOverrides = {},
): string {
  const byId = new Map(categories.map(c => [c.id, c]));
  const seen = new Set<string>();
  let current = categoryId;

  for (;;) {
    if (seen.has(current)) return current; // cycle: stop where we are
    seen.add(current);

    const parent = overrides[current] ?? byId.get(current)?.parent;
    if (!parent || parent === current) return current;
    if (!byId.has(parent)) return current; // dangling pointer: stand still
    current = parent;
  }
}

/** Every category nothing rolls up from — the ones you can budget against. */
export function groups(categories: Category[], overrides: ParentOverrides = {}): Category[] {
  return categories.filter(c => groupOf(c.id, categories, overrides) === c.id);
}

/** The categories that roll up into `groupId`, not counting the group itself. */
export function childrenOf(
  groupId: string,
  categories: Category[],
  overrides: ParentOverrides = {},
): Category[] {
  return categories.filter(c => c.id !== groupId && groupOf(c.id, categories, overrides) === groupId);
}

/**
 * Re-key a category-level total map to group level.
 *
 * Totals for ids that are already groups pass through; everything else is
 * added to its group's total. An id the taxonomy has never heard of keeps its
 * own key rather than being dropped, because a transaction in an unknown
 * category is a thing to investigate, not to lose.
 */
export function rollUp(
  totals: Record<string, number>,
  categories: Category[],
  overrides: ParentOverrides = {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(totals)) {
    const group = groupOf(id, categories, overrides);
    out[group] = (out[group] || 0) + value;
  }
  // Round once at the end: summing several already-rounded children and
  // rounding each addition would drift against the sum of the raw amounts.
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

/**
 * Categories a picker should offer.
 *
 * Retired ones are excluded. They still exist, still resolve by id so older
 * transactions render correctly, and still carry their keywords so the
 * auto-categoriser keeps recognising the merchants — they are simply no longer
 * something you can choose. Deleting them outright would have taken 88
 * keywords with them and pushed pharmacies, hardware stores and vets into the
 * catch-all.
 */
export function selectable(categories: Category[]): Category[] {
  return categories.filter(c => !c.retired);
}

/**
 * Selectable categories arranged under their groups, for a grouped picker.
 *
 * Groups come first in the order they appear in `categories`, each followed by
 * its children. A group with no selectable children still appears, so the list
 * reads the same whether or not a user has customised anything.
 */
export function selectableByGroup(
  categories: Category[],
  overrides: ParentOverrides = {},
): { group: Category; children: Category[] }[] {
  const visible = selectable(categories);
  return groups(visible, overrides).map(group => ({
    group,
    children: childrenOf(group.id, visible, overrides),
  }));
}

/** Convenience for callers that only hold the user's custom list. */
export function groupOfFor(
  categoryId: string,
  customCategories: Category[] = [],
  overrides: ParentOverrides = {},
): string {
  return groupOf(categoryId, getAllCategories(customCategories), overrides);
}
