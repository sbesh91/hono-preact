import type { ComponentType, FunctionComponent, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import type { GuardFn } from './guard.js';
import type { PageUse } from './internal/use-types.js';
import { Page, type WrapperProps } from './page.js';

export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  guards?: GuardFn[];
  /**
   * Page-scope middleware and stream observers. Replaces `guards` in a later
   * task (Phase 8 demolition). For now both fields are accepted; only
   * `guards` is wired to the runtime.
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
      guards={bindings?.guards}
      use={bindings?.use}
      location={location}
    >
      <Component />
    </Page>
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
