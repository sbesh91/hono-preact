import {
  useAction,
  type UseActionOptions,
  type UseActionResult,
  type ActionStub,
} from './action.js';
import { useOptimistic, type OptimisticHandle } from './optimistic.js';

export type UseOptimisticActionOptions<TPayload, TResult, TBase> = Omit<
  UseActionOptions<TPayload, TResult>,
  'invalidate' | 'onMutate' | 'onError' | 'onSuccess'
> & {
  base: TBase;
  apply: (current: TBase, payload: TPayload) => TBase;
  invalidate?: 'auto' | string[];
  onSuccess?: (data: TResult) => void;
  onError?: (err: Error) => void;
};

export type UseOptimisticActionResult<TPayload, TResult, TBase> =
  UseActionResult<TPayload, TResult> & { value: TBase };

export function useOptimisticAction<TPayload, TResult, TBase>(
  stub: ActionStub<TPayload, TResult>,
  options: UseOptimisticActionOptions<TPayload, TResult, TBase>
): UseOptimisticActionResult<TPayload, TResult, TBase> {
  const { base, apply, onSuccess, onError, ...actionOpts } = options;
  const [value, addOptimistic] = useOptimistic(base, apply);

  const action = useAction<TPayload, TResult, OptimisticHandle>(stub, {
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
