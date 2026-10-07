import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Layout from './Layout';
import type { StatusItem } from './Layout';
import type { NavBadges, PageId } from '../types/navigation';

const renderNav = (
  currentPage: PageId = 'dashboard',
  setCurrentPage = vi.fn(),
  badges: NavBadges = {},
  status: StatusItem[] = [],
) => {
  render(
    <Layout currentPage={currentPage} setCurrentPage={setCurrentPage} onQuickAdd={vi.fn()} badges={badges} status={status}>
      <div>page body</div>
    </Layout>,
  );
  return { setCurrentPage };
};

const nav = () => within(screen.getByRole('navigation', { name: 'Pages' }));

describe('navigation', () => {
  it('lists every page at once, under its section', () => {
    renderNav();
    // The terminal nav is flat: nothing is hidden behind a group.
    ['Dashboard', 'Transactions', 'Owed to Me', 'Recurring', 'Budget', 'Goals', 'Comparison',
      'Analytics', 'Reports', 'Income', 'Investments', 'Debts', 'Cash Flow', 'Plan Ahead', 'Settings',
    ].forEach(label => {
      expect(nav().getByRole('button', { name: new RegExp(`^${label}$`, 'i') })).toBeInTheDocument();
    });
    ['Everyday', 'Budgeting', 'Analysis', 'Wealth & Planning'].forEach(label => {
      expect(nav().getByText(label)).toBeInTheDocument();
    });
  });

  it('names each page by itself, not by its code', () => {
    renderNav();
    // The three-letter code is visual shorthand; a screen reader hears the name.
    expect(nav().getByRole('button', { name: /^transactions$/i })).toHaveTextContent('TXN');
  });

  it('navigates when a page is clicked', () => {
    const setCurrentPage = vi.fn();
    renderNav('dashboard', setCurrentPage);
    fireEvent.click(nav().getByRole('button', { name: /^reports$/i }));
    expect(setCurrentPage).toHaveBeenCalledWith('reports');
  });

  it('marks the current page', () => {
    renderNav('debts');
    expect(nav().getByRole('button', { name: /^debts$/i })).toHaveAttribute('aria-current', 'page');
    expect(nav().getByRole('button', { name: /^income$/i })).not.toHaveAttribute('aria-current');
  });

  it('shows a badge on a page that needs attention', () => {
    renderNav('dashboard', vi.fn(), { recurring: { label: '3', title: '3 recurring charges due to post' } });
    expect(nav().getByRole('button', { name: /^recurring/i })).toHaveTextContent('3');
    expect(screen.getByTitle('3 recurring charges due to post')).toBeInTheDocument();
  });

  it('shows no badges when nothing needs attention', () => {
    renderNav();
    expect(screen.queryByTitle(/still owed|due to post/)).not.toBeInTheDocument();
  });

  it('shows the page title in the header', () => {
    renderNav('plan');
    expect(screen.getByRole('heading', { name: /plan ahead/i })).toBeInTheDocument();
  });
});

describe('status strip', () => {
  it('shows the figures it is given', () => {
    renderNav('dashboard', vi.fn(), {}, [
      { label: 'Net worth', value: '$48,912.40' },
      { label: 'Budget used', value: '66.0%', delta: '19% OF MONTH' },
    ]);
    expect(screen.getByText('$48,912.40')).toBeInTheDocument();
    expect(screen.getByText('66.0%')).toBeInTheDocument();
    expect(screen.getByText('19% OF MONTH')).toBeInTheDocument();
  });

  it('opens the command palette from the command line', () => {
    const onOpenPalette = vi.fn();
    render(
      <Layout currentPage="dashboard" setCurrentPage={vi.fn()} onQuickAdd={vi.fn()} onOpenPalette={onOpenPalette}><div /></Layout>,
    );
    fireEvent.click(screen.getByRole('button', { name: /go to a page or run a command/i }));
    expect(onOpenPalette).toHaveBeenCalled();
  });
});
