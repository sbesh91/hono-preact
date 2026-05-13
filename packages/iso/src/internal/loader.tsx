import type { ComponentChildren, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import { Suspense } from 'preact/compat';
import { useContext, useId } from 'preact/hooks';
import { ReloadContext } from '../reload-context.js';
import { ActiveLoaderIdContext, LoaderDataContext, LoaderErrorContext, LoaderIdContext } from './contexts.js';
import type { LoaderRef } from '../define-loader.js';
import { RouteLocationsContext } from './route-locations.js';
import { ErrorBoundary } from './route-boundary.js';
import { useLoaderRunner } from './use-loader-runner.js';
export { serializeLocationForCache } from './cache-key.js';

type LoaderProps<T> = {
  loader: LoaderRef<T>;
  location: RouteHook;
  fallback?: JSX.Element;
  errorFallback?: ComponentChildren | ((err: Error, reset: () => void) => ComponentChildren);
  children: ComponentChildren;
};

export function Loader<T>({
  loader,
  location,
  fallback,
  errorFallback,
  children,
}: LoaderProps<T>) {
  const id = useId();
  return (
    <LoaderIdContext.Provider value={id}>
      <LoaderHost
        loaderRef={loader}
        location={location}
        id={id}
        fallback={fallback}
        errorFallback={errorFallback}
      >
        {children}
      </LoaderHost>
    </LoaderIdContext.Provider>
  );
}

type LoaderHostProps<T> = {
  loaderRef: LoaderRef<T>;
  location?: RouteHook;
  id: string;
  fallback?: JSX.Element;
  errorFallback?: ComponentChildren | ((err: Error, reset: () => void) => ComponentChildren);
  children: ComponentChildren;
};

function LoaderHost<T>({
  loaderRef,
  location: locationProp,
  id,
  fallback,
  errorFallback,
  children,
}: LoaderHostProps<T>) {
  const locMap = useContext(RouteLocationsContext);
  const ctxLocation = loaderRef.__moduleKey ? locMap?.get(loaderRef.__moduleKey) : undefined;
  const location = (locationProp ?? ctxLocation) as RouteHook | undefined;
  if (!location) {
    throw new Error(
      `Loader for module '${loaderRef.__moduleKey ?? '<unkeyed>'}' has no location: ` +
      `wrap the page in a route that owns this server module, or pass location explicitly.`
    );
  }

  const { reader, overrideData, error, reload, reloading } = useLoaderRunner<T>(loaderRef, location, id);

  const suspenseContent = (
    <Suspense fallback={fallback}>
      <DataReader reader={reader} overrideData={overrideData}>
        {children}
      </DataReader>
    </Suspense>
  );

  return (
    <ActiveLoaderIdContext.Provider value={loaderRef.__id}>
      <ReloadContext.Provider value={{ reload, reloading }}>
        <LoaderErrorContext.Provider value={error}>
          {errorFallback != null ? (
            <ErrorBoundary fallback={errorFallback as any}>
              {suspenseContent}
            </ErrorBoundary>
          ) : suspenseContent}
        </LoaderErrorContext.Provider>
      </ReloadContext.Provider>
    </ActiveLoaderIdContext.Provider>
  );
}

type DataReaderProps<T> = {
  reader: { read: () => T };
  overrideData?: T;
  children: ComponentChildren;
};

function DataReader<T>({
  reader,
  overrideData,
  children,
}: DataReaderProps<T>) {
  const data = overrideData !== undefined ? overrideData : reader.read();
  return (
    <LoaderDataContext.Provider value={{ data }}>
      {children}
    </LoaderDataContext.Provider>
  );
}

