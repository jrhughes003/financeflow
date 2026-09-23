import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandPalette from './CommandPalette';

const state = {
  transactions: [
    { id: 't1', merchant: 'Tim Hortons', amount: 6.4, date: '2026-09-18', category: 'dining_out' },
    { id: 't2', merchant: 'Tim Hortons', amount: 5.2, date: '2026-09-11', category: 'dining_out' },
    { id: 't3', merchant: 'Metro', amount: 84.1, date: '2026-09-12', category: 'groceries' },
    { id: 't4', merchant: 'Savings → Japan Trip', amount: 250, date: '2026-09-26', kind: 'savings' },
  ],
};

vi.mock('../context/FinancialContext', () => ({ useFinancial: () => ({ state }) }));
vi.mock('../utils/exportUtils', () => ({ exportToCSV: vi.fn() }));

const onNavigate = vi.fn();
const onQuickAdd = vi.fn();
const onClose = vi.fn();

const open = () => render(
  <CommandPalette open onClose={onClose} onNavigate={onNavigate} onQuickAdd={onQuickAdd} />,
);

const input = () => screen.getByRole('textbox');
const type = value => fireEvent.change(input(), { target: { value } });

beforeEach(() => { onNavigate.mockClear(); onQuickAdd.mockClear(); onClose.mockClear(); });

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <CommandPalette open={false} onClose={onClose} onNavigate={onNavigate} onQuickAdd={onQuickAdd} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists pages and actions when opened with no query', () => {
    open();
    expect(screen.getByText('Add a transaction')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('matches a page by an abbreviation, not just a prefix', () => {
    open();
    type('plah'); // Plan Ahead
    expect(screen.getByText('Plan Ahead')).toBeInTheDocument();
  });

  it('finds a page by what it does rather than its name', () => {
    open();
    type('mortgage');
    expect(screen.getByText('Plan Ahead')).toBeInTheDocument();
    type('avalanche');
    expect(screen.getByText('Debts')).toBeInTheDocument();
  });

  it('surfaces merchants from the ledger with their totals', () => {
    open();
    type('tim');
    expect(screen.getByText('Tim Hortons')).toBeInTheDocument();
    expect(screen.getByText(/2 transactions/)).toBeInTheDocument();
    expect(screen.getByText(/\$11\.60/)).toBeInTheDocument();
  });

  it('leaves savings transfers out of merchant search', () => {
    open();
    type('japan');
    expect(screen.queryByText(/Savings → Japan Trip/)).not.toBeInTheDocument();
  });

  it('navigates on click and closes', () => {
    open();
    type('goals');
    fireEvent.click(screen.getByText('Goals'));
    expect(onNavigate).toHaveBeenCalledWith('goals');
    expect(onClose).toHaveBeenCalled();
  });

  it('is keyboard driven: arrows move, enter chooses', () => {
    open();
    type('budget');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('runs the quick-add action', () => {
    open();
    type('add a transaction');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onQuickAdd).toHaveBeenCalled();
  });

  it('closes on escape', () => {
    open();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when nothing matches', () => {
    open();
    type('zzzzqqq');
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });
});
