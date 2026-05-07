import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useContext, useId } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import type { LoaderCache } from './cache.js';
import type { GuardFn } from './guard.js';
import type { LoaderRef } from './define-loader.js';
import { Envelope } from './envelope.js';
import { Guards } from './guards.js';
import { Loader } from './loader.js';
import { RouteBoundary } from './route-boundary.js';
import { FragmentModeContext } from './fragment-mode.js';

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      'hp-page-fragment': { children?: ComponentChildren };
    }
  }
}

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
  const isFragment = useContext(FragmentModeContext);

  const tree = (
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

  if (isFragment) {
    // Custom element name (must contain a dash) renders as-is in HTML.
    // renderPage extracts content between these markers in fragment mode.
    return <hp-page-fragment>{tree}</hp-page-fragment> as unknown as JSX.Element;
  }
  return tree;
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
