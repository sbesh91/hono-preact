import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import { LoaderDataContext } from './contexts.js';
import type { LoaderRef } from './define-loader.js';

type OverlayProps<T, A> = {
  loader: LoaderRef<T>;
  reducer: (base: T, action: A) => T;
  pending?: A[];
  children: ComponentChildren;
};

export function OptimisticOverlay<T, A>({
  loader,
  reducer,
  pending = [],
  children,
}: OverlayProps<T, A>) {
  const ctx = useContext(LoaderDataContext);
  if (!ctx || ctx.refId !== loader.__id)
    throw new Error(
      '<OptimisticOverlay loader={x}> must be inside a <Loader loader={x}>'
    );

  const base = ctx.data as T;
  const projected = pending.reduce<T>(
    (acc, action) => reducer(acc, action),
    base
  );

  return (
    <LoaderDataContext.Provider value={{ refId: loader.__id, data: projected }}>
      {children}
    </LoaderDataContext.Provider>
  );
}
