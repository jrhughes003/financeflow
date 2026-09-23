// A blank page should say what to do next, not just that it is blank.
//
// Every list in the app starts empty, and the old copy ("No goals yet") left
// the next step to be guessed at. This gives each one an icon, a sentence that
// explains why the page is worth filling in, and a button that starts the job.

import React from 'react';
import { Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondary,
  compact = false,
}: {
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
    <div className={`text-center ${compact ? 'py-8' : 'py-14'} px-4`}>
      {Icon && (
        <div className="w-12 h-12 mx-auto mb-4 rounded-container bg-surface-sunk flex items-center justify-center">
          <Icon className="w-6 h-6 text-ink-muted" />
        </div>
      )}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && (
        <p className="text-sm text-ink-muted mt-1.5 max-w-md mx-auto leading-relaxed">{description}</p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-ink-inverse text-sm font-medium rounded-container transition-colors"
        >
          <Plus className="w-4 h-4" />
          {actionLabel}
        </button>
      )}
      {secondary && <p className="text-caption text-ink-muted mt-4">{secondary}</p>}
    </div>
  );
}
