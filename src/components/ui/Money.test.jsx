// <Money> and formatCurrency() print the same figures on the same screens, so
// the one thing worth pinning is that they agree. They used to not: <Money>
// defaulted to CAD/en-CA while formatCurrency() followed settings.currency,
// which a fresh database set to USD. Both render a bare "$", so nothing looked
// wrong until the two disagreed on grouping or symbol placement.

import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { Money } from './index.jsx';
import { formatCurrency, setDisplayCurrency, getDisplayCurrency, localeFor } from '../../utils/calculations';

// The display currency is module state by design; put it back so ordering
// between test files can't matter.
afterEach(() => setDisplayCurrency('CAD'));

const digitsOf = (s) => s.replace(/[^\d.,]/g, '');

describe('Money', () => {
  it('follows the display currency rather than a hard-coded one', () => {
    setDisplayCurrency('USD');
    expect(getDisplayCurrency()).toBe('USD');
    const { container } = render(<Money value={1234.5} />);
    expect(container.textContent).toContain(digitsOf(formatCurrency(1234.5)));
  });

  it('agrees with formatCurrency in every supported currency', () => {
    for (const currency of ['CAD', 'USD']) {
      setDisplayCurrency(currency);
      const { container, unmount } = render(<Money value={9876.54} />);
      expect(container.textContent).toContain(digitsOf(formatCurrency(9876.54)));
      unmount();
    }
  });

  it('still honours an explicit currency prop', () => {
    setDisplayCurrency('CAD');
    const { container } = render(<Money value={10} currency="USD" locale="en-US" />);
    expect(container.textContent).toContain('10.00');
  });

  it('renders negatives with a minus rather than parentheses', () => {
    const { container } = render(<Money value={-42} />);
    expect(container.textContent.startsWith('−')).toBe(true);
    expect(container.textContent).toContain('42.00');
  });

  it('maps currencies to the locale that prints them', () => {
    expect(localeFor('USD')).toBe('en-US');
    expect(localeFor('CAD')).toBe('en-CA');
  });
});
