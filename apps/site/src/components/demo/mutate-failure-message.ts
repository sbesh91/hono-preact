import type { MutateResult } from 'hono-preact';

/**
 * The human-readable message for either failure arm of a `mutate` result.
 *
 * `mutate` resolves to a three-arm union: a guard's structured `deny` (status,
 * typed code, data) or a thrown `error`. A toast wants neither structure, just
 * the sentence, so the branch lives here once instead of at every call site.
 */
export function mutateFailureMessage(
  result: Extract<MutateResult<unknown>, { ok: false }>
): string {
  return result.kind === 'deny' ? result.deny.message : result.error.message;
}
