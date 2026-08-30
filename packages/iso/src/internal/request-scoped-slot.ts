import { getRequestStore } from '../cache.js';
import type { RequestSlotKey } from './request-slot-key.js';

/**
 * A minimal per-request read/write primitive over the AsyncLocalStorage-backed
 * request store, shared by the small number of request-scoped registries in
 * this package (`server-deny-registry.ts`, `streaming-ssr.ts`). Each consumer
 * layers its own semantics (first-write-wins, max-status-wins, append-to-list)
 * on top; this file only removes the duplicated `getRequestStore()` +
 * get/set plumbing, not the policy.
 *
 * The store underneath is heterogeneous (`Map<symbol, unknown>`), so something
 * has to carry the value type for a given key. A {@link RequestSlotKey} carries
 * it on the key itself, which is what lets the read and write below be typed
 * rather than each call site restating `<T>` and hoping every restatement
 * agrees. A disagreement is now a compile error instead of a silent lie.
 */

/** Re-exported so a consumer needs only this module for the slot primitive. */
export {
  requestSlotKey,
  globalRequestSlotKey,
  type RequestSlotKey,
} from './request-slot-key.js';

/** Read the current value stored under `key` for this request, if any. */
export function readRequestSlot<T>(key: RequestSlotKey<T>): T | undefined {
  const store = getRequestStore();
  return store?.get(key);
}

/** Write `value` under `key` for this request. No-op outside a request scope. */
export function writeRequestSlot<T>(key: RequestSlotKey<T>, value: T): void {
  const store = getRequestStore();
  store?.set(key, value);
}
