import type { ComponentChildren } from 'preact';
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
import { useLoaderRunner } from './use-loader-runner.js';
import { DelayedFallback, DEFAULT_FALLBACK_DELAY_MS } from './delayed-fallback.js';
export { serializeLocationForCache } from './cache-key.js';

type LoaderHostProps<T> = {
  loader: LoaderRef<T>;
  location?: RouteHook;
  fallback?: ComponentChildren;
  errorFallback?:
    | ComponentChildren
    | ((err: Error, reset: () => void) => ComponentChildren);
  children: ComponentChildren;
};

export function LoaderHost<T>({
  loader: loaderRef,
  location: locationProp,
  fallback,
  errorFallback,
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

  const { reader, overrideData, error, reload, reloading } = useLoaderRunner<T>(
    loaderRef,
    location,
    id
  );

  const fallbackDelay = loaderRef.fallbackDelay ?? DEFAULT_FALLBACK_DELAY_MS;
  const wrappedFallback =
    fallback == null ? (
      fallback
    ) : (
      <DelayedFallback delay={fallbackDelay}>{fallback}</DelayedFallback>
    );

  const suspenseContent = (
    <Suspense fallback={wrappedFallback}>
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
            {errorFallback != null ? (
              <ErrorBoundary fallback={errorFallback}>
                {suspenseContent}
              </ErrorBoundary>
            ) : (
              suspenseContent
            )}
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
