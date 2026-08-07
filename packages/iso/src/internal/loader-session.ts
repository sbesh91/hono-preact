import type { SyncValue } from '../loader-state.js';

/**
 * The mutable state of ONE loader instance, for as long as it stays mounted.
 *
 * This is deliberately a single named value rather than the ten separate
 * `useRef`s it replaces. Those refs were not independent: the reader factories,
 * the reload state machine and the SSR-adoption effects all read and write
 * overlapping subsets of them, so every attempt to extract one of those
 * concerns had to thread six-to-eight refs through as parameters. Naming the
 * whole thing once turns that into a single collaborator and makes each
 * concern testable without mounting a component.
 *
 * Everything here is intentionally mutable and intentionally NOT reactive.
 * Nothing in this object triggers a render: the render-triggering state (the
 * loader phase and the stream status) stays in the hook's `useState`, and this
 * object carries only the bookkeeping that has to survive between renders.
 * Keeping that split explicit is what lets a reader factory mutate freely
 * during render without scheduling anything.
 */
export type LoaderSession<T> = {
  /**
   * The synchronously-available value (an SSR preload hit or a browser cache
   * hit) as a present/absent carrier, so a value that is itself `null` or
   * `undefined` stays distinguishable from absence STRUCTURALLY. Reset to
   * absent whenever a reader is rebuilt, so a cold load reports no value.
   */
  sync: SyncValue<T>;

  /** Accumulated value for the streaming consumption form. */
  acc: unknown;

  /**
   * The SSR-baked deny seed. While set, the view projects a coldError from it
   * and no fetch runs. Cleared by a reload or a location change, which both
   * supersede the server's decision.
   */
  bakedDeny: Error | null;

  /** True while a fetch or a stream subscribe is in flight. */
  inFlight: boolean;

  /** A reload requested while one was already in flight; runs on settle. */
  queuedReload: boolean;

  /**
   * Set when the SSR `data-loader` / `data-loader-deny` payload was consumed
   * during render. The paired `cleared` flag makes the post-commit DOM cleanup
   * fire exactly once. Cleanup is deferred to an effect because Preact does not
   * support mutating the DOM during render.
   */
  preloadConsumed: boolean;
  preloadCleared: boolean;
  denyConsumed: boolean;
  denyCleared: boolean;

  /** Aborts the in-flight loader. Replaced on each (re)subscribe. */
  abort: AbortController | null;

  /**
   * The stable throwing reader (`wrapPromise`'s `{ read }`), rebuilt only when
   * the location key or loader identity changes. Rebuilding it on every render
   * would fire a duplicate request and throw a fresh promise into Suspense,
   * unmounting the children.
   */
  reader: { read: () => T } | null;

  /**
   * The location key and loader id the current `reader` was built for. The
   * location key includes search params, so `?genre=action` to `?genre=drama`
   * rebuilds even though preact-iso does not remount on a querystring change.
   */
  locKey: string;
  loaderId: symbol | null;

  /**
   * Self-reference used by the queued-reload drain. The hook assigns this once
   * the reload callback exists; the reader factories and the reload state
   * machine both reach a reload through here rather than closing over it.
   */
  runReload: () => void;
};

export function createLoaderSession<T>(): LoaderSession<T> {
  return {
    sync: { present: false },
    acc: undefined,
    bakedDeny: null,
    inFlight: false,
    queuedReload: false,
    preloadConsumed: false,
    preloadCleared: false,
    denyConsumed: false,
    denyCleared: false,
    abort: null,
    reader: null,
    locKey: '',
    loaderId: null,
    runReload: () => {},
  };
}

/**
 * Clear the in-flight flag and run a reload that was queued while one was
 * already running. Shared by every reader factory and by the reload state
 * machine, so the drain rule lives in exactly one place instead of being
 * copied per mode and kept in lockstep by hand.
 */
export function settleSession<T>(session: LoaderSession<T>): void {
  session.inFlight = false;
  if (session.queuedReload) {
    session.queuedReload = false;
    session.runReload();
  }
}

/**
 * The failure counterpart to `settleSession`: a reload or subscribe rejected,
 * so clear the in-flight flag and ABANDON any queued reload rather than running
 * it. A follow-up reload requested while a doomed one was in flight is dropped
 * on purpose; the caller can request a fresh one.
 */
export function abandonReload<T>(session: LoaderSession<T>): void {
  session.inFlight = false;
  session.queuedReload = false;
}

/**
 * Abort any in-flight loader and install a fresh controller, returning its
 * signal for the new request.
 */
export function nextAbortSignal<T>(session: LoaderSession<T>): AbortSignal {
  if (session.abort) session.abort.abort();
  session.abort = new AbortController();
  return session.abort.signal;
}
