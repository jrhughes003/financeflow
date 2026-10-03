// Applying the theme.
//
// The whole mechanism is one attribute on <html>: tokens.css defines the dark
// palette under :root[data-theme='dark'], so nothing else in the app has to
// know a theme exists.
//
// Two wrinkles are worth the code they cost:
//
//   'system' has to keep following the OS. Reading prefers-color-scheme once at
//   startup looks right until someone's machine switches at sunset and the app
//   stays light until it is restarted — so the media query is subscribed to,
//   not sampled.
//
//   The choice is mirrored into localStorage purely so index.html can apply it
//   before React mounts. The real setting lives in app state (SQLite on the
//   desktop, which cannot be read synchronously before paint); without the
//   mirror, a dark-theme user gets a white flash on every launch.

import type { ThemePreference } from '../types/state';

export const THEME_STORAGE_KEY = 'financeflow_theme';

const query = () => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null);

export function systemPrefersDark(): boolean {
  return query()?.matches ?? false;
}

/** The theme actually shown, resolving 'system' against the OS. */
export function resolveTheme(preference: ThemePreference = 'system'): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemPrefersDark() ? 'dark' : 'light';
}

export function applyTheme(preference: ThemePreference = 'system'): 'light' | 'dark' {
  const resolved = resolveTheme(preference);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private mode, or site data blocked. The theme still applies for this
    // session; only the pre-paint hint on next launch is lost.
  }
  return resolved;
}

/**
 * Keep 'system' in step with the OS. Returns an unsubscribe function, and does
 * nothing for an explicit preference.
 */
export function watchSystemTheme(preference: ThemePreference, onChange: (resolved: 'light' | 'dark') => void): () => void {
  const media = query();
  if (!media || preference !== 'system') return () => {};
  const handler = () => onChange(systemPrefersDark() ? 'dark' : 'light');
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}
