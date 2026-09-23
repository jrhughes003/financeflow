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
const ENTITIES = {
  transaction: { remove: 'DELETE_TRANSACTION', restore: 'ADD_TRANSACTION', noun: 'Transaction' },
  budget:      { remove: 'DELETE_BUDGET',      restore: 'SET_BUDGET',      noun: 'Budget' },
  goal:        { remove: 'DELETE_GOAL',        restore: 'ADD_GOAL',        noun: 'Goal' },
  debt:        { remove: 'DELETE_DEBT',        restore: 'ADD_DEBT',        noun: 'Debt' },
  income:      { remove: 'DELETE_INCOME',      restore: 'ADD_INCOME',      noun: 'Income source' },
  investment:  { remove: 'DELETE_INVESTMENT',  restore: 'ADD_INVESTMENT',  noun: 'Account' },
  recurring:   { remove: 'DELETE_RECURRING_TEMPLATE', restore: 'ADD_RECURRING_TEMPLATE', noun: 'Recurring charge' },
};

export function useUndoableDelete() {
  const { dispatch } = useFinancial();
  const { toast } = useToast();

  return useCallback(({ type, item, label }) => {
    const entity = ENTITIES[type];
    if (!entity || !item) return;

    dispatch({ type: entity.remove, payload: item.id });

    const name = label || item.name || item.merchant || entity.noun;
    toast(`${entity.noun === name ? name : `${entity.noun} “${name}”`} deleted`, {
      type: 'neutral',
      action: { label: 'Undo', onClick: () => dispatch({ type: entity.restore, payload: item }) },
    });
  }, [dispatch, toast]);
}

export default useUndoableDelete;
