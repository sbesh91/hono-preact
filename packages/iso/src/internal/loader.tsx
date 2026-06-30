import type { ComponentChildren } from 'preact';
import type { RouteHook } from 'preact-iso';
import { useContext, useId, useMemo } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';
import { toStreamState } from '../loader-state.js';
import type { LoaderState, StreamState } from '../loader-state.js';
import { ReloadContext } from '../reload-context.js';
import {
  ActiveLoaderIdContext,
  LoaderDataContext,
  LoaderErrorContext,
  LoaderIdContext,
} from './contexts.js';
import type { LoaderRef } from '../define-loader.js';
import { RouteLocationsContext } from './route-locations.js';
import { ErrorBoundary } from './route-boundary.js';
import { Envelope } from './envelope.js';
import type { HydrationAnchor } from './envelope.js';
import {
  useLoaderRunner,
  type AccumulateOptions,
} from './use-loader-runner.js';
export { serializeLocationForCache } from './cache-key.js';

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
function DataReader<T>({
  reader,
  live,
  children,
}: {
  reader: { read: () => T };
  live?: boolean;
  children: ComponentChildren;
}) {
  const raw = reader.read();
  // Project to the same public union the client carries on context. The server
  // render is always settled (the reader awaited the value). The SSR run-vs-skip
  // decision is keyed on the loader's `live` flag, NOT the consumption form:
  // a live loader renders `connecting` (the client reconnects on mount); a
  // non-live loader is always `success` (the baked server value, whether from a
  // single-value fetch or from the first accumulated chunk of a finite stream).
  // `accumulate` stays for projecting the streamed value shape only.
  const state: LoaderState<T> | StreamState<T> = live
    ? toStreamState('connecting', { present: false }, null)
    : { status: 'success', data: raw };
  // Live loaders never run on the server; their stub reader resolves to
  // undefined. The client reconnects on mount, so there is no baked server
  // value to anchor. Non-live loaders (including finite streaming ones consumed
  // via accumulate) resolve and bake their value into data-loader.
  const anchor: HydrationAnchor = live
    ? { kind: 'none' }
    : { kind: 'data', value: raw };
  return (
    <LoaderDataContext.Provider value={state}>
      <Envelope anchor={anchor}>{children}</Envelope>
    </LoaderDataContext.Provider>
  );
}

type LoaderHostProps<T> = {
  loader: LoaderRef<T, boolean>;
  location?: RouteHook;
  errorFallback?:
    | ComponentChildren
    | ((err: Error, reset: () => void) => ComponentChildren);
  /** Present for streaming consumption: fold every chunk into accumulated state. */
  accumulate?: AccumulateOptions;
  children: ComponentChildren;
};

export function LoaderHost<T>({
  loader: loaderRef,
  location: locationProp,
  accumulate,
  children,
  errorFallback,
}: LoaderHostProps<T>) {
  const id = useId();
  const locMap = useContext(RouteLocationsContext);
  const ctxLocation = loaderRef.__moduleKey
    ? locMap?.get(loaderRef.__moduleKey)
    : undefined;
  const resolved = (locationProp ?? ctxLocation) as RouteHook | undefined;
  if (!resolved && loaderRef.__routeId !== undefined) {
    // Route-bound loader with no resolvable location: its page-tier guards depend
    // on the route, so refuse rather than run without them.
    throw new Error(
      `Route-bound loader for module '${loaderRef.__moduleKey ?? '<unkeyed>'}' (route ` +
        `'${loaderRef.__routeId}') has no location; ensure it is consumed under its route.`
    );
  }
  // Route-independent loader: synthesize an empty location (the runner tolerates
  // empty pathParams/searchParams; the cache key becomes module::name only).
  const location: RouteHook = (resolved ?? {
    path: '',
    pathParams: {},
    searchParams: {},
  }) as RouteHook;

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
  const { view, reloading, reload, reader } = useLoaderRunner<T>(
    loaderRef,
    location,
    id,
    accumulate
  );

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
  // changed. `null` on a cold error (which routes to the boundary, not context).
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
  const content = isBrowser() ? (
    <LoaderDataContext.Provider value={viewState}>
      <Envelope anchor={{ kind: 'none' }}>{children}</Envelope>
    </LoaderDataContext.Provider>
  ) : (
    <DataReader reader={reader} live={loaderRef.live}>
      {children}
    </DataReader>
  );

  let body: ComponentChildren;
  if (view.kind === 'coldError') {
    if (errorFallback != null) {
      // Local error UI. `reset` re-enters the loader (clears the error and
      // refetches), mirroring the old ErrorBoundary `reset` semantics.
      body =
        typeof errorFallback === 'function'
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
