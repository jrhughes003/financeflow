// Toasts, with an optional action button.
//
// The action is what makes this worth a context rather than local state: every
// destructive action in the app now removes the record immediately and offers
// Undo for a few seconds, which is both safer and faster than a confirm dialog
// nobody reads.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Undo2, X } from 'lucide-react';

/** Colour and intent. `neutral` is the undo toast, which is not a success. */
export type ToastType = 'success' | 'error' | 'neutral';

/** The button on a toast - in practice always Undo. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  type?: ToastType;
  action?: ToastAction | null;
  /** Defaults to longer when there is an action to click. */
  duration?: number;
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action: ToastAction | null;
}

export interface ToastApi {
  /** Returns the toast id, so a caller can dismiss it early. */
  toast: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 4000;
const UNDO_DURATION = 7000; // long enough to notice a mistake and reach the mouse

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string): void => {
    setToasts(list => list.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const toast = useCallback((message: string, options: ToastOptions = {}): string => {
    const { type = 'success', action = null, duration = action ? UNDO_DURATION : DEFAULT_DURATION } = options;
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts(list => [...list, { id, message, type, action }]);
    timers.current.set(id, setTimeout(() => dismiss(id), duration));
    return id;
  }, [dismiss]);

  // Clear pending timers if the provider goes away mid-countdown.
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none" role="status" aria-live="polite">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`
              flex items-center gap-2.5 min-h-8 py-1 pl-2.5 pr-1 bg-surface border border-line-strong border-l-2 shadow-overlay text-sm
              pointer-events-auto min-w-[280px] max-w-[440px]
              ${t.type === 'error' ? 'border-l-negative' : t.type === 'neutral' ? 'border-l-accent' : 'border-l-positive'}
            `}
          >
            <span
              aria-hidden="true"
              className={`shrink-0 w-9 text-center border border-current text-[10px] leading-[14px] uppercase tracking-[0.06em]
                ${t.type === 'error' ? 'text-negative' : t.type === 'neutral' ? 'text-accent-ink' : 'text-positive'}`}
            >
              {t.type === 'error' ? 'ERR' : t.type === 'neutral' ? 'INFO' : 'OK'}
            </span>
            <span className="flex-1 min-w-0 text-ink">{t.message}</span>
            {t.action && (
              <button
                onClick={() => { t.action?.onClick(); dismiss(t.id); }}
                className="shrink-0 inline-flex items-center gap-1.5 h-6 px-2 rounded-control border border-line-strong text-micro font-medium uppercase tracking-[0.05em] text-accent-ink hover:bg-surface-hover transition-colors"
              >
                <Undo2 className="w-3 h-3" aria-hidden="true" />
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Module-level so the identity is stable: callers put `toast` in effect
// dependency arrays, and a fresh object per render would re-run those effects
// on every render.
const NO_TOASTS: ToastApi = { toast: () => '', dismiss: () => {} };

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  // Components are rendered inside the provider in the app, but tests may mount
  // one on its own; a no-op keeps those from crashing.
  return ctx || NO_TOASTS;
}
