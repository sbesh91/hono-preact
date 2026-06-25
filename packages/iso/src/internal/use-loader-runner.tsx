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
  /**
   * The resolved loader value. `undefined` on a cold load that has not
   * resolved; during a reload it retains the PREVIOUS value (stale-while-
   * revalidate). Derived without ever calling the throwing bridge reader.
   */
  data: T | undefined;
  /**
   * True while a fetch/stream-connect is in flight: a cold load that has not
   * resolved, or an explicit `reload()`.
   */
  loading: boolean;
  error: Error | null;
  reload: () => void;
  status: StreamStatus;
  /**
   * The stable throwing reader (`wrapPromise`'s `{ read }`), created ONCE per
   * mount and only rebuilt when location/loader identity changes. SERVER ONLY:
   * `LoaderHost` hands this to a separate child that calls `reader.read()`, so
   * `renderToStringAsync` suspends on the in-flight loader and bakes the
   * resolved value into the SSR HTML. The CLIENT never reads it (it derives
   * `data`/`loading` from state above); it is the SSR suspension carrier, and
   * because the runner (the hook owner) renders only once before the child
   * throws, the reader survives render-to-string's child-subtree replay.
   */
  reader: { read: () => T };
};

export function useLoaderRunner<T>(
  loaderRef: LoaderRef<T, boolean>,
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

  // The synchronously-available value, set by the non-throwing reader paths
  // (SSR-preload hit, browser-cache hit, live-on-server stub). Lets us derive
  // `data` for those paths WITHOUT calling the throwing bridge reader. Reset to
  // undefined whenever a fetching (throwing) reader is built or the location /
  // loader identity changes, so a cold load reports `data === undefined`.
  const syncDataRef = useRef<T | undefined>(undefined);

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

  // Fold one chunk into the accumulator and surface it. Shared by the initial
  // subscribe and reload() so a streaming reload re-folds through `reduce`
  // rather than overwriting the accumulator with a raw chunk.
  const applyChunk = useCallback(
    (chunk: unknown) => {
      if (!accumulate) return;
      accRef.current = accumulate.reduce(accRef.current, chunk);
      setOverrideData(accRef.current as T);
      setStatus('open');
    },
    [accumulate]
  );

  // (Re)subscribe a streaming/live loader: reset the accumulator to `initial`
  // and open a fresh stream that folds every chunk through `applyChunk`. Returns
  // the first-chunk promise (the Suspense reader on first mount; reload awaits it
  // to clear in-flight tracking). It does not `setStatus('connecting')` itself:
  // the initial subscribe runs during render (where setState is unsafe) and
  // relies on the 'connecting' default, while reload sets it explicitly first.
  const subscribeAccumulate = useCallback(
    (signal: AbortSignal): Promise<T> => {
      accRef.current = accumulate!.initial;
      return runLoader<T>(loaderRef, locationRef.current, id, signal, {
        onChunk: (value) => applyChunk(value),
        onError: (err) => {
          setLoadError(err);
          setStatus('error');
        },
        onEnd: () => setStatus('closed'),
      });
    },
    [accumulate, applyChunk, loaderRef, id]
  );

  const runReload = useCallback(() => {
    inFlightRef.current = true;
    setReloading(true);
    setLoadError(null);

    if (accumulate) {
      // Streaming/live reload = resubscribe: `subscribeAccumulate` aborts the
      // current stream (via newAbortSignal), resets to `initial`, reopens, and
      // folds chunks through `reduce`. Reset the surfaced data to `initial` and
      // drive status connecting -> open/closed/error, mirroring a fresh mount.
      setOverrideData(accumulate.initial as T);
      setStatus('connecting');
      subscribeAccumulate(newAbortSignal())
        .then((firstChunk) => {
          applyChunk(firstChunk);
          setReloading(false);
          inFlightRef.current = false;
          if (queuedReloadRef.current) {
            queuedReloadRef.current = false;
            runReloadRef.current();
          }
        })
        .catch((err: unknown) => {
          setLoadError(err instanceof Error ? err : new Error(String(err)));
          setStatus('error');
          setReloading(false);
          inFlightRef.current = false;
          queuedReloadRef.current = false;
        });
      return;
    }

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
  }, [loaderRef, accumulate, applyChunk, subscribeAccumulate]);
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
    // Default: no synchronous value. The non-throwing paths below set it when a
    // value is available immediately (preload/cache); a cold fetch leaves it
    // undefined so `data` is undefined until `overrideData` lands.
    syncDataRef.current = undefined;

    if (accumulate) {
      // Streaming consumption: fold every chunk into accumulated state via the
      // shared `subscribeAccumulate`/`applyChunk` helpers (also used by reload).
      // A live loader never runs on the server (its infinite generator would
      // hang renderToStringAsync); LoaderHost renders the fallback for
      // live+server, so this reader is not consumed there.
      if (loaderRef.live && !isBrowser()) {
        accRef.current = accumulate.initial;
        readerRef.current = { read: () => undefined as unknown as T };
      } else {
        inFlightRef.current = true;
        const settleAcc = () => {
          inFlightRef.current = false;
          // Drain a reload() queued during the initial suspended window (e.g. a
          // useReload() consumer in the fallback subtree fired it before the
          // first chunk arrived). Mirrors the non-accumulate `settle()` below;
          // without it the queued resubscribe is lost.
          if (queuedReloadRef.current) {
            queuedReloadRef.current = false;
            runReloadRef.current();
          }
        };
        readerRef.current = wrapPromise(
          subscribeAccumulate(newAbortSignal())
            .then((firstChunk) => {
              applyChunk(firstChunk);
              settleAcc();
              return accRef.current as T;
            })
            .catch((err: unknown) => {
              // State-based surfacing: the old Suspense reader propagated this
              // rejection by throwing on read(); now nothing reads the reader,
              // so push the error into state. With no chunk yet `data` stays
              // undefined, so LoaderHost treats it as a COLD error.
              setLoadError(err instanceof Error ? err : new Error(String(err)));
              setStatus('error');
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
        // Synchronously available (non-throwing): expose it as `data`.
        syncDataRef.current = preloaded;
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
        // Synchronously available (non-throwing): expose it as `data`.
        syncDataRef.current = cached;
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
              // Drive the resolved value into state so `data` is available
              // without calling the throwing reader. For a non-streaming loader
              // `runLoader` never fires `onChunk`, so this is the only place the
              // single-value cold load surfaces its result as state.
              setOverrideData(r);
              settle();
              return r;
            })
            .catch((err: unknown) => {
              // State-based surfacing: the old Suspense reader propagated this
              // rejection by throwing on read(); now nothing reads the reader,
              // so push the error into state. `data` is still undefined (the
              // fetch never resolved), so LoaderHost treats it as a COLD error
              // and renders `errorFallback` / rethrows to an outer boundary.
              setLoadError(err instanceof Error ? err : new Error(String(err)));
              settle();
              throw err;
            })
        );
      }
    }
  }

  // Derive `data` WITHOUT calling the throwing bridge reader: the streamed /
  // resolved value (`overrideData`, set via setState) takes precedence; else the
  // synchronously-available value (preload/cache); else undefined (cold load).
  // During a reload `overrideData` retains the previous value, so `data` is the
  // stale value while `loading` is true (stale-while-revalidate).
  const data = overrideData !== undefined ? overrideData : syncDataRef.current;

  // `loading` is true while a load is in flight: an explicit reload (`reloading`
  // state, which re-renders), or a cold load that has not resolved yet
  // (`inFlightRef` set, no value, no error). Settling the cold load fires
  // setOverrideData, which both clears `inFlightRef` and re-renders with `data`.
  const loading =
    reloading ||
    (inFlightRef.current && data === undefined && loadError === null);

  return {
    data,
    loading,
    error: loadError,
    reload,
    status,
    // Non-null here: every branch above assigns `readerRef.current` before
    // this point (preload/cache stub, live-on-server stub, or wrapPromise).
    reader: readerRef.current,
  };
}
