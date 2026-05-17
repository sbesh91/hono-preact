import {
  useAction,
  type UseActionOptions,
  type UseActionResult,
  type ActionStub,
} from './action.js';
import { useOptimistic, type OptimisticHandle } from './optimistic.js';
import type { LoaderRef } from './define-loader.js';

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
  invalidate?: 'auto' | ReadonlyArray<LoaderRef<unknown>>;
  onSuccess?: (data: TResult) => void;
  onError?: (err: Error) => void;
};

export type UseOptimisticActionResult<TPayload, TResult, TBase> =
  UseActionResult<TPayload, TResult> & { value: TBase };

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
  const { base, apply, onSuccess, onError, ...actionOpts } = options;
  const [value, addOptimistic] = useOptimistic(base, apply);

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

  return { ...action, value };
}
