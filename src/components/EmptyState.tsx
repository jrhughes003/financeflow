// A blank page should say what to do next, not just that it is blank.
//
// Every list in the app starts empty, and the old copy ("No goals yet") left
// the next step to be guessed at. This gives each one a title, a sentence that
// explains why the page is worth filling in, and a button that starts the job.
// Terminal style: no icon tile, a short uppercase line, then the sentence.

import React from 'react';
import { Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './ui';

export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  secondary,
  compact = false,
}: {
  /** Accepted for callers, no longer drawn: a terminal panel says it in words. */
  icon?: LucideIcon;
  title: React.ReactNode;
  /** Why the page is worth filling in, not just that it is empty. */
  description?: React.ReactNode;
  /** Both of these together, or neither: a button with nothing to do is worse
   *  than no button. */
  actionLabel?: string;
  onAction?: () => void;
  secondary?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`${compact ? 'px-3 py-4' : 'px-3 py-8'} flex flex-col items-center text-center`}>
      <p className="text-sm font-semibold uppercase tracking-[0.04em] text-ink">{title}</p>
      {description && (
        <p className="font-sans text-sm text-ink-muted mt-1 max-w-md leading-relaxed">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button variant="primary" icon={Plus} onClick={onAction} className="mt-3">
          {actionLabel}
        </Button>
      )}
      {secondary && <p className="font-sans text-caption text-ink-muted mt-2.5 max-w-md">{secondary}</p>}
    </div>
  );
}
