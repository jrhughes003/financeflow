// The theme is one attribute on <html>, so these tests are mostly about the
// two things that are easy to get wrong: 'system' continuing to track the OS
// after startup, and the pre-paint mirror staying in step with the real
// setting without ever becoming the source of truth.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyTheme, resolveTheme, systemPrefersDark, watchSystemTheme, THEME_STORAGE_KEY } from './theme';

/** A controllable prefers-color-scheme, with the listener API jsdom lacks. */
function mockSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn); },
  };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  return {
    media,
    listeners,
    change(toDark: boolean) {
      media.matches = toDark;
      listeners.forEach(fn => fn());
    },
  };
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  try { localStorage.clear(); } catch { /* ignore */ }
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('resolving a preference', () => {
  it('takes an explicit choice at face value, whatever the OS says', () => {
    mockSystem(true);
    expect(resolveTheme('light')).toBe('light');
    mockSystem(false);
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('follows the OS for "system"', () => {
    mockSystem(true);
    expect(resolveTheme('system')).toBe('dark');
    mockSystem(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('defaults to system, and to light where the query is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(systemPrefersDark()).toBe(false);
    expect(resolveTheme()).toBe('light'); // no preference, no media query
  });
});

describe('applying it', () => {
  it('sets the attribute the stylesheet keys off', () => {
    mockSystem(false);
    expect(applyTheme('dark')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('mirrors the preference — not the resolved theme — for the pre-paint hint', () => {
    // index.html re-resolves 'system' itself, so storing 'dark' here would
    // freeze a system user into dark on their next launch.
    mockSystem(true);
    applyTheme('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('still themes the session when storage is blocked', () => {
    mockSystem(false);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => applyTheme('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
    setItem.mockRestore();
  });
});

describe('keeping up with the OS', () => {
  it('re-resolves when the system flips, for "system" only', () => {
    const sys = mockSystem(false);
    const onChange = vi.fn();
    const stop = watchSystemTheme('system', onChange);

    sys.change(true);
    expect(onChange).toHaveBeenCalledWith('dark');
    sys.change(false);
    expect(onChange).toHaveBeenLastCalledWith('light');
    stop();
  });

  it('ignores the OS once a theme has been chosen explicitly', () => {
    const sys = mockSystem(false);
    const onChange = vi.fn();
    watchSystemTheme('light', onChange);
    sys.change(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('unsubscribes, so a remount does not stack listeners', () => {
    const sys = mockSystem(false);
    const onChange = vi.fn();
    const stop = watchSystemTheme('system', onChange);
    expect(sys.listeners.size).toBe(1);
    stop();
    expect(sys.listeners.size).toBe(0);
    sys.change(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is safe to call where there is no media query at all', () => {
    vi.stubGlobal('matchMedia', undefined);
    const stop = watchSystemTheme('system', vi.fn());
    expect(() => stop()).not.toThrow();
  });
});
