import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { sampleData } from '../utils/sampleData';
import { getCategoryById } from '../utils/categorization';
import { setDisplayCurrency } from '../utils/calculations';
import {
  isElectron,
  loadState,
  saveState,
  isInitialized,
  markInitialized,
  readLegacyLocalStorage,
} from '../storage/storage';

const FinancialContext = createContext(null);

// Ensure customCategories field always exists (backwards compat).
function withDefaults(parsed) {
  return { customCategories: [], ...parsed };
}

function loadInitialState() {
  // Synchronous best-effort: in web mode this is the real load; in Electron it's
  // an immediate placeholder that the async SQLite load (below) replaces.
  const legacy = readLegacyLocalStorage();
  if (legacy) return withDefaults(legacy);
  return { ...sampleData };
}

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_TRANSACTION':
      return { ...state, transactions: [...state.transactions, action.payload] };

    case 'DELETE_TRANSACTION':
      return { ...state, transactions: state.transactions.filter(t => t.id !== action.payload) };

    case 'UPDATE_TRANSACTION':
      return { ...state, transactions: state.transactions.map(t => t.id === action.payload.id ? action.payload : t) };

    case 'MARK_EXCEPTION':
      return { ...state, transactions: state.transactions.map(t => t.id === action.payload ? { ...t, isException: !t.isException } : t) };

    case 'SET_BUDGET': {
      const exists = state.budgets.find(b => b.id === action.payload.id);
      if (exists) {
        return { ...state, budgets: state.budgets.map(b => b.id === action.payload.id ? action.payload : b) };
      }
      return { ...state, budgets: [...state.budgets, action.payload] };
    }

    case 'DELETE_BUDGET':
      return { ...state, budgets: state.budgets.filter(b => b.id !== action.payload) };

    case 'ADD_INCOME':
      return { ...state, incomes: [...state.incomes, action.payload] };

    case 'UPDATE_INCOME':
      return { ...state, incomes: state.incomes.map(i => i.id === action.payload.id ? action.payload : i) };

    case 'DELETE_INCOME':
      return { ...state, incomes: state.incomes.filter(i => i.id !== action.payload) };

    case 'ADD_GOAL':
      return { ...state, savings_goals: [...state.savings_goals, action.payload] };

    case 'UPDATE_GOAL':
      return { ...state, savings_goals: state.savings_goals.map(g => g.id === action.payload.id ? action.payload : g) };

    case 'DELETE_GOAL':
      return { ...state, savings_goals: state.savings_goals.filter(g => g.id !== action.payload) };

    case 'ADD_INVESTMENT':
      return { ...state, investments: [...state.investments, action.payload] };

    case 'UPDATE_INVESTMENT':
      return { ...state, investments: state.investments.map(i => i.id === action.payload.id ? action.payload : i) };

    case 'DELETE_INVESTMENT':
      return { ...state, investments: state.investments.filter(i => i.id !== action.payload) };

    case 'ADD_DEBT':
      return { ...state, debts: [...state.debts, action.payload] };

    case 'UPDATE_DEBT':
      return { ...state, debts: state.debts.map(d => d.id === action.payload.id ? action.payload : d) };

    case 'DELETE_DEBT':
      return { ...state, debts: state.debts.filter(d => d.id !== action.payload) };

    case 'ADD_RECURRING_TEMPLATE':
      return { ...state, recurringTemplates: [...state.recurringTemplates, action.payload] };

    case 'UPDATE_RECURRING_TEMPLATE':
      return { ...state, recurringTemplates: state.recurringTemplates.map(r => r.id === action.payload.id ? action.payload : r) };

    case 'DELETE_RECURRING_TEMPLATE':
      return { ...state, recurringTemplates: state.recurringTemplates.filter(r => r.id !== action.payload) };

    case 'IMPORT_TRANSACTIONS':
      return { ...state, transactions: [...state.transactions, ...action.payload] };

    // Add a user-created category
    case 'ADD_CATEGORY': {
      const already = (state.customCategories || []).find(c => c.id === action.payload.id);
      if (already) return state;
      return { ...state, customCategories: [...(state.customCategories || []), action.payload] };
    }

    // Delete a user-created category
    case 'DELETE_CATEGORY':
      return { ...state, customCategories: (state.customCategories || []).filter(c => c.id !== action.payload) };

    case 'LOAD_DATA':
      return { customCategories: [], ...action.payload };

    case 'RESET_DATA':
      return { ...sampleData };

    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };

    default:
      return state;
  }
}

export function FinancialProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, loadInitialState);

  // In Electron we must finish the async SQLite load before persisting, or the
  // placeholder state would clobber the database. Web mode is ready immediately.
  const readyToPersist = useRef(!isElectron);

  // Electron-only: load from SQLite, seeding sample data (or migrating a legacy
  // localStorage blob) exactly once on first launch.
  // Currency is a display concern, so it lives outside React state.
  useEffect(() => { setDisplayCurrency(state.settings?.currency); }, [state.settings?.currency]);

  useEffect(() => {
    if (!isElectron) return;
    let cancelled = false;
    (async () => {
      try {
        if (await isInitialized()) {
          const loaded = await loadState();
          if (!cancelled && loaded) dispatch({ type: 'LOAD_DATA', payload: loaded });
        } else {
          const legacy = readLegacyLocalStorage();
          const seed = legacy ? withDefaults(legacy) : { ...sampleData };
          await saveState(seed);
          await markInitialized();
          if (!cancelled) dispatch({ type: 'LOAD_DATA', payload: seed });
        }
      } finally {
        readyToPersist.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist the whole state on every change (matches the prior localStorage
  // semantics; the adapter routes it to SQLite or localStorage as appropriate).
  useEffect(() => {
    if (!readyToPersist.current) return;
    saveState(state);
  }, [state]);

  return (
    <FinancialContext.Provider value={{ state, dispatch }}>
      {children}
    </FinancialContext.Provider>
  );
}

export function useFinancial() {
  const ctx = useContext(FinancialContext);
  if (!ctx) throw new Error('useFinancial must be used within FinancialProvider');
  return ctx;
}

/**
 * Convenience hook — returns a getCategoryById function pre-loaded with
 * the user's custom categories, so callers don't need to pass customCategories manually.
 */
export function useGetCategory() {
  const { state } = useFinancial();
  const customCategories = state.customCategories || [];
  return (id) => getCategoryById(id, customCategories);
}
