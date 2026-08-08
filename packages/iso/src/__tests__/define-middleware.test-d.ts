// Type-level guards for the server middleware surface, run via
// `pnpm test:types` (`vitest --typecheck.only`). Only `*.test-d.*` files are
// typechecked by that command, so these assertions are the ones that hold the
// build accountable for the variance rules below.
import { expectTypeOf } from 'vitest';
import {
  defineServerMiddleware,
  type ClientMiddleware,
  type ServerMiddleware,
  type ServerCtx,
  type ServerPageCtx,
  type ServerLoaderCtx,
  type ServerActionCtx,
  type Scope,
} from '../define-middleware.js';
import type { AppUseElement } from '../define-app.js';
import type { RouteUseElement } from '../internal/use-types.js';
import type { RouteDef } from '../define-routes.js';

// `ServerCtx<Scope>` is the union of the three scope contexts: what an
// all-scope middleware has to accept.
expectTypeOf<ServerCtx<Scope>>().toEqualTypeOf<
  ServerPageCtx | ServerLoaderCtx | ServerActionCtx
>();
expectTypeOf<ServerCtx<'page'>>().toEqualTypeOf<ServerPageCtx>();
expectTypeOf<ServerCtx<'loader'>>().toEqualTypeOf<ServerLoaderCtx>();
expectTypeOf<ServerCtx<'action'>>().toEqualTypeOf<ServerActionCtx>();

declare const pageMw: ServerMiddleware<'page'>;
declare const loaderMw: ServerMiddleware<'loader'>;
declare const actionMw: ServerMiddleware<'action'>;
declare const allMw: ServerMiddleware<Scope>;
declare const clientMw: ClientMiddleware;

// A route node's `use` still admits client middleware: the route tree IS in
// the client module graph and `startChain` dispatches the `runs === 'client'`
// entries there. `RouteUseElement` is the exported name for that element
// union, and it must actually BE the element type of `RouteDef['use']`, or
// the annotation the docs prescribe drifts from the slot it annotates.
expectTypeOf<ClientMiddleware>().toExtend<RouteUseElement>();
expectTypeOf<RouteUseElement>().toEqualTypeOf<
  NonNullable<RouteDef['use']>[number]
>();

// `S` is CONTRAVARIANT: the `fn` parameter is the only place it appears. An
// all-scope middleware satisfies any single-scope slot...
expectTypeOf(allMw).toExtend<ServerMiddleware<'page'>>();
expectTypeOf(allMw).toExtend<ServerMiddleware<'loader'>>();
expectTypeOf(allMw).toExtend<ServerMiddleware<'action'>>();

// ...and no single-scope middleware satisfies the all-scope slot. This is what
// `AppConfig['use']` leans on: the app tier is dispatched in all three scopes,
// so an entry that signed up for one of them is not safe there.
const appUse: AppUseElement[] = [allMw];
void appUse;

// @ts-expect-error page-only middleware cannot be app-level: the loader and
// action dispatches would hand it a ctx it did not sign up for.
const rejectPage: AppUseElement = pageMw;
// @ts-expect-error client middleware cannot be app-level either: app config
// never enters the client module graph, so nothing would ever dispatch it
// (#359). Client middleware belongs on route nodes, where the client
// dispatcher actually sees it.
const rejectClient: AppUseElement = clientMw;
void rejectClient;
// @ts-expect-error loader-only middleware cannot be app-level: the page
// dispatch would hand it a ServerPageCtx with no `module` / `loader`.
const rejectLoader: AppUseElement = loaderMw;
// @ts-expect-error action-only middleware cannot be app-level.
const rejectAction: AppUseElement = actionMw;
void rejectPage;
void rejectLoader;
void rejectAction;

// `next()` resolves with no value, so BOTH spellings the dispatcher's
// contract-violation message prescribes typecheck: `await next()` and the
// pass-through `return next()`.
const awaited = defineServerMiddleware(async (_ctx, next) => {
  await next();
});
const returned = defineServerMiddleware(async (_ctx, next) => next());
expectTypeOf(awaited).toEqualTypeOf<ServerMiddleware<Scope>>();
expectTypeOf(returned).toEqualTypeOf<ServerMiddleware<Scope>>();

// An un-annotated `defineServerMiddleware(...)` infers the all-scope form, so
// the default spelling is the one that fits an app-level `use`.
expectTypeOf(awaited).toExtend<AppUseElement>();

// The SAME contract at the route tier. `composeServerChain` folds
// `resolvePageUse(path)` into the loader and action chains as well as the page
// render, so a route node's `use` is dispatched in all three scopes exactly as
// the app tier is.
//
// Pinned on `RouteDef` rather than through a `defineRoutes([...])` call. That
// route looks more end-to-end and is worse: `defineRoutes` takes
// `const T extends readonly RouteDef[]`, and in a hand-built route literal any
// OTHER mismatch (a layout fixture, a missing child) also lands on the same
// line, so a `@ts-expect-error` there stays "used" whether or not `use` is
// rejected. That pin passed identically with `PageUse` reshaped and reverted,
// i.e. it asserted nothing. This one was mutation-checked: reverting
// `PageUse` to `ServerMiddleware<'page'>` makes all three directives unused.
declare const routeUseAll: RouteDef;
void ({ ...routeUseAll, path: '/ok', use: [allMw] } satisfies RouteDef);

// @ts-expect-error page-only middleware cannot sit on a route node: that tier
// is dispatched with a loader ctx and an action ctx too.
const badRoutePage: RouteDef['use'] = [pageMw];
void badRoutePage;

// @ts-expect-error loader-only middleware cannot sit on a route node: the page
// render would hand it a ServerPageCtx.
const badRouteLoader: RouteDef['use'] = [loaderMw];
void badRouteLoader;

// @ts-expect-error action-only middleware cannot sit on a route node.
const badRouteAction: RouteDef['use'] = [actionMw];
void badRouteAction;
