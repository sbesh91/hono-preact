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
