import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import type { Outcome } from './outcomes.js';

export type Scope = 'page' | 'loader' | 'action';

export type ServerBaseCtx = {
  c: Context;
  signal: AbortSignal;
};

export type ServerPageCtx = ServerBaseCtx & {
  scope: 'page';
  location: RouteHook;
};

export type ServerLoaderCtx = ServerBaseCtx & {
  scope: 'loader';
  location: RouteHook;
  module: string;
  loader: string;
};

export type ServerActionCtx = ServerBaseCtx & {
  scope: 'action';
  module: string;
  action: string;
  payload: unknown;
  /**
   * Route-authoritative location for route-bound actions
   * (`serverRoute(r).action`): the invoking page URL matched against the
   * action's own declared pattern, so a route-node guard can gate action scope
   * by `ctx.location.pathParams` exactly as it does page and loader scope.
   * Absent for a bare `defineAction` (route-independent, runs no route-node page
   * tier) and for the in-process `call()` path (runs no route-node middleware).
   */
  location?: RouteHook;
};

/**
 * The context a server middleware receives, keyed by the scope it runs in.
 * `ServerCtx<Scope>` is the union of all three: what a middleware that has to
 * survive every scope must accept.
 *
 * Spelled as an indexed access rather than a chain of `S extends 'page' ? ...`
 * conditionals, because the spelling decides the variance TypeScript measures
 * for everything built on it. With `S` in a conditional's check position, both
 * of the compiler's variance probes fall through to the same branch, so
 * `ServerMiddleware<S>` measures BIVARIANT in `S`: every scope tag becomes
 * interchangeable with `Scope`, and a `ServerMiddleware<'page'>` satisfies a
 * `ServerMiddleware<Scope>` slot even though the dispatcher may hand it a
 * loader or an action ctx. An indexed access measures contravariant, which is
 * what a parameter position means: a middleware that handles all three scopes
 * fits a single-scope slot, and a single-scope middleware does not fit an
 * all-scope slot.
 */
export type ServerCtx<S extends Scope = Scope> = {
  page: ServerPageCtx;
  loader: ServerLoaderCtx;
  action: ServerActionCtx;
}[S];

export type ClientPageCtx = {
  scope: 'page';
  location: RouteHook;
};

/**
 * Pass control inward. Resolves once the rest of the chain and the inner
 * handler have settled, so `try { await next() } finally { ... }` wraps the
 * whole downstream.
 *
 * It resolves with no value on purpose. The inner handler's result is threaded
 * back to the dispatcher's caller, not to middleware; nothing in the chain
 * gives that value a meaning at this seam, and typing it `unknown` published an
 * implementation detail while making `return next()` (the spelling the
 * dispatcher's own contract-violation message prescribes) fail to typecheck,
 * since `Promise<unknown>` is not assignable to a `void | Outcome` return.
 */
export type Next = () => Promise<void>;

/**
 * Server middleware written for scope `S`. The default `Scope` is the strictest
 * form, not the loosest: its `fn` accepts the ctx union, so it is the only
 * shape that can run wherever the framework dispatches it. Because `fn` is a
 * property holding a function type, `S` is contravariant, and
 * `ServerMiddleware<Scope>` flows into a `ServerMiddleware<'loader'>` slot but
 * not the other way round.
 */
export type ServerMiddleware<S extends Scope = Scope> = {
  __kind: 'middleware';
  runs: 'server';
  fn: (ctx: ServerCtx<S>, next: Next) => Promise<void | Outcome>;
};

export type ClientMiddleware = {
  __kind: 'middleware';
  runs: 'client';
  fn: (ctx: ClientPageCtx, next: Next) => Promise<void | Outcome>;
};

/**
 * A middleware of unknown scope: what `partitionUse` hands back after
 * classifying a `use` entry structurally, and what a `use` array holds before
 * anyone decides which ctx to call it with.
 *
 * Distributed over `Scope` on purpose, so it admits a single-scope
 * `ServerMiddleware<'loader'>` as readily as an all-scope one. It is NOT
 * `ServerMiddleware<Scope>`: that spelling means "handles every scope", a
 * promise the runtime classifier never checks and most entries do not make.
 * Consumers narrow to the scope they are about to dispatch in.
 */
export type Middleware =
  | { [S in Scope]: ServerMiddleware<S> }[Scope]
  | ClientMiddleware;

export function defineServerMiddleware<S extends Scope = Scope>(
  fn: ServerMiddleware<S>['fn']
): ServerMiddleware<S> {
  return { __kind: 'middleware', runs: 'server', fn };
}

export function defineClientMiddleware(
  fn: ClientMiddleware['fn']
): ClientMiddleware {
  return { __kind: 'middleware', runs: 'client', fn };
}
