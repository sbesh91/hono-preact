import type { ComponentType, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import type { LoaderCache } from './cache.js';
import type { GuardFn } from './guard.js';
import type { LoaderRef } from './define-loader.js';
import { Page, type WrapperProps } from './page.js';

export type PageConfig<T> = {
  loader?: LoaderRef<T>;
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
  fallback?: JSX.Element;
  Wrapper?: ComponentType<WrapperProps>;
};

export function wrapWithPage<T>(
  Component: ComponentType,
  config: PageConfig<T>
): (location: RouteHook) => JSX.Element {
  return function PageRouteHandler(location: RouteHook) {
    return (
      <Page {...config} location={location}>
        <Component />
      </Page>
    );
  };
}
