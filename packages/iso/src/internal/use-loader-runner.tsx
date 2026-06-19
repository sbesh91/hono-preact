import type { RouteHook } from 'preact-iso';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import { isBrowser } from '../is-browser.js';
import { getPreloadedData, deletePreloadedData } from './preload.js';
import wrapPromise from './wrap-promise.js';
import { subscribeToLoaderStream } from './stream-registry.js';
import { runLoader } from './loader-runner.js';
import { serializeLocationForCache } from './cache-key.js';

export type StreamStatus = 'connecting' | 'open' | 'closed' | 'error';

/** Streaming consumption: fold every chunk into accumulated state. */
export type AccumulateOptions = {
  initial: unknown;
  reduce: (acc: unknown, chunk: unknown) => unknown;
};

export type LoaderRunnerState<T> = {
  reader: { read: () => T };
  overrideData: T | undefined;
  error: Error | null;
  reload: () => void;
  reloading: boolean;
  status: StreamStatus;
};

export function useLoaderRunner<T>(
  loaderRef: LoaderRef<T>,
  location: RouteHook,
  id: string,
  accumulate?: AccumulateOptions
): LoaderRunnerState<T> {
  const [reloading, setReloading] = useState(false);
  const [overrideData, setOverrideData] = useState<T | undefined>(undefined);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // Accumulated value for the streaming path; reset on each (re)subscribe.
  const accRef = useRef<unknown>(accumulate ? accumulate.initial : undefined);

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

  // Cleanup of the SSR preload attribute is deferred to after commit so
  // we never mutate the DOM during the render pass (Preact reconciliation
  // doesn't formally support that, and re-renders could observe a phantom
  // half-cleared element). The render path sets `preloadConsumedRef` when
  // it reads the payload; this effect clears the attribute exactly once,
  // on the first commit that consumed it.
  const preloadConsumedRef = useRef(false);
  const preloadClearedRef = useRef(false);
  useEffect(() => {
    if (preloadConsumedRef.current && !preloadClearedRef.current) {
      preloadClearedRef.current = true;
      deletePreloadedData(id);
    }
  });

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
              serializeLocationForCache(locationRef.current, loaderRef.params)
            );
          }
        },
        onError: (err) => setLoadError(err),
        onEnd: () => {
          /* nothing to do */
        },
      }
    );

    promise
      .then((result) => {
        if (isBrowser())
          loaderRef.cache.set(
            result,
            serializeLocationForCache(locationRef.current, loaderRef.params)
          );
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

    if (accumulate) {
      // Streaming consumption: fold every chunk into accumulated state. A live
      // loader never runs on the server (its infinite generator would hang
      // renderToStringAsync); LoaderHost renders the fallback for live+server,
      // so this reader is not consumed there.
      accRef.current = accumulate.initial;
      if (loaderRef.live && !isBrowser()) {
        readerRef.current = { read: () => undefined as unknown as T };
      } else {
        inFlightRef.current = true;
        const settleAcc = () => {
          inFlightRef.current = false;
        };
        const apply = (chunk: unknown) => {
          accRef.current = accumulate.reduce(accRef.current, chunk);
          setOverrideData(accRef.current as T);
          setStatus('open');
        };
        const accFetch: Promise<T> = runLoader<T>(
          loaderRef,
          location,
          id,
          newAbortSignal(),
          {
            onChunk: (value) => apply(value),
            onError: (err) => {
              setLoadError(err);
              setStatus('error');
            },
            onEnd: () => setStatus('closed'),
          }
        );
        readerRef.current = wrapPromise(
          accFetch
            .then((firstChunk) => {
              apply(firstChunk);
              settleAcc();
              return accRef.current as T;
            })
            .catch((err: unknown) => {
              settleAcc();
              throw err;
            })
        );
      }
    } else {
      const preloaded = getPreloadedData<T>(id);
      const isFirstRender = readerRef.current === null;
      if (preloaded !== null) {
        // Record that we consumed the SSR preload payload so the useEffect
        // below can clear the DOM attribute AFTER commit instead of mutating
        // the DOM during render.
        preloadConsumedRef.current = true;
        loaderRef.cache.set(preloaded, locKey);
        readerRef.current = { read: () => preloaded };
        if (isBrowser()) {
          const unsub = subscribeToLoaderStream(id, {
            push: (value) => {
              setOverrideData(value as T);
              loaderRef.cache.set(value as T, locKey);
            },
            end: () => {
              /* nothing to do */
            },
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
            onEnd: () => {
              /* nothing to do */
            },
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
  }

  return {
    reader: readerRef.current,
    overrideData,
    error: loadError,
    reload,
    reloading,
    status,
  };
}
