import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import type { RouteHook } from 'preact-iso';
import { useContext, useId, useMemo } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';
import { toLoaderState, toStreamState } from '../loader-state.js';
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
  type StreamStatus,
} from './use-loader-runner.js';
export { serializeLocationForCache } from './cache-key.js';

/** Streaming status for a `.View` consuming a streaming/`live` loader. */
export const LoaderStatusContext = createContext<StreamStatus>('connecting');

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
  accumulate,
  children,
}: {
  reader: { read: () => T };
  accumulate?: AccumulateOptions;
  children: ComponentChildren;
}) {
  const raw = reader.read();
  // Project to the same public union the client carries on context. The server
  // render is always settled (the reader awaited the value): a non-live loader
  // is `success`; a live loader's stub resolves to `undefined`, which projects
  // to `connecting` (the client reconnects on mount).
  const state = accumulate
    ? toStreamState(raw, 'connecting', null)
    : toLoaderState(raw, null, true, false);
  // Live loaders never run on the server; their reader resolves to undefined.
  // The client reconnects on mount, so there is no baked server value to
  // anchor. Non-live loaders resolve and bake their value into data-loader.
  const anchor: HydrationAnchor = accumulate
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
  const location = (locationProp ?? ctxLocation) as RouteHook | undefined;
  if (!location) {
    throw new Error(
      `Loader for module '${loaderRef.__moduleKey ?? '<unkeyed>'}' has no location: ` +
        `wrap the page in a route whose server module includes this loader's .server.ts file, or pass location explicitly.`
    );
  }

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
  const { data, reloading, settled, error, reload, status, reader } =
    useLoaderRunner<T>(loaderRef, location, id, accumulate);

  // Project the runner's authoritative state into the public union ONCE, here,
  // and carry it on `LoaderDataContext` (review #6). `ViewRenderer` and
  // `useData()` READ this union; they never re-project. Memoized on the runner's
  // fields so the value is referentially stable across re-renders that do not
  // change the loader state, keeping `useData()` consumers stable (review #7).
  const viewState = useMemo(
    () =>
      accumulate
        ? toStreamState(data, status, error)
        : toLoaderState(data, error, settled, reloading),
    [accumulate, data, status, error, settled, reloading]
  );

  // A COLD error: a SINGLE-VALUE load that failed before any value settled. The
  // old Suspense path threw the reader so an error boundary caught it; the state
  // path surfaces the error without throwing, so reproduce that propagation
  // explicitly. Keyed on `!settled` (no settled value), not `data === undefined`,
  // so a real resolve-to-`undefined` is not mistaken for a cold failure. A
  // POST-settle error (a value exists) is NOT cold: keep the last-good content
  // visible and let the render fn read the error via the union's `error` arm /
  // `useError()` (stale-while-error). Streaming (`accumulate`) cold errors are
  // NOT routed here; they surface in-view via the `StreamState.error` arm.
  //
  // Server-only: `coldError` is always false on the first (and only) server
  // render of `LoaderHost`, because runner state has not updated yet. A cold
  // failure on the server surfaces by `reader.read()` rethrowing the rejection
  // from inside `DataReader`, which the `ErrorBoundary` wrap below (or an outer
  // page boundary) catches, mirroring the client's `throw error` propagation.
  const coldError = !accumulate && error != null && !settled;

  // SERVER (`!isBrowser()`): suspend on the stable reader from a SEPARATE child
  // so render-to-string awaits the loader and bakes the resolved value. CLIENT:
  // render the view directly from runner state (never calls `reader.read()`).
  const content = isBrowser() ? (
    <LoaderDataContext.Provider value={viewState}>
      <Envelope anchor={{ kind: 'none' }}>{children}</Envelope>
    </LoaderDataContext.Provider>
  ) : (
    <DataReader reader={reader} accumulate={accumulate}>
      {children}
    </DataReader>
  );

  let body: ComponentChildren;
  if (coldError) {
    if (errorFallback != null) {
      // Local error UI. `reset` re-enters the loader (clears the error and
      // refetches), mirroring the old ErrorBoundary `reset` semantics.
      body =
        typeof errorFallback === 'function'
          ? errorFallback(error, reload)
          : errorFallback;
    } else {
      // No local handler: re-throw so an OUTER boundary (a page-level
      // `errorFallback` / `RouteBoundary`) catches it, exactly as the thrown
      // Suspense reader propagated up the tree before.
      throw error;
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
            <LoaderStatusContext.Provider value={status}>
              {body}
            </LoaderStatusContext.Provider>
          </LoaderErrorContext.Provider>
        </ReloadContext.Provider>
      </ActiveLoaderIdContext.Provider>
    </LoaderIdContext.Provider>
  );
}

// Public name consumed by define-loader.ts and user code.
export { LoaderHost as Loader };
