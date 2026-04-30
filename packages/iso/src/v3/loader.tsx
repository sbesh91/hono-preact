import type { ComponentChildren, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import { Suspense } from 'preact/compat';
import { useCallback, useId, useRef, useState } from 'preact/hooks';
import type { LoaderCache } from '../cache.js';
import { isBrowser } from '../is-browser.js';
import { ReloadContext } from '../page.js';
import { getPreloadedData } from '../preload.js';
import wrapPromise from '../wrap-promise.js';
import { LoaderDataContext, LoaderIdContext } from './contexts.js';
import type { LoaderRef } from './define-loader.js';

type LoaderProps<T> = {
  loader: LoaderRef<T>;
  location: RouteHook;
  cache?: LoaderCache<T>;
  fallback?: JSX.Element;
  children: ComponentChildren;
};

export function Loader<T>({
  loader,
  location,
  cache,
  fallback,
  children,
}: LoaderProps<T>) {
  const id = useId();
  const effectiveCache = cache ?? loader.cache;

  return (
    <LoaderIdContext.Provider value={id}>
      <LoaderHost
        loaderRef={loader}
        cache={effectiveCache}
        location={location}
        id={id}
        fallback={fallback}
      >
        {children}
      </LoaderHost>
    </LoaderIdContext.Provider>
  );
}

type LoaderHostProps<T> = {
  loaderRef: LoaderRef<T>;
  cache?: LoaderCache<T>;
  location: RouteHook;
  id: string;
  fallback?: JSX.Element;
  children: ComponentChildren;
};

function LoaderHost<T>({
  loaderRef,
  cache,
  location,
  id,
  fallback,
  children,
}: LoaderHostProps<T>) {
  const [reloading, setReloading] = useState(false);
  const [overrideData, setOverrideData] = useState<T | undefined>(undefined);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const fnRef = useRef(loaderRef.fn);
  fnRef.current = loaderRef.fn;
  const locationRef = useRef(location);
  locationRef.current = location;

  const reload = useCallback(() => {
    if (reloading) return;
    setReloading(true);
    setLoadError(null);
    fnRef
      .current({ location: locationRef.current })
      .then((result) => {
        if (isBrowser()) cache?.set(result);
        setOverrideData(result);
        setReloading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err : new Error(String(err)));
        setReloading(false);
      });
  }, [reloading, cache]);

  // Stable reader: only rebuilt when path or loader identity changes. Without
  // this, every re-render (e.g. from setReloading) would call wrapPromise(...)
  // again, fire a duplicate XHR, and throw a fresh promise into Suspense —
  // unmounting the children and wiping any optimistic UI state below.
  const readerRef = useRef<{ read: () => T } | null>(null);
  const prevPath = useRef(location.path);
  const prevLoaderId = useRef(loaderRef.__id);

  const pathChanged = prevPath.current !== location.path;
  const loaderChanged = prevLoaderId.current !== loaderRef.__id;

  if (readerRef.current === null || pathChanged || loaderChanged) {
    prevPath.current = location.path;
    prevLoaderId.current = loaderRef.__id;
    if (pathChanged || loaderChanged) setOverrideData(undefined);

    const preloaded = getPreloadedData<T>(id);
    if (preloaded !== null) {
      cache?.set(preloaded);
      readerRef.current = { read: () => preloaded };
    } else if (isBrowser() && cache?.has()) {
      const cached = cache.get()!;
      readerRef.current = { read: () => cached };
    } else {
      readerRef.current = wrapPromise(
        loaderRef.fn({ location }).then((r) => {
          if (isBrowser()) cache?.set(r);
          return r;
        })
      );
    }
  }

  return (
    <ReloadContext.Provider value={{ reload, reloading, error: loadError }}>
      <Suspense fallback={fallback}>
        <DataReader
          refId={loaderRef.__id}
          reader={readerRef.current}
          overrideData={overrideData}
        >
          {children}
        </DataReader>
      </Suspense>
    </ReloadContext.Provider>
  );
}

type DataReaderProps<T> = {
  refId: symbol;
  reader: { read: () => T };
  overrideData?: T;
  children: ComponentChildren;
};

function DataReader<T>({
  refId,
  reader,
  overrideData,
  children,
}: DataReaderProps<T>) {
  const data = overrideData !== undefined ? overrideData : reader.read();
  return (
    <LoaderDataContext.Provider value={{ refId, data }}>
      {children}
    </LoaderDataContext.Provider>
  );
}
