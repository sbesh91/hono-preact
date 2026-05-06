import type { RouteHook } from 'preact-iso';
import type { LoaderCache } from './cache.js';

export type LoaderCtx = { location: RouteHook };

export type Loader<T> = (ctx: LoaderCtx) => Promise<T>;

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly fn: Loader<T>;
  readonly cache?: LoaderCache<T>;
}

/**
 * Plugin-emitted opts for `defineLoader`. Authored code should never
 * construct this literal directly -- it's threaded in by the
 * `moduleKeyPlugin` Vite transform when it rewrites
 * `defineLoader(fn)` to `defineLoader(fn, { __moduleKey: '...' })`.
 */
export type DefineLoaderOpts<T> = {
  __moduleKey: string;
};

/**
 * Define a server loader.
 *
 * Authored as `defineLoader(fn)` in `.server.*` files. The `moduleKeyPlugin`
 * Vite plugin rewrites the call at build time to thread the path-derived
 * module key in: `defineLoader(fn, { __moduleKey: 'src/pages/movies' })`.
 *
 * The `__moduleKey` is the routing key for `__loaders`/`__actions` RPC
 * and the payload of `Symbol.for(...)` for `__id`. Two loaders defined in
 * different files produce distinct `__id` symbols by construction.
 *
 * To bind a `LoaderCache` to a loader, pass it via `definePage(Component,
 * { loader, cache })` rather than through `defineLoader` opts.
 */
export function defineLoader<T>(fn: Loader<T>): LoaderRef<T>;
export function defineLoader<T>(
  fn: Loader<T>,
  opts: DefineLoaderOpts<T>
): LoaderRef<T>;
export function defineLoader<T>(
  fn: Loader<T>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T> {
  if (opts?.__moduleKey) {
    return {
      __id: Symbol.for(`@hono-preact/loader:${opts.__moduleKey}`),
      fn,
    };
  }
  // Plugin-less context (a consumer testing their loader in isolation).
  // Identity is unstable across module reloads, which is acceptable for
  // tests that don't depend on cache-by-id behavior.
  return {
    __id: Symbol(`@hono-preact/loader:<unkeyed>`),
    fn,
  };
}
