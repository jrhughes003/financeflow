// Deleting used to be instant and irreversible from a bare trash icon. These
// tests pin the replacement: the record goes immediately, and Undo puts it back
// exactly as it was.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider } from '../context/ToastContext';
import { useUndoableDelete } from './useUndoableDelete';

const dispatch = vi.fn();
vi.mock('../context/FinancialContext', () => ({
  useFinancial: () => ({ state: {}, dispatch }),
}));

function Harness({ payload }) {
  const remove = useUndoableDelete();
  return <button onClick={() => remove(payload)}>delete it</button>;
}

const renderWith = payload => render(
  <ToastProvider><Harness payload={payload} /></ToastProvider>,
);

beforeEach(() => { dispatch.mockClear(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('useUndoableDelete', () => {
  const debt = { id: 'd1', name: 'Car loan', balance: 12850, originalBalance: 24000 };

  it('removes the record straight away and offers Undo', () => {
    renderWith({ type: 'debt', item: debt });
    fireEvent.click(screen.getByText('delete it'));

    expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_DEBT', payload: 'd1' });
    expect(screen.getByText(/Debt “Car loan” deleted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
  });

  it('restores the whole record on Undo, not just its id', () => {
    renderWith({ type: 'debt', item: debt });
    fireEvent.click(screen.getByText('delete it'));
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));

    // The original balance matters: payoff progress is measured against it.
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'ADD_DEBT', payload: debt });
  });

  it('dismisses the toast once Undo is used', () => {
    renderWith({ type: 'debt', item: debt });
    fireEvent.click(screen.getByText('delete it'));
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
  });

  it('gives a long enough window to notice the mistake', () => {
    renderWith({ type: 'debt', item: debt });
    fireEvent.click(screen.getByText('delete it'));

    act(() => { vi.advanceTimersByTime(5000) });
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3000) });
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
  });

  it('names the record so it is clear what went', () => {
    renderWith({ type: 'transaction', item: { id: 't1', merchant: 'Sakura Sushi', amount: 248 }, label: 'Sakura Sushi' });
    fireEvent.click(screen.getByText('delete it'));
    expect(screen.getByText(/Transaction “Sakura Sushi” deleted/)).toBeInTheDocument();
  });

  it('maps every entity type to a delete and a restore action', () => {
    const cases = [
      ['transaction', 'DELETE_TRANSACTION', 'ADD_TRANSACTION'],
      ['budget', 'DELETE_BUDGET', 'SET_BUDGET'],
      ['goal', 'DELETE_GOAL', 'ADD_GOAL'],
      ['debt', 'DELETE_DEBT', 'ADD_DEBT'],
      ['income', 'DELETE_INCOME', 'ADD_INCOME'],
      ['investment', 'DELETE_INVESTMENT', 'ADD_INVESTMENT'],
      ['recurring', 'DELETE_RECURRING_TEMPLATE', 'ADD_RECURRING_TEMPLATE'],
    ];

    cases.forEach(([type, removeAction, restoreAction]) => {
      dispatch.mockClear();
      const item = { id: `${type}_1`, name: type };
      const { unmount } = renderWith({ type, item });
      fireEvent.click(screen.getByText('delete it'));
      expect(dispatch).toHaveBeenCalledWith({ type: removeAction, payload: item.id });
      fireEvent.click(screen.getAllByRole('button', { name: /undo/i })[0]);
      expect(dispatch).toHaveBeenLastCalledWith({ type: restoreAction, payload: item });
      unmount();
    });
  });

  it('ignores an unknown entity type rather than dispatching nonsense', () => {
    renderWith({ type: 'mystery', item: { id: 'x' } });
    fireEvent.click(screen.getByText('delete it'));
    expect(dispatch).not.toHaveBeenCalled();
  });
});
