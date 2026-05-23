import { useCallback, useReducer, useRef } from 'preact/hooks';

type Status = 'active' | 'ready';
type Entry<TPayload> = { id: number; payload: TPayload; status: Status };

export type OptimisticHandle = {
  settle: () => void;
  revert: () => void;
};

export type UseOptimisticOptions = {
  /**
   * When true, the settle and revert paths are wrapped in
   * `document.startViewTransition`. The initial optimistic update is never
   * wrapped (it must paint same-frame). Falls back to a synchronous update
   * when `document.startViewTransition` is unavailable.
   */
  transition?: boolean;
};

export function useOptimistic<TBase, TPayload>(
  base: TBase,
  reducer: (current: TBase, payload: TPayload) => TBase,
  options?: UseOptimisticOptions
): [TBase, (payload: TPayload) => OptimisticHandle] {
  const queueRef = useRef<Entry<TPayload>[]>([]);
  const lastBaseRef = useRef(base);
  const idRef = useRef(0);
  const [, forceRender] = useReducer<number, void>((c) => c + 1, 0);
  const transitionRef = useRef(options?.transition === true);
  transitionRef.current = options?.transition === true;

  if (!Object.is(lastBaseRef.current, base)) {
    queueRef.current = queueRef.current.filter((e) => e.status !== 'ready');
    lastBaseRef.current = base;
  }

  const value = queueRef.current.reduce(
    (acc, e) => reducer(acc, e.payload),
    base
  );

  // Reads `transitionRef.current` at invocation time, not capture time, so it
  // is safe to close over from the memoized `addOptimistic` (useCallback([]))
  // below. Each render rebinds this function and writes the latest option
  // value into the ref; settle/revert created by the stale memoized callback
  // still see the up-to-date `transition` setting through the ref.
  const runWithTransition = (mutator: () => void) => {
    if (
      transitionRef.current &&
      typeof document !== 'undefined' &&
      typeof document.startViewTransition === 'function'
    ) {
      document.startViewTransition(() => {
        mutator();
      });
    } else {
      mutator();
    }
  };

  const addOptimistic = useCallback((payload: TPayload): OptimisticHandle => {
    const id = ++idRef.current;
    queueRef.current = [...queueRef.current, { id, payload, status: 'active' }];
    forceRender();
    return {
      settle: () => {
        const entry = queueRef.current.find((e) => e.id === id);
        if (entry && entry.status === 'active') {
          runWithTransition(() => {
            entry.status = 'ready';
            forceRender();
          });
        }
      },
      revert: () => {
        runWithTransition(() => {
          queueRef.current = queueRef.current.filter((e) => e.id !== id);
          forceRender();
        });
      },
    };
  }, []);

  return [value, addOptimistic];
}
