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
  name: string,
  fn: Loader<T>,
  cache?: LoaderCache<T>
): LoaderRef<T> {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      'defineLoader(name, fn): name must be a non-empty string. ' +
      "Pick a stable identifier matching the .server.* module basename, " +
      "e.g. defineLoader('movies', serverLoader)."
    );
  }
  return {
    __id: Symbol.for(`@hono-preact/loader:${name}`),
    fn,
    cache,
  };
}
