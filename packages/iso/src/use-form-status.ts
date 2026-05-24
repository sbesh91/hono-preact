import { useSyncExternalStore } from 'preact/compat';
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
  // preact/compat (10.29) ships only the 2-arg signature of useSyncExternalStore.
  // The SSR "always idle" behavior that React 18's getServerSnapshot would
  // provide is achieved via the isBrowser() guard inside getSnapshot.
  const pending = useSyncExternalStore(subscribe, () =>
    isBrowser() ? isPending(stub) : false
  );
  return { pending };
}
