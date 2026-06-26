import type { StreamStatus } from './internal/use-loader-runner.js';

/** Single-value loader consumption state. Pattern-match on `status`. */
export type LoaderState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'revalidating'; data: T }
  | { status: 'error'; error: Error; data: T };

/** Streaming/live loader consumption state. Pattern-match on `status`. */
export type StreamState<T> =
  | { status: 'connecting' }
  | { status: 'open'; data: T }
  | { status: 'closed'; data: T }
  // `data` is optional: a COLD stream error (the connect rejects before any
  // chunk) surfaces here with no accumulated value. A post-chunk error still
  // carries the last-good `data`. Read `data` only after narrowing to a
  // data-bearing status (`open`/`closed`), or guard it on the error arm.
  | { status: 'error'; error: Error; data?: T };

/**
 * Project the runner's authoritative discriminant into the single-value union.
 * Keyed on `settled` (a settled value exists), NOT on `data === undefined`, so a
 * loader that legitimately resolves to `undefined` lands in `success`/`error`
 * rather than collapsing back to `loading` (review #1).
 *
 * `data` is typed `T` (not `T | undefined`): the caller (`loader.tsx`) passes
 * the runner's settled value, whose type already admits `undefined` when the
 * loader can return it (inference binds `T` to that wider type). In the
 * data-carrying arms the value IS `T`, so no cast is needed. Cold errors (error
 * with no settled value) are routed to `errorFallback`/the boundary in
 * `loader.tsx` before the render fn runs; here they fall through to `loading`.
 */
export function toLoaderState<T>(
  data: T,
  error: Error | null,
  settled: boolean,
  reloading: boolean
): LoaderState<T> {
  if (error !== null && settled) return { status: 'error', error, data };
  if (!settled) return { status: 'loading' };
  if (reloading) return { status: 'revalidating', data };
  return { status: 'success', data };
}

/**
 * Project loose streaming-context fields into a streaming union. Error wins
 * FIRST, before the connecting/undefined guard: a COLD stream error (the connect
 * rejects before any chunk, so `data === undefined`) must reach the `error` arm
 * in-view rather than hang on `connecting` forever (review #5). The error arm's
 * `data` is therefore optional, and may be `undefined` on a cold error; a
 * post-chunk error carries the last-good value.
 *
 * After the error check, `connecting` carries no data (the `initial` accumulator
 * is an internal reduce seed). Key the connecting arm on the stream status too,
 * not just `data === undefined`: a manual `reload()` of a live loader surfaces
 * `data = accumulate.initial` (a defined value, e.g. `[]`) together with
 * `status === 'connecting'`, and that reconnect must project to `connecting`
 * (mirroring a fresh mount) rather than to `open` with the empty seed. Safe
 * because the runner only sets `status === 'open'` once a chunk has arrived, so
 * `open`/`closed` always carry data.
 */
export function toStreamState<T>(
  data: T | undefined,
  status: StreamStatus,
  error: Error | null
): StreamState<T> {
  if (error !== null) return { status: 'error', error, data };
  if (status === 'connecting' || data === undefined)
    return { status: 'connecting' };
  if (status === 'closed') return { status: 'closed', data };
  return { status: 'open', data };
}
