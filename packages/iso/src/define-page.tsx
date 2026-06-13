import type { ComponentType, FunctionComponent, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import { Page, type WrapperProps } from './page.js';

export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
};

export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = () => (
    <Page Wrapper={bindings?.Wrapper} errorFallback={bindings?.errorFallback}>
      <Component />
    </Page>
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
