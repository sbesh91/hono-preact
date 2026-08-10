import type { MutateResult } from 'hono-preact';

/**
 * The human-readable message for any failure arm of a `mutate` result.
 *
 * The failure side of `mutate` is a guard's structured `deny` (status, typed
 * code, data), a cancelled `aborted`, or a thrown `error`; the latter two both
 * carry `error`. A toast wants neither structure, just the sentence, so the
 * branch lives here once instead of at every call site.
 */
export function mutateFailureMessage(
  result: Extract<MutateResult<unknown>, { ok: false }>
): string {
  return result.kind === 'deny' ? result.deny.message : result.error.message;
}
