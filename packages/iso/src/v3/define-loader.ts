import type { RouteHook } from 'preact-iso';
import type { LoaderCache } from '../cache.js';

export type LoaderCtx = { location: RouteHook };

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly fn: (ctx: LoaderCtx) => Promise<T>;
  readonly cache?: LoaderCache<T>;
}

export function defineLoader<T>(
  fn: (ctx: LoaderCtx) => Promise<T>,
  cache?: LoaderCache<T>
): LoaderRef<T> {
  return { __id: Symbol('loader'), fn, cache };
}
