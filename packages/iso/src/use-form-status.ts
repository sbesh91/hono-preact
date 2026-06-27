import type { ActionRef } from './action.js';
import { isPending, subscribe } from './internal/form-submit-store.js';
import { isBrowser } from './is-browser.js';
import { useStoreSnapshot } from './internal/use-store-snapshot.js';

export type FormStatus = { pending: boolean };

// Generic over the stub's payload/result so callers can pass any
// `ActionRef<TPayload, TResult, never>` without contravariant-position
// assignment errors. The hook only reads `__module` and `__action`.
export function useFormStatus<TPayload = unknown, TResult = unknown>(
  stub?: ActionRef<TPayload, TResult, never>
): FormStatus {
  const pending = useStoreSnapshot(subscribe, () =>
    isBrowser() ? isPending(stub) : false
  );
  return { pending };
}
