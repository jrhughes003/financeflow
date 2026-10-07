// Autofill for the merchant field.
//
// utils/merchants.ts holds a curated table — a name, a category and a
// subcategory per row — and the entry form is the one place where that table
// can do the typing: three characters become a filled-in merchant, category and
// subcategory, before any of the categorisation tiers have to guess.
//
// IT IS A COMBOBOX, NOT A LIST UNDER A TEXT BOX. The entry dialog was recently
// taken from two labelled controls to seven, and a hand-rolled typeahead is the
// easiest way to hand that back: a popup that steals focus, a list a screen
// reader never announces, options only a mouse can reach. So this is the ARIA
// 1.2 combobox pattern as written — focus never leaves the input, the active
// option is pointed at with aria-activedescendant rather than focused, and the
// popup is a real listbox of real options. The input keeps the caller's `id`,
// so the form's existing <label htmlFor> still names it.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { searchMerchants } from '../../utils/merchants';
import type { MerchantEntry } from '../../utils/merchants';

export interface MerchantComboboxProps {
  /** The input's id, so the form's existing <label htmlFor> keeps naming it. */
  id: string;
  value: string;
  /** Every keystroke. The value itself stays owned by the caller. */
  onChange: (value: string) => void;
  /** A suggestion was accepted. Carries the category hint, not only the name. */
  onSelect: (entry: MerchantEntry) => void;
  /** The input's own blur, after the list has closed. */
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}

export default function MerchantCombobox({
  id, value, onChange, onSelect, onBlur, placeholder, className = '',
}: MerchantComboboxProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Opened by typing, and by an arrow key. Not by a value arriving from
  // elsewhere: the edit modal mounts with a merchant already in the field, and
  // it should not greet the user with a popup over the rest of the form.
  const [typing, setTyping] = useState(false);

  // -1 is "no active option", and it is deliberate rather than defaulting to the
  // first row: Enter in this form submits it, so pre-activating a suggestion
  // would turn "type a merchant, press Enter" into accepting whatever the table
  // happened to rank first.
  const [active, setActive] = useState(-1);

  // searchMerchants already requires two characters and is already ranked
  // best-first, so there is nothing to filter or sort here — only whether there
  // is anything to show.
  const suggestions = useMemo(() => searchMerchants(value), [value]);
  const open = typing && suggestions.length > 0;

  const listboxId = `${id}-listbox`;
  const optionId = (index: number): string => `${id}-option-${index}`;

  const close = (): void => { setTyping(false); setActive(-1); };

  const select = (entry: MerchantEntry): void => { close(); onSelect(entry); };

  // Escape is handled on the window, in the capture phase, rather than in the
  // input's own onKeyDown.
  //
  // Modal closes the whole dialog from a capture-phase listener on `document`
  // (see ui/Modal.tsx), which runs before React dispatches anything, so a React
  // handler could never get in front of it — Escape would abandon the
  // half-filled form instead of the suggestion list, and a merchant the user
  // started picking would be impossible to back out of. `window` is one step
  // further out than `document` in the capture path, so this always runs first,
  // whichever order the two effects happened to register in.
  //
  // Only while the list is open: with nothing to close, Escape belongs to the
  // dialog again.
  useEffect(() => {
    if (!open) return undefined;
    const onEscape = (e: KeyboardEvent): void => {
      // Ours only if the input still has the key: anything else pressing Escape
      // is the dialog's business, not this list's.
      if (e.key !== 'Escape' || e.target !== inputRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [open]);

  // Keep the active option in view. An eight-row list overflows the popup, and
  // an active option below the fold is invisible to the one user who cannot see
  // where it went. The typeof guard is for jsdom, which has no scrollIntoView.
  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.children.item(active);
    if (el instanceof HTMLElement && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [open, active]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestions.length) return;
      e.preventDefault();
      // An arrow also opens the list, which is the only way back to one that
      // Escape closed without retyping the merchant.
      setTyping(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(i => {
        const next = i + step;
        // Wrap at both ends. Running off the end of a list this short is a dead
        // stop the user has to notice; wrapping never is.
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter' && open && active >= 0) {
      const entry = suggestions[active];
      if (!entry) return;
      // Only with an option active, so Enter still submits the form otherwise.
      e.preventDefault();
      select(entry);
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        // Omitted rather than emptied while nothing is active: an empty string
        // here is read as a reference to an element that does not exist.
        {...(open && active >= 0 ? { 'aria-activedescendant': optionId(active) } : {})}
        // The browser's own saved-values dropdown would sit on top of this one.
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={e => {
          // A new query invalidates the old active row, so it starts again at
          // "nothing chosen" rather than pointing at a different merchant.
          setActive(-1);
          setTyping(true);
          onChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => { close(); onBlur?.(); }}
        className={className}
      />

      <ul
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label="Merchant suggestions"
        // Rendered even when closed, so aria-controls always points at an
        // element that exists; `hidden` keeps it out of the accessibility tree
        // and out of the layout in the meantime.
        hidden={!open}
        className="absolute left-0 right-0 top-full mt-px z-20 max-h-56 overflow-y-auto bg-surface border border-line-strong shadow-overlay"
      >
        {suggestions.map((entry, index) => (
          <li
            key={entry.name}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            // Focus has to stay in the input: a blur would close the list before
            // the click could ever land on the option.
            onMouseDown={e => e.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => select(entry)}
            className={`flex items-center justify-between gap-3 h-row px-2 text-sm cursor-pointer border-b border-line-faint last:border-b-0
              ${index === active ? 'bg-accent-tint text-accent-ink' : 'text-ink-secondary'}`}
          >
            <span className="truncate min-w-0">{entry.name}</span>
            {/* The subcategory, because it is already human-readable and it says
                what accepting this row is about to fill in. */}
            {entry.subcategory && <span className="text-micro uppercase text-ink-muted shrink-0">{entry.subcategory}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
