// A dialog that behaves like one.
//
// The transaction overlay used to be a plain fixed div. It announced nothing to
// a screen reader, Tab walked straight out of it into the page behind, and
// Escape only closed it by accident: App.tsx has a global key handler that
// clears the quick-add, so the *edit* modal — opened from the ledger and from
// the owed page — could not be dismissed with the keyboard at all.
//
// CommandPalette already did this properly. This is that behaviour, extracted,
// so there is one implementation rather than two and the next overlay gets it
// for free.

import React, { useCallback, useEffect, useRef } from 'react';

/** Everything focusable, in document order. Used for the tab wrap. */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ModalProps {
  /** Names the dialog for assistive tech. Usually the same text as the heading. */
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** The element to focus on open. Defaults to the first focusable one. */
  initialFocus?: React.RefObject<HTMLElement | null>;
}

export default function Modal({
  label, onClose, children, className = '', initialFocus,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Whatever had focus before this opened, so it can be handed back on close.
  const returnTo = useRef<HTMLElement | null>(null);

  const focusable = useCallback(
    (): HTMLElement[] => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocus?.current ?? focusable()[0])?.focus();

    return () => {
      // Returning focus matters more than it sounds: without it, focus falls
      // back to <body> and the next Tab starts from the top of the page.
      returnTo.current?.focus();
    };
  }, [focusable, initialFocus]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Stop the global quick-add handler in App from also firing.
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends, so Tab cannot walk out into the page behind.
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture, so this runs before App's window-level handler.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [focusable, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className="fixed inset-0 bg-ink/25" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className={`relative ${className}`}>
        {children}
      </div>
    </div>
  );
}
