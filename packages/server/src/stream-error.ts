/**
 * Mask a thrown error's detail unless `dev` is true. Shared by every
 * mid-stream error surface that puts an error's `message`/`name` directly on
 * the wire: the SSE `event: error` frame (`sse.ts`) and the SSR streaming
 * pump's per-loader error script (`stream-pump.ts`). Production masks to
 * `{ message: 'Stream failed', name: 'Error' }` (mirroring the JSON paths'
 * 'Loader failed' / 'Action failed' masking); dev passes the real message and
 * name through. Callers that also run stream observers (fanError) still
 * receive the real error for the observability side channel regardless of
 * `dev`.
 *
 * It lives in its own module rather than in `sse.ts` because masking is a
 * property of the streaming wire in general, not of SSE: the HTML pump has no
 * other reason to import the SSE encoder.
 */
export function maskStreamError(
  err: unknown,
  dev: boolean
): { message: string; name: string } {
  if (!dev) {
    return { message: 'Stream failed', name: 'Error' };
  }
  return {
    message: err instanceof Error ? err.message : String(err),
    name: err instanceof Error ? err.name : 'Error',
  };
}
