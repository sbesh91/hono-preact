import {
  createContext,
  type ComponentType,
  type FunctionComponent,
  type JSX,
} from 'preact';
import { type RouteHook } from 'preact-iso';
import { memo, Suspense } from 'preact/compat';
import { useContext, useId } from 'preact/hooks';
import { type LoaderCache } from './cache.js';
import { type GuardFn } from './guard.js';
import { GuardGate } from './guard-gate.js';
import { isBrowser } from './is-browser.js';
import { type Loader, type LoaderData } from './loader.js';
import { LoaderDataContext } from './loader-data-context.js';
import { useGuardSuspender, type GuardSuspender } from './use-guards.js';
import { useLoaderState, type LoaderSuspender } from './use-loader.js';

type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
  error: Error | null;
};

export const ReloadContext = createContext<ReloadContextValue | undefined>(
  undefined
);

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
  children: JSX.Element | JSX.Element[] | string | null;
};

const DefaultWrapper: FunctionComponent<WrapperProps> = (props) => (
  <section {...props} />
);

type PageProps<T> = {
  Child: FunctionComponent<LoaderData<T>>;
  serverLoader?: Loader<T>;
  location: RouteHook;
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
  fallback?: JSX.Element;
  Wrapper?: ComponentType<WrapperProps>;
};

const defaultLoader: Loader<Record<string, unknown>> = async () => ({});

export const Page = memo(function <T extends Record<string, unknown>>({
  Child,
  serverLoader,
  location,
  cache,
  serverGuards = [],
  clientGuards = [],
  fallback,
  Wrapper,
}: PageProps<T>) {
  const id = useId();
  const guards = isBrowser() ? clientGuards : serverGuards;
  const loader = (serverLoader ?? defaultLoader) as Loader<T>;

  // These hooks live outside the Suspense boundaries below. Their refs/state
  // persist across re-mounts of the suspending children.
  const guardSuspender = useGuardSuspender(guards, location);
  const { suspender: loaderSuspender, reload, reloading, error } =
    useLoaderState<T>(loader, { id, cache, location });

  return (
    <ReloadContext.Provider value={{ reload, reloading, error }}>
      <Suspense fallback={fallback}>
        <GuardBoundary guardSuspender={guardSuspender}>
          <Suspense fallback={fallback}>
            <LoaderBoundary
              id={id}
              Child={Child}
              suspender={loaderSuspender}
              Wrapper={Wrapper}
            />
          </Suspense>
        </GuardBoundary>
      </Suspense>
    </ReloadContext.Provider>
  );
});

type GuardBoundaryProps = {
  guardSuspender: GuardSuspender;
  children: JSX.Element | JSX.Element[];
};

const GuardBoundary = memo(function ({
  guardSuspender,
  children,
}: GuardBoundaryProps) {
  const result = guardSuspender.read() ?? null;
  return <GuardGate result={result}>{children}</GuardGate>;
});

type LoaderBoundaryProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  suspender: LoaderSuspender<T>;
  Wrapper?: ComponentType<WrapperProps>;
};

const LoaderBoundary = memo(function <T>({
  id,
  Child,
  suspender,
  Wrapper,
}: LoaderBoundaryProps<T>) {
  const data = suspender.read();
  return (
    <LoaderDataContext.Provider value={data}>
      <Helper id={id} Child={Child} data={data} Wrapper={Wrapper} />
    </LoaderDataContext.Provider>
  );
});

type HelperProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  data: T;
  Wrapper?: ComponentType<WrapperProps>;
};

export const Helper = memo(function <T>({
  id,
  Child,
  data,
  Wrapper = DefaultWrapper,
}: HelperProps<T>) {
  const stringified = !isBrowser() ? JSON.stringify(data) : 'null';

  return (
    <Wrapper id={id} data-loader={stringified}>
      <Child loaderData={data} id={id} />
    </Wrapper>
  );
});
