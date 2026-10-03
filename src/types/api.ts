// The Electron bridge, as electron/preload.cjs actually exposes it.
//
// Eight methods, all promise-returning, and nothing else — no ipcRenderer
// object, no Node globals. Mirroring it here rather than hand-writing a .d.ts
// next to the .cjs means the mirror can drift, so electron/ipc-contract.test.js
// compares this list against the channels both sides of the bridge register.

import type { AppState } from './state';

/**
 * The AI features, taken from the ALLOW keys in electron/ai/payload.cjs.
 *
 * That object is the actual gate: buildPayload throws on a name it does not
 * know, so a typo cannot fall through to sending an unfiltered object.
 */
export type AiFeature = 'categorize' | 'parse_entry' | 'query' | 'insights' | 'extract';

/**
 * What the main process reports about the key, and nothing more.
 *
 * The key itself never crosses the bridge in either direction after it is set —
 * it exists in plaintext only in main-process memory at call time.
 */
export interface AiStatus {
  /** False when the OS keychain is unavailable, in which case setKey refuses. */
  encryptionAvailable: boolean;
  hasKey: boolean;
}

/**
 * Structured failure rather than a rejection.
 *
 * Everything on the AI path returns this instead of throwing across IPC, so a
 * missing key is a value the UI can render rather than an exception it has to
 * catch. `no_key` in particular is a sentinel the Settings and Reports pages
 * map to a specific message.
 */
export type AiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface DatabaseBridge {
  /**
   * Returns arbitrary JSON, not a guaranteed AppState: the rows were written by
   * older versions and round-tripped through SQLite. Narrow it with asAppState.
   * May carry `_corruptRows` when something was unreadable.
   */
  loadAll(): Promise<unknown>;
  saveAll(state: AppState): Promise<true>;
  isInitialized(): Promise<boolean>;
  markInitialized(): Promise<true>;
}

/**
 * One outbound request, exactly as it was handed to the transport.
 *
 * Recorded by wrapping the SDK rather than the payload gate, so it shows what
 * actually left — including the tool results Q&A sends back in later turns,
 * which a gate-level record would omit. In memory only; never written to disk.
 */
export interface AiAuditEntry {
  feature: AiFeature;
  /** ISO timestamp of when the request went out. */
  at: string;
  ms: number;
  /** The verbatim request body. Shape is the Anthropic SDK's, not ours. */
  request: unknown;
  model: string | null;
  usage: { input_tokens?: number; output_tokens?: number } | null;
  outcome: 'ok' | 'error';
  error?: string;
}

export interface AiBridge {
  status(): Promise<AiStatus>;
  setKey(key: string): Promise<AiResult<void>>;
  clearKey(): Promise<AiResult<void>>;
  run(feature: AiFeature, input: unknown): Promise<AiResult<unknown>>;
  /** Newest first, capped at the last 20 requests. */
  auditLog(): Promise<AiAuditEntry[]>;
  clearAuditLog(): Promise<true>;
}

export interface FinanceFlowApi {
  /** Present and true only under Electron; the storage layer switches on it. */
  isElectron: true;
  db: DatabaseBridge;
  ai: AiBridge;
}

/** The channel names both sides of the bridge must agree on. */
export const IPC_CHANNELS = [
  'db:loadAll', 'db:saveAll', 'db:isInitialized', 'db:markInitialized',
  'ai:status', 'ai:setKey', 'ai:clearKey', 'ai:run', 'ai:auditLog', 'ai:clearAuditLog',
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];
