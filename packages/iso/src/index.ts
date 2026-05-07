// Page declaration and the <Page> escape hatch.
export { Page } from './page.js';
export type { PageProps, WrapperProps } from './page.js';
export { definePage } from './define-page.js';
export type { PageBindings } from './define-page.js';

// Routing primitives. Router and lazy are direct re-exports of preact-iso;
// Route is our wrapper that adds the optional navigate="ssr" prop.
export { Router, lazy } from 'preact-iso';
export { Route } from './route.js';
export type { RouteProps } from './route.js';
export type { NavigateMode } from './navigator.js';

// Programmatic navigation that respects per-route SSR/SPA mode.
export { navigate } from './navigator.js';

// Hydration island used by SSR routes (also exported so advanced consumers
// can compose their own routing).
export { PageHost } from './page-host.js';
export type { PageHostProps } from './page-host.js';

// Server bindings.
export { defineLoader } from './define-loader.js';
export type {
  LoaderRef,
  LoaderCtx,
  Loader as LoaderFn,
} from './define-loader.js';
export { defineAction, useAction } from './action.js';
export type {
  ActionStub,
  UseActionOptions,
  UseActionResult,
  ActionGuardContext,
  ActionGuardFn,
} from './action.js';
export { ActionGuardError, defineActionGuard } from './action.js';

// Hooks.
export { useLoaderData } from './use-loader-data.js';
export { useReload } from './reload-context.js';
export { useOptimistic } from './optimistic.js';
export type { OptimisticHandle } from './optimistic.js';
export { useOptimisticAction } from './optimistic-action.js';
export type {
  UseOptimisticActionOptions,
  UseOptimisticActionResult,
} from './optimistic-action.js';

// Forms.
export { Form } from './form.js';

// Cache + invalidation.
export { createCache } from './cache.js';
export type { LoaderCache } from './cache.js';
export { cacheRegistry } from './cache-registry.js';

// Guards.
export { createGuard, GuardRedirect } from './guard.js';
export type { GuardFn, GuardResult, GuardContext } from './guard.js';

// Utilities.
export { prefetch } from './prefetch.js';
export { isBrowser, env } from './is-browser.js';
