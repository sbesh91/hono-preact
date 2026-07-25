import { useComputed } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { ActionRef } from './action.js';
import { pendingSignal, pickIsPending } from './internal/form-submit-store.js';
import { isBrowser } from './is-browser.js';

export type FormStatus = { pending: boolean };

// Generic over the stub's payload/result so callers can pass any
// `ActionRef<TPayload, TResult, never>` without contravariant-position
// assignment errors. The hook only reads `__module` and `__action`.
//
// Reactive read: `useComputed` tracks `pendingSignal`, so a binding that
// reads `.value.pending` updates on a begin/end submit without the host
// component re-rendering.
export function useFormStatus<TPayload = unknown, TResult = unknown>(
  stub?: ActionRef<TPayload, TResult, never>
): ReadonlySignal<FormStatus> {
  return useComputed(() => ({
    pending: isBrowser() ? pickIsPending(pendingSignal.value, stub) : false,
  }));
}
