import { useSyncExternalStore } from 'preact/compat';
import type { ActionStub } from './action.js';
import { isPending, subscribe } from './internal/form-submit-store.js';
import { isBrowser } from './is-browser.js';

export type FormStatus = { pending: boolean };

export function useFormStatus(
  stub?: ActionStub<unknown, unknown, never>
): FormStatus {
  const pending = useSyncExternalStore(
    subscribe,
    () => (isBrowser() ? isPending(stub) : false)
  );
  return { pending };
}
