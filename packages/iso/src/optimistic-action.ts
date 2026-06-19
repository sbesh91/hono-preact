import {
  useAction,
  type UseActionOptions,
  type UseActionResult,
  type ActionStub,
} from './action.js';
import { useOptimistic, type OptimisticHandle } from './optimistic.js';
import type { AnyLoaderRef } from './define-loader.js';
import type { Serialize } from './internal/serialize.js';

export const OPTIMISTIC_BRAND: unique symbol = Symbol('hono-preact.optimistic');

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

export type UseOptimisticActionResult<TPayload, TResult, TBase> = ActionStub<
  TPayload,
  TResult,
  never
> &
  UseActionResult<TPayload, TResult> & {
    value: TBase;
    readonly [OPTIMISTIC_BRAND]: OptimisticBinding<TPayload, TBase>;
  };

/**
 * Like `useAction`, but with an optimistic-update wrapper. `TChunk` defaults
 * to `never` so existing non-streaming call sites are unaffected. Pass the
 * stub's chunk type explicitly (or infer it via the stub's third generic)
 * when the action is streaming and you need a typed `onChunk` callback.
 */
export function useOptimisticAction<TPayload, TResult, TBase, TChunk = never>(
  stub: ActionStub<TPayload, TResult, TChunk>,
  options: UseOptimisticActionOptions<TPayload, TResult, TBase, TChunk>
): UseOptimisticActionResult<TPayload, TResult, TBase> {
  const { base, apply, onSuccess, onError, transition, ...actionOpts } =
    options;
  const [value, addOptimistic] = useOptimistic(base, apply, { transition });

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
    value,
    [OPTIMISTIC_BRAND]: { apply, addOptimistic },
  };
}
