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
  ServerRoute,
  LayoutProps,
  ViewProps,
} from './define-routes.js';

// Content-glob route helper.
export { contentRoutes } from './content-routes.js';
export type { ContentRoutesOptions } from './content-routes.js';

// Typed route params.
export type {
  RouteParams,
  RoutePaths,
  RegisteredRoutes,
} from './internal/typed-routes.js';

// Server bindings.
export { defineLoader } from './define-loader.js';
export type {
  LoaderRef,
  LoaderCtx,
  Loader as LoaderFn,
  StreamStatus,
  UseStreamOptions,
  UseStreamResult,
} from './define-loader.js';
export { serverRoute } from './server-route.js';
export type { RouteServer } from './server-route.js';
export { defineAction, useAction, TimeoutError } from './action.js';
export type {
  ActionStub,
  UseActionOptions,
  UseActionResult,
  MutateResult,
} from './action.js';
export type { ContentfulStatusCode } from 'hono/utils/http-status';

// Hooks.
export { useReload } from './reload-context.js';
export { useOptimistic } from './optimistic.js';
export type { OptimisticHandle, UseOptimisticOptions } from './optimistic.js';
export { useOptimisticAction } from './optimistic-action.js';
export type {
  UseOptimisticActionOptions,
  UseOptimisticActionResult,
} from './optimistic-action.js';
export { useNavigate, type NavigateOptions } from './use-navigate.js';
export { useParams } from './use-params.js';

// Active-route detection.
export {
  useRouteMatch,
  useRouteActive,
  type RouteMatchOptions,
} from './route-active.js';
export { NavLink, type NavLinkProps } from './nav-link.js';
export { buildPath } from './build-path.js';

// Forms.
export { Form } from './form.js';
export { useActionResult, type ActionResult } from './use-action-result.js';
export {
  ActionResultContext,
  type ActionResultContextValue,
} from './action-result-context.js';
export { useFormStatus, type FormStatus } from './use-form-status.js';

// Cache + invalidation.
export { createCache } from './cache.js';
export type { LoaderCache } from './cache.js';

// Middleware + outcomes (the new system).
export {
  defineServerMiddleware,
  defineClientMiddleware,
} from './define-middleware.js';
export type {
  ServerMiddleware,
  ClientMiddleware,
  Middleware,
  ServerBaseCtx,
  ServerPageCtx,
  ServerLoaderCtx,
  ServerActionCtx,
  ServerCtx,
  ClientPageCtx,
  Scope,
  Next,
} from './define-middleware.js';

export { defineStreamObserver } from './define-stream-observer.js';
export type {
  StreamObserver,
  ServerStreamCtx,
} from './define-stream-observer.js';

export { defineApp } from './define-app.js';
export type { AppConfig, AppUseElement } from './define-app.js';

export {
  redirect,
  deny,
  timeoutOutcome,
  isOutcome,
  isRedirect,
  isDeny,
  isRender,
  isTimeout,
} from './outcomes.js';
export type {
  Outcome,
  RedirectOutcome,
  DenyOutcome,
  RenderOutcome,
  TimeoutOutcome,
  RedirectStatusCode,
  ErrorStatusCode,
} from './outcomes.js';

// Utilities.
export { prefetch } from './prefetch.js';
export { usePrefetch } from './use-prefetch.js';
export { isBrowser } from './is-browser.js';

// Client entry primitives (item 4 of v0.1).
export { Head } from './head.js';
export type { HeadProps } from './head.js';
export { ClientScript } from './client-script.js';

// View transition lifecycle hook.
export {
  useViewTransitionLifecycle,
  type ViewTransitionLifecycle,
  type ViewTransitionPhaseCallback,
} from './view-transition-lifecycle.js';
export type {
  ViewTransitionEvent,
  NavDirection,
  ViewTransitionReason,
} from './internal/view-transition-event.js';

// View transitions types.
export {
  useViewTransitionTypes,
  subscribeViewTransitionTypes,
  type ViewTransitionTypesInput,
  type ViewTransitionTypesNav,
} from './view-transition-types.js';
// View transition name + group hooks and components.
export {
  useViewTransitionName,
  useViewTransitionClass,
  ViewTransitionName,
  ViewTransitionGroup,
  type ViewTransitionNameProps,
  type ViewTransitionGroupProps,
} from './view-transition-name.js';

// Persist components.
export { Persist, PersistHost, type PersistProps } from './persist.js';
