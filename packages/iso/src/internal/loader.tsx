import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import type { RouteHook } from 'preact-iso';
import { useContext, useId } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';
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
  // Live loaders never run on the server; their reader resolves to undefined.
  // The client reconnects on mount, so there is no baked server value to
  // anchor. Non-live loaders resolve and bake their value into data-loader.
  const anchor: HydrationAnchor = accumulate
    ? { kind: 'none' }
    : { kind: 'data', value: raw };
  return (
    <LoaderDataContext.Provider value={{ data: raw, loading: false }}>
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
  const { data, loading, error, reload, status, reader } = useLoaderRunner<T>(
    loaderRef,
    location,
    id,
    accumulate
  );

  // For an accumulating (`live`) consumer the render fn always expects a valid
  // accumulator, so during the connecting window (before the first chunk, and on
  // SSR where a live loader never runs) surface `accumulate.initial` rather than
  // the runner's `undefined`. A non-accumulate loader surfaces `undefined` while
  // it is loading, which the render fn reads alongside `loading === true`.
  const viewData =
    accumulate && data === undefined ? (accumulate.initial as T) : data;

  // A COLD error: the load failed before any data arrived (`data` is the RAW
  // runner value, undefined here). The old Suspense path threw the reader so an
  // error boundary caught it; the state path surfaces the error without throwing,
  // so reproduce that propagation explicitly. A POST-first-chunk error (`data`
  // present) is NOT cold: keep the last-good content visible and let the render
  // fn read the error via `useError()`/`status === 'error'` (stale-while-error).
  //
  // Server-only: `coldError` is always false on the first (and only) server
  // render of `LoaderHost`, because runner state has not updated yet. A cold
  // failure on the server surfaces by `reader.read()` rethrowing the rejection
  // from inside `DataReader`, which the `ErrorBoundary` wrap below (or an outer
  // page boundary) catches, mirroring the client's `throw error` propagation.
  const coldError = error != null && data === undefined;

  // SERVER (`!isBrowser()`): suspend on the stable reader from a SEPARATE child
  // so render-to-string awaits the loader and bakes the resolved value. CLIENT:
  // render the view directly from runner state (never calls `reader.read()`).
  const content = isBrowser() ? (
    <LoaderDataContext.Provider value={{ data: viewData, loading }}>
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
        <ReloadContext.Provider value={{ reload, reloading: loading }}>
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
