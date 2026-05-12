// Page declaration and the <Page> escape hatch.
export { Page } from './page.js';
export type { PageProps, WrapperProps } from './page.js';
export { definePage } from './define-page.js';
export type { PageBindings } from './define-page.js';

// Routing primitives — trivial re-exports of preact-iso. Listed here so
// consumers have a single import surface for everything they need.
export { Route, Router, lazy, useLocation, useRoute } from 'preact-iso';

// Declarative route tree.
export { defineRoutes, Routes } from './define-routes.js';
export type {
  RouteDef,
  RoutesManifest,
  FlatRoute,
  LayoutProps,
  ViewProps,
} from './define-routes.js';

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

// Guards.
export { createGuard, GuardRedirect } from './guard.js';
export type { GuardFn, GuardResult, GuardContext } from './guard.js';

// Utilities.
export { prefetch } from './prefetch.js';
export { isBrowser, env } from './is-browser.js';

// Client entry primitives (item 4 of v0.1).
export { useRouteChange } from './route-change.js';
export type { RouteChangeHandler } from './route-change.js';
export { ViewTransitions } from './view-transitions.js';
export { Head } from './head.js';
export type { HeadProps } from './head.js';
export { ClientScript } from './client-script.js';
