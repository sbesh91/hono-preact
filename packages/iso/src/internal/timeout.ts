// Shared timeout helpers. `validateTimeoutMs` was previously copy-pasted
// byte-for-byte in `define-loader.ts` and `action.ts`; `timeoutMessage` is the
// single source for the timed-out wording so `TimeoutError` and the
// decoded-outcome handlers cannot drift.

/**
 * Validate a `timeoutMs` option as authored on `defineLoader`/`defineAction`.
 * `undefined` means "use the handler's configured default"; `false` means "no
 * timeout, only the request signal aborts". Any other value must be a
 * non-negative finite number.
 */
export function validateTimeoutMs(
  value: number | false | undefined,
  context: string
): void {
  if (value === undefined || value === false) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${context}: timeoutMs must be a non-negative finite number or false, got ${String(value)}`
    );
  }
}

/** The canonical message for a timed-out unit. */
export function timeoutMessage(timeoutMs: number): string {
  return `Request timed out after ${timeoutMs}ms`;
}
