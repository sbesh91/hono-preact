import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import type { RouteHook } from 'preact-iso';
import { Suspense } from 'preact/compat';
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
import { isBrowser } from '../is-browser.js';
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
  fallback,
  errorFallback,
  accumulate,
  children,
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

  const { reader, overrideData, error, reload, reloading, status } =
    useLoaderRunner<T>(loaderRef, location, id, accumulate);

  // A `live` loader never runs on the server (its infinite generator would hang
  // renderToStringAsync). Render the fallback directly on SSR; the client
  // renders the same fallback while suspended on the first chunk, so the SSR DOM
  // is adopted on hydration (the same Suspense + useId machinery a data loader
  // hydrates through, seeded with a fallback instead of server data).
  const liveServer = loaderRef.live && !isBrowser();

  // Anchor a streaming consumer's fallback under the same `useId` element the
  // resolved content uses (an `Envelope`-shaped `<section id>`), so the SSR
  // fallback DOM is ADOPTED on hydration rather than orphaned inside a lazy
  // layout (which would leave two overlapping bars and a duplicate
  // view-transition-name). The `Envelope` itself can't wrap the fallback (it
  // requires LoaderDataContext), so mirror its anchor shape directly.
  const fallbackContent = accumulate ? (
    <section id={id} data-loader="null">
      {fallback}
    </section>
  ) : (
    fallback
  );

  const suspenseContent = liveServer ? (
    <Suspense fallback={fallbackContent}>{fallbackContent}</Suspense>
  ) : (
    <Suspense fallback={fallbackContent}>
      <DataReader reader={reader} overrideData={overrideData}>
        <Envelope>{children}</Envelope>
      </DataReader>
    </Suspense>
  );

  return (
    <LoaderIdContext.Provider value={id}>
      <ActiveLoaderIdContext.Provider value={loaderRef.__id}>
        <ReloadContext.Provider value={{ reload, reloading }}>
          <LoaderErrorContext.Provider value={error}>
            <LoaderStatusContext.Provider value={status}>
              {errorFallback != null ? (
                <ErrorBoundary fallback={errorFallback}>
                  {suspenseContent}
                </ErrorBoundary>
              ) : (
                suspenseContent
              )}
            </LoaderStatusContext.Provider>
          </LoaderErrorContext.Provider>
        </ReloadContext.Provider>
      </ActiveLoaderIdContext.Provider>
    </LoaderIdContext.Provider>
  );
}

// Public name consumed by define-loader.ts and user code.
export { LoaderHost as Loader };

type DataReaderProps<T> = {
  reader: { read: () => T };
  overrideData?: T;
  children: ComponentChildren;
};

function DataReader<T>({ reader, overrideData, children }: DataReaderProps<T>) {
  const data = overrideData !== undefined ? overrideData : reader.read();
  return (
    <LoaderDataContext.Provider value={{ data }}>
      {children}
    </LoaderDataContext.Provider>
  );
}
