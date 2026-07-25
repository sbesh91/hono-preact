import type { RouteHook } from 'preact-iso';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ReadonlySignal } from '@preact/signals';
import type { LoaderRef } from '../define-loader.js';
import { deletePreloadedData, deletePreloadedDeny } from './preload.js';
import { createLoaderSession, type LoaderSession } from './loader-session.js';
import { buildLoaderReader, type LoaderPhaseOps } from './loader-readers.js';
import { runReload, requestReload } from './loader-reload.js';
import { runLoader } from './loader-runner.js';
import { serializeLocationForCache } from './cache-key.js';
import type {
  LoaderPhase,
  LoaderView,
  StreamState,
  StreamStatus,
} from '../loader-state.js';
import {
  hasPhaseValue,
  phaseError,
  resolveCurrentValue,
  toLoaderView,
  toStreamState,
} from '../loader-state.js';
import { toError } from './to-error.js';
import {
  appendCollectChunk,
  closeCollectSignals,
  createCollectSignals,
  resetCollectSignals,
  setCollectError,
  type CollectSignals,
} from './loader-signal.js';

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

/**
 * Collect-mode's reactive output: the retained chunk log plus status/error, as
 * signals. `loader.tsx` puts this on `LoaderStreamContext`; `useData(initial,
 * reduce)` folds `chunks` through the caller's `reduce` (see `foldStream`).
 */
export type CollectState = {
  chunks: ReadonlySignal<readonly unknown[]>;
  status: ReadonlySignal<StreamStatus>;
  error: ReadonlySignal<Error | null>;
  /** See `LoaderStreamValue.epoch` / `CollectSignals.epoch`. */
  epoch: ReadonlySignal<number>;
};

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
  /**
   * Present only when `collect` is true: the retained chunk log plus
   * status/error, for `loader.tsx` to put on `LoaderStreamContext`. `undefined`
   * outside collect-mode (single-value and `.View` accumulate hosts).
   */
  collect?: CollectState;
};

export function useLoaderRunner<T>(
  loaderRef: LoaderRef<T, boolean>,
  location: RouteHook,
  id: string,
  accumulate?: AccumulateOptions,
  /**
   * Run the runner in COLLECT-mode: a live loader hosted for `useData(initial,
   * reduce)` rather than `.View`'s accumulating fold. Distinct from
   * `accumulate` (never both set): collect-mode appends every chunk to a
   * retained log signal instead of folding it, so N independent `useData`
   * consumers under one host can fold the SAME log differently off ONE
   * subscription. See `CollectState` / `LoaderStreamContext`.
   */
  collect?: boolean
): LoaderRunnerState<T> {
  // Single-value lifecycle as one ADT (replaces the `overrideData` sentinel +
  // separate `reloading`/`loadError` states). The public `view` is built
  // STRUCTURALLY from this phase below (value-presence = the variant tag).
  const [phase, setPhase] = useState<LoaderPhase<T>>({ tag: 'loading' });
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // All non-rendering bookkeeping for this loader instance lives in one named
  // value rather than ten sibling refs. See `loader-session.ts` for why.
  const sessionRef = useRef<LoaderSession<T> | null>(null);
  if (sessionRef.current === null) {
    const created = createLoaderSession<T>();
    if (accumulate) created.acc = accumulate.initial;
    sessionRef.current = created;
  }
  const session = sessionRef.current;

  // Collect-mode's reactive output: created once, lazily, only when `collect`
  // is set, via `loader-signal.ts`'s factory (which pairs the signals with the
  // batched mutators that keep them atomic). Writing these does NOT re-render
  // this host, which is the point (a `useData` consumer reads them
  // independently via `LoaderStreamContext`, granularly). See
  // `applyCollectChunk` / `subscribeCollect` below.
  const collectRef = useRef<CollectSignals | null>(null);
  if (collect && collectRef.current === null) {
    collectRef.current = createCollectSignals();
  }

  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(
    () => () => {
      if (session.abort) session.abort.abort();
    },
    [session]
  );

  // Cleanup of the SSR preload attribute is deferred to after commit so
  // we never mutate the DOM during the render pass (Preact reconciliation
  // doesn't formally support that, and re-renders could observe a phantom
  // half-cleared element). The render path sets `session.preloadConsumed` when
  // it reads the payload; this effect clears the attribute exactly once,
  // on the first commit that consumed it.
  useEffect(() => {
    if (session.preloadConsumed && !session.preloadCleared) {
      session.preloadCleared = true;
      deletePreloadedData(id);
    }
  });

  // SSR-baked deny seed: set on the first client render when a `data-loader-deny`
  // marker is present. While set, the view projects a coldError from it and NO
  // fetch runs. A reload() clears it so a real fetch takes over.
  useEffect(() => {
    if (session.denyConsumed && !session.denyCleared) {
      session.denyCleared = true;
      deletePreloadedDeny(id);
    }
  });

  // Normalize an unknown thrown value and push it into the error phase. Value
  // presence is STRUCTURAL: if the current phase already carries a settled value,
  // or a preload/cache value was adopted on `session.sync`, the error is a
  // `staleError` (keeps that value visible, stale-while-error); otherwise it is a
  // cold `error` (no value, routes to the boundary). No `?? session.sync.value`
  // value-presence test.
  //
  // This is ALSO how a collect-mode COLD connect error (one that rejects
  // before the first chunk) reaches the host: `phase` never carries a chunk
  // value in collect-mode (chunks fold only into the `collect` signals
  // `useData()` reads, never into `phase`), so this always lands on the cold
  // `error` tag, and `loader.tsx` routes it exactly like a single-value
  // loader's cold error (`errorFallback` / an outer boundary), NOT in-view via
  // `useData()`'s `StreamState`. A MID-stream collect error is different: it
  // never reaches this function (`subscribeCollect`'s own `onError` calls
  // `setCollectError` directly), so it stays in-view without touching `phase`.
  const setError = (err: unknown) => {
    const error = toError(err);
    setPhase((p) => {
      const current = resolveCurrentValue(p, session.sync);
      return current.present
        ? { tag: 'staleError', error, value: current.value }
        : { tag: 'error', error };
    });
  };

  // Append one chunk to the retained collect-mode log and flip status to
  // `open`, WITHOUT folding (that is `useData`'s job, via `foldStream`).
  const applyCollectChunk = useCallback((chunk: unknown) => {
    const c = collectRef.current;
    if (c) appendCollectChunk(c, chunk);
  }, []);

  // Fold one chunk into the accumulator and surface it. Shared by the initial
  // subscribe and reload() so a streaming reload re-folds through `reduce`
  // rather than overwriting the accumulator with a raw chunk.
  //
  // `collect` short-circuits to the collect-mode append above: `accumulate`
  // and `collect` are never both set (mutually exclusive host modes), so this
  // branch never changes the `.View` fold-mode's behaviour below it.
  const applyChunk = useCallback(
    (chunk: unknown) => {
      if (collect) {
        applyCollectChunk(chunk);
        return;
      }
      if (!accumulate) return;
      session.acc = accumulate.reduce(session.acc, chunk);
      // A fresh `success` object per chunk; streaming already re-renders. The
      // accumulator is `unknown` by design (erased-ref boundary), so reading it
      // as `T` here is the ONE sanctioned cast (not a phase-variant coercion).
      setPhase({ tag: 'success', value: session.acc as T });
      setStatus('open');
    },
    [accumulate, collect, applyCollectChunk]
  );

  // (Re)subscribe a streaming/live loader: reset the accumulator to `initial`
  // and open a fresh stream that folds every chunk through `applyChunk`. Returns
  // the first-chunk promise (the Suspense reader on first mount; reload awaits it
  // to clear in-flight tracking). It does not `setStatus('connecting')` itself:
  // the initial subscribe runs during render (where setState is unsafe) and
  // relies on the 'connecting' default, while reload sets it explicitly first.
  const subscribeAccumulate = useCallback(
    (signal: AbortSignal): Promise<T> => {
      session.acc = accumulate!.initial;
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

  // (Re)subscribe the collect-mode stream: reset the retained log (a fresh
  // subscription starts a fresh log; a resubscribing consumer should not see
  // the PRIOR connection's chunks folded in) and open a stream that appends
  // every chunk via `applyCollectChunk`. Mirrors `subscribeAccumulate` above,
  // for the collect (non-folding) form.
  const subscribeCollect = useCallback(
    (signal: AbortSignal): Promise<T> => {
      const c = collectRef.current;
      if (c) resetCollectSignals(c);
      return runLoader<T>(loaderRef, locationRef.current, id, signal, {
        onChunk: (value) => applyCollectChunk(value),
        onError: (err) => {
          if (c) setCollectError(c, toError(err));
        },
        onEnd: () => {
          if (c) closeCollectSignals(c);
        },
      });
    },
    [loaderRef, id, applyCollectChunk]
  );

  // The write surface shared by the reader factories and the reload state
  // machine: one way to move the phase, and both go through it. Built fresh each
  // render so it closes over the current `accumulate`-dependent callbacks; every
  // member is either a stable `useState` setter or a `useCallback`.
  //
  // `subscribeAccumulate` selects the mode's subscribe function: collect-mode
  // uses `subscribeCollect` (append, no fold); everything else (including
  // `.View` fold-mode) uses the untouched `subscribeAccumulate`. `applyChunk`
  // is already mode-aware internally, so it needs no such selection.
  const ops: LoaderPhaseOps<T> = {
    setPhase,
    setStatus,
    setError,
    applyChunk,
    subscribeAccumulate: collect ? subscribeCollect : subscribeAccumulate,
  };

  // The reload state machine lives in `loader-reload.ts`. Rebind the session's
  // bound entry each render so it closes over the latest ops/accumulate, and
  // read the location through a thunk so a reload uses the location as of when
  // it runs, not when it was wired.
  session.runReload = () =>
    runReload<T>({
      session,
      ops,
      loaderRef,
      currentLocation: () => locationRef.current,
      id,
      accumulate,
      collect,
    });

  const reload = useCallback(() => requestReload(session), [session]);

  // Stable reader: only rebuilt when location or loader identity changes.
  // Without this, every re-render (e.g. from a phase setState) would call
  // wrapPromise(...) again, fire a duplicate XHR, and throw a fresh promise
  // into Suspense, unmounting the children and wiping any optimistic UI
  // state below.
  //
  // The location key includes path AND searchParams so /movies?genre=action →
  // /movies?genre=drama refetches even though preact-iso doesn't remount on
  // querystring changes.
  const locKey = serializeLocationForCache(location, loaderRef.params);
  // Seed once, to the first render's values, so neither reads as "changed" on
  // the first render (this reproduces the previous `useRef(locKey)` init).
  if (session.loaderId === null) {
    session.locKey = locKey;
    session.loaderId = loaderRef.__id;
  }

  const locationChanged = session.locKey !== locKey;
  const loaderChanged = session.loaderId !== loaderRef.__id;

  if (session.reader === null || locationChanged || loaderChanged) {
    session.locKey = locKey;
    session.loaderId = loaderRef.__id;
    if (locationChanged || loaderChanged) {
      setPhase({ tag: 'loading' });
      // A client navigation supersedes the SSR-baked deny exactly like a
      // reload does: preact-iso does not remount on a location/param change,
      // so without this the stale seed would keep overriding `finalView`
      // below forever, hiding a freshly resolved success behind the old SSR
      // deny fallback.
      session.bakedDeny = null;
    }
    // Default: no synchronous value. The non-throwing factories below set it
    // when a value is available immediately (preload/cache); a cold fetch leaves
    // it absent so the view stays `loading` until the phase settles.
    session.sync = { present: false };

    session.reader = buildLoaderReader<T>({
      session,
      ops,
      loaderRef,
      location,
      locKey,
      id,
      accumulate,
      collect,
    });
  }

  // Build the public view STRUCTURALLY from the phase, WITHOUT calling the
  // throwing bridge reader and WITHOUT any `data === undefined` test. The
  // single-value union (and the cold-error signal) is `toLoaderView(phase,
  // session.sync)`; value-presence is the variant tag / the `present` flag. The
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
            : session.sync,
          phaseError(phase)
        ),
      }
    : toLoaderView(phase, session.sync);

  // While the baked-deny seed is active, project it over whatever `view` would
  // otherwise show (the phase is still `loading`, since no fetch ran): a
  // coldError carrying `fromBakedDeny: true` so `loader.tsx` routes to
  // `errorFallback` exactly like a real cold error, and Task 8 can re-wrap it
  // in a matching Envelope.
  const finalView: RunnerView<T> =
    session.bakedDeny !== null
      ? { kind: 'coldError', error: session.bakedDeny, fromBakedDeny: true }
      : view;

  return {
    view: finalView,
    reload,
    reloading,
    // Non-null here: every branch above assigns `session.reader` before
    // this point (preload/cache stub, live-on-server stub, or wrapPromise).
    reader: session.reader,
    collect: collectRef.current ?? undefined,
  };
}
