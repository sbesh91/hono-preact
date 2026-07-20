import { isDeny } from '../outcomes.js';
import type { DenyOutcome } from '../outcomes.js';

/**
 * Marks a `DenyOutcome` as loader-originated. Declared on `DenyOutcome` so the
 * read is a typed `in`-style property access, not a cast. Only SSR uses it: a
 * loader deny with no local `errorFallback` is tagged before rethrow so a
 * page-level `RouteBoundary` may render its fallback; a middleware deny is never
 * tagged and stays bare text.
 */
export const LOADER_DENY: unique symbol = Symbol.for('@hono-preact/loader-deny');

/** Tag the outcome in place and return it (for `throw markLoaderDeny(e)`). */
export function markLoaderDeny(o: DenyOutcome): DenyOutcome {
  (o as { [LOADER_DENY]?: true })[LOADER_DENY] = true;
  return o;
}

/** True iff `x` is a deny outcome carrying the loader tag. */
export function isLoaderDeny(x: unknown): x is DenyOutcome {
  return isDeny(x) && x[LOADER_DENY] === true;
}
