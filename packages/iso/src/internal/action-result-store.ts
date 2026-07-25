import type { DenyCode } from '../outcomes.js';
import { createStoreSignal } from './store-signal.js';
import type { ReadonlySignal } from '@preact/signals';

type Key = string; // `${module}::${action}`

export type StoredActionResult =
  | { kind: 'success'; data: unknown; submittedPayload: unknown }
  | {
      kind: 'deny';
      status: number;
      message: string;
      data?: unknown;
      code?: DenyCode;
      submittedPayload: unknown;
    }
  | {
      kind: 'error';
      message: string;
      submittedPayload: unknown | null;
    };

export type StoredActionEntry = StoredActionResult & {
  module: string;
  action: string;
};

function key(module: string, action: string): Key {
  return `${module}::${action}`;
}

// The signal holds the whole keyed map (a fresh Map instance on every write,
// so the identity change drives the signal); `store.js` is the sanctioned
// `@preact/signals` importer, so this module never imports it directly (the
// module-graph guard).
const store = createStoreSignal<ReadonlyMap<Key, StoredActionEntry>>(new Map());

/**
 * The reactive read channel: `useActionResult`'s `useComputed` reads
 * `.value` (subscribing); `getLastActionResult` below reads `.peek()`
 * (non-reactive, for callers that compare identity rather than subscribe).
 */
export const lastActionResultSignal: ReadonlySignal<
  ReadonlyMap<Key, StoredActionEntry>
> = store.signal;

/**
 * Pure filter over a map snapshot: by stub identity if given, otherwise the
 * most recently written entry (Map iteration order, which `setLastActionResult`
 * maintains via delete-then-set). Shared by the reactive hook read and the
 * non-reactive peek below so the two never drift.
 */
export function pickLastActionResult(
  entries: ReadonlyMap<Key, StoredActionEntry>,
  stub?: { __module: string; __action: string }
): StoredActionEntry | null {
  if (stub) return entries.get(key(stub.__module, stub.__action)) ?? null;
  // No stub: return the most recently written entry.
  let last: StoredActionEntry | null = null;
  for (const entry of entries.values()) last = entry;
  return last;
}

export function setLastActionResult(
  module: string,
  action: string,
  result: StoredActionResult
): void {
  const k = key(module, action);
  // Delete-then-set to bump to most-recent position in Map iteration order,
  // so no-stub readers see the latest action result, not the earliest.
  const next = new Map(store.signal.peek());
  next.delete(k);
  next.set(k, { ...result, module, action });
  store.set(next);
}

export function clearLastActionResult(module: string, action: string): void {
  const k = key(module, action);
  const current = store.signal.peek();
  if (!current.has(k)) return;
  const next = new Map(current);
  next.delete(k);
  store.set(next);
}

/**
 * Non-reactive peek, for callers that compare identity rather than subscribe
 * (e.g. `<Form>`'s derived-state reset on a fresh server result).
 */
export function getLastActionResult(stub?: {
  __module: string;
  __action: string;
}): StoredActionEntry | null {
  return pickLastActionResult(store.signal.peek(), stub);
}
