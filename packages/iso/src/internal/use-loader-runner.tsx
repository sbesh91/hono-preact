import type { RouteHook } from 'preact-iso';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import { isBrowser } from '../is-browser.js';
import { getPreloadedData, deletePreloadedData } from './preload.js';
import wrapPromise from './wrap-promise.js';
import { subscribeToLoaderStream } from './stream-registry.js';
import { runLoader } from './loader-runner.js';
import { serializeLocationForCache } from './cache-key.js';
import type {
  LoaderPhase,
  LoaderView,
  StreamState,
  StreamStatus,
  SyncValue,
} from '../loader-state.js';
import {
  hasPhaseValue,
  phaseError,
  resolveCurrentValue,
  toLoaderView,
  toStreamState,
} from '../loader-state.js';
import { toError } from './to-error.js';

/** Streaming consumption: fold every chunk into accumulated state. */
export type AccumulateOptions = {
  initial: unknown;
  reduce: (acc: unknown, chunk: unknown) => unknown;
};

/**
 * The runner's renderable view: the single-value `LoaderView` (a `LoaderState`
 * or a cold-error signal) OR a streaming `StreamState` wrapped in `render`.
 * `loader.tsx` routes it; it never re-projects.
 */
export type RunnerView<T> =
  | LoaderView<T>
  | { kind: 'render'; state: StreamState<T> };

export type LoaderRunnerState<T> = {
  /**
   * The renderable view (a single-value `LoaderState` or a streaming
   * `StreamState`), or a cold-error signal, built STRUCTURALLY from the phase by
   * the runner. `loader.tsx` only routes it: `coldError` -> errorFallback /
   * boundary; otherwise the `state` goes on `LoaderDataContext`. No scalar
   * `data` / `loading` / `settled` is re-derived downstream (no `data ===
   * undefined` heuristic anywhere).
   */
  view: RunnerView<T>;
  reload: () => void;
  /**
   * True ONLY while an explicit `reload()` / revalidation is in flight (the
   * `revalidating` phase, which retains the prior value). Kept solely for
   * `useReload()`'s `reloading` flag; the load status is otherwise on the union.
   */
  reloading: boolean;
  /**
   * The stable throwing reader (`wrapPromise`'s `{ read }`), created ONCE per
   * mount and only rebuilt when location/loader identity changes. SERVER ONLY:
   * `LoaderHost` hands this to a separate child that calls `reader.read()`, so
   * `renderToStringAsync` suspends on the in-flight loader and bakes the
   * resolved value into the SSR HTML. The CLIENT never reads it (it renders the
   * `view` from state); it is the SSR suspension carrier, and because the runner
   * (the hook owner) renders only once before the child throws, the reader
   * survives render-to-string's child-subtree replay.
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
  // separate `reloading`/`loadError` states). The public `view` is built
  // STRUCTURALLY from this phase below (value-presence = the variant tag).
  const [phase, setPhase] = useState<LoaderPhase<T>>({ tag: 'loading' });
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // Accumulated value for the streaming path; reset on each (re)subscribe.
  const accRef = useRef<unknown>(accumulate ? accumulate.initial : undefined);

  // The synchronously-available value (SSR-preload hit, browser-cache hit) as a
  // present/absent carrier, so a preload/cache value of `null` / `undefined` is
  // distinguished from absence STRUCTURALLY (not via `!== undefined`). Reset to
  // absent whenever a fetching reader is built or the location / loader identity
  // changes, so a cold load reports no synchronous value.
  const syncRef = useRef<SyncValue<T>>({ present: false });

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

  // Normalize an unknown thrown value and push it into the error phase. Value
  // presence is STRUCTURAL: if the current phase already carries a settled value,
  // or a preload/cache value was adopted on `syncRef`, the error is a
  // `staleError` (keeps that value visible, stale-while-error); otherwise it is a
  // cold `error` (no value, routes to the boundary). No `?? syncDataRef.current`
  // value-presence test.
  const setError = (err: unknown) => {
    const error = toError(err);
    setPhase((p) => {
      const current = resolveCurrentValue(p, syncRef.current);
      return current.present
        ? { tag: 'staleError', error, value: current.value }
        : { tag: 'error', error };
    });
  };

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
          setError(err);
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
    // with NO settled value fall back to a cold `loading`. Presence is
    // STRUCTURAL: the phase carries a value, OR a preload/cache value was adopted
    // on `syncRef` (a preload/cache-hydrated loader keeps its phase at `loading`
    // while its value lives on `syncRef`). NOT `prior !== undefined`, so a reload
    // over a settled-`undefined` value still revalidates (review #2/#3).
    setPhase((p) => {
      const current = resolveCurrentValue(p, syncRef.current);
      return current.present
        ? { tag: 'revalidating', value: current.value }
        : { tag: 'loading' };
    });

    if (accumulate) {
      // Streaming/live reload = resubscribe: `subscribeAccumulate` aborts the
      // current stream (via newAbortSignal), resets to `initial`, reopens, and
      // folds chunks through `reduce`. Reset the surfaced data to `initial` and
      // drive status connecting -> open/closed/error, mirroring a fresh mount.
      // `revalidating` keeps `reloading`/`loading` true until the first chunk.
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
          setError(err);
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
        onError: (err) => setError(err),
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
        setError(err);
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
    // Default: no synchronous value. The non-throwing factories below set it
    // when a value is available immediately (preload/cache); a cold fetch leaves
    // it absent so the view stays `loading` until the phase settles.
    syncRef.current = { present: false };

    // Shared post-suspend drain for the cold/streaming readers: clear the
    // in-flight flag and run a reload() that was queued while suspended. One
    // definition replaces the per-mode `settle`/`settleAcc` copies the
    // reader-construction branches used to keep in lockstep by hand.
    const settle = () => {
      inFlightRef.current = false;
      if (queuedReloadRef.current) {
        queuedReloadRef.current = false;
        runReloadRef.current();
      }
    };

    // Each reader mode is one factory returning the stable `{ read }` carrier;
    // the dispatch below picks one by mode. The factories own their side effects
    // (syncRef adoption, subscriptions, in-flight tracking) and share `settle`.
    if (accumulate) {
      // A live loader never runs on the server (its infinite generator would
      // hang renderToStringAsync); LoaderHost renders the fallback for
      // live+server, so this stub reader is not consumed there.
      const buildLiveServerReader = (): { read: () => T } => {
        accRef.current = accumulate.initial;
        return { read: () => undefined as unknown as T };
      };

      // Streaming consumption: fold every chunk into accumulated state via the
      // shared `subscribeAccumulate`/`applyChunk` helpers (also used by reload).
      const buildStreamingReader = (): { read: () => T } => {
        inFlightRef.current = true;
        return wrapPromise(
          subscribeAccumulate(newAbortSignal())
            .then((firstChunk) => {
              applyChunk(firstChunk);
              settle();
              return accRef.current as T;
            })
            .catch((err: unknown) => {
              // State-based surfacing: the old Suspense reader propagated this
              // rejection by throwing on read(); now nothing reads the reader,
              // so push the error into state. With no chunk yet the phase has no
              // value AND a live loader never preloads (so `syncRef` is absent
              // too), so the streaming view surfaces the `error` arm IN-VIEW
              // (streaming cold errors are never routed to the boundary).
              setError(err);
              setStatus('error');
              settle();
              throw err;
            })
        );
      };

      readerRef.current =
        loaderRef.live && !isBrowser()
          ? buildLiveServerReader()
          : buildStreamingReader();
    } else {
      // SSR preload hit: adopt the server-baked `data-loader` payload as the
      // synchronous value and, in the browser, attach the live update channel.
      const buildPreloadReader = (
        preloaded: Extract<SyncValue<T>, { present: true }>
      ): { read: () => T } => {
        // Record that we consumed the SSR preload payload so the useEffect
        // above can clear the DOM attribute AFTER commit instead of mutating
        // the DOM during render. A PRESENT preload value of `null` / `undefined`
        // is adopted exactly like any other (no `!== null` refetch).
        preloadConsumedRef.current = true;
        loaderRef.cache.set(preloaded.value, locKey);
        // Synchronously available (non-throwing): carry it structurally.
        syncRef.current = preloaded;
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
            // Stale-while-error: a preload-hydrated loader keeps its phase at
            // `loading` while the value lives on `syncRef`, so a live-channel
            // error BEFORE any push has no phase value. `setError` consults
            // `syncRef.present` and builds a `staleError` that retains the
            // preloaded value V, so it surfaces in-view as the error arm rather
            // than unwinding the page as a cold error (R1R2 review).
            error: (err) => setError(err),
          });
          // Unsubscribe on unmount: attach to the abortRef signal.
          if (abortRef.current) {
            abortRef.current.signal.addEventListener('abort', unsub);
          } else {
            abortRef.current = new AbortController();
            abortRef.current.signal.addEventListener('abort', unsub);
          }
        }
        return { read: () => preloaded.value };
      };

      // Browser cache hit: serve the cached value synchronously, no fetch.
      const buildCacheReader = (): { read: () => T } => {
        const cached = loaderRef.cache.get(locKey)!;
        // Synchronously available (non-throwing): carry it structurally.
        syncRef.current = { present: true, value: cached };
        return { read: () => cached };
      };

      // Cold fetch (no preload, no cache): run the loader, suspend on it, and
      // drive the resolved value into state so the view settles without reading
      // the throwing reader.
      const buildColdFetchReader = (): { read: () => T } => {
        inFlightRef.current = true;
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
            onError: (err) => setError(err),
            onEnd: () => {
              /* nothing to do */
            },
          }
        );

        return wrapPromise(
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
              // so push the error into state. This branch is the cold-fetch path
              // (no preload, no cache), so `syncRef` is absent and the phase has
              // no value (the fetch never resolved): `setError` builds a cold
              // `error` phase, which `toLoaderView` reports as `coldError` and
              // LoaderHost renders `errorFallback` / rethrows to an outer
              // boundary.
              setError(err);
              settle();
              throw err;
            })
        );
      };

      // The SSR preload is a ONE-TIME hydration handoff: only this loader
      // instance's FIRST render can legitimately adopt the server-baked
      // `data-loader` attribute. On a later client navigation (`locationChanged`,
      // so `readerRef.current` is already set) the same `<section>` is still
      // mounted carrying the attribute the client `<Envelope>` re-wrote on the
      // previous render (`"null"` for the state path). Re-reading it would adopt
      // that stale value as a present preload and skip the fetch entirely (the
      // navigation never shows `loading` and lands on stale/`null` data). Gate
      // the read on first-render, exactly like the cache branch.
      const isFirstRender = readerRef.current === null;
      const preloaded: SyncValue<T> = isFirstRender
        ? getPreloadedData<T>(id)
        : { present: false };
      if (preloaded.present) {
        readerRef.current = buildPreloadReader(preloaded);
      } else if (isBrowser() && isFirstRender && loaderRef.cache.has(locKey)) {
        readerRef.current = buildCacheReader();
      } else {
        readerRef.current = buildColdFetchReader();
      }
    }
  }

  // Build the public view STRUCTURALLY from the phase, WITHOUT calling the
  // throwing bridge reader and WITHOUT any `data === undefined` test. The
  // single-value union (and the cold-error signal) is `toLoaderView(phase,
  // syncRef)`; value-presence is the variant tag / the `present` flag. The
  // streaming union is `toStreamState(status, value, error)`, keyed on `status`
  // alone, with the accumulated value sourced from the phase (present iff the
  // phase carries one). `loader.tsx` only ROUTES this; it never re-projects.
  const reloading = phase.tag === 'revalidating';

  const view: RunnerView<T> = accumulate
    ? {
        kind: 'render',
        state: toStreamState(
          status,
          hasPhaseValue(phase)
            ? { present: true, value: phase.value }
            : syncRef.current,
          phaseError(phase)
        ),
      }
    : toLoaderView(phase, syncRef.current);

  return {
    view,
    reload,
    reloading,
    // Non-null here: every branch above assigns `readerRef.current` before
    // this point (preload/cache stub, live-on-server stub, or wrapPromise).
    reader: readerRef.current,
  };
}
