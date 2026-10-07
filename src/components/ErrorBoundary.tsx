// A render error used to blank the whole window: no message, no way back, and
// in a finance app that reads like lost data even though nothing was written.
//
// The boundary wraps the page area rather than the whole app, so the sidebar
// survives and you can navigate somewhere else instead of restarting. It also
// offers a backup export, because the state in memory is still intact at this
// point and getting it to disk is the one thing worth doing before a reload.

import React from 'react';
import { RotateCcw, Download } from 'lucide-react';
import { Panel, Badge, Button } from './ui';

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
      <div className="max-w-xl mx-auto mt-8">
        <Panel bordered title="This page hit an error" actions={<Badge tone="caution">Render error</Badge>}>
          <div className="p-3">
            <p className="font-sans text-sm text-ink-secondary">
              Your data hasn't been touched — nothing is written while a page is failing to draw.
              Try another page from the sidebar, or reload.
            </p>

            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <Button variant="primary" icon={RotateCcw} onClick={() => window.location.reload()}>
                Reload
              </Button>
              {this.props.onExport && (
                <Button icon={Download} onClick={this.props.onExport}>
                  Export a backup first
                </Button>
              )}
            </div>
          </div>

          <details className="border-t border-line">
            <summary className="py-1.5 px-2.5 label-micro cursor-pointer hover:text-ink-secondary hover:bg-surface-hover">
              Technical detail
            </summary>
            <pre className="px-2.5 py-1.5 bg-canvas border-t border-line text-caption text-ink-secondary overflow-x-auto whitespace-pre-wrap">
              {String(error?.stack || error?.message || error)}
            </pre>
          </details>
        </Panel>
      </div>
    );
  }
}
