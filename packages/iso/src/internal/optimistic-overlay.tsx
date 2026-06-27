import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import { LoaderDataContext } from './contexts.js';
import type { LoaderRef } from '../define-loader.js';
import type { LoaderState, StreamState } from '../loader-state.js';

/** The consumption union <Page> puts on `LoaderDataContext`. */
type ConsumptionState = LoaderState<unknown> | StreamState<unknown>;

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
  const ctx = useContext(LoaderDataContext);
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

  // Data-bearing arm (`success` / `revalidating` / `error`): re-provide the SAME
  // discriminated arm with the data replaced (load status unchanged).
  if (isDataBearing(ctx)) {
    return (
      <LoaderDataContext.Provider value={{ ...ctx, data: projected }}>
        {children}
      </LoaderDataContext.Provider>
    );
  }

  // Cold first load (`loading` / `connecting`, no underlying value yet). When
  // there ARE pending actions, surface their projection so descendants reading
  // `loader.useData()` see the optimistic items DURING the first load, restoring
  // parity with the overlay before the loader state machine landed (which always
  // projected). It rides the `revalidating` arm: data is available but
  // PROVISIONAL while the real first load is still in flight, which is the honest
  // status (`success` would falsely claim the load completed). With no pending
  // actions there is nothing to project, so the genuine `loading` / `connecting`
  // arm passes through unchanged. The reduce seeds from the absent base; the
  // reducer is responsible for tolerating an empty base, so the overlay never
  // builds an invalid value itself.
  return (
    <LoaderDataContext.Provider
      value={
        pending.length > 0 ? { status: 'revalidating', data: projected } : ctx
      }
    >
      {children}
    </LoaderDataContext.Provider>
  );
}
