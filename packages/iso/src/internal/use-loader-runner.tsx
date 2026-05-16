import type { RouteHook } from 'preact-iso';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import { isBrowser } from '../is-browser.js';
import { getPreloadedData } from './preload.js';
import wrapPromise from './wrap-promise.js';
import { subscribeToLoaderStream } from './stream-registry.js';
import { runLoader } from './loader-runner.js';
import { serializeLocationForCache } from './cache-key.js';

export type LoaderRunnerState<T> = {
  reader: { read: () => T };
  overrideData: T | undefined;
  error: Error | null;
  reload: () => void;
  reloading: boolean;
};

export function useLoaderRunner<T>(
  loaderRef: LoaderRef<T>,
  location: RouteHook,
  id: string
): LoaderRunnerState<T> {
  const [reloading, setReloading] = useState(false);
  const [overrideData, setOverrideData] = useState<T | undefined>(undefined);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const locationRef = useRef(location);
  locationRef.current = location;

  const abortRef = useRef<AbortController | null>(null);

  function newAbortSignal(): AbortSignal {
    // Abort the previous controller (cancels any in-flight loader),
    // then allocate a fresh one whose signal is passed to the new fn call.
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    return abortRef.current.signal;
  }

  useEffect(
    () => () => {
      if (abortRef.current) abortRef.current.abort();
    },
    []
  );

  // True while either the initial Suspense fetch or an explicit reload is in
  // flight. Tracked via a ref so reload() can read it without recapturing on
  // every state change, and so the wrapPromise branch below can flip it
  // during render without scheduling an extra setState.
  const inFlightRef = useRef(false);
  const queuedReloadRef = useRef(false);
  const runReloadRef = useRef<() => void>(() => {});

  const runReload = useCallback(() => {
    inFlightRef.current = true;
    setReloading(true);
    setLoadError(null);

    const promise: Promise<T> = runLoader<T>(
      loaderRef,
      locationRef.current,
      id,
      newAbortSignal(),
      {
        onChunk: (value) => {
          setOverrideData(value);
          if (isBrowser()) {
            loaderRef.cache.set(
              value,
              serializeLocationForCache(locationRef.current, loaderRef.params),
            );
          }
        },
        onError: (err) => setLoadError(err),
        onEnd: () => { /* nothing to do */ },
      }
    );

    promise
      .then((result) => {
        if (isBrowser()) loaderRef.cache.set(result, serializeLocationForCache(locationRef.current, loaderRef.params));
        setOverrideData(result);
        setReloading(false);
        inFlightRef.current = false;
        if (queuedReloadRef.current) {
          queuedReloadRef.current = false;
          runReloadRef.current();
        }
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err : new Error(String(err)));
        setReloading(false);
        inFlightRef.current = false;
        queuedReloadRef.current = false;
      });
  }, [loaderRef]);
  runReloadRef.current = runReload;

  const reload = useCallback(() => {
    if (inFlightRef.current) {
      queuedReloadRef.current = true;
      return;
    }
    runReloadRef.current();
  }, []);

  // Stable reader: only rebuilt when location or loader identity changes.
  // Without this, every re-render (e.g. from setReloading) would call
  // wrapPromise(...) again, fire a duplicate XHR, and throw a fresh promise
  // into Suspense — unmounting the children and wiping any optimistic UI
  // state below.
  //
  // The location key includes path AND searchParams so /movies?genre=action →
  // /movies?genre=drama refetches even though preact-iso doesn't remount on
  // querystring changes.
  const readerRef = useRef<{ read: () => T } | null>(null);
  const locKey = serializeLocationForCache(location, loaderRef.params);
  const prevLocKey = useRef(locKey);
  const prevLoaderId = useRef(loaderRef.__id);

  const locationChanged = prevLocKey.current !== locKey;
  const loaderChanged = prevLoaderId.current !== loaderRef.__id;

  if (readerRef.current === null || locationChanged || loaderChanged) {
    prevLocKey.current = locKey;
    prevLoaderId.current = loaderRef.__id;
    if (locationChanged || loaderChanged) setOverrideData(undefined);

    const preloaded = getPreloadedData<T>(id);
    const isFirstRender = readerRef.current === null;
    if (preloaded !== null) {
      loaderRef.cache.set(preloaded, locKey);
      readerRef.current = { read: () => preloaded };
      if (isBrowser()) {
        const unsub = subscribeToLoaderStream(id, {
          push: (value) => {
            setOverrideData(value as T);
            loaderRef.cache.set(value as T, locKey);
          },
          end: () => { /* nothing to do */ },
          error: (err) => setLoadError(err),
        });
        // Unsubscribe on unmount: attach to the abortRef signal.
        if (abortRef.current) {
          abortRef.current.signal.addEventListener('abort', unsub);
        } else {
          abortRef.current = new AbortController();
          abortRef.current.signal.addEventListener('abort', unsub);
        }
      }
    } else if (isBrowser() && isFirstRender && loaderRef.cache.has(locKey)) {
      const cached = loaderRef.cache.get(locKey)!;
      readerRef.current = { read: () => cached };
    } else {
      inFlightRef.current = true;
      const settle = () => {
        inFlightRef.current = false;
        if (queuedReloadRef.current) {
          queuedReloadRef.current = false;
          runReloadRef.current();
        }
      };

      const fetchPromise: Promise<T> = runLoader<T>(
        loaderRef,
        location,
        id,
        newAbortSignal(),
        {
          onChunk: (value) => {
            setOverrideData(value);
            if (isBrowser()) loaderRef.cache.set(value, locKey);
          },
          onError: (err) => setLoadError(err),
          onEnd: () => { /* nothing to do */ },
        }
      );

      readerRef.current = wrapPromise(
        fetchPromise
          .then((r) => {
            if (isBrowser()) loaderRef.cache.set(r, locKey);
            settle();
            return r;
          })
          .catch((err: unknown) => {
            settle();
            throw err;
          })
      );
    }
  }

  return {
    reader: readerRef.current,
    overrideData,
    error: loadError,
    reload,
    reloading,
  };
}
