// "What was sent" — the privacy claim, made checkable.
//
// The README says an allow-list decides exactly what each feature may send.
// This shows the actual request bodies, so a user can verify that rather than
// take it on trust: open it after asking a question and read what left.
//
// It is deliberately not a summary. A friendly rendering ("sent: 3 totals")
// would be another claim about the data rather than the data, and the whole
// point is that nothing stands between the user and the bytes.

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, Trash2, ChevronRight } from 'lucide-react';
import { getAiAuditLog, clearAiAuditLog } from '../ai/ai';
import type { AiAuditEntry } from '../types/api';

const FEATURE_LABELS: Record<string, string> = {
  categorize: 'Auto-categorisation',
  parse_entry: 'Natural-language entry',
  query: 'Q&A',
  insights: 'Insights',
  extract: 'Receipt parsing',
};

const bytes = (value: unknown): number => {
  try { return new Blob([JSON.stringify(value)]).size; } catch { return 0; }
};

const formatBytes = (n: number): string => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`);

function Entry({ entry, index }: { entry: AiAuditEntry; index: number }) {
  const [open, setOpen] = useState(index === 0); // newest expanded
  const when = new Date(entry.at);

  return (
    <div className="border border-line rounded-control overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 h-row text-left hover:bg-surface-hover transition-colors"
      >
        <ChevronRight className={`w-3.5 h-3.5 text-ink-muted shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-sm text-ink flex-1 truncate">
          {FEATURE_LABELS[entry.feature] ?? entry.feature}
        </span>
        {entry.outcome === 'error' && (
          <span className="text-micro uppercase tracking-[0.06em] text-negative">failed</span>
        )}
        <span className="text-caption text-ink-muted money shrink-0">{formatBytes(bytes(entry.request))}</span>
        <span className="text-caption text-ink-muted money shrink-0 hidden sm:inline">
          {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </button>

      {open && (
        <div className="border-t border-line">
          <dl className="flex flex-wrap gap-x-6 gap-y-1 px-3 py-2 bg-surface-sunk text-caption">
            <div><dt className="inline text-ink-muted">model </dt><dd className="inline text-ink money">{entry.model ?? '—'}</dd></div>
            <div><dt className="inline text-ink-muted">took </dt><dd className="inline text-ink money">{entry.ms} ms</dd></div>
            {entry.usage && (
              <div>
                <dt className="inline text-ink-muted">tokens </dt>
                <dd className="inline text-ink money">
                  {entry.usage.input_tokens ?? 0} in / {entry.usage.output_tokens ?? 0} out
                </dd>
              </div>
            )}
            {entry.error && (
              <div><dt className="inline text-ink-muted">error </dt><dd className="inline text-negative">{entry.error}</dd></div>
            )}
          </dl>
          <pre className="px-3 py-2 text-caption text-ink-secondary overflow-x-auto max-h-80 whitespace-pre-wrap break-words money">
            {JSON.stringify(entry.request, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function AiAuditPanel() {
  const [entries, setEntries] = useState<AiAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setEntries(await getAiAuditLog());
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="bg-surface rounded-container border border-line p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-ink-muted" aria-hidden="true" />
            What was sent
          </h2>
          <p className="text-sm text-ink-muted mt-1">
            Every request this app has made to the Anthropic API, exactly as it went out.
            Held in memory only and gone when you close the app — a file of these would be
            the thing this app exists not to keep.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void refresh()}
            className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {entries.length > 0 && (
            <button
              onClick={async () => { await clearAiAuditLog(); void refresh(); }}
              aria-label="Clear the record"
              className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors h-9 px-3.5 text-sm text-negative hover:bg-negative-tint"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted py-3">Reading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-ink-muted py-3">
          Nothing has been sent. With AI off, or no key saved, nothing ever is — this stays empty.
        </p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry, i) => <Entry key={`${entry.at}-${i}`} entry={entry} index={i} />)}
        </div>
      )}
    </div>
  );
}
