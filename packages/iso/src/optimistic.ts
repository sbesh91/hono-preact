import { useCallback, useRef } from 'preact/hooks';
import type { ReadonlySignal } from '@preact/signals';
import { useStoreState, useStoreValue } from './internal/store-signal.js';

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
): [ReadonlySignal<TBase>, (payload: TPayload) => OptimisticHandle] {
  const queue = useStoreState<Entry<TPayload>[]>([]);
  const lastBaseRef = useRef(base);
  const idRef = useRef(0);
  const transitionRef = useRef(options?.transition === true);
  transitionRef.current = options?.transition === true;

  if (!Object.is(lastBaseRef.current, base)) {
    // Guard the write: only touch the signal when the filter actually drops
    // a `ready` entry. A signal write always notifies (unlike the old plain
    // ref, which silently tolerated a no-op reassignment), so an unconditional
    // write here would re-notify on every render whose `base` prop happens to
    // be a fresh reference each time (e.g. an inline literal) even with an
    // empty queue, which is a synchronous render loop: write -> subscribed
    // component re-renders -> `base` is a new reference again -> write ...
    const current = queue.value.value;
    const filtered = current.filter((e) => e.status !== 'ready');
    if (filtered.length !== current.length) {
      queue.set(filtered);
    }
    lastBaseRef.current = base;
  }

  const value = useStoreValue(() =>
    queue.value.value.reduce((acc, e) => reducer(acc, e.payload), base)
  );

  // Reads `transitionRef.current` at invocation time, not capture time, so it
  // is safe to close over from the memoized `addOptimistic` (useCallback([]))
  // below. Each render rebinds this function and writes the latest option
  // value into the ref; settle/revert created by the stale memoized callback
  // still see the up-to-date `transition` setting through the ref.
  //
  // The callback returns a promise that resolves on the next animation frame
  // so the browser snapshots Preact's POST-render DOM as "new state". Without
  // the rAF wait, the queue signal write has not yet flushed through Preact's
  // scheduled re-render of any subscribed component when `startViewTransition`
  // snapshots, and the transition captures identical before/after frames with
  // no visible animation.
  const runWithTransition = (mutator: () => void) => {
    if (
      transitionRef.current &&
      typeof document !== 'undefined' &&
      typeof document.startViewTransition === 'function'
    ) {
      const t = document.startViewTransition(async () => {
        mutator();
        await new Promise<void>((resolve) => {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
          } else {
            // Non-DOM environment (shouldn't reach this branch given the
            // outer check, but defensive). Resolve on next microtask so
            // Preact's scheduled render runs.
            queueMicrotask(resolve);
          }
        });
      });
      // An aborted or skipped transition is a cosmetic downgrade, not an
      // error: the mutator already ran inside the update callback. Swallow
      // the rejections so they do not surface as unhandled.
      t.finished.catch(() => {});
      t.ready.catch(() => {});
      t.updateCallbackDone.catch(() => {});
    } else {
      mutator();
    }
  };

  const addOptimistic = useCallback((payload: TPayload): OptimisticHandle => {
    const id = ++idRef.current;
    queue.set([...queue.value.value, { id, payload, status: 'active' }]);
    return {
      settle: () => {
        const current = queue.value.value;
        const entry = current.find((e) => e.id === id);
        if (entry && entry.status === 'active') {
          runWithTransition(() => {
            queue.set(
              current.map((e) => (e.id === id ? { ...e, status: 'ready' } : e))
            );
          });
        }
      },
      revert: () => {
        runWithTransition(() => {
          queue.set(queue.value.value.filter((e) => e.id !== id));
        });
      },
    };
  }, []);

  return [value, addOptimistic];
}
