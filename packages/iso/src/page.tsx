import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useId } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import type { LoaderCache } from './cache.js';
import type { GuardFn } from './guard.js';
import type { LoaderRef } from './define-loader.js';
import { Envelope } from './envelope.js';
import { Guards } from './guards.js';
import { Loader } from './loader.js';
import { RouteBoundary } from './route-boundary.js';

export type WrapperProps = {
  id: string;
  'data-loader': string;
  children: ComponentChildren;
};

const DefaultWrapper: FunctionComponent<WrapperProps> = (props) => (
  <section {...props} />
);

export type PageProps<T> = {
  loader?: LoaderRef<T>;
  location: RouteHook;
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
  fallback?: JSX.Element;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  Wrapper?: ComponentType<WrapperProps>;
  children: ComponentChildren;
};

export function Page<T>({
  loader,
  location,
  cache,
  serverGuards,
  clientGuards,
  fallback,
  errorFallback,
  Wrapper,
  children,
}: PageProps<T>): JSX.Element {
  const id = useId();
  return (
    <RouteBoundary fallback={fallback} errorFallback={errorFallback}>
      <Guards server={serverGuards} client={clientGuards} location={location}>
        {loader ? (
          <Loader
            loader={loader}
            location={location}
            cache={cache}
            fallback={fallback}
          >
            <Envelope as={Wrapper}>{children}</Envelope>
          </Loader>
        ) : (
          <NoLoaderFrame id={id} as={Wrapper}>
            {children}
          </NoLoaderFrame>
        )}
      </Guards>
    </RouteBoundary>
  );
}

const NoLoaderFrame: FunctionComponent<{
  id: string;
  as?: ComponentType<WrapperProps>;
  children: ComponentChildren;
}> = ({ id, as, children }) => {
  const W = as ?? DefaultWrapper;
  return (
    <W id={id} data-loader="null">
      {children}
    </W>
  );
};
