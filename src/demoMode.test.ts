// The demo build is the only thing a visitor ever sees, so the two behaviours
// that make it a demo are worth pinning: it seeds a populated ledger, and it
// does so only when the flag is set.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AppState } from './types/state';

async function loadContext({ demo }: { demo: boolean }) {
  vi.stubEnv('VITE_DEMO_MODE', demo ? 'true' : 'false');
  vi.resetModules();
  return import('./context/FinancialContext');
}

beforeEach(() => localStorage.clear());
afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); });

describe('demo build', () => {
  it('starts empty when the flag is off', async () => {
    const { FinancialProvider } = await loadContext({ demo: false });
    const { render } = await import('@testing-library/react');
    const React = (await import('react')).default;
    const { useFinancial } = await import('./context/FinancialContext');

    let state: AppState | undefined;
    function Capture() { state = useFinancial().state; return null; }
    render(React.createElement(FinancialProvider, null, React.createElement(Capture)));
    expect(state).toBeDefined();
    if (!state) throw new Error('unreachable');

    expect(state.transactions).toEqual([]);
  });

  it('opens populated when the flag is on', async () => {
    const { FinancialProvider, useFinancial } = await loadContext({ demo: true });
    const { render } = await import('@testing-library/react');
    const React = (await import('react')).default;

    let state: AppState | undefined;
    function Capture() { state = useFinancial().state; return null; }
    render(React.createElement(FinancialProvider, null, React.createElement(Capture)));
    expect(state).toBeDefined();
    if (!state) throw new Error('unreachable');

    // Enough history that every chart and insight has something to draw.
    expect(state.transactions.length).toBeGreaterThan(100);
    expect(state.budgets.length).toBeGreaterThan(0);
    expect(state.debts.length).toBeGreaterThan(0);
  });

  it('does not overwrite data the visitor already has', async () => {
    localStorage.setItem('financeflow_data', JSON.stringify({
      transactions: [{ id: 'mine', amount: 1 }], budgets: [], incomes: [],
      savings_goals: [], investments: [], debts: [], recurringTemplates: [], settings: {},
    }));
    const { FinancialProvider, useFinancial } = await loadContext({ demo: true });
    const { render } = await import('@testing-library/react');
    const React = (await import('react')).default;

    let state: AppState | undefined;
    function Capture() { state = useFinancial().state; return null; }
    render(React.createElement(FinancialProvider, null, React.createElement(Capture)));
    expect(state).toBeDefined();
    if (!state) throw new Error('unreachable');

    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].id).toBe('mine');
  });
});
