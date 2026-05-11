import type { ComponentChildren, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import { Suspense } from 'preact/compat';
import { useCallback, useEffect, useId, useRef, useState } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';
import { ReloadContext } from '../reload-context.js';
import { getPreloadedData } from './preload.js';
import wrapPromise from './wrap-promise.js';
import { ActiveLoaderIdContext, LoaderDataContext, LoaderErrorContext, LoaderIdContext } from './contexts.js';
import type { LoaderRef } from '../define-loader.js';

type LoaderProps<T> = {
  loader: LoaderRef<T>;
  location: RouteHook;
  fallback?: JSX.Element;
  children: ComponentChildren;
};

export function Loader<T>({
  loader,
  location,
  fallback,
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
      >
        {children}
      </LoaderHost>
    </LoaderIdContext.Provider>
  );
}

type LoaderHostProps<T> = {
  loaderRef: LoaderRef<T>;
  location: RouteHook;
  id: string;
  fallback?: JSX.Element;
  children: ComponentChildren;
};

function LoaderHost<T>({
  loaderRef,
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

  const abortRef = useRef<AbortController | null>(null);

  function newAbortSignal(): AbortSignal {
    // Abort the previous controller (cancels any in-flight loader),
    // then allocate a fresh one whose signal is passed to the new fn call.
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    return abortRef.current.signal;
  }

  useEffect(
    () => () => {
      if (abortRef.current) abortRef.current.abort();
    },
    []
  );

  // True while either the initial Suspense fetch or an explicit reload is in
  // flight. Tracked via a ref so reload() can read it without recapturing on
  // every state change, and so the wrapPromise branch below can flip it
  // during render without scheduling an extra setState.
  const inFlightRef = useRef(false);
  const queuedReloadRef = useRef(false);
  const runReloadRef = useRef<() => void>(() => {});

  const runReload = useCallback(() => {
    inFlightRef.current = true;
    setReloading(true);
    setLoadError(null);
    // Cast to Promise<T>: Task 11 will add a runtime adapter for generators/streams.
    (fnRef.current({ location: locationRef.current, signal: newAbortSignal() }) as Promise<T>)
      .then((result) => {
        if (isBrowser()) loaderRef.cache.set(result);
        setOverrideData(result);
        setReloading(false);
        inFlightRef.current = false;
        if (queuedReloadRef.current) {
          queuedReloadRef.current = false;
          runReloadRef.current();
        }
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err : new Error(String(err)));
        setReloading(false);
        inFlightRef.current = false;
        queuedReloadRef.current = false;
      });
  }, [loaderRef]);
  runReloadRef.current = runReload;

  const reload = useCallback(() => {
    if (inFlightRef.current) {
      queuedReloadRef.current = true;
      return;
    }
    runReloadRef.current();
  }, []);

  // Stable reader: only rebuilt when location or loader identity changes.
  // Without this, every re-render (e.g. from setReloading) would call
  // wrapPromise(...) again, fire a duplicate XHR, and throw a fresh promise
  // into Suspense — unmounting the children and wiping any optimistic UI
  // state below.
  //
  // The location key includes path AND searchParams so /movies?genre=action →
  // /movies?genre=drama refetches even though preact-iso doesn't remount on
  // querystring changes.
  const readerRef = useRef<{ read: () => T } | null>(null);
  const locKey = serializeLocation(location);
  const prevLocKey = useRef(locKey);
  const prevLoaderId = useRef(loaderRef.__id);

  const locationChanged = prevLocKey.current !== locKey;
  const loaderChanged = prevLoaderId.current !== loaderRef.__id;

  if (readerRef.current === null || locationChanged || loaderChanged) {
    prevLocKey.current = locKey;
    prevLoaderId.current = loaderRef.__id;
    if (locationChanged || loaderChanged) setOverrideData(undefined);

    const preloaded = getPreloadedData<T>(id);
    const isFirstRender = readerRef.current === null;
    if (preloaded !== null) {
      loaderRef.cache.set(preloaded);
      readerRef.current = { read: () => preloaded };
    } else if (isBrowser() && isFirstRender && loaderRef.cache.has()) {
      const cached = loaderRef.cache.get()!;
      readerRef.current = { read: () => cached };
    } else {
      inFlightRef.current = true;
      const settle = () => {
        inFlightRef.current = false;
        if (queuedReloadRef.current) {
          queuedReloadRef.current = false;
          runReloadRef.current();
        }
      };
      // Cast to Promise<T>: Task 11 will add a runtime adapter for generators/streams.
      readerRef.current = wrapPromise(
        (loaderRef.fn({ location, signal: newAbortSignal() }) as Promise<T>)
          .then((r) => {
            if (isBrowser()) loaderRef.cache.set(r);
            settle();
            return r;
          })
          .catch((err: unknown) => {
            settle();
            throw err;
          })
      );
    }
  }

  return (
    <ActiveLoaderIdContext.Provider value={loaderRef.__id}>
      <ReloadContext.Provider value={{ reload, reloading }}>
        <LoaderErrorContext.Provider value={loadError}>
          <Suspense fallback={fallback}>
            <DataReader
              reader={readerRef.current}
              overrideData={overrideData}
            >
              {children}
            </DataReader>
          </Suspense>
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

function serializeLocation(loc: RouteHook): string {
  const sp = loc.searchParams ?? {};
  const sortedSearch = Object.keys(sp)
    .sort()
    .map((k) => `${k}=${sp[k]}`)
    .join('&');
  return `${loc.path}?${sortedSearch}`;
}
