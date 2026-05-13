import { h } from 'preact';
import { useContext } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import { createCache, type LoaderCache } from './cache.js';
import { LoaderDataContext, LoaderErrorContext } from './internal/contexts.js';
import { Loader as LoaderHost } from './internal/loader.js';

export type LoaderCtx = {
  location: RouteHook;
  signal: AbortSignal;
};

export type Loader<T> =
  | ((ctx: LoaderCtx) => Promise<T>)
  | ((ctx: LoaderCtx) => Promise<ReadableStream<T>>)
  | ((ctx: LoaderCtx) => AsyncGenerator<T, void, unknown>);

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly __moduleKey?: string;
  readonly __loaderName?: string;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  readonly params: string[] | '*';
  useData(): T;
  useError(): Error | null;
  invalidate(): void;
  Boundary: import('preact').ComponentType<{
    fallback?: import('preact').ComponentChildren;
    errorFallback?:
      | import('preact').ComponentChildren
      | ((err: Error, reset: () => void) => import('preact').ComponentChildren);
    children: import('preact').ComponentChildren;
  }>;
  View<P extends Record<string, unknown> = {}>(
    render: (
      args: P & { data: T; error: Error | null; reload: () => void }
    ) => import('preact').ComponentChildren,
    opts?: {
      fallback?: import('preact').ComponentChildren;
      errorFallback?:
        | import('preact').ComponentChildren
        | ((err: Error, reset: () => void) => import('preact').ComponentChildren);
    }
  ): import('preact').FunctionComponent<P>;
}

/**
 * Plugin-emitted opts for `defineLoader`. The `__moduleKey` field is threaded
 * in by the `moduleKeyPlugin` Vite transform; user code does not set it.
 * `cache` is an opt-in for sharing a cache instance across multiple loaders;
 * when omitted, `defineLoader` creates a fresh one.
 */
export type DefineLoaderOpts<T> = {
  __moduleKey?: string;
  __loaderName?: string;
  cache?: LoaderCache<T>;
  params?: string[] | '*';
};

// Stash a shared cache map on globalThis so duplicate copies of
// @hono-preact/iso (workspace hoisting quirks) still see the same map.
// The serverOnlyPlugin emits a `defineLoader(fn, { __moduleKey })` call at
// EVERY importer of a `.server.*` module, so without this dedup each
// importer would get its own private LoaderCache and `ref.invalidate()`
// would only clear the calling importer's copy. That breaks cross-route
// invalidation (movie.tsx invalidating `moviesListLoader` no longer flushes
// the list page's cache).
const SHARED_CACHES_KEY = Symbol.for('@hono-preact/iso/loaderCaches');

type SharedCacheMap = Map<symbol, LoaderCache<unknown>>;

function getSharedCaches(): SharedCacheMap {
  const g = globalThis as unknown as Record<symbol, SharedCacheMap>;
  let map = g[SHARED_CACHES_KEY];
  if (!map) {
    map = new Map();
    g[SHARED_CACHES_KEY] = map;
  }
  return map;
}

export function defineLoader<T>(
  fn: Loader<T>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T> {
  const idKey = opts?.__moduleKey
    ? opts.__loaderName
      ? `${opts.__moduleKey}::${opts.__loaderName}`
      : opts.__moduleKey
    : null;

  const __id = idKey
    ? Symbol.for(`@hono-preact/loader:${idKey}`)
    : Symbol(`@hono-preact/loader:<unkeyed>`);

  let cache = opts?.cache;
  if (!cache) {
    if (opts?.__moduleKey) {
      // Keyed loaders: dedupe the auto-attached cache by __id so every
      // importer of the same .server module shares one LoaderCache.
      const shared = getSharedCaches();
      const existing = shared.get(__id) as LoaderCache<T> | undefined;
      if (existing) {
        cache = existing;
      } else {
        cache = createCache<T>();
        shared.set(__id, cache as LoaderCache<unknown>);
      }
    } else {
      // Unkeyed loaders only happen when consumers call defineLoader(fn)
      // directly without the plugin transform (i.e. in tests). Each call
      // gets a fresh cache.
      cache = createCache<T>();
    }
  }

  const ref: LoaderRef<T> = {
    __id,
    __moduleKey: opts?.__moduleKey,
    __loaderName: opts?.__loaderName,
    fn,
    cache: cache!,
    params: opts?.params ?? [],
    useData() {
      const ctx = useContext(LoaderDataContext);
      if (!ctx) {
        throw new Error(
          'loader.useData() must be called inside a route page that has a loader.'
        );
      }
      return ctx.data as T;
    },
    useError() {
      return useContext(LoaderErrorContext);
    },
    invalidate() {
      cache!.invalidate();
    },
    Boundary: null as never,
    View: (() => { throw new Error('View not yet implemented'); }) as never,
  };

  const Boundary: LoaderRef<T>['Boundary'] = ({ fallback, errorFallback, children }) => {
    return h(LoaderHost as any, {
      loader: ref,
      fallback,
      errorFallback,
      children,
    });
  };
  ref.Boundary = Boundary;

  return ref;
}
