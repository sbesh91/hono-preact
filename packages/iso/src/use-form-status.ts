import { useComputed } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { ActionRef } from './action.js';
import { pendingSignal, pickIsPending } from './internal/form-submit-store.js';
import { useStubKey } from './internal/use-stub-key.js';
import { isBrowser } from './is-browser.js';

export type FormStatus = { pending: boolean };

// The two inhabitants of `FormStatus`, shared rather than rebuilt per
// projection. A `computed` propagates to its subscribers only when the
// projected value changes by `===`. A fresh `{ pending }` object literal per
// recompute never compares equal, so EVERY reader would re-render on EVERY
// begin/end submit anywhere in the app -- including readers bound to an
// unrelated action whose own pending-ness did not change. Two frozen
// singletons restore the dedupe inside a SINGLE computed.
const IDLE: FormStatus = Object.freeze({ pending: false });
const PENDING: FormStatus = Object.freeze({ pending: true });

// Generic over the stub's payload/result so callers can pass any
// `ActionRef<TPayload, TResult, never>` without contravariant-position
// assignment errors. The hook only reads `__module` and `__action`.
//
// Reactive read: the `useComputed` below tracks `pendingSignal`, so a binding
// that reads `.value.pending` updates on a begin/end submit without the host
// component re-rendering -- and only when THIS stub's own pending state flips.
export function useFormStatus<TPayload = unknown, TResult = unknown>(
  stub?: ActionRef<TPayload, TResult, never>
): ReadonlySignal<FormStatus> {
  const stubKey = useStubKey(stub);

  return useComputed(() => {
    const { ref, unmatchable } = stubKey.value;
    // No identity to match, so no submission can be attributed to this stub.
    // Falling through would report `pending` whenever ANY form on the page is
    // submitting.
    if (unmatchable) return IDLE;
    return isBrowser() && pickIsPending(pendingSignal.value, ref)
      ? PENDING
      : IDLE;
  });
}
