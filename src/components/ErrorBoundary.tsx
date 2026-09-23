// A render error used to blank the whole window: no message, no way back, and
// in a finance app that reads like lost data even though nothing was written.
//
// The boundary wraps the page area rather than the whole app, so the sidebar
// survives and you can navigate somewhere else instead of restarting. It also
// offers a backup export, because the state in memory is still intact at this
// point and getting it to disk is the one thing worth doing before a reload.

import React from 'react';
import { AlertTriangle, RotateCcw, Download } from 'lucide-react';

interface ErrorBoundaryProps {
  children?: React.ReactNode;
  /** Changing this clears the failure — the app passes the current page. */
  resetKey?: unknown;
  /** Offered because the in-memory state is still intact at this point. */
  onExport?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Desktop users have no devtools open by default; this at least lands in
    // the terminal for `npm run electron:dev`.
    console.error('Render error:', error, info?.componentStack);
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Moving to another page clears the failure, so one broken page doesn't
    // trap the session.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="max-w-lg mx-auto mt-12 bg-surface border border-line rounded-container p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-caution shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">This page hit an error</h2>
            <p className="text-sm text-ink-secondary mt-1">
              Your data hasn't been touched — nothing is written while a page is failing to draw.
              Try another page from the sidebar, or reload.
            </p>

            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reload
              </button>
              {this.props.onExport && (
                <button
                  onClick={this.props.onExport}
                  className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover"
                >
                  <Download className="w-3.5 h-3.5" /> Export a backup first
                </button>
              )}
            </div>

            <details className="mt-4">
              <summary className="text-caption text-ink-muted cursor-pointer hover:text-ink-secondary">
                Technical detail
              </summary>
              <pre className="mt-2 p-3 bg-surface-sunk border border-line rounded-control text-caption text-ink-secondary overflow-x-auto whitespace-pre-wrap">
                {String(error?.stack || error?.message || error)}
              </pre>
            </details>
          </div>
        </div>
      </div>
    );
  }
}
