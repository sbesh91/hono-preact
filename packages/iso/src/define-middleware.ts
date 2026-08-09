import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import type { DenyOutcome, Outcome } from './outcomes.js';

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
 * The body of a server middleware. Named so `defineServerMiddleware` can infer
 * `TDeny` from the `deny()` a body returns: `TDeny` has to sit in an inferable
 * position, which an inline function type on a property does not give the
 * factory.
 *
 * The return union is spelled `Exclude<Outcome, DenyOutcome> | DenyOutcome<TDeny>`
 * rather than `Outcome`: the non-deny arms are unchanged, and only the deny arm
 * carries the payload type. With `TDeny = unknown` (the erased default) it is
 * exactly `void | Outcome`, so nothing that compiled before stops compiling.
 */
export type ServerMiddlewareFn<S extends Scope, TDeny> = (
  ctx: ServerCtx<S>,
  next: Next
) => Promise<void | Exclude<Outcome, DenyOutcome> | DenyOutcome<TDeny>>;

/**
 * Server middleware written for scope `S`. The default `Scope` is the strictest
 * form, not the loosest: its `fn` accepts the ctx union, so it is the only
 * shape that can run wherever the framework dispatches it. Because `fn` is a
 * property holding a function type, `S` is contravariant, and
 * `ServerMiddleware<Scope>` flows into a `ServerMiddleware<'loader'>` slot but
 * not the other way round.
 *
 * `TDeny` is the type of the `data` this middleware attaches when it denies.
 * It rides along so `defineAction` can union the deny types of a whole `use`
 * array into the typed deny arm of `mutate`'s result. It appears only in the
 * `fn`'s RETURN, so it is covariant: a `ServerMiddleware<S, {a: 1}>` flows into
 * a `ServerMiddleware<S, unknown>` slot, which is what keeps every erased
 * consumer (the dispatchers, `Middleware`, `RouteUseElement`) unchanged.
 */
export type ServerMiddleware<S extends Scope = Scope, TDeny = unknown> = {
  __kind: 'middleware';
  runs: 'server';
  fn: ServerMiddlewareFn<S, TDeny>;
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

/**
 * Declare server middleware. Two spellings, and the difference is entirely
 * about what TypeScript can infer:
 *
 * - `defineServerMiddleware('action', fn)` passes the scope as a VALUE, so both
 *   `S` and `TDeny` are inferred: `ctx` narrows to the action ctx AND the
 *   `deny({ data })` in the body is captured, so `defineAction` can surface it
 *   on `mutate`'s deny arm. The scope argument is type-level only at runtime
 *   (the dispatcher supplies the ctx); it exists because TypeScript has no
 *   partial type-argument inference, so naming `S` as a type argument forces
 *   every other parameter to its default.
 * - `defineServerMiddleware<'action'>(fn)` is the original spelling and behaves
 *   exactly as it always has: `TDeny` falls to its `unknown` default. That
 *   default is deliberately not `never`; `unknown` degrades a deny union to
 *   "untyped", while `never` would silently DROP this middleware's deny data
 *   from the union and read as sound when it is not.
 */
export function defineServerMiddleware<S extends Scope, TDeny = never>(
  scope: S,
  fn: ServerMiddlewareFn<S, TDeny>
): ServerMiddleware<S, TDeny>;
export function defineServerMiddleware<
  S extends Scope = Scope,
  TDeny = unknown,
>(fn: ServerMiddlewareFn<S, TDeny>): ServerMiddleware<S, TDeny>;
export function defineServerMiddleware(
  a: Scope | ServerMiddlewareFn<Scope, unknown>,
  b?: ServerMiddlewareFn<Scope, unknown>
): ServerMiddleware<Scope, unknown> {
  const fn = typeof a === 'function' ? a : b;
  if (!fn) {
    throw new TypeError(
      'defineServerMiddleware(scope, fn) requires the middleware function as its second argument'
    );
  }
  return { __kind: 'middleware', runs: 'server', fn };
}

export function defineClientMiddleware(
  fn: ClientMiddleware['fn']
): ClientMiddleware {
  return { __kind: 'middleware', runs: 'client', fn };
}
