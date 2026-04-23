import {
  createContext,
  type ComponentChildren,
  type ComponentType,
  type FunctionComponent,
  type JSX,
} from 'preact';
import { RouteHook, useLocation } from 'preact-iso';
import { memo, Suspense } from 'preact/compat';
import { useCallback, useContext, useId, useRef, useState } from 'preact/hooks';
import { type LoaderCache } from './cache';
import { type GuardFn, GuardRedirect, runGuards } from './guard.js';
import { isBrowser } from './is-browser';
import { Loader, LoaderData } from './loader';
import { getPreloadedData } from './preload';
import wrapPromise from './wrap-promise';

type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
};

const ReloadContext = createContext<ReloadContextValue | undefined>(undefined);

export function useReload(): ReloadContextValue {
  const ctx = useContext(ReloadContext);
  if (!ctx)
    throw new Error(
      'useReload must be called inside a component rendered by getLoaderData'
    );
  return ctx;
}

export type WrapperProps = {
  id: string;
  'data-loader': string;
  'data-page': boolean;
  children: ComponentChildren;
};

const DefaultWrapper: FunctionComponent<WrapperProps> = (props) => (
  <section {...props} />
);

type PageProps<T> = {
  Child: FunctionComponent<LoaderData<T>>;
  serverLoader?: Loader<T>;
  clientLoader?: Loader<T>;
  location: RouteHook;
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
  fallback?: JSX.Element;
  Wrapper?: ComponentType<WrapperProps>;
};

export const Page = memo(function <T extends {}>({
  Child,
  serverLoader,
  clientLoader,
  location,
  cache,
  serverGuards = [],
  clientGuards = [],
  fallback,
  Wrapper,
}: PageProps<T>) {
  const id = useId();
  const guards = isBrowser() ? clientGuards : serverGuards;
  const prevGuardPath = useRef(location.path);
  const guardRef = useRef(wrapPromise(runGuards(guards, { location })));

  if (prevGuardPath.current !== location.path) {
    prevGuardPath.current = location.path;
    guardRef.current = wrapPromise(runGuards(guards, { location }));
  }

  return (
    <Suspense fallback={fallback}>
      <GuardedPage
        id={id}
        Child={Child}
        serverLoader={serverLoader}
        clientLoader={clientLoader}
        location={location}
        cache={cache}
        guardRef={guardRef}
        fallback={fallback}
        Wrapper={Wrapper}
      />
    </Suspense>
  );
});

type GuardedPageProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  serverLoader?: Loader<T>;
  clientLoader?: Loader<T>;
  location: RouteHook;
  cache?: LoaderCache<T>;
  guardRef: { current: { read: () => import('./guard.js').GuardResult } };
  fallback?: JSX.Element;
  Wrapper?: ComponentType<WrapperProps>;
};

const GuardedPage = memo(function <T extends {}>({
  id,
  Child,
  serverLoader = async () => ({}) as T,
  clientLoader = serverLoader,
  location,
  cache,
  guardRef,
  fallback,
  Wrapper,
}: GuardedPageProps<T>) {
  const { route } = useLocation();
  const [reloading, setReloading] = useState(false);
  const [overrideData, setOverrideData] = useState<T | undefined>(undefined);

  const prevPath = useRef(location.path);
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    setOverrideData(undefined);
  }

  const reload = useCallback(() => {
    if (reloading) return;
    setReloading(true);
    clientLoader({ location })
      .then((result) => {
        setOverrideData(result);
        setReloading(false);
      })
      .catch(() => {
        setReloading(false);
      });
  }, [reloading, clientLoader, location]);

  const guardResult = guardRef.current.read();

  if (guardResult && 'redirect' in guardResult) {
    if (isBrowser()) {
      route(guardResult.redirect);
      return null;
    } else {
      throw new GuardRedirect(guardResult.redirect);
    }
  }

  if (guardResult && 'render' in guardResult) {
    const Fallback = guardResult.render;
    return <Fallback />;
  }

  const preloaded = getPreloadedData<T>(id);

  if (preloaded !== null) {
    cache?.set(preloaded);
    return (
      <ReloadContext.Provider value={{ reload, reloading }}>
        <Helper
          id={id}
          Child={Child}
          loader={{ read: () => preloaded }}
          overrideData={overrideData}
          Wrapper={Wrapper}
        />
      </ReloadContext.Provider>
    );
  }

  if (isBrowser() && cache?.has()) {
    const cached = cache.get()!;
    return (
      <ReloadContext.Provider value={{ reload, reloading }}>
        <Helper
          id={id}
          Child={Child}
          loader={{ read: () => cached }}
          overrideData={overrideData}
          Wrapper={Wrapper}
        />
      </ReloadContext.Provider>
    );
  }

  const loaderRef = wrapPromise(
    isBrowser()
      ? clientLoader({ location }).then((r) => {
          cache?.set(r);
          return r;
        })
      : serverLoader({ location })
  );

  return (
    <ReloadContext.Provider value={{ reload, reloading }}>
      <Suspense fallback={fallback}>
        <Helper
          id={id}
          Child={Child}
          loader={loaderRef}
          overrideData={overrideData}
          Wrapper={Wrapper}
        />
      </Suspense>
    </ReloadContext.Provider>
  );
});

type HelperProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  loader: { read: () => T };
  overrideData?: T;
  Wrapper?: ComponentType<WrapperProps>;
};
export const Helper = memo(function <T>({
  id,
  Child,
  loader,
  overrideData,
  Wrapper = DefaultWrapper,
}: HelperProps<T>) {
  const loaderData = overrideData !== undefined ? overrideData : loader.read();
  const stringified = !isBrowser() ? JSON.stringify(loaderData) : '{}';

  return (
    <Wrapper id={id} data-loader={stringified} data-page>
      <Child loaderData={loaderData} id={id} />
    </Wrapper>
  );
});
