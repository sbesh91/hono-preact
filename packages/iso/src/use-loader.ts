import { useCallback, useRef, useState } from 'preact/hooks';
import { type RouteHook } from 'preact-iso';
import { type LoaderCache } from './cache.js';
import { isBrowser } from './is-browser.js';
import { type Loader } from './loader.js';
import { getPreloadedData } from './preload.js';
import wrapPromise from './wrap-promise.js';

export type UseLoaderOptions<T> = {
  id: string;
  cache?: LoaderCache<T>;
  location: RouteHook;
};

export type UseLoaderResult<T> = {
  data: T;
  reload: () => void;
  reloading: boolean;
  error: Error | null;
};

export type LoaderSuspender<T> = { read: () => T };

export type UseLoaderStateResult<T> = {
  suspender: LoaderSuspender<T>;
  reload: () => void;
  reloading: boolean;
  error: Error | null;
};

type LazyPromise<T> = { read: () => T };

function makeLazyPromise<T>(
  loader: Loader<T>,
  location: RouteHook,
  cache?: LoaderCache<T>
): LazyPromise<T> {
  let started: { read: () => T } | null = null;
  return {
    read: () => {
      if (!started) {
        started = wrapPromise(
          loader({ location }).then((r) => {
            if (isBrowser()) cache?.set(r);
            return r;
          })
        );
      }
      return started.read();
    },
  };
}

/**
 * Holds reload state and a stable lazy fetch promise. Does NOT throw.
 * Must be called in a component that lives ABOVE the catching `<Suspense>`,
 * because Preact's compat Suspense remounts children of the boundary on
 * each suspend — that would reset useState/useRef.
 */
export function useLoaderState<T>(
  loader: Loader<T>,
  { id, cache, location }: UseLoaderOptions<T>
): UseLoaderStateResult<T> {
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [override, setOverride] = useState<T | undefined>(undefined);

  const prevPath = useRef(location.path);
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    setOverride(undefined);
  }

  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const locationRef = useRef(location);
  locationRef.current = location;

  const reload = useCallback(() => {
    if (reloading) return;
    setReloading(true);
    setError(null);
    loaderRef
      .current({ location: locationRef.current })
      .then((result) => {
        if (isBrowser()) cache?.set(result);
        setOverride(result);
        setReloading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setReloading(false);
      });
  }, [reloading, cache]);

  const promiseRef = useRef<LazyPromise<T> | null>(null);
  const promisePathRef = useRef<string | null>(null);
  if (
    promiseRef.current === null ||
    promisePathRef.current !== location.path
  ) {
    promisePathRef.current = location.path;
    promiseRef.current = makeLazyPromise(loader, location, cache);
  }

  // Capture the current state in closures so the suspender's `read` reflects
  // the latest values from this render. The suspender object is recreated
  // each render, but the underlying promiseRef / cache / preload stores
  // persist.
  const currentOverride = override;
  const suspender: LoaderSuspender<T> = {
    read: () => {
      if (currentOverride !== undefined) return currentOverride;
      const preloaded = getPreloadedData<T>(id);
      if (preloaded !== null) {
        if (isBrowser()) cache?.set(preloaded);
        return preloaded;
      }
      if (isBrowser() && cache?.has()) return cache.get()!;
      return promiseRef.current!.read();
    },
  };

  return { suspender, reload, reloading, error };
}

/**
 * Convenience hook combining {@link useLoaderState} with read.
 * The caller must place the catching `<Suspense>` ABOVE this component.
 * For Page-style nesting (Suspense inside the orchestrator), use
 * {@link useLoaderState} and call `suspender.read()` in a child component.
 */
export function useLoader<T>(
  loader: Loader<T>,
  opts: UseLoaderOptions<T>
): UseLoaderResult<T> {
  const { suspender, reload, reloading, error } = useLoaderState(loader, opts);
  const data = suspender.read();
  return { data, reload, reloading, error };
}
