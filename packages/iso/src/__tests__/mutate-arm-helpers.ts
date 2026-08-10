import type { MutateResult } from '../action.js';
import type { DenyRecord } from '../internal/deny-record.js';

/**
 * Narrow a `mutate` result to one of its two failure arms, throwing a
 * descriptive failure when it is the other one.
 *
 * `mutate` resolves to a five-arm union, so a test that just checks
 * `!result.ok` no longer says which failure it expected. Going through these
 * makes the arm part of the assertion: a deny that regresses into a generic
 * error (or the reverse) fails loudly instead of type-erroring at the reader.
 */
export function denyArm(result: MutateResult<unknown>): DenyRecord {
  if (result.ok || result.kind !== 'deny') {
    throw new Error(`expected a deny arm, got ${JSON.stringify(result)}`);
  }
  return result.deny;
}

export function errorArm(result: MutateResult<unknown>): Error {
  if (result.ok || result.kind !== 'error') {
    throw new Error(`expected an error arm, got ${JSON.stringify(result)}`);
  }
  return result.error;
}

/**
 * Narrow a `mutate` result to the navigated arm, so tests read the same way
 * as `denyArm` and `errorArm` instead of poking `.kind` directly.
 */
export function isNavigatedArm(
  result: MutateResult<unknown>
): result is { ok: true; kind: 'navigated' } {
  return result.ok && result.kind === 'navigated';
}

/**
 * Narrow a `mutate` result to the aborted arm, so tests read the same way as
 * `denyArm` and `errorArm` instead of poking `.kind` directly.
 */
export function isAbortedArm(
  result: MutateResult<unknown>
): result is { ok: false; kind: 'aborted'; error: Error } {
  return !result.ok && result.kind === 'aborted';
}
