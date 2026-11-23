// useState that survives leaving the page and restarting the app.
//
// For view state only — which page was open, what the ledger was filtered to —
// never for records. It lives in this browser profile's localStorage, which in
// the desktop app is Electron's own profile, and it may be missing or blocked,
// so every read and write is guarded and a failure just means starting fresh.

import { useEffect, useState } from 'react';

const PREFIX = 'financeflow_ui:';

export function readPersistent<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    // Shallow-merged onto the fallback for objects, so a field added in a later
    // version gets its default instead of undefined.
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) && parsed && typeof parsed === 'object') {
      return { ...fallback, ...(parsed as object) } as T;
    }
    return (parsed as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function usePersistentState<T>(key: string, fallback: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readPersistent(key, fallback));
  useEffect(() => {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }, [key, value]);
  return [value, setValue];
}
