import type { RouteHook } from 'preact-iso';
import type { LoaderRef } from '../define-loader.js';
import { isBrowser } from '../is-browser.js';
import { getPreloadedData, getPreloadedDeny } from './preload.js';
import wrapPromise from './wrap-promise.js';
import { subscribeToLoaderStream } from './stream-registry.js';
import { runLoader } from './loader-runner.js';
import type { LoaderPhase, StreamStatus, SyncValue } from '../loader-state.js';
import {
  nextAbortSignal,
  settleSession,
  type LoaderSession,
} from './loader-session.js';
import type { AccumulateOptions } from './use-loader-runner.js';

/**
 * The write surface onto a loader's rendering state. Everything that can move
 * a loader's phase goes through here, which is what lets the reader factories
 * below be built and tested without a renderer: pass plain functions and
 * assert on what they were called with.
 *
 * This is also the seam a future reactivity change would swap. Today these are
 * `useState` setters; nothing in this file knows or cares.
 */
export type LoaderPhaseOps<T> = {
  setPhase(
    next: LoaderPhase<T> | ((prev: LoaderPhase<T>) => LoaderPhase<T>)
  ): void;
  setStatus(next: StreamStatus): void;
  /**
   * Normalize a thrown value into the error phase. Presence is STRUCTURAL: an
   * error over a settled value becomes `staleError` (keeping the value
   * visible), otherwise a cold `error` that routes to the boundary.
   */
  setError(err: unknown): void;
  /** Fold one chunk into the accumulator and surface it. */
  applyChunk(chunk: unknown): void;
  /** (Re)subscribe a streaming/live loader; resolves with the first chunk. */
  subscribeAccumulate(signal: AbortSignal): Promise<T>;
};

export type BuildReaderArgs<T> = {
  session: LoaderSession<T>;
  ops: LoaderPhaseOps<T>;
  loaderRef: LoaderRef<T, boolean>;
  location: RouteHook;
  /** Cache key for this location, already serialized by the caller. */
  locKey: string;
  /** The `useId()` anchoring this loader's SSR envelope and stream channel. */
  id: string;
  accumulate?: AccumulateOptions;
};

/**
 * Pick and build the reader for this loader instance.
 *
 * Five mutually exclusive modes, dispatched in precedence order: an SSR-baked
 * deny, a streaming/live subscription, an SSR preload hit, a browser cache hit,
 * and a cold fetch. Each mode is one factory returning the stable `{ read }`
 * carrier; the factories own their side effects (sync adoption, subscriptions,
 * in-flight tracking) and share the settle drain.
 *
 * Side effects on `session` are intentional and are the reason this returns a
 * reader rather than being pure: adopting an SSR payload, marking a deny as
 * consumed and flipping in-flight all have to survive the render that built
 * the reader.
 */
export function buildLoaderReader<T>(args: BuildReaderArgs<T>): {
  read: () => T;
} {
  const { session, ops, loaderRef, location, locKey, id, accumulate } = args;
  const { setPhase, setStatus, setError, applyChunk, subscribeAccumulate } =
    ops;
  const newAbortSignal = () => nextAbortSignal(session);

  // Shared post-suspend drain for the cold/streaming readers: clear the
  // in-flight flag and run a reload() that was queued while suspended. One
  // definition replaces the per-mode `settle`/`settleAcc` copies the
  // reader-construction branches used to keep in lockstep by hand.
  const settle = () => settleSession(session);

  // The SSR preload/deny handoff is a ONE-TIME hydration adoption: only this
  // loader instance's FIRST render can legitimately adopt server-baked state
  // (`data-loader` or `data-loader-deny`). On a later client navigation
  // (`locationChanged`, so `session.reader` is already set) the same
  // `<section>` is still mounted carrying whatever the client `<Envelope>`
  // re-wrote on the previous render. Re-reading it would adopt stale server
  // state and skip the fetch entirely. Gate the read on first-render.
  const isFirstRender = session.reader === null;

  // Baked-deny seed takes precedence over any value preload/cache/fetch AND
  // over BOTH consumption forms (single-value and streaming/accumulate): a
  // denied loader wrote NO `data-loader`, only `data-loader-deny`, regardless
  // of whether the loader is consumed as a single value or accumulated. This
  // check is hoisted above the `accumulate` split so a finite streaming
  // loader that denied during SSR also seeds a coldError instead of silently
  // resubscribing over SSE and re-hitting the denied loader.
  const bakedDeny =
    isFirstRender && isBrowser()
      ? getPreloadedDeny(id)
      : ({ present: false } as const);

  // Each reader mode is one factory returning the stable `{ read }` carrier;
  // the dispatch below picks one by mode. The factories own their side effects
  // (session.sync adoption, subscriptions, in-flight tracking) and share `settle`.
  if (bakedDeny.present) {
    session.denyConsumed = true;
    session.bakedDeny = new Error(bakedDeny.message);
    // Stub reader: the client never reads it; reload() rebuilds a real one
    // for either consumption form.
    return { read: () => undefined as unknown as T };
  } else if (accumulate) {
    // A live loader never runs on the server (its infinite generator would
    // hang renderToStringAsync); LoaderHost renders the fallback for
    // live+server, so this stub reader is not consumed there.
    const buildLiveServerReader = (): { read: () => T } => {
      session.acc = accumulate.initial;
      return { read: () => undefined as unknown as T };
    };

    // Streaming consumption: fold every chunk into accumulated state via the
    // shared `subscribeAccumulate`/`applyChunk` helpers (also used by reload).
    const buildStreamingReader = (): { read: () => T } => {
      session.inFlight = true;
      return wrapPromise(
        subscribeAccumulate(newAbortSignal())
          .then((firstChunk) => {
            applyChunk(firstChunk);
            settle();
            return session.acc as T;
          })
          .catch((err: unknown) => {
            // State-based surfacing: the old Suspense reader propagated this
            // rejection by throwing on read(); now nothing reads the reader,
            // so push the error into state. With no chunk yet the phase has no
            // value AND a live loader never preloads (so `session.sync` is absent
            // too), so the streaming view surfaces the `error` arm IN-VIEW
            // (streaming cold errors are never routed to the boundary).
            setError(err);
            setStatus('error');
            settle();
            throw err;
          })
      );
    };

    return loaderRef.live && !isBrowser()
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
      session.preloadConsumed = true;
      loaderRef.cache.set(preloaded.value, locKey);
      // Synchronously available (non-throwing): carry it structurally.
      session.sync = preloaded;
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
          // `loading` while the value lives on `session.sync`, so a live-channel
          // error BEFORE any push has no phase value. `setError` consults
          // `session.sync.present` and builds a `staleError` that retains the
          // preloaded value V, so it surfaces in-view as the error arm rather
          // than unwinding the page as a cold error (R1R2 review).
          error: (err) => setError(err),
        });
        // Unsubscribe on unmount: attach to the session.abort signal.
        if (session.abort) {
          session.abort.signal.addEventListener('abort', unsub);
        } else {
          session.abort = new AbortController();
          session.abort.signal.addEventListener('abort', unsub);
        }
      }
      return { read: () => preloaded.value };
    };

    // Browser cache hit: serve the cached value synchronously, no fetch.
    const buildCacheReader = (): { read: () => T } => {
      const cached = loaderRef.cache.get(locKey)!;
      // Synchronously available (non-throwing): carry it structurally.
      session.sync = { present: true, value: cached };
      return { read: () => cached };
    };

    // Cold fetch (no preload, no cache): run the loader, suspend on it, and
    // drive the resolved value into state so the view settles without reading
    // the throwing reader.
    const buildColdFetchReader = (): { read: () => T } => {
      session.inFlight = true;
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
            // (no preload, no cache), so `session.sync` is absent and the phase has
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

    const preloaded: SyncValue<T> = isFirstRender
      ? getPreloadedData<T>(id)
      : { present: false };
    if (preloaded.present) {
      return buildPreloadReader(preloaded);
    } else if (isBrowser() && isFirstRender && loaderRef.cache.has(locKey)) {
      return buildCacheReader();
    } else {
      return buildColdFetchReader();
    }
  }
}
