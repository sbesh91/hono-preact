import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import { LoaderDataContext, type LoaderData } from './contexts.js';
import { LoaderDataProvider } from './loader-data-provider.js';
import type { LoaderRef } from '../define-loader.js';

/**
 * The consumption union <Page> puts on `LoaderDataContext`, minus the cold-error
 * `null` (which `loader.tsx` routes to the `errorFallback` instead of rendering
 * the children this overlay lives among).
 */
type ConsumptionState = NonNullable<LoaderData>;

/** The data-bearing arms: everything but the cold `loading` / `connecting`. */
type DataBearing = Exclude<
  ConsumptionState,
  { status: 'loading' } | { status: 'connecting' }
>;

/**
 * Structural value-presence test on the variant TAG, not a `data`-presence test:
 * every arm now declares `data` (the cold arms as `data?: never`), so `'data' in
 * ctx` would no longer exclude them. The cold `loading` / `connecting` arms carry
 * no value; every other arm is data-bearing.
 *
 * This treats the `error` arm as data-bearing. For a `LoaderState` that always
 * holds (a render-time `error` carries the last-good `data`; a cold error routes
 * to the boundary instead). It would NOT hold for a `StreamState` cold error,
 * which carries no `data` key, but `OptimisticOverlay` binds only a non-live
 * `LoaderRef<T>` (see `loader` below), so its context is always a `LoaderState`
 * and that arm never reaches here. The status test and the prior `'data' in ctx`
 * test therefore agree on every shape this overlay can actually receive.
 */
function isDataBearing(s: ConsumptionState): s is DataBearing {
  return s.status !== 'loading' && s.status !== 'connecting';
}

type OverlayProps<T, A> = {
  // `loader` binds the overlay's data type `T`. It is not read at runtime;
  // the overlay reads from the nearest LoaderDataContext provided by <Page>.
  // Pass the same loader ref the page was configured with so `T` matches.
  loader: LoaderRef<T>;
  reducer: (base: T, action: A) => T;
  pending?: A[];
  children: ComponentChildren;
};

export function OptimisticOverlay<T, A>({
  reducer,
  pending = [],
  children,
}: OverlayProps<T, A>) {
  // Reading `.value` subscribes the overlay to the loader's state, so a settled
  // load re-projects here even when nothing re-renders the overlay from above.
  const ctx = useContext(LoaderDataContext)?.value ?? null;
  if (!ctx)
    throw new Error(
      '<OptimisticOverlay> must be inside a route page that has a loader'
    );

  // An optimistic projection rewrites the loader DATA, not the load status. Read
  // the current value off whichever data-carrying arm is present, or treat it as
  // absent during a cold `loading` / `connecting` first load. `ctx.data` is the
  // erased context value (`unknown`); reading it as the overlay's bound `T` is
  // the pre-existing structural-read boundary (the `loader` prop binds `T`).
  const base = (isDataBearing(ctx) ? ctx.data : undefined) as T;
  const projected = pending.reduce<T>(
    (acc, action) => reducer(acc, action),
    base
  );

  // The arm this overlay re-provides:
  //
  //  - Data-bearing (`success` / `revalidating` / `error`): the SAME
  //    discriminated arm with the data replaced (load status unchanged).
  //  - Cold first load (`loading` / `connecting`, no underlying value yet) WITH
  //    pending actions: surface their projection so descendants reading
  //    `loader.useData()` see the optimistic items DURING the first load,
  //    restoring parity with the overlay before the loader state machine landed
  //    (which always projected). It rides the `revalidating` arm: data is
  //    available but PROVISIONAL while the real first load is still in flight,
  //    which is the honest status (`success` would falsely claim the load
  //    completed). The reduce seeds from the absent base; the reducer is
  //    responsible for tolerating an empty base, so the overlay never builds an
  //    invalid value itself.
  //  - Cold first load with nothing pending: nothing to project, so the genuine
  //    `loading` / `connecting` arm passes through unchanged.
  //
  // When the projection did not change the data (nothing pending, so `reduce`
  // returned the base untouched) the HOST's own arm is re-provided by
  // reference. Spreading a fresh `{...ctx, data: projected}` there publishes a
  // new object with identical contents, and `LoaderDataProvider`'s signal
  // compares by identity, so every `loader.useData()` consumer below would be
  // woken for nothing -- disabling the granularity this data layer exists for,
  // across the whole optimistic subtree.
  //
  // No retained-last-arm dance here: `LoaderDataProvider` compares before it
  // publishes (#361), so handing it an equivalent-but-fresh arm is already
  // inert. This used to keep its own copy of that comparison, which is exactly
  // the duplication the boundary was introduced to remove.
  const arm: ConsumptionState = isDataBearing(ctx)
    ? projected === ctx.data
      ? ctx
      : { ...ctx, data: projected }
    : pending.length > 0
      ? { status: 'revalidating', data: projected }
      : ctx;

  // Re-provide the ONE loader channel with the projected arm, so every reader
  // below (a `.View` render function, a descendant's `loader.useData()`) sees
  // the projection rather than the host's raw loader state. `LoaderDataProvider`
  // owns the stable-identity contract that a consumer's memoized projection
  // depends on.
  return <LoaderDataProvider state={arm}>{children}</LoaderDataProvider>;
}
