// Shown when the database could not be read at startup.
//
// This screen exists because the alternative is much worse. The app used to
// treat a failed load as "no data yet": it kept the empty placeholder state,
// unlocked persistence anyway, and the next keystroke wrote that empty state
// over a database that was merely unreadable, not empty. Blocking the UI is
// what guarantees nothing is written while the real rows are still on disk.

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

const DB_PATH = String.raw`C:\Users\<you>\AppData\Roaming\FinanceFlow\financeflow.db`;

export default function LoadFailure({ error }) {
  return (
    <div className="min-h-screen bg-canvas flex items-start justify-center p-6">
      <div className="max-w-lg w-full mt-16 bg-surface border border-line rounded-container p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-negative shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-ink">Couldn't open your data</h1>

            <p className="text-sm text-ink-secondary mt-1">
              The database exists but couldn't be read, so the app has stopped before doing
              anything else. <strong className="font-medium text-ink">Nothing has been
              written</strong> — your records are still on disk exactly as they were.
            </p>

            <p className="text-sm text-ink-secondary mt-3">
              Copy this file somewhere safe before trying anything, then reload:
            </p>
            <pre className="mt-2 p-3 bg-surface-sunk border border-line rounded-control text-caption text-ink-secondary overflow-x-auto">
              {DB_PATH}
            </pre>

            <button
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reload
            </button>

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
    </div>
  );
}
