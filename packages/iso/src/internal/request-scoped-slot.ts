import { getRequestStore } from '../cache.js';

/**
 * A minimal per-request read/write primitive over the AsyncLocalStorage-backed
 * request store, shared by the small number of request-scoped registries in
 * this package (`server-deny-registry.ts`, `streaming-ssr.ts`). Each consumer
 * layers its own semantics (first-write-wins, max-status-wins, append-to-list)
 * on top; this file only removes the duplicated `getRequestStore()` +
 * get/set plumbing, not the policy.
 */

/** Read the current value stored under `key` for this request, if any. */
export function readRequestSlot<T>(key: symbol): T | undefined {
  const store = getRequestStore();
  return store ? (store.get(key) as T | undefined) : undefined;
}

/** Write `value` under `key` for this request. No-op outside a request scope. */
export function writeRequestSlot<T>(key: symbol, value: T): void {
  const store = getRequestStore();
  if (store) store.set(key, value);
}
