// The boundary is the difference between "this page hit an error" and a blank
// white window, which in a finance app reads as lost data. These tests pin the
// three things it promises: the children render untouched when nothing is
// wrong, a throw becomes a readable panel instead of a blanked window, and the
// panel offers a way out — reload, an export of the state still in memory, and
// a resetKey change so navigating elsewhere clears the failure.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

/** The messages thrown on purpose below; everything else is a real failure. */
const DELIBERATE = ['boom', 'kaboom'];

/** Every console.error argument list the render produced, for the componentDidCatch case. */
let logged: unknown[][] = [];

beforeEach(() => {
  logged = [];
  // React logs every error a boundary catches, and componentDidCatch logs it
  // again on purpose. Both are expected and would bury the suite output — but
  // the spy only swallows the throws these tests staged, so an unrelated
  // console.error (a React key warning, an act() complaint) still shows up.
  const real = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args);
    const text = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
    if (DELIBERATE.some(m => text.includes(m))) return;
    real(...args);
  });
});

afterEach(() => { vi.restoreAllMocks(); });

/** A child that fails to draw. Always throws, hence the `never` return. */
function Boom({ message = 'boom' }: { message?: string }): never {
  throw new Error(message);
}

/** A child that fails only while told to, so recovery can be observed. */
function Flaky({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom');
  return <div>page body</div>;
}

const fallback = () => screen.queryByRole('heading', { name: /this page hit an error/i });

describe('ErrorBoundary', () => {
  it('renders its children untouched when nothing throws', () => {
    render(<ErrorBoundary><div>page body</div></ErrorBoundary>);
    expect(screen.getByText('page body')).toBeInTheDocument();
    expect(fallback()).not.toBeInTheDocument();
  });

  it('catches a child throw and explains that the data is intact', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(fallback()).toBeInTheDocument();
    // The reassurance is the substance of the panel, not decoration: a render
    // failure writes nothing, and saying so is what stops a user from
    // panicking about their ledger.
    expect(screen.getByText(/nothing is written while a page is failing to draw/i)).toBeInTheDocument();
  });

  it('keeps the underlying error reachable instead of hiding it', () => {
    render(<ErrorBoundary><Boom message="kaboom" /></ErrorBoundary>);
    // Tucked behind a <details> so it does not shout at the user, but present:
    // a desktop user with no devtools has nothing else to paste into a report.
    expect(screen.getByText(/technical detail/i)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
  });

  it('offers a reload', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    // Presence only. The handler is `window.location.reload()`, and jsdom marks
    // both `window.location` and `Location.prototype.reload` non-configurable
    // (they are [LegacyUnforgeable] in WebIDL), so neither can be spied on or
    // replaced — clicking would just log "Not implemented: navigation". The
    // affordance existing is the part a test can actually pin.
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('offers a backup export only when the app supplies one', () => {
    const onExport = vi.fn();
    const { unmount } = render(<ErrorBoundary onExport={onExport}><Boom /></ErrorBoundary>);
    // The state in memory is still intact at this point, so getting it to disk
    // is the one useful thing to do before reloading throws it away.
    fireEvent.click(screen.getByRole('button', { name: /export a backup first/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
    unmount();

    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.queryByRole('button', { name: /export a backup first/i })).not.toBeInTheDocument();
  });

  it('logs the error and the component stack for the terminal', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    // componentDidCatch is the only trace an Electron user leaves: devtools are
    // closed, so `npm run electron:dev` in a terminal is where this has to land.
    const call = logged.find(args => args[0] === 'Render error:');
    expect(call).toBeDefined();
    if (!call) throw new Error('componentDidCatch never logged');
    expect(call[1]).toBeInstanceOf(Error);
    expect((call[1] as Error).message).toBe('boom');
    expect(String(call[2])).toMatch(/Boom/); // the component stack React handed it
  });

  it('clears the failure when the app navigates to another page', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="dashboard"><Flaky explode /></ErrorBoundary>,
    );
    expect(fallback()).toBeInTheDocument();

    // resetKey is the current page. Without this, one page that throws would
    // hold the whole session hostage until a restart.
    rerender(<ErrorBoundary resetKey="budgets"><Flaky explode={false} /></ErrorBoundary>);
    expect(fallback()).not.toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('stays in the failed state while the page is unchanged', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="dashboard"><Flaky explode /></ErrorBoundary>,
    );
    // A re-render on the same page must not silently retry: the child would
    // throw again and the panel would flicker instead of holding still.
    rerender(<ErrorBoundary resetKey="dashboard"><Flaky explode={false} /></ErrorBoundary>);
    expect(fallback()).toBeInTheDocument();
    expect(screen.queryByText('page body')).not.toBeInTheDocument();
  });
});
