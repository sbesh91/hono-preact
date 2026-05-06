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
 * construct this literal directly — it's threaded in by the
 * `moduleKeyPlugin` Vite transform when it rewrites
 * `defineLoader(fn)` to `defineLoader(fn, { __moduleKey: '...' })`.
 */
export type DefineLoaderOpts<T> = {
  __moduleKey: string;
  cache?: LoaderCache<T>;
};

// Public form (post-plugin authoring): defineLoader(fn) — the plugin will
// rewrite this to defineLoader(fn, { __moduleKey: '...' }) at build time.
export function defineLoader<T>(fn: Loader<T>): LoaderRef<T>;
// Plugin-emitted form: defineLoader(fn, { __moduleKey, cache? }).
export function defineLoader<T>(
  fn: Loader<T>,
  opts: DefineLoaderOpts<T>
): LoaderRef<T>;
// Legacy form (deprecated, removed in the final task of this plan):
// defineLoader(name, fn, cache?).
export function defineLoader<T>(
  name: string,
  fn: Loader<T>,
  cache?: LoaderCache<T>
): LoaderRef<T>;
export function defineLoader<T>(
  fnOrName: Loader<T> | string,
  fnOrOpts?: Loader<T> | DefineLoaderOpts<T>,
  legacyCache?: LoaderCache<T>
): LoaderRef<T> {
  if (typeof fnOrName === 'string') {
    // Legacy (name, fn) form.
    const name = fnOrName;
    const fn = fnOrOpts as Loader<T>;
    if (name.length === 0) {
      throw new Error(
        'defineLoader(name, fn): name must be a non-empty string. ' +
          "Pick a stable identifier matching the .server.* module basename, " +
          "e.g. defineLoader('movies', serverLoader)."
      );
    }
    return {
      __id: Symbol.for(`@hono-preact/loader:${name}`),
      fn,
      cache: legacyCache,
    };
  }

  // New (fn, opts?) form. When opts is absent, the plugin hasn't run yet
  // (e.g. in unit tests of consumer code that import the .server.* file
  // directly). Use a placeholder symbol; identity will be unstable across
  // module reloads, which is acceptable for tests.
  const fn = fnOrName;
  // At this point fnOrName is Loader<T>, so fnOrOpts is either
  // DefineLoaderOpts<T> or undefined (not a Loader<T>).
  const opts = fnOrOpts as DefineLoaderOpts<T> | undefined;
  if (opts?.__moduleKey) {
    return {
      __id: Symbol.for(`@hono-preact/loader:${opts.__moduleKey}`),
      fn,
      cache: opts.cache,
    };
  }
  return {
    __id: Symbol(`@hono-preact/loader:<unkeyed>`),
    fn,
  };
}
