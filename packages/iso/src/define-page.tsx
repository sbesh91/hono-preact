import type { ComponentType, FunctionComponent, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import type { PageUse } from './internal/use-types.js';
import { Page, type WrapperProps } from './page.js';

export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  /**
   * Page-scope middleware and stream observers. The dispatcher partitions
   * server vs client members by their `runs` tag, so mixed arrays of
   * defineServerMiddleware + defineClientMiddleware work as one list.
   */
  use?: PageUse;
};

export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = (location) => (
    <Page
      Wrapper={bindings?.Wrapper}
      errorFallback={bindings?.errorFallback}
      use={bindings?.use}
      location={location}
    >
      <Component />
    </Page>
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
