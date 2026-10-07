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
import { RefreshCw, Trash2, ChevronRight } from 'lucide-react';
import { getAiAuditLog, clearAiAuditLog } from '../ai/ai';
import type { AiAuditEntry } from '../types/api';
import { Panel, Button } from './ui';

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
    <div className="border-b border-line last:border-b-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 px-2.5 h-row text-left transition-colors ${open ? 'bg-accent-tint' : 'hover:bg-surface-hover'}`}
      >
        <ChevronRight className={`w-3 h-3 text-ink-muted shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
        <span className="text-sm text-ink flex-1 truncate">
          {FEATURE_LABELS[entry.feature] ?? entry.feature}
        </span>
        {entry.outcome === 'error' && (
          <span className="px-1 border border-current text-[10px] leading-[14px] uppercase tracking-[0.06em] text-negative">failed</span>
        )}
        <span className="w-16 text-right text-caption text-ink-secondary money shrink-0">{formatBytes(bytes(entry.request))}</span>
        <span className="w-16 text-right text-caption text-ink-muted money shrink-0 hidden sm:inline">
          {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </button>

      {open && (
        <div className="border-t border-line">
          <dl className="flex flex-wrap gap-x-5 gap-y-0.5 px-2.5 py-1 bg-surface-sunk text-caption border-b border-line">
            <div><dt className="inline label-micro">model </dt><dd className="inline text-ink money">{entry.model ?? '—'}</dd></div>
            <div><dt className="inline label-micro">took </dt><dd className="inline text-ink money">{entry.ms} ms</dd></div>
            {entry.usage && (
              <div>
                <dt className="inline label-micro">tokens </dt>
                <dd className="inline text-ink money">
                  {entry.usage.input_tokens ?? 0} in / {entry.usage.output_tokens ?? 0} out
                </dd>
              </div>
            )}
            {entry.error && (
              <div><dt className="inline label-micro">error </dt><dd className="inline text-negative">{entry.error}</dd></div>
            )}
          </dl>
          <pre className="px-2.5 py-1.5 bg-canvas text-caption text-ink-secondary overflow-x-auto max-h-80 whitespace-pre-wrap break-words money">
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
    <Panel
      bordered
      title="What was sent"
      meta={loading ? undefined : `${entries.length} REQ · MEMORY ONLY`}
      actions={(
        <>
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void refresh()}>
            Refresh
          </Button>
          {entries.length > 0 && (
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              onClick={async () => { await clearAiAuditLog(); void refresh(); }}
              aria-label="Clear the record"
            >
              Clear
            </Button>
          )}
        </>
      )}
    >
      <p className="font-sans text-sm text-ink-muted px-2.5 py-2 border-b border-line">
        Every request this app has made to the Anthropic API, exactly as it went out.
        Held in memory only and gone when you close the app — a file of these would be
        the thing this app exists not to keep.
      </p>

      {loading ? (
        <p className="font-sans text-sm text-ink-muted p-3">Reading…</p>
      ) : entries.length === 0 ? (
        <p className="font-sans text-sm text-ink-muted p-3">
          Nothing has been sent. With AI off, or no key saved, nothing ever is — this stays empty.
        </p>
      ) : (
        <div>
          <div className="flex items-center gap-2.5 px-2.5 h-[22px] bg-surface-sunk border-b border-line" aria-hidden="true">
            <span className="w-3 shrink-0" />
            <span className="label-micro flex-1">Feature</span>
            <span className="label-micro w-16 text-right">Size</span>
            <span className="label-micro w-16 text-right hidden sm:inline">Time</span>
          </div>
          {entries.map((entry, i) => <Entry key={`${entry.at}-${i}`} entry={entry} index={i} />)}
        </div>
      )}
    </Panel>
  );
}
