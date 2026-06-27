/**
 * Normalize an unknown thrown value into an `Error`. A thrown non-`Error`
 * (a string, a rejected scalar) is wrapped via `new Error(String(err))`; an
 * existing `Error` passes through unchanged. Shared by every catch site that
 * needs an `Error` out of an `unknown` (loader runner, form/action submit,
 * loader fetch, route boundary) so the idiom lives in one place.
 */
export const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));
