// Shown when the database could not be read at startup.
//
// This screen exists because the alternative is much worse. The app used to
// treat a failed load as "no data yet": it kept the empty placeholder state,
// unlocked persistence anyway, and the next keystroke wrote that empty state
// over a database that was merely unreadable, not empty. Blocking the UI is
// what guarantees nothing is written while the real rows are still on disk.

import React from 'react';
import { RotateCcw } from 'lucide-react';
import { Badge, Button } from './ui';

/** Whatever was thrown, rendered as something a person can paste into a report. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

const DB_PATH = String.raw`C:\Users\<you>\AppData\Roaming\FinanceFlow\financeflow.db`;

export default function LoadFailure({ error }: { error: unknown }) {
  return (
    <div className="min-h-screen bg-canvas flex items-start justify-center p-4">
      <section aria-labelledby="load-failure-title" className="max-w-xl w-full mt-16 bg-surface border border-line-strong">
        <div className="h-bar flex items-center gap-2.5 px-2.5 bg-surface-sunk border-b border-line">
          <h1 id="load-failure-title" className="text-micro uppercase font-semibold text-ink">Couldn't open your data</h1>
          <span className="ml-auto"><Badge tone="negative">Load failed</Badge></span>
        </div>

        <div className="p-3 space-y-2.5">
          <p className="font-sans text-sm text-ink-secondary">
            The database exists but couldn't be read, so the app has stopped before doing
            anything else. <strong className="font-medium text-ink">Nothing has been
            written</strong> — your records are still on disk exactly as they were.
          </p>

          <div>
            <p className="font-sans text-sm text-ink-secondary">
              Copy this file somewhere safe before trying anything, then reload:
            </p>
            <pre className="mt-1.5 px-2.5 py-1.5 bg-canvas border border-line text-caption text-ink overflow-x-auto">
              {DB_PATH}
            </pre>
          </div>

          <Button variant="primary" icon={RotateCcw} onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>

        <details className="border-t border-line">
          <summary className="py-1.5 px-2.5 label-micro cursor-pointer hover:text-ink-secondary hover:bg-surface-hover">
            Technical detail
          </summary>
          <pre className="px-2.5 py-1.5 bg-canvas border-t border-line text-caption text-ink-secondary overflow-x-auto whitespace-pre-wrap">
            {describeError(error)}
          </pre>
        </details>
      </section>
    </div>
  );
}
