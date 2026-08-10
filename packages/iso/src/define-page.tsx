import type { ComponentType, FunctionComponent, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import { Page, type WrapperProps } from './page.js';

export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
};

/**
 * Stamped onto the component `definePage` returns, so route registration can
 * tell a wrapped leaf view from a bare one and warn about the route error
 * boundary a bare view silently loses. A symbol, not a `displayName` string:
 * a string marker is one a user component could coincidentally carry.
 */
export const DEFINE_PAGE_MARKER = Symbol.for('hono-preact.definePage');

export type DefinePageComponent = FunctionComponent<RouteHook> & {
  [DEFINE_PAGE_MARKER]: true;
};

/**
 * True for a component `definePage` produced. A plain `in` check written as a
 * type predicate so narrowing carries through, matching `isLiveStreamFn`
 * (`define-loader.ts`).
 */
export function isDefinePageComponent(
  value: unknown
): value is DefinePageComponent {
  return typeof value === 'function' && DEFINE_PAGE_MARKER in value;
}

export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook> {
  const PageRoute: DefinePageComponent = Object.assign(
    () => (
      <Page Wrapper={bindings?.Wrapper} errorFallback={bindings?.errorFallback}>
        <Component />
      </Page>
    ),
    { [DEFINE_PAGE_MARKER]: true as const }
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
