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
  // Subscribe to the form-submit store with a force-update; no preact/compat.
  // Mirrors useSyncExternalStore(subscribe, getSnapshot): the snapshot is read
  // during render and the store notification triggers a re-render. The SSR
  // "always idle" behavior that React 18's getServerSnapshot would provide is
  // achieved via the isBrowser() guard in the snapshot read.
  const [, force] = useReducer((n: number, _action: void) => n + 1, 0);
  useEffect(() => subscribe(() => force()), []);
  const pending = isBrowser() ? isPending(stub) : false;
  return { pending };
}
