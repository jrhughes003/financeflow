// A blank page should say what to do next, not just that it is blank.
//
// Every list in the app starts empty, and the old copy ("No goals yet") left
// the next step to be guessed at. This gives each one an icon, a sentence that
// explains why the page is worth filling in, and a button that starts the job.

import React from 'react';
import { Plus } from 'lucide-react';

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondary,
  compact = false,
}) {
  return (
    <div className={`text-center ${compact ? 'py-8' : 'py-14'} px-4`}>
      {Icon && (
        <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-gray-50 flex items-center justify-center">
          <Icon className="w-6 h-6 text-gray-400" />
        </div>
      )}
      <p className="text-base font-semibold text-gray-900">{title}</p>
      {description && (
        <p className="text-sm text-gray-500 mt-1.5 max-w-md mx-auto leading-relaxed">{description}</p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" />
          {actionLabel}
        </button>
      )}
      {secondary && <p className="text-xs text-gray-400 mt-4">{secondary}</p>}
    </div>
  );
}
