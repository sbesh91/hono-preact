import { useContext } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import { createCache, type LoaderCache } from './cache.js';
import { LoaderDataContext } from './internal/contexts.js';

export type LoaderCtx = { location: RouteHook };

export type Loader<T> = (ctx: LoaderCtx) => Promise<T>;

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  useData(): T;
  invalidate(): void;
}

/**
 * Plugin-emitted opts for `defineLoader`. The `__moduleKey` field is threaded
 * in by the `moduleKeyPlugin` Vite transform; user code does not set it.
 * `cache` is an opt-in for sharing a cache instance across multiple loaders;
 * when omitted, `defineLoader` creates a fresh one.
 */
export type DefineLoaderOpts<T> = {
  __moduleKey?: string;
  cache?: LoaderCache<T>;
};

export function defineLoader<T>(
  fn: Loader<T>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T> {
  const __id = opts?.__moduleKey
    ? Symbol.for(`@hono-preact/loader:${opts.__moduleKey}`)
    : Symbol(`@hono-preact/loader:<unkeyed>`);
  const cache = opts?.cache ?? createCache<T>();

  const ref: LoaderRef<T> = {
    __id,
    fn,
    cache,
    useData() {
      const ctx = useContext(LoaderDataContext);
      if (!ctx) {
        throw new Error(
          'loader.useData() must be called inside a route page that has a loader.'
        );
      }
      return ctx.data as T;
    },
    invalidate() {
      cache.invalidate();
    },
  };
  return ref;
}
