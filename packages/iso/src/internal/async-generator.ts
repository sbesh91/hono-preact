/**
 * Structural async-generator check: the single definition both packages use.
 *
 * Consumers: iso `internal/loader-runner-server.ts` (the direct-fn loader
 * path), server `sse.ts` (re-exported for `loaders-handler` /
 * `page-actions-handler`, which decide stream-vs-JSON on it). It lives here,
 * in the lower package, because a duplicated predicate is a predicate that can
 * drift: the two copies decided the same stream-vs-JSON branch, so any
 * divergence would silently route one surface differently from the other.
 *
 * The check is structural rather than an `instanceof`: a generator that
 * crossed a realm, or a hand-rolled object implementing the protocol, is a
 * legitimate streaming source and must take the same branch.
 */
export function isAsyncGenerator(
  value: unknown
): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === 'function' &&
    'next' in value &&
    typeof value.next === 'function'
  );
}
