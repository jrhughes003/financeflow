// Shown only in the deployed web demo.
//
// Three things a visitor would otherwise have to guess: the ledger in front of
// them is generated rather than someone's real finances, whatever they type
// stays in their own browser, and the AI features are missing because they run
// in the desktop app's main process rather than because they are broken.

import React, { useState } from 'react';
import { Info, X } from 'lucide-react';
import { isDemoBuild } from '../demoMode';

const DISMISSED_KEY = 'financeflow_demo_banner_dismissed';

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false; // private mode or blocked site data — just show it
  }
}

export default function DemoBanner() {
  const [hidden, setHidden] = useState(wasDismissed);

  if (!isDemoBuild || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch { /* not worth telling anyone about */ }
  };

  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-accent-tint border-b border-line text-sm text-ink-secondary">
      <Info className="w-4 h-4 shrink-0 mt-0.5 text-accent" aria-hidden="true" />
      <p className="flex-1 min-w-0">
        <strong className="font-medium text-ink">Live demo.</strong>{' '}
        Everything here is generated data, and anything you change stays in this browser —
        nothing is uploaded. Clear your site data to start over. The AI features need an
        API key and run in the desktop build, so they're switched off here.
      </p>
      <button
        onClick={dismiss}
        aria-label="Dismiss the demo notice"
        className="p-1 -m-1 shrink-0 opacity-60 hover:opacity-100 rounded-control focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
