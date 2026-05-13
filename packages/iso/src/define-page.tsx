import type { ComponentType, FunctionComponent, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import type { GuardFn } from './guard.js';
import { Page, type WrapperProps } from './page.js';

export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
};

/**
 * Wrap a page component with its per-page bindings (guards, error boundary,
 * optional Wrapper) and return a routable component that self-wraps in `<Page>`.
 *
 * The output is a function `(location: RouteHook) => JSX.Element` that
 * `preact-iso`'s `<Route component={...}>` calls directly. No marker symbols,
 * no introspection, no custom router required.
 *
 * Data loading is owned by individual `loader.View()` / `loader.Boundary`
 * components placed inside the page, not by the page itself.
 */
export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = (location) => (
    <Page
      Wrapper={bindings?.Wrapper}
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
