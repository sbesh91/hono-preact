import type { ComponentType, FunctionComponent, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import type { LoaderRef } from './define-loader.js';
import type { LoaderCache } from './cache.js';
import type { GuardFn } from './guard.js';
import { Page, type WrapperProps } from './page.js';

export type PageBindings<T> = {
  loader?: LoaderRef<T>;
  cache?: LoaderCache<T>;
  Wrapper?: ComponentType<WrapperProps>;
  fallback?: JSX.Element;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
};

/**
 * Wrap a page component with its per-page bindings (loader, cache, fallback,
 * guards, etc.) and return a routable component that self-wraps in `<Page>`.
 *
 * The output is a function `(location: RouteHook) => JSX.Element` that
 * `preact-iso`'s `<Route component={...}>` calls directly. No marker symbols,
 * no introspection, no custom router required.
 */
export function definePage<T>(
  Component: ComponentType,
  bindings?: PageBindings<T>
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = (location) => (
    <Page<T>
      loader={bindings?.loader}
      cache={bindings?.cache}
      Wrapper={bindings?.Wrapper}
      fallback={bindings?.fallback}
      errorFallback={bindings?.errorFallback}
      serverGuards={bindings?.serverGuards}
      clientGuards={bindings?.clientGuards}
      location={location}
    >
      <Component />
    </Page>
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
