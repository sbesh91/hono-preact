import type { ComponentChildren } from 'preact';
import type { RouteHook } from 'preact-iso';
import { useContext, useId, useMemo } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';
import { toStreamState } from '../loader-state.js';
import type { LoaderState, StreamState } from '../loader-state.js';
import { ReloadContext } from '../reload-context.js';
import {
  ActiveLoaderIdContext,
  LoaderErrorContext,
  LoaderIdContext,
  LoaderStreamContext,
  type LoaderStreamValue,
} from './contexts.js';
import { LoaderDataProvider } from './loader-data-provider.js';
import type { LoaderRef } from '../define-loader.js';
import { RouteLocationsContext } from './route-locations.js';
import { ErrorBoundary } from './route-boundary.js';
import { Envelope } from './envelope.js';
import type { HydrationAnchor } from './envelope.js';
import { isDeny } from '../outcomes.js';
import { recordServerDeny } from './server-deny-registry.js';
import {
  useLoaderRunner,
  type AccumulateOptions,
} from './use-loader-runner.js';
import { createCollectSignals } from './loader-signal.js';
export { serializeLocationForCache } from './cache-key.js';

// Collect-mode's SSR placeholder: a live loader hosted for `useData` renders
// `connecting` with an empty log on the server (the same "no baked streaming
// value, the client reconnects on mount" contract `accumulate` already uses
// below). Built via `loader-signal.ts`'s factory (this file never calls
// `@preact/signals` directly, see `signals-always-on.test.ts`), and never
// mutated, so one instance is safe to share across every request/render.
const SSR_STREAM_VALUE: LoaderStreamValue = createCollectSignals();

// A route-independent loader runs with no location. Its zero-value location is
// invariant, so a single frozen module-level instance serves every render and
// avoids the per-render object allocation a fresh literal would incur.
const EMPTY_LOCATION: RouteHook = Object.freeze({
  path: '',
  pathParams: {},
  searchParams: {},
}) as RouteHook;

/**
 * SERVER-ONLY suspension carrier (Mechanism B, spike-verified in
 * `.superpowers/spike/spike-b1-reader-prop.mjs`).
 *
 * `LoaderHost` (the hook owner) renders ONCE on the server and creates a stable
 * `reader`. This SEPARATE child calls `reader.read()`, which throws the in-flight
 * promise while the loader is pending. `renderToStringAsync` catches the throw
 * and replays ONLY this child's subtree (not `LoaderHost`), so the reader created
 * by the once-rendering parent survives the resume and returns the resolved value
 * on retry; `data` then bakes into `<Envelope>`'s `data-loader` attribute and the
 * server render completes in a single fetch.
 *
 * It MUST stay a distinct component reached via props. Inlining `reader.read()`
 * into `LoaderHost` would make every retry re-run the host body and rebuild the
 * reader, fetching forever (the spike's negative control,
 * `spike-b3-negative-parent-throws.mjs`). No `<Suspense>` boundary and no
 * `preact/compat` are needed on the server: render-to-string's async catch scopes
 * the retry to this child on its own.
 */
/**
 * Renders an `errorFallback` (static children or a `(error, reset) =>
 * children` render fn) for a loader deny and wraps the result in the SAME
 * `data-loader-deny` `<Envelope>` anchor on both the server and the client.
 * The server's `DataReader` catch and the client's `LoaderHost` `fromBakedDeny`
 * branch call this ONE function so they cannot silently drift out of lockstep
 * (a divergence here is a hydration mismatch, not a cosmetic difference).
 */
export function renderDenyFallback(
  errorFallback:
    | ComponentChildren
    | ((err: Error, reset: () => void) => ComponentChildren),
  error: Error,
  reset: () => void,
  message: string
): ComponentChildren {
  const rendered =
    typeof errorFallback === 'function'
      ? errorFallback(error, reset)
      : errorFallback;
  return <Envelope anchor={{ kind: 'deny', message }}>{rendered}</Envelope>;
}

function DataReader<T>({
  reader,
  accumulate,
  collect,
  errorFallback,
  children,
}: {
  reader: { read: () => T };
  accumulate?: AccumulateOptions;
  /** Collect-mode: see `LoaderHostProps.collect`. */
  collect?: boolean;
  errorFallback?:
    | ComponentChildren
    | ((err: Error, reset: () => void) => ComponentChildren);
  children: ComponentChildren;
}) {
  let raw: T;
  try {
    raw = reader.read();
  } catch (e) {
    // A pending promise (Suspense) or any non-deny throw: rethrow unchanged so
    // renderToStringAsync suspends / an outer boundary handles a plain error.
    if (!isDeny(e)) throw e;
    // A loader deny with no LOCAL errorFallback: rethrow so it unwinds to
    // renderPage's outer catch, which translates it to a bare-text response
    // at the deny status (a page-level errorFallback cannot catch an SSR
    // loader deny: a throw from the suspended DataReader subtree escapes
    // ancestor boundaries in preact-render-to-string).
    if (errorFallback == null) throw e;
    // Loader-local deny WITH a fallback: record the response facts and render
    // the fallback wrapped in an Envelope carrying the deny marker, so the
    // client seeds a coldError on hydration instead of refetching.
    recordServerDeny({ status: e.status, headers: e.headers });
    // On the server there is no client runner to reset; the real reload is
    // wired on hydration. A noop keeps the (error, reset) signature.
    return renderDenyFallback(
      errorFallback,
      new Error(e.message),
      NOOP_RESET,
      e.message
    );
  }
  // Project to the same public union the client carries on context, keyed on the
  // CONSUMPTION FORM (`accumulate`), so SSR and the client's FIRST render agree
  // (no hydration mismatch):
  //
  //  - Streaming (accumulate) consumption: the client never adopts a baked
  //    streaming value; on mount it re-subscribes via SSE, so its first render is
  //    a `connecting` StreamState with no value. SSR therefore renders that SAME
  //    `connecting` StreamState and bakes NO value. (A live loader's stub reader
  //    resolves to `undefined` here; a finite streaming loader's first chunk is
  //    likewise not baked, because the accumulating consumer reconnects either
  //    way.) Keying on the consumption form, not `live`, is what keeps the
  //    server's projected union shape (`StreamState`) identical to the one the
  //    accumulating `.View` render fn reads on the client.
  //  - Single-value consumption: the server render is settled (the reader awaited
  //    the value), so project a `success` `LoaderState` and bake the value into
  //    `data-loader` for the client preload to adopt.
  //  - Collect consumption (`useData(initial, reduce)` on a live loader):
  //    exactly the same `connecting`/no-bake treatment as `accumulate`, since a
  //    live loader's SSR-side value is likewise discarded (the client always
  //    reconnects). Also seeds `LoaderStreamContext` with an empty log so a
  //    `useData` consumer under SSR sees `connecting` structurally instead of
  //    hitting the "no host" throw.
  const state: LoaderState<T> | StreamState<T> =
    accumulate || collect
      ? toStreamState('connecting', { present: false }, null)
      : { status: 'success', data: raw };
  const anchor: HydrationAnchor =
    accumulate || collect ? { kind: 'none' } : { kind: 'data', value: raw };
  // The server provides the SAME signal-valued channel the client does. The
  // state is settled by the time this renders and never changes again, but the
  // channel's shape is not allowed to differ by environment: a consumer that
  // reads `.value` (or calls any other `ReadonlySignal` method) has to work
  // identically under SSR.
  const body = (
    <LoaderDataProvider state={state}>
      <Envelope anchor={anchor}>{children}</Envelope>
    </LoaderDataProvider>
  );
  if (!collect) return body;
  return (
    <LoaderStreamContext.Provider value={SSR_STREAM_VALUE}>
      {body}
    </LoaderStreamContext.Provider>
  );
}

const NOOP_RESET = () => {};

type LoaderHostProps<T> = {
  loader: LoaderRef<T, boolean>;
  location?: RouteHook;
  errorFallback?:
    | ComponentChildren
    | ((err: Error, reset: () => void) => ComponentChildren);
  /** Present for streaming consumption: fold every chunk into accumulated state. */
  accumulate?: AccumulateOptions;
  /**
   * Present for collect consumption: a live loader hosted for `useData(initial,
   * reduce)` rather than `.View` accumulate. Runs the runner's collect-mode
   * (appends every chunk to a retained log signal instead of folding) and
   * provides `LoaderStreamContext` to descendants. Never set together with
   * `accumulate`.
   */
  collect?: boolean;
  children: ComponentChildren;
};

export function LoaderHost<T>({
  loader: loaderRef,
  location: locationProp,
  accumulate,
  collect,
  children,
  errorFallback,
}: LoaderHostProps<T>) {
  const id = useId();
  const locMap = useContext(RouteLocationsContext);
  const ctxLocation = loaderRef.__moduleKey
    ? locMap?.get(loaderRef.__moduleKey)
    : undefined;
  const resolved = (locationProp ?? ctxLocation) as RouteHook | undefined;
  if (!resolved && loaderRef.__routeBound) {
    // Route-bound loader with no resolvable location: its page-tier guards and
    // its `location.pathParams` depend on the route, so refuse rather than run
    // with an empty location (which would silently yield wrong/empty data). The
    // route-bound flag is set on BOTH the server ref (`serverRoute().loader`) and
    // the client stub (threaded by the Vite plugin), so the guard fires on either
    // side rather than only on the server.
    throw new Error(
      `Route-bound loader for module '${loaderRef.__moduleKey ?? '<unkeyed>'}' has no ` +
        `location; it must be consumed under its bound route (render it within that ` +
        `route's page tree).`
    );
  }
  // Route-independent loader: run with the shared empty location (the runner
  // tolerates empty pathParams/searchParams; the cache key becomes module::name
  // only).
  const location: RouteHook = resolved ?? EMPTY_LOCATION;

  // CLIENT: state-based rendering. The runner exposes `data`/`loading` directly,
  // so we render the `.View` render fn (the children) immediately rather than
  // suspending on a throwing reader. Because nothing suspends on the client, the
  // initial hydration render reads the SSR-baked preload (loading=false) and
  // adopts the server DOM cleanly.
  //
  // SERVER: state alone cannot bake loader data, because the loader resolves
  // asynchronously and a single synchronous render would emit `data-loader=null`
  // before the value lands. So the server path additionally suspends on the
  // runner's stable `reader` via a SEPARATE `DataReader` child (Mechanism B),
  // letting `renderToStringAsync` await the loader and bake the resolved value.
  const {
    view,
    reloading,
    reload,
    reader,
    collect: collectSignals,
  } = useLoaderRunner<T>(loaderRef, location, id, accumulate, collect);

  // The runner builds the public union (or a cold-error signal) STRUCTURALLY;
  // `loader.tsx` only ROUTES it (review #6). `ViewRenderer` / `useData()` READ
  // the union off context; nothing re-projects. `error` for `LoaderErrorContext`
  // / `errorFallback` is read off the view discriminant (cold error, or the
  // stale-error arm), never re-derived from `data === undefined`.
  const error: Error | null =
    view.kind === 'coldError'
      ? view.error
      : view.state.status === 'error'
        ? view.state.error
        : null;

  // Stabilize the renderable union's REFERENCE across re-renders that do not
  // change the loader state, so memoized `useData()` consumers stay stable
  // (review #7). The runner builds a fresh `view.state` each render; this
  // `useMemo` keyed on its fields returns the cached reference when nothing
  // changed, which is also what makes `LoaderDataProvider`'s write a no-op on
  // an unchanged render. `null` on a cold error (which routes to the boundary,
  // not context).
  const renderState = view.kind === 'render' ? view.state : null;
  const memoStatus = renderState ? renderState.status : null;
  const memoData =
    renderState && 'data' in renderState ? renderState.data : undefined;
  const memoError =
    renderState && 'error' in renderState ? renderState.error : null;
  const viewState = useMemo(
    () => renderState,
    [memoStatus, memoData, memoError]
  );

  // A COLD error: a SINGLE-VALUE load that failed before ANY value settled. The
  // old Suspense path threw the reader so an error boundary caught it; the state
  // path surfaces the error without throwing, so reproduce that propagation
  // explicitly. The runner already decided this STRUCTURALLY (the cold `error`
  // phase -> `view.kind === 'coldError'`), so a real resolve-to-`undefined` (a
  // value-bearing phase) is never mistaken for a cold failure, and a POST-settle
  // (stale) error stays in-view via the `error` arm / `useError()`. Streaming
  // (`accumulate`) cold errors are NEVER `coldError`; they surface in-view via
  // the `StreamState.error` arm.
  //
  // Server-only: `view.kind` is always `render` on the first (and only) server
  // render of `LoaderHost`, because runner state has not updated yet. A cold
  // failure on the server surfaces by `reader.read()` rethrowing the rejection
  // from inside `DataReader`, which the `ErrorBoundary` wrap below (or an outer
  // page boundary) catches, mirroring the client's `throw` propagation.

  // SERVER (`!isBrowser()`): suspend on the stable reader from a SEPARATE child
  // so render-to-string awaits the loader and bakes the resolved value. CLIENT:
  // render the view directly from runner state (never calls `reader.read()`).
  // Collect-mode additionally wraps children in `LoaderStreamContext` so a
  // live loader's `useData(initial, reduce)` can find its host.
  const envelopedChildren = collectSignals ? (
    <LoaderStreamContext.Provider value={collectSignals}>
      <Envelope anchor={{ kind: 'none' }}>{children}</Envelope>
    </LoaderStreamContext.Provider>
  ) : (
    <Envelope anchor={{ kind: 'none' }}>{children}</Envelope>
  );
  const content = isBrowser() ? (
    <LoaderDataProvider state={viewState}>
      {envelopedChildren}
    </LoaderDataProvider>
  ) : (
    <DataReader
      reader={reader}
      accumulate={accumulate}
      collect={collect}
      errorFallback={errorFallback}
    >
      {children}
    </DataReader>
  );

  let body: ComponentChildren;
  if (view.kind === 'coldError') {
    if (errorFallback != null) {
      // Local error UI. `reset` re-enters the loader (clears the error and
      // refetches), mirroring the old ErrorBoundary `reset` semantics.
      //
      // Hydration parity: a baked-deny coldError (seeded from the SSR marker)
      // re-wraps the fallback in the SAME `data-loader-deny` Envelope the
      // server emitted, via the shared `renderDenyFallback`, so the client DOM
      // matches the server DOM under the shared `useId` and no mismatch /
      // refetch occurs. A pure client-nav coldError (a real failed fetch, no
      // baked marker) stays bare.
      body = view.fromBakedDeny
        ? renderDenyFallback(
            errorFallback,
            view.error,
            reload,
            view.error.message
          )
        : typeof errorFallback === 'function'
          ? errorFallback(view.error, reload)
          : errorFallback;
    } else {
      // No local handler: re-throw so an OUTER boundary (a page-level
      // `errorFallback` / `RouteBoundary`) catches it, exactly as the thrown
      // Suspense reader propagated up the tree before.
      throw view.error;
    }
  } else if (errorFallback != null) {
    // No cold error (loading, resolved, or a stale post-chunk error): render the
    // content, still wrapped in an ErrorBoundary so a render-time throw from the
    // children subtree is caught by the local `errorFallback` rather than
    // unwinding the page.
    body = <ErrorBoundary fallback={errorFallback}>{content}</ErrorBoundary>;
  } else {
    body = content;
  }

  return (
    <LoaderIdContext.Provider value={id}>
      <ActiveLoaderIdContext.Provider value={loaderRef.__id}>
        <ReloadContext.Provider value={{ reload, reloading }}>
          <LoaderErrorContext.Provider value={error}>
            {body}
          </LoaderErrorContext.Provider>
        </ReloadContext.Provider>
      </ActiveLoaderIdContext.Provider>
    </LoaderIdContext.Provider>
  );
}

// Public name consumed by define-loader.ts and user code.
export { LoaderHost as Loader };
