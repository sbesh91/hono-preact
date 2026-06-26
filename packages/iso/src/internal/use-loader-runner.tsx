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

/**
 * The runner's single-value lifecycle, modelled as a discriminated union. Each
 * settle produces a FRESH object, so resolving to `undefined` lands in
 * `{ tag: 'success', value: undefined }` and is a real state change (clears
 * loading) rather than a no-op `setState(undefined)` (review #10). `revalidating`
 * and `error` carry the prior value so a reload/error keeps the last-good data
 * visible (stale-while-revalidate).
 */
type LoaderPhase<T> =
  | { tag: 'loading' }
  | { tag: 'revalidating'; value: T }
  | { tag: 'success'; value: T }
  | { tag: 'error'; error: Error; value?: T };

/**
 * Read the value a phase carries, if any, without a variant-coercion cast.
 * `value` is typed by the variant (`T`, or `T | undefined` on `error`), so the
 * `in` narrowing carries the type through with no `as`.
 */
function phaseValue<T>(p: LoaderPhase<T>): T | undefined {
  return 'value' in p ? p.value : undefined;
}

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
  /**
   * True ONLY while an explicit `reload()`/revalidation is in flight (the
   * `revalidating` phase, which retains the prior value). A cold load reports
   * `false` here even though `loading` is `true`, so consumers can tell a
   * first-load apart from a refresh-over-stale-data.
   */
  reloading: boolean;
  /**
   * Authoritative discriminant: a settled value exists. True for any settled
   * phase (success/revalidating/error, whose value MAY legitimately be
   * `undefined`) or when a synchronous preload/cache value is present. The
   * public `LoaderState`/`StreamState` union is projected from this in
   * `loader.tsx`, never re-derived from `data === undefined`.
   */
  settled: boolean;
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
  // Single-value lifecycle as one ADT (replaces the `overrideData` sentinel +
  // separate `reloading`/`loadError` states). `data`/`loading`/`reloading`/
  // `error` are all DERIVED from this below.
  const [phase, setPhase] = useState<LoaderPhase<T>>({ tag: 'loading' });
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

  // True while a fetch is in flight: a cold load (no value yet) or an explicit
  // reload. Tracked via a ref so reload() can read it without recapturing on
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
      // A fresh `success` object per chunk; streaming already re-renders. The
      // accumulator is `unknown` by design (erased-ref boundary), so reading it
      // as `T` here is the ONE sanctioned cast (not a phase-variant coercion).
      setPhase({ tag: 'success', value: accRef.current as T });
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
          // Retain prior chunks (stale-while-error) by carrying the prior value.
          setPhase((p) => ({ tag: 'error', error: err, value: phaseValue(p) }));
          setStatus('error');
        },
        onEnd: () => setStatus('closed'),
      });
    },
    [accumulate, applyChunk, loaderRef, id]
  );

  const runReload = useCallback(() => {
    inFlightRef.current = true;
    // Enter `revalidating` retaining the prior value (stale-while-revalidate);
    // with no prior value fall back to a cold `loading`. Moving off `error`/
    // `success` here also clears any prior error (error is derived from phase).
    // A preload/cache-hydrated loader keeps its phase at `loading` while the
    // value lives on `syncDataRef`, so the prior must consult `syncDataRef`
    // too, otherwise a reload-over-preload would drop straight to a cold
    // `loading` instead of `revalidating` (review #2).
    setPhase((p) => {
      const prior = p.tag === 'loading' ? syncDataRef.current : phaseValue(p);
      return prior !== undefined
        ? { tag: 'revalidating', value: prior }
        : { tag: 'loading' };
    });

    if (accumulate) {
      // Streaming/live reload = resubscribe: `subscribeAccumulate` aborts the
      // current stream (via newAbortSignal), resets to `initial`, reopens, and
      // folds chunks through `reduce`. Reset the surfaced data to `initial` and
      // drive status connecting -> open/closed/error, mirroring a fresh mount.
      // `revalidating` keeps `reloading`/`loading` true until the first chunk.
      setPhase({ tag: 'revalidating', value: accumulate.initial as T });
      setStatus('connecting');
      subscribeAccumulate(newAbortSignal())
        .then((firstChunk) => {
          // applyChunk moves the phase to `success` (clears reloading).
          applyChunk(firstChunk);
          inFlightRef.current = false;
          if (queuedReloadRef.current) {
            queuedReloadRef.current = false;
            runReloadRef.current();
          }
        })
        .catch((err: unknown) => {
          const e = err instanceof Error ? err : new Error(String(err));
          setPhase((p) => ({ tag: 'error', error: e, value: phaseValue(p) }));
          setStatus('error');
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
          setPhase({ tag: 'success', value });
          if (isBrowser()) {
            loaderRef.cache.set(
              value,
              serializeLocationForCache(locationRef.current, loaderRef.params)
            );
          }
        },
        onError: (err) =>
          setPhase((p) => ({ tag: 'error', error: err, value: phaseValue(p) })),
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
        // A fresh `success` per settle (clears reloading); `result` may be
        // `undefined`, which is a real state change here (review #10).
        setPhase({ tag: 'success', value: result });
        inFlightRef.current = false;
        if (queuedReloadRef.current) {
          queuedReloadRef.current = false;
          runReloadRef.current();
        }
      })
      .catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        setPhase((p) => ({ tag: 'error', error: e, value: phaseValue(p) }));
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
  // Without this, every re-render (e.g. from a phase setState) would call
  // wrapPromise(...) again, fire a duplicate XHR, and throw a fresh promise
  // into Suspense, unmounting the children and wiping any optimistic UI
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
    if (locationChanged || loaderChanged) setPhase({ tag: 'loading' });
    // Default: no synchronous value. The non-throwing paths below set it when a
    // value is available immediately (preload/cache); a cold fetch leaves it
    // undefined so `data` is undefined until the phase settles.
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
              // so push the error into state. With no chunk yet the phase has no
              // value, so `data` stays undefined and LoaderHost treats it as a
              // COLD error.
              const e = err instanceof Error ? err : new Error(String(err));
              setPhase((p) => ({
                tag: 'error',
                error: e,
                value: phaseValue(p),
              }));
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
              // `value` is an erased stream payload (`unknown`); reading it as
              // `T` is the pre-existing stream boundary, not a phase coercion.
              setPhase({ tag: 'success', value: value as T });
              loaderRef.cache.set(value as T, locKey);
            },
            end: () => {
              /* nothing to do */
            },
            error: (err) =>
              setPhase((p) => ({
                tag: 'error',
                error: err,
                value: phaseValue(p),
              })),
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
              setPhase({ tag: 'success', value });
              if (isBrowser()) loaderRef.cache.set(value, locKey);
            },
            onError: (err) =>
              setPhase((p) => ({
                tag: 'error',
                error: err,
                value: phaseValue(p),
              })),
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
              // single-value cold load surfaces its result as state. A fresh
              // `success` object means a resolve-to-`undefined` still re-renders
              // and clears loading (review #10).
              setPhase({ tag: 'success', value: r });
              settle();
              return r;
            })
            .catch((err: unknown) => {
              // State-based surfacing: the old Suspense reader propagated this
              // rejection by throwing on read(); now nothing reads the reader,
              // so push the error into state. The phase has no value (the fetch
              // never resolved), so `data` is undefined and LoaderHost treats it
              // as a COLD error and renders `errorFallback` / rethrows to an
              // outer boundary.
              const e = err instanceof Error ? err : new Error(String(err));
              setPhase((p) => ({
                tag: 'error',
                error: e,
                value: phaseValue(p),
              }));
              settle();
              throw err;
            })
        );
      }
    }
  }

  // Derive the public fields WITHOUT calling the throwing bridge reader. The
  // settled phases (`success`/`revalidating`/`error`) OWN their value, even when
  // it is `undefined` (a real resolve-to-undefined); only the initial `loading`
  // phase defers to the synchronously-available value (preload/cache) on
  // `syncDataRef`. Keying `data` on the phase tag (not `value !== undefined`)
  // means a settled-`undefined` no longer falls back to a stale `syncDataRef`
  // value (review #3).
  const data =
    phase.tag === 'loading' ? syncDataRef.current : phaseValue(phase);

  // `settled` is the authoritative discriminant a settled value exists:
  // `success`/`revalidating` always own a value (even `undefined`, a real
  // resolve-to-undefined), and any phase carrying a value (`error` after a prior
  // chunk, or the synchronous preload/cache value on a still-`loading` phase)
  // counts too. A COLD `error` (the load failed before any value, so `data` is
  // `undefined`) is NOT settled, which is what lets `loader.tsx` route it to the
  // boundary. The public union is projected from THIS in `loader.tsx`, never
  // re-derived from `data === undefined` (which cannot tell cold from
  // settled-undefined, review #1).
  const settled =
    phase.tag === 'success' ||
    phase.tag === 'revalidating' ||
    data !== undefined;

  const reloading = phase.tag === 'revalidating';
  const error = phase.tag === 'error' ? phase.error : null;

  // `loading` is true while a load is in flight: an explicit reload (the
  // `revalidating` phase, which re-renders), or a cold load that has not
  // settled yet (`inFlightRef` set, not settled, no error). The synchronous
  // preload/cache paths leave `phase` at its initial `loading` tag but populate
  // `syncDataRef`, so `settled` is already true for them and they report
  // `loading: false`. Settling a cold load sets a `success`/`error` phase, which
  // both clears `inFlightRef` and re-renders.
  const loading =
    reloading || (inFlightRef.current && !settled && error === null);

  return {
    data,
    loading,
    reloading,
    settled,
    error,
    reload,
    status,
    // Non-null here: every branch above assigns `readerRef.current` before
    // this point (preload/cache stub, live-on-server stub, or wrapPromise).
    reader: readerRef.current,
  };
}
