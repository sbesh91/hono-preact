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

// Server bindings.
export { defineLoader } from './define-loader.js';
export type {
  LoaderRef,
  LoaderCtx,
  Loader as LoaderFn,
} from './define-loader.js';
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
export { isBrowser, env } from './is-browser.js';

// Client entry primitives (item 4 of v0.1).
export { useRouteChange } from './route-change.js';
export type { RouteChangeHandler } from './route-change.js';
export { Head } from './head.js';
export type { HeadProps } from './head.js';
export { ClientScript } from './client-script.js';
