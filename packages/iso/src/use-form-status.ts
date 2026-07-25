import { useComputed, useSignal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { ActionRef } from './action.js';
import { pendingSignal, pickIsPending } from './internal/form-submit-store.js';
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
  // Mirror the stub's IDENTITY (two primitive strings, so a fresh object
  // literal per render is a no-op write) into tracked signals. The computed
  // below is created once (`useComputed` is `useMemo(..., [])`) and only
  // re-evaluates when a TRACKED signal changes, so a plain closure capture of
  // `stub` would pin this reader to the action passed on the mount render: a
  // `<Form action={mode === 'create' ? createTodo : updateTodo}>` that flips
  // `mode` would keep reporting the previous action's pending state. Same
  // pattern, and the same reason, as `useOptimistic`'s `base`.
  const stubModule = useSignal<string | undefined>(stub?.__module);
  const stubAction = useSignal<string | undefined>(stub?.__action);
  stubModule.value = stub?.__module;
  stubAction.value = stub?.__action;

  return useComputed(() => {
    const module = stubModule.value;
    const action = stubAction.value;
    const ref =
      module !== undefined && action !== undefined
        ? { __module: module, __action: action }
        : undefined;
    return isBrowser() && pickIsPending(pendingSignal.value, ref)
      ? PENDING
      : IDLE;
  });
}
