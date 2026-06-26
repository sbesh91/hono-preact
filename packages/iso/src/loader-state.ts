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
  | { status: 'error'; error: Error; data: T };

/**
 * Project loose loader-context fields into a single-value union. Cold errors
 * (error with no data) are handled by errorFallback/ErrorBoundary before the
 * render fn runs, so the `error` arm always carries data here.
 */
export function toLoaderState<T>(
  data: T | undefined,
  loading: boolean,
  error: Error | null
): LoaderState<T> {
  if (error !== null && data !== undefined)
    return { status: 'error', error, data };
  if (data === undefined) return { status: 'loading' };
  if (loading) return { status: 'revalidating', data };
  return { status: 'success', data };
}

/**
 * Project loose streaming-context fields into a streaming union. `connecting`
 * carries no data (the `initial` accumulator is an internal reduce seed). Key
 * the connecting arm on the stream status too, not just `data === undefined`: a
 * manual `reload()` of a live loader surfaces `data = accumulate.initial` (a
 * defined value, e.g. `[]`) together with `status === 'connecting'`, and that
 * reconnect must project to `connecting` (mirroring a fresh mount) rather than
 * to `open` with the empty seed. Safe because the runner only sets
 * `status === 'open'` once a chunk has arrived, so `open`/`closed`/`error`
 * always carry data.
 */
export function toStreamState<T>(
  data: T | undefined,
  status: StreamStatus,
  error: Error | null
): StreamState<T> {
  if (status === 'connecting' || data === undefined)
    return { status: 'connecting' };
  if (error !== null) return { status: 'error', error, data };
  if (status === 'closed') return { status: 'closed', data };
  return { status: 'open', data };
}
