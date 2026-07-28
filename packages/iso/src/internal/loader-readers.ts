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
import { isStreamingMode, type LoaderMode } from './loader-mode.js';

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
  /** Apply one chunk, however this host's mode consumes it. */
  applyChunk(chunk: unknown): void;
  /**
   * (Re)subscribe a streaming/live loader; resolves with the first chunk.
   * MODE-AGNOSTIC: `use-loader-runner.tsx` fills this slot with the folding or
   * the collecting subscriber, and nothing here knows which.
   */
  subscribeStream(signal: AbortSignal): Promise<T>;
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
  /**
   * How the host consumes this loader. Both STREAMING modes (`fold` and
   * `collect`) share the same reader shape here (open once, SSR stub / suspend,
   * `wrapPromise`); only the chunk handling differs, and that lives entirely in
   * `ops` (built by `use-loader-runner.tsx`), not here. The single field this
   * file reads off `fold` directly is `initial`, to seed the accumulator.
   */
  mode: LoaderMode;
};

/**
 * Which of the five readers this loader instance needs.
 *
 * The precedence rule lives in `selectReaderMode` below and nowhere else; this
 * union is what it returns, and `buildLoaderReader` only dispatches on it.
 */
export type ReaderMode<T> =
  | { kind: 'bakedDeny'; message: string }
  | { kind: 'liveServer' }
  | { kind: 'streaming' }
  | { kind: 'preload'; preloaded: Extract<SyncValue<T>, { present: true }> }
  | { kind: 'cache' }
  | { kind: 'cold' };

/**
 * The precedence rule this module exists to own, as one readable sequence:
 *
 *   baked deny > streaming > SSR preload > browser cache > cold fetch
 *
 * PURE: it reads the session, the SSR envelope and the cache, and returns which
 * reader is called for. Nothing is adopted or subscribed here (the factories own
 * their side effects), so the ordering can be tested on its own -- which is how
 * the preload-over-cache edge finally got a test.
 *
 * Two of the rules are worth stating rather than inferring from the order:
 *
 * - **A baked deny outranks EVERY mode**, including streaming. A denied loader
 *   wrote no `data-loader`, only `data-loader-deny`, however the host consumes
 *   it, so a finite streaming loader that denied during SSR must seed a
 *   coldError rather than silently resubscribing over SSE and re-hitting the
 *   denied loader.
 * - **The SSR handoff is first-render only.** On a later client navigation the
 *   same `<section>` is still mounted carrying whatever the client `<Envelope>`
 *   re-wrote last render; re-reading it would adopt stale server state and skip
 *   the fetch. `session.reader === null` is that gate.
 */
export function selectReaderMode<T>(
  args: Pick<
    BuildReaderArgs<T>,
    'session' | 'loaderRef' | 'locKey' | 'id' | 'mode'
  >
): ReaderMode<T> {
  const { session, loaderRef, locKey, id, mode } = args;
  const isFirstRender = session.reader === null;

  const bakedDeny =
    isFirstRender && isBrowser()
      ? getPreloadedDeny(id)
      : ({ present: false } as const);
  if (bakedDeny.present) {
    return { kind: 'bakedDeny', message: bakedDeny.message };
  }

  if (isStreamingMode(mode)) {
    // A live loader never runs on the server (its infinite generator would hang
    // renderToStringAsync); `LoaderHost` renders the fallback for live+server.
    return loaderRef.live && !isBrowser()
      ? { kind: 'liveServer' }
      : { kind: 'streaming' };
  }

  const preloaded: SyncValue<T> = isFirstRender
    ? getPreloadedData<T>(id)
    : { present: false };
  if (preloaded.present) return { kind: 'preload', preloaded };

  if (isBrowser() && isFirstRender && loaderRef.cache.has(locKey)) {
    return { kind: 'cache' };
  }

  return { kind: 'cold' };
}

/**
 * What every reader factory needs: the build args plus the two helpers they
 * share (the post-suspend drain and the abort-signal minter), resolved once by
 * `buildLoaderReader` so no factory re-derives them.
 */
type ReaderCtx<T> = BuildReaderArgs<T> & {
  settle: () => void;
  newAbortSignal: () => AbortSignal;
};

/**
 * A denied SSR render: record the deny so the view projects a coldError from it,
 * and hand back a stub. The client never reads it; `reload()` rebuilds a real
 * reader for any mode.
 */
function buildDenyReader<T>(
  ctx: ReaderCtx<T>,
  message: string
): { read: () => T } {
  ctx.session.denyConsumed = true;
  ctx.session.bakedDeny = new Error(message);
  return { read: () => undefined as unknown as T };
}

/** Live loader on the server: nothing to read, and nothing reads it. */
function buildLiveServerReader<T>(ctx: ReaderCtx<T>): { read: () => T } {
  // Collect-mode has no `initial` (it never folds); only seed for fold-mode.
  if (ctx.mode.kind === 'fold') ctx.session.acc = ctx.mode.initial;
  return { read: () => undefined as unknown as T };
}

/**
 * Streaming consumption: open the subscription via the shared
 * `subscribeStream`/`applyChunk` helpers (also used by reload). Both are already
 * mode-aware, resolved by `use-loader-runner.tsx`; this factory is agnostic to
 * which streaming mode is active.
 */
function buildStreamingReader<T>(ctx: ReaderCtx<T>): { read: () => T } {
  const { session, ops, mode, settle, newAbortSignal } = ctx;
  session.inFlight = true;
  return wrapPromise(
    ops
      .subscribeStream(newAbortSignal())
      .then((firstChunk) => {
        ops.applyChunk(firstChunk);
        settle();
        // Collect-mode never populates `session.acc` (nothing folds into it);
        // the client never reads this resolved value either way, so the raw
        // first chunk is a fine stand-in.
        return mode.kind === 'fold' ? (session.acc as T) : firstChunk;
      })
      .catch((err: unknown) => {
        // State-based surfacing: the old Suspense reader propagated this
        // rejection by throwing on read(); now nothing reads the reader, so push
        // the error into state. A stream lifecycle failure is data, not an
        // exception: it surfaces on the consumer's `status`, never on a boundary
        // (`use-loader-runner.tsx`'s `setError` routes both streaming modes
        // in-view).
        ops.setError(err);
        ops.setStatus('error');
        settle();
        throw err;
      })
  );
}

/**
 * SSR preload hit: adopt the server-baked `data-loader` payload as the
 * synchronous value and, in the browser, attach the live update channel.
 */
function buildPreloadReader<T>(
  ctx: ReaderCtx<T>,
  preloaded: Extract<SyncValue<T>, { present: true }>
): { read: () => T } {
  const { session, ops, loaderRef, locKey, id } = ctx;
  // Record that we consumed the SSR preload payload so the runner's effect can
  // clear the DOM attribute AFTER commit instead of mutating the DOM during
  // render. A PRESENT preload value of `null` / `undefined` is adopted exactly
  // like any other (no `!== null` refetch).
  session.preloadConsumed = true;
  loaderRef.cache.set(preloaded.value, locKey);
  // Synchronously available (non-throwing): carry it structurally.
  session.sync = preloaded;
  if (isBrowser()) {
    const unsub = subscribeToLoaderStream(id, {
      push: (value) => {
        // `value` is an erased stream payload (`unknown`); reading it as `T` is
        // the pre-existing stream boundary, not a phase coercion.
        ops.setPhase({ tag: 'success', value: value as T });
        loaderRef.cache.set(value as T, locKey);
      },
      end: () => {
        /* nothing to do */
      },
      // Stale-while-error: a preload-hydrated loader keeps its phase at
      // `loading` while the value lives on `session.sync`, so a live-channel
      // error BEFORE any push has no phase value. `setError` consults
      // `session.sync.present` and builds a `staleError` that retains the
      // preloaded value, so it surfaces in-view as the error arm rather than
      // unwinding the page as a cold error (R1R2 review).
      error: (err) => ops.setError(err),
    });
    // Unsubscribe on unmount: attach to the session.abort signal.
    if (!session.abort) session.abort = new AbortController();
    session.abort.signal.addEventListener('abort', unsub);
  }
  return { read: () => preloaded.value };
}

/** Browser cache hit: serve the cached value synchronously, no fetch. */
function buildCacheReader<T>(ctx: ReaderCtx<T>): { read: () => T } {
  const cached = ctx.loaderRef.cache.get(ctx.locKey)!;
  // Synchronously available (non-throwing): carry it structurally.
  ctx.session.sync = { present: true, value: cached };
  return { read: () => cached };
}

/**
 * Cold fetch (no preload, no cache): run the loader, suspend on it, and drive
 * the resolved value into state so the view settles without reading the
 * throwing reader.
 */
function buildColdFetchReader<T>(ctx: ReaderCtx<T>): { read: () => T } {
  const { session, ops, loaderRef, location, locKey, id, settle } = ctx;
  session.inFlight = true;
  const fetchPromise: Promise<T> = runLoader<T>(
    loaderRef,
    location,
    id,
    ctx.newAbortSignal(),
    {
      onChunk: (value) => {
        ops.setPhase({ tag: 'success', value });
        if (isBrowser()) loaderRef.cache.set(value, locKey);
      },
      onError: (err) => ops.setError(err),
      onEnd: () => {
        /* nothing to do */
      },
    }
  );

  return wrapPromise(
    fetchPromise
      .then((r) => {
        if (isBrowser()) loaderRef.cache.set(r, locKey);
        // Drive the resolved value into state so `data` is available without
        // calling the throwing reader. For a non-streaming loader `runLoader`
        // never fires `onChunk`, so this is the only place the single-value cold
        // load surfaces its result as state. A fresh `success` object means a
        // resolve-to-`undefined` still re-renders and clears loading (review #10).
        ops.setPhase({ tag: 'success', value: r });
        settle();
        return r;
      })
      .catch((err: unknown) => {
        // State-based surfacing, as above. This is the cold-fetch path (no
        // preload, no cache), so `session.sync` is absent and the phase has no
        // value (the fetch never resolved): `setError` builds a cold `error`
        // phase, which `toLoaderView` reports as `coldError` and `LoaderHost`
        // renders `errorFallback` / rethrows to an outer boundary.
        ops.setError(err);
        settle();
        throw err;
      })
  );
}

/**
 * Pick and build the reader for this loader instance: `selectReaderMode` decides
 * WHICH, a factory above decides HOW, and this is only the join between them.
 *
 * Side effects on `session` are intentional and are the reason this returns a
 * reader rather than being pure: adopting an SSR payload, marking a deny as
 * consumed and flipping in-flight all have to survive the render that built the
 * reader. They live in the factories, so the selection stays testable alone.
 */
export function buildLoaderReader<T>(args: BuildReaderArgs<T>): {
  read: () => T;
} {
  const ctx: ReaderCtx<T> = {
    ...args,
    // Shared post-suspend drain for the cold/streaming readers: clear the
    // in-flight flag and run a reload() queued while suspended.
    settle: () => settleSession(args.session),
    newAbortSignal: () => nextAbortSignal(args.session),
  };

  const selected = selectReaderMode<T>(args);
  switch (selected.kind) {
    case 'bakedDeny':
      return buildDenyReader(ctx, selected.message);
    case 'liveServer':
      return buildLiveServerReader(ctx);
    case 'streaming':
      return buildStreamingReader(ctx);
    case 'preload':
      return buildPreloadReader(ctx, selected.preloaded);
    case 'cache':
      return buildCacheReader(ctx);
    case 'cold':
      return buildColdFetchReader(ctx);
    default: {
      const unreachable: never = selected;
      return unreachable;
    }
  }
}
