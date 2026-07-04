/**
 * Deep (recursive) `Readonly<T>` for JSON-shaped connection data, except
 * identity for `unknown`/`any`.
 *
 * `.data` is edge-seeded, JSON-serialized onto a forward header, and re-read
 * fresh per event, so a nested in-place mutation silently vanishes on a
 * Cloudflare Durable Object (it never persists) just like a top-level one. A
 * shallow `Readonly<T>` only froze the top level, letting `conn.data.nested.x =
 * 1` type-check; the deep type turns any nested mutation into a compile error
 * too. Recursion is JSON-only (arrays + plain objects); `.data` is not a place
 * for `Date`/`Map`/`Set`/functions since it must round-trip through
 * `JSON.stringify`.
 *
 * The leading `unknown extends T ? T` is load-bearing on two counts: (1) the
 * internal realtime plumbing types per-connection data as `unknown` at its
 * seams, and `Readonly<unknown>` degenerates to `{}` (which `unknown` is not
 * assignable to), so it keeps the seam assignable; (2) it short-circuits `any`
 * to identity before the `any`-distributing conditionals below would explode it
 * into a union of every branch. Because it recurses through this same alias,
 * that guard applies at every nesting level.
 */
export type ReadonlyData<T> = unknown extends T
  ? T
  : T extends readonly (infer U)[]
    ? ReadonlyArray<ReadonlyData<U>>
    : T extends object
      ? { readonly [K in keyof T]: ReadonlyData<T[K]> }
      : T;
