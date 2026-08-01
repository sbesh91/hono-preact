import {
  useAction,
  type UseActionOptions,
  type UseActionResult,
  type ActionRef,
} from './action.js';
import type { ReadonlySignal } from '@preact/signals';
import { useOptimistic, type OptimisticHandle } from './optimistic.js';
import type { AnyLoaderRef } from './define-loader.js';
import type { Serialize } from './internal/serialize.js';
import { OPTIMISTIC_BRAND } from './internal/optimistic-brand.js';

// Re-exported for API stability: the brand's single definition lives in the
// dependency-free leaf (so Form can import it without the optimistic runtime),
// but consumers may still import it from here.
export { OPTIMISTIC_BRAND };

export type OptimisticBinding<TPayload, TBase> = {
  apply: (current: TBase, payload: TPayload) => TBase;
  addOptimistic: (payload: TPayload) => OptimisticHandle;
};

export type UseOptimisticActionOptions<
  TPayload,
  TResult,
  TBase,
  TChunk = never,
> = Omit<
  UseActionOptions<TPayload, TResult, TChunk>,
  'invalidate' | 'onMutate' | 'onError' | 'onSuccess'
> & {
  base: TBase;
  apply: (current: TBase, payload: TPayload) => TBase;
  invalidate?: 'auto' | ReadonlyArray<AnyLoaderRef>;
  // The action result reaches the client JSON round-tripped (`Serialize`).
  onSuccess?: (data: Serialize<TResult>) => void;
  onError?: (err: Error) => void;
  /** Forwarded to the internal `useOptimistic` call. */
  transition?: boolean;
};

export type UseOptimisticActionResult<TPayload, TResult, TBase> = ActionRef<
  TPayload,
  TResult,
  never
> &
  UseActionResult<TPayload, TResult> & {
    /**
     * The current projection: `base` with every in-flight payload applied.
     *
     * A lazy getter over {@link UseOptimisticActionResult.valueSignal}, so the
     * subscription follows the READ. A component that reads this during render
     * is tracked and re-renders on every queue change, which is what every
     * existing call site relies on. A component that never reads it (one that
     * only calls `mutate`, or hands `valueSignal` to a leaf) is not subscribed
     * at all.
     */
    readonly value: TBase;
    /**
     * The same projection as a signal. Hand this to a leaf and only the leaf
     * re-renders on a dispatch; the component that owns the action does not.
     */
    readonly valueSignal: ReadonlySignal<TBase>;
    readonly [OPTIMISTIC_BRAND]: OptimisticBinding<TPayload, TBase>;
  };

/**
 * Like `useAction`, but with an optimistic-update wrapper. `TChunk` defaults
 * to `never` so existing non-streaming call sites are unaffected. Pass the
 * stub's chunk type explicitly (or infer it via the stub's third generic)
 * when the action is streaming and you need a typed `onChunk` callback.
 */
export function useOptimisticAction<TPayload, TResult, TBase, TChunk = never>(
  stub: ActionRef<TPayload, TResult, TChunk>,
  options: UseOptimisticActionOptions<TPayload, TResult, TBase, TChunk>
): UseOptimisticActionResult<TPayload, TResult, TBase> {
  const { base, apply, onSuccess, onError, transition, ...actionOpts } =
    options;
  // `useOptimistic` returns a `ReadonlySignal<TBase>` (Phase 3), and it is
  // deliberately NOT read here. An eager `valueSignal.value` in this hook body
  // subscribes the host unconditionally -- including a host that only calls
  // `mutate` and never renders the projection -- because Preact's signals
  // integration auto-tracks any `.value` read during a function component's
  // render. That spends the whole granularity the signal exists to provide.
  // The lazy getter on `value` below moves the subscription to the READ, so a
  // host that renders the projection behaves exactly as before and one that
  // hands `valueSignal` to a leaf keeps its own renders.
  const [valueSignal, addOptimistic] = useOptimistic(base, apply, {
    transition,
  });

  const action = useAction<TPayload, TResult, TChunk, OptimisticHandle>(stub, {
    ...actionOpts,
    onMutate: (payload) => addOptimistic(payload),
    onSuccess: (data, handle) => {
      handle.settle();
      onSuccess?.(data);
    },
    onError: (err, handle) => {
      handle.revert();
      onError?.(err);
    },
  });

  return {
    __module: stub.__module,
    __action: stub.__action,
    useAction: stub.useAction,
    ...action,
    // Written as a getter in THIS literal, and never spread in from another
    // object. A spread EVALUATES accessors, so `{ ...somethingHoldingValue }`
    // would turn `value` back into a one-shot snapshot and silently un-track
    // every reader of it. That, not the ordering, is the invariant to keep:
    // `...action` above cannot collide with `value` at all, since
    // `UseActionResult` is `mutate` / `pending` / `error` / `data`.
    get value() {
      return valueSignal.value;
    },
    valueSignal,
    [OPTIMISTIC_BRAND]: { apply, addOptimistic },
  };
}
