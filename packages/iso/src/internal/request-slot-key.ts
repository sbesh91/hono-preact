// The key half of the request-scoped slot primitive, kept in its own leaf.
//
// This module imports nothing. `cache.ts` needs the key type to describe its
// store, and `request-scoped-slot.ts` needs `getRequestStore` from `cache.ts`;
// putting the keys in either of those files makes the two import each other.
// That cycle happens to resolve (hoisted function declarations), but a module
// cycle at package init is a class this repo has been bitten by before, and it
// is not worth relying on evaluation order for a type brand.

declare const slotValue: unique symbol;

/**
 * A request-store key that carries the type of the value stored under it.
 *
 * The underlying store is heterogeneous (`Map<symbol, unknown>`), so something
 * has to carry the value type for a given key. Carrying it on the key is what
 * lets reads and writes be typed rather than each call site restating `<T>` and
 * hoping every restatement agrees; a disagreement is now a compile error.
 *
 * The brand is phantom: it exists only in the type system and never at runtime,
 * where these are ordinary symbols. It is required rather than optional, which
 * is what makes the type nominal: an unbranded `symbol` is not a slot key, so a
 * caller cannot skip the factories below and lose the value type. Being an
 * intersection with `symbol`, a key is still usable as a `Map` key.
 */
export type RequestSlotKey<T> = symbol & { readonly [slotValue]: T };

/**
 * Mint a slot key for values of type `T`.
 *
 * The assertion here is the brand's construction site: a real `symbol` has no
 * such property, and attaching one at runtime would be pointless bookkeeping
 * for a purely compile-time distinction. Confining it to these two factories is
 * what makes every read and write cast-free.
 */
export function requestSlotKey<T>(description: string): RequestSlotKey<T> {
  return Symbol(description) as RequestSlotKey<T>;
}

/**
 * Mint a slot key backed by the global symbol registry, for a slot that must be
 * the same key across duplicate module instances (see `Symbol.for`).
 */
export function globalRequestSlotKey<T>(key: string): RequestSlotKey<T> {
  return Symbol.for(key) as RequestSlotKey<T>;
}
