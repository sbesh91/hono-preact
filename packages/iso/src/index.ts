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
  RouteSubtrees,
  RegisteredRoutes,
  RegisteredSubtrees,
} from './internal/typed-routes.js';
export type { Serialize } from './internal/serialize.js';

// Inference helpers over action/loader refs.
export type {
  InferActionPayload,
  InferActionResult,
  InferActionChunk,
  InferLoaderData,
} from './infer.js';

// Server bindings.
export { defineLoader } from './define-loader.js';
export type {
  LoaderRef,
  AnyLoaderRef,
  LoaderCtx,
  Loader as LoaderFn,
  StreamStatus,
  LoaderState,
  StreamState,
} from './define-loader.js';
export { serverRoute, liveStream } from './server-route.js';
export type { RouteBinder } from './server-route.js';

// Server-side caller (HTTP-free loader/action composition + testing).
export { createCaller } from './server-caller.js';
export type {
  ServerCaller,
  CallResult,
  CallLoaderLocation,
  CallLoaderOptions,
  CallStreamOptions,
} from './server-caller.js';
export { defineAction, useAction, TimeoutError } from './action.js';
export type {
  ActionRef,
  UseActionOptions,
  UseActionResult,
  MutateResult,
} from './action.js';
export type { StandardSchemaV1 } from '@standard-schema/spec';
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
export { getValidationIssues } from './get-validation-issues.js';
export type { ValidationIssue } from './validate.js';
export { LoaderValidationError } from './loader-validation-error.js';
export {
  ActionResultContext,
  type ActionResultContextValue,
} from './action-result-context.js';
export { useFormStatus, type FormStatus } from './use-form-status.js';
export {
  useFieldErrors,
  useFieldErrorProps,
  FieldError,
} from './use-field-errors.js';
export type { FieldErrorsMap } from './internal/field-errors-context.js';

// Cache + invalidation.
export { createCache } from './cache.js';
export type { LoaderCache } from './cache.js';

// Realtime channels.
export { defineChannel } from './define-channel.js';
export type { Channel, Topic } from './define-channel.js';
export { publish } from './pubsub.js';
export { eventStream } from './event-stream.js';

// Duplex WebSocket sockets.
export { defineSocket } from './define-socket.js';
export type {
  SocketRef,
  SocketHandler,
  ServerSocket,
} from './define-socket.js';
export { useSocket } from './use-socket.js';
export type {
  SocketStatus,
  SocketCloseInfo,
  ReconnectOptions,
  UseSocketOptions,
  UseSocketArgs,
  UseSocketResult,
} from './use-socket.js';
export { upgradeWebSocket } from './upgrade-websocket.js';

// Broadcasting rooms (a duplex socket bound to a typed channel + presence).
export { defineRoom } from './define-room.js';
export type { RoomRef, RoomHandler, RoomConnection } from './define-room.js';
export { useRoom } from './use-room.js';
export type { UseRoomOptions, UseRoomArgs, UseRoomResult } from './use-room.js';
export type { PresenceMember } from './internal/room-envelope.js';

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
  DENY_CODE_STATUS,
} from './outcomes.js';
export type {
  Outcome,
  RedirectOutcome,
  DenyOutcome,
  RenderOutcome,
  TimeoutOutcome,
  RedirectStatusCode,
  ErrorStatusCode,
  DenyCode,
} from './outcomes.js';

// Utilities.
export { prefetch } from './prefetch.js';
export { usePrefetch } from './use-prefetch.js';
export { isBrowser } from './is-browser.js';

// Client entry primitives (item 4 of v0.1).
export { Head } from './head.js';
export type { HeadProps } from './head.js';
export { ClientScript } from './client-script.js';

// Head management hooks: trivial re-exports of hoofd/preact. The framework
// owns the hoofd integration (renderPage collects these into the document
// head via HoofdProvider), so pages import the hooks from hono-preact rather
// than depending on hoofd directly.
export {
  useTitle,
  useTitleTemplate,
  useMeta,
  useLink,
  useLang,
  useScript,
} from 'hoofd/preact';
export type { MetaOptions, LinkOptions, ScriptOptions } from 'hoofd/preact';

// View transition lifecycle hook.
export {
  useViewTransitionLifecycle,
  type ViewTransitionLifecycle,
  type ViewTransitionPhaseCallback,
} from './view-transition-lifecycle.js';
export { skipNextNavTransition } from './internal/route-change.js';
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

// Client boot. Installs the runtime services the generated client entry
// relies on (history shim, nav-transition scheduler, stream registry);
// public so a custom `clientEntry` can make the same call.
export { bootClient } from './boot-client.js';
