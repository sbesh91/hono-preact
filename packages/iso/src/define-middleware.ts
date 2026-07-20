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

export type ServerCtx<S extends Scope = Scope> = S extends 'page'
  ? ServerPageCtx
  : S extends 'loader'
    ? ServerLoaderCtx
    : S extends 'action'
      ? ServerActionCtx
      : ServerPageCtx | ServerLoaderCtx | ServerActionCtx;

export type ClientPageCtx = {
  scope: 'page';
  location: RouteHook;
};

export type Next = () => Promise<unknown>;

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

export type Middleware = ServerMiddleware | ClientMiddleware;

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
