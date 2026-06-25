import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import type { RouteHook } from 'preact-iso';
import { useContext, useId } from 'preact/hooks';
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
import {
  useLoaderRunner,
  type AccumulateOptions,
  type StreamStatus,
} from './use-loader-runner.js';
export { serializeLocationForCache } from './cache-key.js';

/** Streaming status for a `.View` consuming a streaming/`live` loader. */
export const LoaderStatusContext = createContext<StreamStatus>('connecting');

type LoaderHostProps<T> = {
  loader: LoaderRef<T, boolean>;
  location?: RouteHook;
  fallback?: ComponentChildren;
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

  // State-based rendering: the runner exposes `data`/`loading` directly, so we
  // render the `.View` render fn (the children) immediately rather than
  // suspending on a throwing reader. Because nothing suspends, the SSR render
  // and the initial client hydration take the SAME branch (no Suspense fallback
  // swapped in/out), which keeps the markup identical across the boundary and
  // lets Preact adopt the server DOM cleanly on hydration.
  const { data, loading, error, reload, status } = useLoaderRunner<T>(
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
  const coldError = error != null && data === undefined;

  const content = (
    <LoaderDataContext.Provider value={{ data: viewData, loading }}>
      <Envelope>{children}</Envelope>
    </LoaderDataContext.Provider>
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
        <ReloadContext.Provider value={{ reload }}>
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
