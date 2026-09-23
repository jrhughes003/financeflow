import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Layout from './Layout';

const renderNav = (currentPage = 'dashboard', setCurrentPage = vi.fn(), badges = {}) => {
  render(
    <Layout currentPage={currentPage} setCurrentPage={setCurrentPage} onQuickAdd={vi.fn()} badges={badges}>
      <div>page body</div>
    </Layout>,
  );
  return { setCurrentPage };
};

const group = name => screen.getByRole('button', { name: new RegExp(name, 'i') });

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe('sidebar grouping', () => {
  it('shows pinned items and collapsed groups, not every page at once', () => {
    renderNav();
    // Pinned destinations are always reachable.
    expect(screen.getByRole('button', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
    // Group headers are present…
    ['Everyday', 'Budgeting', 'Analysis', 'Wealth & Planning'].forEach(label => {
      expect(group(label)).toBeInTheDocument();
    });
    // …but their pages are not, until opened.
    expect(screen.queryByRole('button', { name: /^transactions$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /plan ahead/i })).not.toBeInTheDocument();
  });

  it('expands a group on click and collapses it again', () => {
    renderNav();
    const header = group('Wealth & Planning');
    expect(header).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    ['Income', 'Investments', 'Debts', 'Plan Ahead'].forEach(label => {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}$`, 'i') })).toBeInTheDocument();
    });

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^investments$/i })).not.toBeInTheDocument();
  });

  it('navigates when a page inside a group is clicked', () => {
    const setCurrentPage = vi.fn();
    renderNav('dashboard', setCurrentPage);

    fireEvent.click(group('Analysis'));
    fireEvent.click(screen.getByRole('button', { name: /^reports$/i }));
    expect(setCurrentPage).toHaveBeenCalledWith('reports');
  });

  it('opens the group holding the current page', () => {
    renderNav('debts');
    expect(group('Wealth & Planning')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^debts$/i })).toBeInTheDocument();
    // Unrelated groups stay shut.
    expect(group('Everyday')).toHaveAttribute('aria-expanded', 'false');
  });

  it('remembers which groups were open', () => {
    const { unmount } = render(
      <Layout currentPage="dashboard" setCurrentPage={vi.fn()} onQuickAdd={vi.fn()}><div /></Layout>,
    );
    fireEvent.click(screen.getByRole('button', { name: /budgeting/i }));
    unmount();

    renderNav();
    expect(group('Budgeting')).toHaveAttribute('aria-expanded', 'true');
  });

  it('survives localStorage being unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => renderNav('goals')).not.toThrow();
    expect(group('Budgeting')).toHaveAttribute('aria-expanded', 'true'); // still follows the current page
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('shows a badge on a page that needs attention', () => {
    renderNav('dashboard', vi.fn(), { recurring: { label: '3', title: '3 recurring charges due to post' } });
    fireEvent.click(group('Everyday'));
    const recurring = screen.getByRole('button', { name: /^recurring/i });
    expect(recurring).toHaveTextContent('3');
  });

  it('flags a collapsed group when something inside is waiting', () => {
    const { container } = render(
      <Layout currentPage="dashboard" setCurrentPage={vi.fn()} onQuickAdd={vi.fn()}
        badges={{ owed: { label: '$62', title: '$62.00 still owed to you' } }}><div /></Layout>,
    );
    expect(group('Everyday')).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.bg-amber-500')).toBeTruthy();
  });

  it('shows no badges when nothing needs attention', () => {
    const { container } = render(
      <Layout currentPage="dashboard" setCurrentPage={vi.fn()} onQuickAdd={vi.fn()}><div /></Layout>,
    );
    expect(container.querySelector('.bg-amber-500')).toBeNull();
    expect(container.querySelector('.bg-amber-100')).toBeNull();
  });

  it('still shows the page title in the header for a grouped page', () => {
    renderNav('plan');
    expect(screen.getByRole('heading', { name: /plan ahead/i })).toBeInTheDocument();
  });
});
