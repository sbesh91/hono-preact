import type { RouteHook } from 'preact-iso';
import type { LoaderCache } from './cache.js';

export type LoaderCtx = { location: RouteHook };

export type Loader<T> = (ctx: LoaderCtx) => Promise<T>;

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly fn: Loader<T>;
  readonly cache?: LoaderCache<T>;
}

export function defineLoader<T>(
  fn: Loader<T>,
  cache?: LoaderCache<T>
): LoaderRef<T> {
  return { __id: Symbol('loader'), fn, cache };
}
