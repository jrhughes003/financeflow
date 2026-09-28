// What this file is really protecting is the keyboard and the screen reader.
//
// The suggestion list itself is easy: searchMerchants does the ranking, and a
// wrong list is visible the moment anyone looks at the form. The parts that
// break silently are the ARIA ones — an aria-activedescendant that points at
// nothing, a listbox that never appears in the accessibility tree, an option
// only a mouse can reach — and the one interaction that cannot be checked by
// looking at this component on its own: Escape.
//
// Escape has to close the suggestion list *without* closing the dialog around
// it. Modal listens for it on the capture phase (see Modal.tsx), so getting this
// wrong does not produce a subtly worse experience — it makes a half-picked
// merchant impossible to back out of without throwing the whole form away. That
// is asserted below against the real dialog, not a stand-in, because the bug
// lives in the interaction between the two.

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import MerchantCombobox from './MerchantCombobox';
import TransactionEntry from '../TransactionEntry';
import { searchMerchants } from '../../utils/merchants';
import { makeState } from '../../test/factories';
import type { AppState } from '../../types/state';

// --- Doubles ----------------------------------------------------------------

// The context is stubbed rather than driven through FinancialProvider, the same
// way TransactionEntry.test.tsx and CommandPalette.test.tsx do it: the same
// shape the provider hands consumers, with the dispatch readable directly.
let state: AppState = makeState();
const dispatch = vi.fn();
vi.mock('../../context/FinancialContext', () => ({ useFinancial: () => ({ state, dispatch }) }));

// aiSupported off, so no tier of the categorisation chain can reach out. The
// merchant table is meant to answer before any of them anyway; this makes sure a
// network call cannot be what makes a test pass.
vi.mock('../../ai/ai', () => ({
  aiSupported: false,
  runAi: vi.fn(),
  taxonomy: vi.fn(() => []),
}));

// --- Fixtures ---------------------------------------------------------------

// Read out of the table rather than written down here. merchants.json is
// generated and still growing, and hardcoding "Netflix" means a later row either
// breaks a test for no reason or, worse, makes one pass while asserting nothing.
// Two characters is searchMerchants' own minimum.
const QUERY = 'ne';
const EXPECTED = searchMerchants(QUERY);
if (EXPECTED.length < 3) {
  throw new Error(`unreachable: "${QUERY}" must match at least three merchants for the wrap tests, but it matches ${EXPECTED.length}`);
}
const FIRST = EXPECTED[0];
const LAST = EXPECTED[EXPECTED.length - 1];

/** A category the table does not suggest for QUERY, so an overwrite would show. */
const USER_CATEGORY = 'groceries';
if (FIRST.category === USER_CATEGORY) {
  throw new Error(`unreachable: the "do not overwrite" test needs a category the table would not pick, and it already picks ${USER_CATEGORY}`);
}

const onSelect = vi.fn();
const onBlurred = vi.fn();

/**
 * A caller for the combobox, because the value belongs to one: without a parent
 * holding it, nothing typed would ever appear and the list would never change.
 * The <label htmlFor> is the form's — the accessible name comes from it, not
 * from an aria-label the component made up for itself.
 */
function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="merchant">Merchant / Description</label>
      <MerchantCombobox
        id="merchant"
        value={value}
        onChange={setValue}
        onSelect={entry => { onSelect(entry); setValue(entry.name); }}
        onBlur={onBlurred}
      />
    </>
  );
}

// --- Queries ----------------------------------------------------------------

const combobox = () => screen.getByRole('combobox', { name: 'Merchant / Description' });
const listbox = () => screen.queryByRole('listbox');

/** The popup's options, scoped: the form's <select>s have role="option" children too. */
const options = (): HTMLElement[] => {
  const list = listbox();
  return list ? within(list).getAllByRole('option') : [];
};

/** The option aria-activedescendant names, or null when none is active. */
const activeOption = (): HTMLElement | null => {
  const id = combobox().getAttribute('aria-activedescendant');
  if (!id) return null;
  const el = document.getElementById(id);
  if (!el) throw new Error(`unreachable: aria-activedescendant names "${id}", which is not in the document`);
  return el;
};

const type = (value: string) => fireEvent.change(combobox(), { target: { value } });
const press = (key: string) => fireEvent.keyDown(combobox(), { key });

beforeEach(() => {
  vi.clearAllMocks();
  state = makeState();
});

// --- Opening ----------------------------------------------------------------

describe('the suggestion list', () => {
  it('opens on the second character, in the table order', () => {
    render(<Harness />);
    type(QUERY);

    const list = listbox();
    if (!list) throw new Error('unreachable: two characters should have opened the listbox');
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    expect(combobox()).toHaveAttribute('aria-controls', list.id);
    expect(combobox()).toHaveAttribute('aria-autocomplete', 'list');
    // Not re-sorted here: searchMerchants is already ranked best-first.
    expect(options().map(o => o.textContent)).toEqual(EXPECTED.map(e => expect.stringContaining(e.name)));
  });

  it('shows nothing for a single character', () => {
    render(<Harness />);
    type(QUERY.slice(0, 1));
    expect(listbox()).not.toBeInTheDocument();
    expect(options()).toHaveLength(0);
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts with no option active, so Enter still belongs to the form', () => {
    render(<Harness />);
    type(QUERY);
    expect(activeOption()).toBeNull();
    press('Enter');
    expect(onSelect).not.toHaveBeenCalled();
    expect(listbox()).toBeInTheDocument();
  });
});

// --- The keyboard -----------------------------------------------------------

describe('the keyboard', () => {
  it('walks down the options and wraps past the last one', () => {
    render(<Harness />);
    type(QUERY);

    press('ArrowDown');
    expect(activeOption()).toBe(options()[0]);
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    expect(options()[1]).toHaveAttribute('aria-selected', 'false');

    press('ArrowDown');
    expect(activeOption()).toBe(options()[1]);

    // Off the end and round to the top.
    for (let i = options().length - 2; i > 0; i -= 1) press('ArrowDown');
    expect(activeOption()).toHaveTextContent(LAST.name);
    press('ArrowDown');
    expect(activeOption()).toBe(options()[0]);
  });

  it('walks up from the end and wraps past the first one', () => {
    render(<Harness />);
    type(QUERY);

    // Nothing is active yet, so up starts at the bottom of the list.
    press('ArrowUp');
    expect(activeOption()).toHaveTextContent(LAST.name);

    press('ArrowUp');
    expect(activeOption()).toBe(options()[options().length - 2]);

    for (let i = options().length - 2; i > 0; i -= 1) press('ArrowUp');
    expect(activeOption()).toBe(options()[0]);
    press('ArrowUp');
    expect(activeOption()).toHaveTextContent(LAST.name);
  });

  it('never moves focus off the input', () => {
    render(<Harness />);
    combobox().focus();
    type(QUERY);
    press('ArrowDown');
    press('ArrowDown');
    expect(combobox()).toHaveFocus();
  });

  it('accepts the active option on Enter and closes the list', () => {
    render(<Harness />);
    type(QUERY);
    press('ArrowDown');
    press('Enter');

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      name: FIRST.name, category: FIRST.category, subcategory: FIRST.subcategory,
    }));
    expect(combobox()).toHaveValue(FIRST.name);
    expect(listbox()).not.toBeInTheDocument();
    expect(activeOption()).toBeNull();
  });

  it('closes the list on Escape', () => {
    render(<Harness />);
    type(QUERY);
    press('Escape');
    expect(listbox()).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    // The typing survives: Escape abandons the offer, not the field.
    expect(combobox()).toHaveValue(QUERY);
  });

  it('reopens a closed list with an arrow, without retyping', () => {
    render(<Harness />);
    type(QUERY);
    press('Escape');
    press('ArrowDown');
    expect(listbox()).toBeInTheDocument();
    expect(activeOption()).toBe(options()[0]);
  });
});

// --- The mouse --------------------------------------------------------------

describe('the mouse', () => {
  it('selects the option that was clicked', () => {
    render(<Harness />);
    type(QUERY);
    const second = options()[1];
    if (!second) throw new Error('unreachable: the list should hold more than one option');
    fireEvent.click(second);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: EXPECTED[1].name }));
    expect(combobox()).toHaveValue(EXPECTED[1].name);
    expect(listbox()).not.toBeInTheDocument();
  });

  it('closes the list on blur without selecting anything', () => {
    render(<Harness />);
    type(QUERY);
    fireEvent.blur(combobox());
    expect(listbox()).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    // The form's own blur work — the categorisation chain — still runs.
    expect(onBlurred).toHaveBeenCalledTimes(1);
  });
});

// --- Wired into the entry form ---------------------------------------------

describe('in the transaction form', () => {
  const merchant = () => screen.getByRole('combobox', { name: 'Merchant / Description' });
  const category = () => screen.getByLabelText('Category');
  const typeMerchant = (value: string) => fireEvent.change(merchant(), { target: { value } });
  const acceptFirst = () => {
    fireEvent.keyDown(merchant(), { key: 'ArrowDown' });
    fireEvent.keyDown(merchant(), { key: 'Enter' });
  };

  it('keeps the visible label the form already had', () => {
    render(<TransactionEntry />);
    expect(screen.getByLabelText('Merchant / Description')).toBe(merchant());
  });

  it('fills the merchant, the category and the subcategory from the table', () => {
    render(<TransactionEntry />);
    typeMerchant(QUERY);
    acceptFirst();

    expect(merchant()).toHaveValue(FIRST.name);
    expect(category()).toHaveValue(FIRST.category);
    const subcategory = screen.queryByLabelText('Subcategory');
    if (!subcategory) {
      throw new Error(`unreachable: ${FIRST.category} should offer subcategories for ${FIRST.name} to fill`);
    }
    expect(subcategory).toHaveValue(FIRST.subcategory);
    // The table answered, so there is nothing left for the blur-time chain to
    // offer and no stale "auto-categorize as…" button under the field.
    expect(screen.queryByRole('button', { name: /Auto-categorize as/ })).not.toBeInTheDocument();
  });

  it('never overwrites a category the user chose', () => {
    render(<TransactionEntry />);
    fireEvent.change(category(), { target: { value: USER_CATEGORY } });
    typeMerchant(QUERY);
    acceptFirst();

    expect(merchant()).toHaveValue(FIRST.name);
    expect(category()).toHaveValue(USER_CATEGORY);
  });

  // The reason this component exists as a combobox rather than a div with a list
  // under it. Modal takes Escape on the capture phase, so without the window
  // listener in MerchantCombobox the first Escape here would throw away the
  // whole half-filled form.
  it('gives Escape to the list first and to the dialog second', () => {
    const onClose = vi.fn();
    render(<TransactionEntry isModal onClose={onClose} />);
    typeMerchant(QUERY);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(merchant(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Add Transaction' })).toBeInTheDocument();
    expect(merchant()).toHaveValue(QUERY);

    // With no list left to close, Escape is the dialog's again.
    fireEvent.keyDown(merchant(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
