import { useCallback, useRef } from 'preact/hooks';
import { useComputed, useSignal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { shallowEqual } from './internal/shallow-equal.js';

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

/**
 * Optimistic UI: fold a queue of pending payloads over `base` and expose the
 * result as a `ReadonlySignal<TBase>`, plus a `dispatch` that enqueues one
 * optimistic update (returning a handle to `settle` or `revert` it).
 *
 * `base` is compared by CONTENTS, not by reference (`shallowEqual`), so the
 * expressions an author reaches for first are safe to pass inline: a fresh
 * `data?.movies ?? []`, an inline `.filter(...)`, a spread. Rebuilding the
 * container every render is inert; only a real change to the entries publishes.
 * A nested change (`[{...}]` whose inner object was rebuilt) reads as a change,
 * since the comparison is one level deep.
 */
export function useOptimistic<TBase, TPayload>(
  base: TBase,
  reducer: (current: TBase, payload: TPayload) => TBase,
  options?: UseOptimisticOptions
): [ReadonlySignal<TBase>, (payload: TPayload) => OptimisticHandle] {
  const queue = useSignal<Entry<TPayload>[]>([]);
  // Holds `base` as a tracked signal, not just the plain closure capture
  // below, so the value computed (which reads `baseState.value`) re-derives
  // when `base` changes even while the queue is idle. Written only from the
  // changed branch below, never unconditionally: a signal write always
  // notifies, and @preact/signals dedupes on REFERENCE, which is the one thing
  // an inline `?? []` does not hold still.
  const baseState = useSignal<TBase>(base);
  const lastBaseRef = useRef(base);
  const idRef = useRef(0);
  const transitionRef = useRef(options?.transition === true);
  transitionRef.current = options?.transition === true;

  // Contents, not identity. Reference equality here republished an unchanged
  // `base` on every render that rebuilt it inline, waking every consumer bound
  // to the projection, and it dropped settled `ready` entries at the same time,
  // both for a `base` that had not actually moved.
  if (!shallowEqual(lastBaseRef.current, base)) {
    baseState.value = base;
    // Only touch the queue when the filter actually drops a `ready` entry: a
    // signal write always notifies, unlike the plain ref this replaced, which
    // silently tolerated a no-op reassignment.
    //
    // `peek`, not `.value`: this runs during render, so a tracked read would
    // subscribe the CALLING component to the queue and re-render it on the next
    // dispatch. That is precisely the granularity a caller gives up when it
    // holds the returned signal and passes it to a leaf instead of reading it.
    // Every other non-tracking read in the data layer already uses `peek`
    // (`action-result-store`, `form-submit-store`, all of `loader-signal`).
    const current = queue.peek();
    const filtered = current.filter((e) => e.status !== 'ready');
    if (filtered.length !== current.length) {
      queue.value = filtered;
    }
    lastBaseRef.current = base;
  }

  // Holds `reducer` as a tracked signal for the same reason `base` is held
  // above: the value computed is created once (`useComputed` is
  // `useMemo(..., [])`), so a plain closure capture would pin the fold to the
  // reducer passed on the mount render, and a call site whose reducer closes
  // over changing props (`(acc, p) => acc + p * mult`) would keep folding with
  // the stale one. A fresh arrow per render is a new reference, so this writes
  // during render; the value computed is read later in the SAME render pass,
  // which reconciles the version before the batch ends, so no re-render is
  // scheduled and there is no loop.
  const reducerState = useSignal(reducer);
  reducerState.value = reducer;

  const value = useComputed(() =>
    queue.value.reduce(
      (acc, e) => reducerState.value(acc, e.payload),
      baseState.value
    )
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
    queue.value = [...queue.value, { id, payload, status: 'active' }];
    return {
      settle: () => {
        const entry = queue.value.find((e) => e.id === id);
        if (entry && entry.status === 'active') {
          runWithTransition(() => {
            // Read FRESH inside the mutator (as `revert` does). With
            // `transition: true` the mutator runs >=1 frame later, so a queue
            // snapshot taken here at call time would clobber anything enqueued
            // in between -- and two settles racing in the same frame would each
            // write the other's entry back to `active`, stranding it forever
            // (the base-change eviction above only drops `ready` entries).
            queue.value = queue.value.map((e) =>
              e.id === id ? { ...e, status: 'ready' } : e
            );
          });
        }
      },
      revert: () => {
        runWithTransition(() => {
          queue.value = queue.value.filter((e) => e.id !== id);
        });
      },
    };
  }, []);

  return [value, addOptimistic];
}
