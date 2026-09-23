// Delete-with-undo for every entity in the app.
//
// Deletes used to fire straight from a trash icon — no confirm, no undo, and
// for a debt that meant losing the original-balance anchor the payoff progress
// is measured against. Rather than add confirm dialogs (which people click
// through), the record goes immediately and comes back on Undo.
//
//   const remove = useUndoableDelete();
//   remove({ type: 'debt', item: debt });

import { useCallback } from 'react';
import { useFinancial } from '../context/FinancialContext';
import { useToast } from '../context/ToastContext';
import type { Action } from '../types/state';
import type {
  Budget, Debt, Goal, Income, Investment, RecurringTemplate, Transaction,
} from '../types/domain';

/** Which collection a deletable record belongs to, and what it holds. */
interface EntityMap {
  transaction: Transaction;
  budget: Budget;
  goal: Goal;
  debt: Debt;
  income: Income;
  investment: Investment;
  recurring: RecurringTemplate;
}

export type EntityKind = keyof EntityMap;

/**
 * How to remove and restore one kind of record.
 *
 * Factories rather than action-type strings, because the two halves of an
 * action are not independent - a delete takes an id while an add or an upsert
 * takes the whole object. A `type` read out of a lookup table is just `string`
 * and can never be checked against the Action union.
 */
interface EntityActions<K extends EntityKind> {
  noun: string;
  remove: (id: string) => Action;
  restore: (item: EntityMap[K]) => Action;
}

/**
 * The argument. Generic over the kind, so `{ type: 'goal', item: someBudget }`
 * does not compile - the kind and the record have to agree.
 */
export interface UndoableDelete<K extends EntityKind = EntityKind> {
  type: K;
  item: EntityMap[K];
  /** Overrides the name shown in the toast. */
  label?: string;
}

// How to remove and restore each entity, and what to call it in the message.
// SET_BUDGET and ADD_* are upserts or appends, so restoring is just re-adding
// the object we captured.
//
// These are action factories rather than action-type strings because the two
// halves of an action are not independent: DELETE_* takes an id and ADD_*/
// SET_BUDGET take the whole object. Dispatching `{ type: entity.remove,
// payload: item.id }` cannot be checked against a union of actions — `type` is
// just `string` there — and no amount of `as const` fixes it, because nothing
// ties the chosen type back to the payload it requires. Building the action in
// one place does.
const ENTITIES: { [K in EntityKind]: EntityActions<K> } = {
  transaction: {
    noun: 'Transaction',
    remove: id => ({ type: 'DELETE_TRANSACTION', payload: id }),
    restore: item => ({ type: 'ADD_TRANSACTION', payload: item }),
  },
  budget: {
    noun: 'Budget',
    remove: id => ({ type: 'DELETE_BUDGET', payload: id }),
    // SET_BUDGET is an upsert, so it restores as well as ADD_* would.
    restore: item => ({ type: 'SET_BUDGET', payload: item }),
  },
  goal: {
    noun: 'Goal',
    remove: id => ({ type: 'DELETE_GOAL', payload: id }),
    restore: item => ({ type: 'ADD_GOAL', payload: item }),
  },
  debt: {
    noun: 'Debt',
    remove: id => ({ type: 'DELETE_DEBT', payload: id }),
    restore: item => ({ type: 'ADD_DEBT', payload: item }),
  },
  income: {
    noun: 'Income source',
    remove: id => ({ type: 'DELETE_INCOME', payload: id }),
    restore: item => ({ type: 'ADD_INCOME', payload: item }),
  },
  investment: {
    noun: 'Account',
    remove: id => ({ type: 'DELETE_INVESTMENT', payload: id }),
    restore: item => ({ type: 'ADD_INVESTMENT', payload: item }),
  },
  recurring: {
    noun: 'Recurring charge',
    remove: id => ({ type: 'DELETE_RECURRING_TEMPLATE', payload: id }),
    restore: item => ({ type: 'ADD_RECURRING_TEMPLATE', payload: item }),
  },
};

export function useUndoableDelete() {
  const { dispatch } = useFinancial();
  const { toast } = useToast();

  // Generic over the kind rather than taking a union: with K concrete,
  // ENTITIES[type] is EntityActions<K> and item is EntityMap[K], so the two
  // correlate on their own and nothing has to be asserted.
  return useCallback(<K extends EntityKind>({ type, item, label }: UndoableDelete<K>): void => {
    // ENTITIES[type] with a generic key is a distributive indexed access, which
    // TypeScript widens to a union of function types and refuses to call - it
    // cannot see that the factory it picked matches the item beside it. The
    // signature above is what actually enforces that pairing, at every call
    // site; this restates it once, where the checker cannot follow.
    const entity = ENTITIES[type] as EntityActions<K>;
    if (!entity || !item) return;

    dispatch(entity.remove(item.id));

    const named = item as { name?: string; merchant?: string };
    const name = label || named.name || named.merchant || entity.noun;
    toast(`${entity.noun === name ? name : `${entity.noun} “${name}”`} deleted`, {
      type: 'neutral',
      action: { label: 'Undo', onClick: () => dispatch(entity.restore(item)) },
    });
  }, [dispatch, toast]);
}

export default useUndoableDelete;
