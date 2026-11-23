// Settings → Automatic backups. Desktop only: the browser build keeps its data
// in localStorage, which the main process cannot reach.

import React, { useEffect, useState } from 'react';
import { FolderOpen, FolderCog, RotateCcw, Save } from 'lucide-react';
import { Panel, Button, Badge } from './ui';
import { electronApi } from '../storage/storage';
import type { BackupStatus } from '../types/api';

const fmtWhen = (iso: string | null): string => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const fmtSize = (bytes: number): string =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function AutoBackupPanel() {
  const api = electronApi();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { api?.backup.status().then(setStatus).catch(() => setStatus(null)); }, [api]);

  if (!api) return null;

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.backup.runNow();
      setStatus(res);
      setNote(res.ok ? { ok: true, text: 'Backup taken.' } : { ok: false, text: `Backup failed: ${res.error}` });
    } finally { setBusy(false); }
  };

  const setKeep = async (keep: number) => setStatus(await api.backup.configure({ keep }));

  return (
    <Panel bordered title="Automatic Backups" meta={status ? `DAILY · KEEP ${status.keep}` : 'DAILY'}>
      <p className="font-sans text-sm text-ink-secondary px-2.5 py-2 border-b border-line">
        A copy of your whole database is saved once a day, when the app opens and every few hours while
        it stays open. Older copies beyond the number below are deleted; nothing else in the folder is touched.
      </p>
      {status && (
        <div className="px-2.5 py-2 space-y-2 text-sm">
          <div className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 font-sans">
            <span className="label-micro self-center">Folder</span>
            <span className="text-ink break-all">{status.dir}</span>
            <span className="label-micro self-center">Last backup</span>
            <span className="text-ink">{fmtWhen(status.lastAt)}{status.files[0] ? ` · ${status.files[0].name} (${fmtSize(status.files[0].size)})` : ''}</span>
            <span className="label-micro self-center">Copies kept</span>
            <span>
              <select
                value={status.keep}
                onChange={e => setKeep(Number(e.target.value))}
                className="h-6 px-1 bg-surface border border-line-strong rounded-control text-caption text-ink"
                aria-label="Number of daily backups to keep"
              >
                {[7, 14, 30, 60, 90].map(n => <option key={n} value={n}>{n} days</option>)}
                {![7, 14, 30, 60, 90].includes(status.keep) && <option value={status.keep}>{status.keep} days</option>}
              </select>
              <span className="text-ink-muted text-caption ml-2">{status.files.length} on disk now</span>
            </span>
          </div>
          {status.lastError && (
            <p className="flex items-start gap-2"><Badge tone="negative" className="shrink-0 mt-px">ERR</Badge><span className="font-sans text-caption text-negative">Last backup failed: {status.lastError}</span></p>
          )}
          {note && (
            <p className="flex items-start gap-2"><Badge tone={note.ok ? 'positive' : 'negative'} className="shrink-0 mt-px">{note.ok ? 'OK' : 'ERR'}</Badge><span className="font-sans text-caption">{note.text}</span></p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button icon={Save} onClick={run} disabled={busy}>{busy ? 'Backing up…' : 'Back up now'}</Button>
            <Button icon={FolderOpen} onClick={() => api.backup.openDir()}>Open folder</Button>
            <Button icon={FolderCog} onClick={async () => setStatus(await api.backup.chooseDir())}>Change folder…</Button>
            {status.dir !== status.defaultDir && (
              <Button icon={RotateCcw} onClick={async () => setStatus(await api.backup.configure({ resetDir: true }))}>Use default folder</Button>
            )}
          </div>
          <p className="font-sans text-caption text-ink-muted">
            To restore one: close FinanceFlow, copy the backup over <code>financeflow.db</code> in
            %APPDATA%\FinanceFlow (delete the -wal and -shm files beside it), then reopen. A folder
            synced by OneDrive works too, so copies also live off this machine.
          </p>
        </div>
      )}
    </Panel>
  );
}
