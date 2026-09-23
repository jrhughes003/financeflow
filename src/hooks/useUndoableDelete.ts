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
const ENTITIES = {
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

  return useCallback(({ type, item, label }) => {
    const entity = ENTITIES[type];
    if (!entity || !item) return;

    dispatch(entity.remove(item.id));

    const name = label || item.name || item.merchant || entity.noun;
    toast(`${entity.noun === name ? name : `${entity.noun} “${name}”`} deleted`, {
      type: 'neutral',
      action: { label: 'Undo', onClick: () => dispatch(entity.restore(item)) },
    });
  }, [dispatch, toast]);
}

export default useUndoableDelete;
