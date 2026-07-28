import type { RouteHook } from 'preact-iso';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import { deletePreloadedData, deletePreloadedDeny } from './preload.js';
import { createLoaderSession, type LoaderSession } from './loader-session.js';
import { buildLoaderReader, type LoaderPhaseOps } from './loader-readers.js';
import { runReload, requestReload } from './loader-reload.js';
import { runLoader } from './loader-runner.js';
import { serializeLocationForCache } from './cache-key.js';
import type { LoaderStreamValue } from './contexts.js';
import type { LoaderMode } from './loader-mode.js';
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
import {
  appendCollectChunk,
  closeCollectSignals,
  createCollectSignals,
  beginCollectResubscribe,
  setCollectError,
  type CollectSignals,
} from './loader-signal.js';

/**
 * The runner's renderable view: the single-value `LoaderView` (a `LoaderState`
 * or a cold-error signal) OR a streaming `StreamState` wrapped in `render`.
 * `loader.tsx` routes it; it never re-projects.
 */
export type RunnerView<T> =
  | LoaderView<T>
  | { kind: 'render'; state: StreamState<T> };

/**
 * Project the runner's state into the view `loader.tsx` routes. Pure and
 * mode-exhaustive; extracted from the hook so the three arms are readable side
 * by side and testable without a renderer.
 *
 * `fold` is the only mode whose view is a `StreamState`: it is the only mode
 * that folds chunks INTO `phase`, so the accumulated value and the streaming
 * `status` both describe the same thing.
 *
 * `collect` is streaming yet deliberately takes the SINGLE-VALUE projection,
 * which is not an oversight. A collect host's chunks never enter `phase` (they
 * append to the collect signals that `useData(initial, reduce)` reads off
 * `LoaderStreamContext`), and neither do its errors (`setError` routes those to
 * the collect signals too, so a stream failure is always data on the consumer's
 * `status`). `phase` therefore only ever holds `loading` here, and this arm is
 * really "render the children and let the collect signals drive them". The whole
 * in-view streaming lifecycle comes from those signals, not from here.
 */
function projectRunnerView<T>(
  mode: LoaderMode,
  phase: LoaderPhase<T>,
  status: StreamStatus,
  sync: SyncValue<T>
): RunnerView<T> {
  switch (mode.kind) {
    case 'fold':
      return {
        kind: 'render',
        state: toStreamState(
          status,
          hasPhaseValue(phase) ? { present: true, value: phase.value } : sync,
          phaseError(phase)
        ),
      };
    case 'single':
    case 'collect':
      return toLoaderView(phase, sync);
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

/**
 * Hold the host's mode IDENTITY stable across renders that did not change it.
 * A host may legitimately build a fresh `LoaderMode` object per render (a fold
 * mode wraps the caller's `accumulate`; a bare `<Loader>` host may write a
 * literal), and the runner's mode-keyed `useCallback`s would then rebuild every
 * render. Memoized on the mode's own fields, the same shape `loader.tsx` uses to
 * stabilize the projected union.
 */
function useStableLoaderMode(mode: LoaderMode): LoaderMode {
  const kind = mode.kind;
  const initial = mode.kind === 'fold' ? mode.initial : undefined;
  const reduce = mode.kind === 'fold' ? mode.reduce : undefined;
  return useMemo(() => mode, [kind, initial, reduce]);
}

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
   * Present only in collect-mode: the retained chunk log plus status/error, for
   * `loader.tsx` to put on `LoaderStreamContext`. `undefined` in `single` and
   * `fold` mode.
   */
  collect?: LoaderStreamValue;
};

export function useLoaderRunner<T>(
  loaderRef: LoaderRef<T, boolean>,
  location: RouteHook,
  id: string,
  /**
   * How this host consumes the loader (`single` / `fold` / `collect`), built
   * once by the host. See `loader-mode.ts`; the modes are mutually exclusive by
   * construction, so nothing below re-derives or re-checks that.
   */
  hostMode: LoaderMode
): LoaderRunnerState<T> {
  const mode = useStableLoaderMode(hostMode);
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
    if (mode.kind === 'fold') created.acc = mode.initial;
    sessionRef.current = created;
  }
  const session = sessionRef.current;

  // Collect-mode's reactive output: created once, lazily, only in that mode,
  // via `loader-signal.ts`'s factory (which pairs the signals with the batched
  // mutators that keep them atomic). Writing these does NOT re-render this
  // host, which is the point (a `useData` consumer reads them independently via
  // `LoaderStreamContext`, granularly). See `applyCollectChunk` /
  // `subscribeCollect` below.
  const collectRef = useRef<CollectSignals | null>(null);
  if (mode.kind === 'collect' && collectRef.current === null) {
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
  // A STREAMING failure is data, not an exception: it belongs on the consumer's
  // `status`, never on an error boundary. Fold-mode has always worked that way,
  // and it is what `live-loaders.mdx` promises ("errorFallback does not catch a
  // stream connect failure"). Collect-mode routes here too, so it does the same:
  // every collect failure goes in-view via the collect signals, whether it
  // rejected before the first chunk or after ten minutes of healthy streaming.
  //
  // Both cases used to land on the cold `error` tag, because collect-mode
  // presence is NOT in `phase` (chunks append to the collect signals that
  // `useData()` reads and never settle into a phase value), so the structural
  // test below saw "no value" however long the stream had run. That unwound the
  // subtree to the boundary: destructive for a warm failure, and for a cold one
  // it made `StreamState`'s own error arm unreachable in this mode.
  //
  // A mid-stream error never reaches this function at all -- `subscribeCollect`'s
  // own `onError` calls `setCollectError` directly -- so all three collect
  // failure paths now converge on the same in-view surface.
  const setError = (err: unknown) => {
    const error = toError(err);
    const collect = collectRef.current;
    if (mode.kind === 'collect' && collect) {
      setCollectError(collect, error);
      return;
    }
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

  // Apply one chunk, per mode. Shared by the initial subscribe and by reload()
  // so a streaming reload re-folds through `reduce` rather than overwriting the
  // accumulator with a raw chunk. Exhaustive on the mode union: a new mode
  // cannot be added without deciding what a chunk does here.
  const applyChunk = useCallback(
    (chunk: unknown) => {
      switch (mode.kind) {
        case 'collect':
          applyCollectChunk(chunk);
          return;
        case 'fold':
          session.acc = mode.reduce(session.acc, chunk);
          // A fresh `success` object per chunk; streaming already re-renders.
          // The accumulator is `unknown` by design (erased-ref boundary), so
          // reading it as `T` here is the ONE sanctioned cast (not a
          // phase-variant coercion).
          setPhase({ tag: 'success', value: session.acc as T });
          setStatus('open');
          return;
        case 'single':
          // A single-value host never subscribes to a stream, so nothing ever
          // calls this. It stays a no-op rather than a throw because `ops` is
          // built for every mode.
          return;
        default: {
          const unreachable: never = mode;
          return unreachable;
        }
      }
    },
    [mode, session, applyCollectChunk]
  );

  // (Re)subscribe a FOLD-mode stream: reset the accumulator to `initial` and
  // open a fresh stream that folds every chunk through `applyChunk`. Returns the
  // first-chunk promise (the Suspense reader on first mount; reload awaits it to
  // clear in-flight tracking). It does not `setStatus('connecting')` itself: the
  // initial subscribe runs during render (where setState is unsafe) and relies
  // on the 'connecting' default, while reload sets it explicitly first.
  //
  // The `fold` narrow below is a real guard, not a type formality: this is also
  // the subscriber `single` mode gets in the `ops` slot (only `collect` swaps
  // it), and a single-value host has no accumulator to seed. It replaces the
  // `accumulate!.initial` non-null assertion, which was held up by nothing but
  // which guards happened to precede it.
  const subscribeFold = useCallback(
    (signal: AbortSignal): Promise<T> => {
      if (mode.kind === 'fold') session.acc = mode.initial;
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
    [mode, session, applyChunk, loaderRef, id]
  );

  // (Re)subscribe the collect-mode stream. The retained chunks are NOT dropped
  // here: `beginCollectResubscribe` reports `connecting` and arms the truncate,
  // which the first chunk of the new connection performs. A resubscribing
  // consumer still never folds the prior connection's chunks into the new
  // stream (the truncate + epoch bump happen before that first chunk is
  // appended), but it keeps showing them while the reconnect is in flight, and
  // keeps them if it fails. Mirrors `subscribeFold`, for the non-folding form.
  const subscribeCollect = useCallback(
    (signal: AbortSignal): Promise<T> => {
      const c = collectRef.current;
      if (c) beginCollectResubscribe(c);
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
  // render so it closes over the current mode-dependent callbacks; every member
  // is either a stable `useState` setter or a `useCallback`.
  //
  // `subscribeStream` is the MODE-AGNOSTIC subscribe slot, resolved here:
  // collect-mode uses `subscribeCollect` (append, no fold), every other mode
  // uses `subscribeFold`. `applyChunk` is already mode-aware internally, so it
  // needs no such selection.
  const ops: LoaderPhaseOps<T> = {
    setPhase,
    setStatus,
    setError,
    applyChunk,
    subscribeStream: mode.kind === 'collect' ? subscribeCollect : subscribeFold,
  };

  // The reload state machine lives in `loader-reload.ts`. Rebind the session's
  // bound entry each render so it closes over the latest ops/mode, and read the
  // location through a thunk so a reload uses the location as of when it runs,
  // not when it was wired.
  session.runReload = () =>
    runReload<T>({
      session,
      ops,
      loaderRef,
      currentLocation: () => locationRef.current,
      id,
      mode,
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
      mode,
    });
  }

  // Build the public view STRUCTURALLY from the phase, WITHOUT calling the
  // throwing bridge reader and WITHOUT any `data === undefined` test:
  // value-presence is the phase's variant tag / `session.sync`'s `present` flag
  // throughout. `projectRunnerView` above owns the per-mode dispatch;
  // `loader.tsx` only ROUTES the result and never re-projects it.
  const reloading = phase.tag === 'revalidating';

  const view: RunnerView<T> = projectRunnerView(
    mode,
    phase,
    status,
    session.sync
  );

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
