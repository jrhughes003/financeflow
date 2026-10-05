/*
 * The rules that decide which budget a transaction counts against.
 *
 * Worth testing hard because every failure here is silent and reassuring: a
 * group whose children stopped rolling up looks *under* budget, which is the
 * direction nobody checks. The cases below are the ones that would produce
 * that — a budget on a child, a dangling parent, a cycle, a custom category
 * the shipped taxonomy has never heard of.
 */

import { describe, expect, it } from 'vitest';
import {
  groupOf, groups, childrenOf, rollUp, selectable, selectableByGroup, effectiveOverrides,
} from './categoryTree';
import { CATEGORIES, getAllCategories } from './categorization';
import type { Category } from '../types/domain';

const cat = (id: string, extra: Partial<Category> = {}): Category => ({
  id, name: id, color: '#000', icon: 'Tag', subcategories: [], keywords: [], ...extra,
});

describe('groupOf', () => {
  it('returns a group as itself', () => {
    expect(groupOf('products', CATEGORIES)).toBe('products');
    expect(groupOf('transportation', CATEGORIES)).toBe('transportation');
  });

  it('walks a child up to its group', () => {
    expect(groupOf('travel', CATEGORIES)).toBe('transportation');
    expect(groupOf('utilities', CATEGORIES)).toBe('housing');
    expect(groupOf('entertainment', CATEGORIES)).toBe('products');
  });

  it('walks more than one level', () => {
    // utilities -> housing, and housing moved under a custom group.
    const cats = [...CATEGORIES, cat('renthousehold')];
    const overrides = { housing: 'renthousehold' };
    expect(groupOf('utilities', cats, overrides)).toBe('renthousehold');
    expect(groupOf('home', cats, overrides)).toBe('renthousehold');
  });

  it('treats a category it has never heard of as its own group', () => {
    // A custom category, or one from a newer build. Counting it under some
    // arbitrary group would move money the user never agreed to move.
    expect(groupOf('something_new', CATEGORIES)).toBe('something_new');
  });

  it('stands still on a parent that does not exist', () => {
    const cats = [cat('orphan', { parent: 'deleted_group' })];
    expect(groupOf('orphan', cats)).toBe('orphan');
  });

  it('survives a cycle rather than hanging', () => {
    const cats = [cat('a', { parent: 'b' }), cat('b', { parent: 'a' })];
    expect(['a', 'b']).toContain(groupOf('a', cats));
    expect(['a', 'b']).toContain(groupOf('b', cats));
  });

  it('survives a category that is its own parent', () => {
    expect(groupOf('x', [cat('x', { parent: 'x' })])).toBe('x');
  });

  it('lets an override win over the shipped parent', () => {
    expect(groupOf('travel', CATEGORIES)).toBe('transportation');
    expect(groupOf('travel', CATEGORIES, { travel: 'products' })).toBe('products');
  });
});

describe('effectiveOverrides', () => {
  it('makes a budgeted category a group', () => {
    // Without this, a budget on Utilities would keep its amount while its
    // spending rolled past it into Housing — the line would read zero spent
    // and look comfortably met.
    const overrides = effectiveOverrides([{ category: 'utilities' }]);
    expect(groupOf('utilities', CATEGORIES, overrides)).toBe('utilities');
  });

  it('still lets an explicit user override win', () => {
    const overrides = effectiveOverrides(
      [{ category: 'utilities' }],
      { utilities: 'housing' },
    );
    expect(groupOf('utilities', CATEGORIES, overrides)).toBe('housing');
  });

  it('ignores junk in the budget list', () => {
    expect(() => effectiveOverrides([null as never, { category: '' }])).not.toThrow();
  });
});

describe('rollUp', () => {
  it('adds children into their group', () => {
    const out = rollUp({ transportation: 100, travel: 40 }, CATEGORIES);
    expect(out).toEqual({ transportation: 140 });
  });

  it('preserves the total', () => {
    const totals = { dining_out: 10.1, travel: 20.2, utilities: 30.3, entertainment: 5.05 };
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    const out = rollUp(totals, CATEGORIES);
    const rolled = Object.values(out).reduce((a, b) => a + b, 0);
    expect(rolled).toBeCloseTo(sum, 2);
  });

  it('keeps an unknown category under its own name rather than dropping it', () => {
    const out = rollUp({ mystery: 12 }, CATEGORIES);
    expect(out.mystery).toBe(12);
  });

  it('rounds once at the end, not per addition', () => {
    // Three thirds of a cent should land on the cent, not drift.
    const out = rollUp({ travel: 0.003, entertainment: 0, transportation: 0.004 }, CATEGORIES);
    expect(out.transportation).toBe(0.01);
  });

  it('handles an empty map', () => {
    expect(rollUp({}, CATEGORIES)).toEqual({});
  });
});

describe('groups and childrenOf', () => {
  it('finds exactly the six shipped groups', () => {
    expect(groups(CATEGORIES).map(c => c.id).sort()).toEqual(
      ['dining_out', 'groceries', 'housing', 'products', 'subscriptions', 'transportation'],
    );
  });

  it('lists what rolls into a group, excluding the group itself', () => {
    expect(childrenOf('transportation', CATEGORIES).map(c => c.id)).toEqual(['travel']);
    expect(childrenOf('housing', CATEGORIES).map(c => c.id).sort()).toEqual(['home', 'utilities']);
  });

  it('every category reaches a group', () => {
    const ids = new Set(groups(CATEGORIES).map(c => c.id));
    for (const c of CATEGORIES) {
      expect(ids.has(groupOf(c.id, CATEGORIES)), `${c.id} does not reach a group`).toBe(true);
    }
  });
});

describe('selectable', () => {
  const RETIRED = ['health', 'insurance', 'education', 'pets', 'home'];

  it('leaves out the retired categories', () => {
    const ids = selectable(CATEGORIES).map(c => c.id);
    for (const id of RETIRED) expect(ids).not.toContain(id);
  });

  it('keeps them resolvable, and keeps their keywords', () => {
    // The point of retiring rather than deleting: an old transaction still
    // renders with the right name, and the auto-categoriser still knows that
    // Home Depot is a hardware store.
    for (const id of RETIRED) {
      const found = CATEGORIES.find(c => c.id === id);
      expect(found, `${id} should still exist`).toBeTruthy();
      expect(found!.keywords.length, `${id} should keep its keywords`).toBeGreaterThan(0);
    }
  });

  it('offers thirteen categories, down from eighteen', () => {
    expect(CATEGORIES).toHaveLength(18);
    expect(selectable(CATEGORIES)).toHaveLength(13);
  });
});

describe('selectableByGroup', () => {
  it('puts every selectable category under exactly one group', () => {
    const tree = selectableByGroup(CATEGORIES);
    const listed = tree.flatMap(({ group, children }) => [group.id, ...children.map(c => c.id)]);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.sort()).toEqual(selectable(CATEGORIES).map(c => c.id).sort());
  });

  it('never lists a retired category', () => {
    const tree = selectableByGroup(CATEGORIES);
    const listed = tree.flatMap(({ group, children }) => [group.id, ...children.map(c => c.id)]);
    expect(listed).not.toContain('health');
    expect(listed).not.toContain('home');
  });

  it('follows a user regrouping', () => {
    const cats = [...CATEGORIES, cat('renthousehold')];
    const tree = selectableByGroup(cats, { housing: 'renthousehold' });
    const rent = tree.find(g => g.group.id === 'renthousehold');
    expect(rent).toBeTruthy();
    expect(rent!.children.map(c => c.id).sort()).toEqual(['housing', 'utilities']);
    expect(tree.some(g => g.group.id === 'housing')).toBe(false);
  });
});

describe('getAllCategories deduplication', () => {
  it('lets a custom category override a built-in with the same id', () => {
    // The demo ledger ships a custom "Housing" whose id collides with the
    // built-in one. Before this was deduplicated, Housing appeared twice in
    // the picker and twice as a budget group.
    const mine = cat('housing', { name: 'Rent & Housing', color: '#123456' });
    const all = getAllCategories([mine]);
    const housing = all.filter(c => c.id === 'housing');
    expect(housing).toHaveLength(1);
    expect(housing[0].name).toBe('Rent & Housing');
  });

  it('produces no duplicate ids at all', () => {
    const all = getAllCategories([cat('housing'), cat('mine'), cat('mine')]);
    const ids = all.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('yields exactly one group per id', () => {
    const all = getAllCategories([cat('housing', { name: 'Rent & Housing' })]);
    const ids = groups(all).map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tolerates junk in the custom list', () => {
    expect(() => getAllCategories([null as never, { id: '' } as never])).not.toThrow();
  });
});
