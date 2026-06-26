import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import { LoaderDataContext } from './contexts.js';
import type { LoaderRef } from '../define-loader.js';

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

  // An optimistic projection rewrites the loader DATA, not the load status, so
  // re-provide the SAME discriminated arm with the data replaced. Read the value
  // off whichever data-carrying arm is present; while loading/connecting there
  // is no value to project over, so pass the state through unchanged. `ctx.data`
  // is the erased context value (`unknown`); reading it as the overlay's bound
  // `T` is the pre-existing structural-read boundary (the `loader` prop binds
  // `T`).
  const base = ('data' in ctx ? ctx.data : undefined) as T;
  const projected = pending.reduce<T>(
    (acc, action) => reducer(acc, action),
    base
  );

  return (
    <LoaderDataContext.Provider
      value={'data' in ctx ? { ...ctx, data: projected } : ctx}
    >
      {children}
    </LoaderDataContext.Provider>
  );
}
