import { getRequestStore } from '../cache.js';

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

declare const slotValue: unique symbol;

/**
 * A request-store key that carries the type of the value stored under it.
 *
 * The brand is phantom: it exists only in the type system and never at
 * runtime, where these are ordinary symbols. It is required rather than
 * optional, which is what makes the type nominal: an unbranded `symbol` is not
 * a slot key, so a caller cannot skip `requestSlotKey` and lose the value type.
 * Being an intersection with `symbol`, a key is still usable as a `Map` key.
 */
export type RequestSlotKey<T> = symbol & { readonly [slotValue]: T };

/**
 * Mint a slot key for values of type `T`.
 *
 * The single assertion here is the brand's construction site: a real `symbol`
 * has no such property, and attaching one at runtime would be pointless
 * bookkeeping for a purely compile-time distinction. Confining it to this one
 * factory is what makes every read and write below cast-free.
 */
export function requestSlotKey<T>(description: string): RequestSlotKey<T> {
  return Symbol(description) as RequestSlotKey<T>;
}

/**
 * Mint a slot key backed by the global symbol registry, for a slot that must
 * be the same key across duplicate module instances (see `Symbol.for`).
 */
export function globalRequestSlotKey<T>(key: string): RequestSlotKey<T> {
  return Symbol.for(key) as RequestSlotKey<T>;
}

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
