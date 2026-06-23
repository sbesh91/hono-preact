import { useEffect, useReducer } from 'preact/hooks';
import type { ActionStub } from './action.js';
import { isPending, subscribe } from './internal/form-submit-store.js';
import { isBrowser } from './is-browser.js';

export type FormStatus = { pending: boolean };

// Generic over the stub's payload/result so callers can pass any
// `ActionStub<TPayload, TResult, never>` without contravariant-position
// assignment errors. The hook only reads `__module` and `__action`.
export function useFormStatus<TPayload = unknown, TResult = unknown>(
  stub?: ActionStub<TPayload, TResult, never>
): FormStatus {
  // Compat-free subscription (no preact/compat useSyncExternalStore): useReducer
  // force-update + useEffect(subscribe). useSyncExternalStore additionally re-reads
  // the snapshot at subscribe time to close the render-to-effect tear window; this
  // store is a synchronous in-memory store written only by post-mount submit
  // events, so that window is empty in practice. See the 2026-06-23 drop-compat spec.
  const [, force] = useReducer((n: number, _action: void) => n + 1, 0);
  useEffect(() => subscribe(() => force()), []);
  const pending = isBrowser() ? isPending(stub) : false;
  return { pending };
}
