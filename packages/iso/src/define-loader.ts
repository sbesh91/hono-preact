import { h } from 'preact';
import type { ComponentChildren, ComponentType, FunctionComponent } from 'preact';
import { useContext } from 'preact/hooks';
import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import { createCache, type LoaderCache } from './cache.js';
import { LoaderDataContext, LoaderErrorContext } from './internal/contexts.js';
import { Loader as LoaderHost } from './internal/loader.js';
import { ReloadContext } from './reload-context.js';

export type LoaderCtx = {
  c: Context;
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
  Boundary: ComponentType<{
    fallback?: ComponentChildren;
    errorFallback?:
      | ComponentChildren
      | ((err: Error, reset: () => void) => ComponentChildren);
    children: ComponentChildren;
  }>;
  View<P extends Record<string, unknown> = {}>(
    render: (
      args: P & { data: T; error: Error | null; reload: () => void }
    ) => ComponentChildren,
    opts?: {
      fallback?: ComponentChildren;
      errorFallback?:
        | ComponentChildren
        | ((err: Error, reset: () => void) => ComponentChildren);
    }
  ): FunctionComponent<P>;
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

function ViewRenderer<T>({
  loaderRef,
  props,
  render,
}: {
  loaderRef: LoaderRef<T>;
  props: Record<string, unknown>;
  render: (args: any) => ComponentChildren;
}) {
  const data = loaderRef.useData();
  const error = loaderRef.useError();
  const reloadCtx = useContext(ReloadContext);
  const reload = reloadCtx?.reload ?? (() => {});
  return render({ data, error, reload, ...props }) as any;
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
          'loader.useData() must be called inside a `loader.View` render function or inside a `loader.Boundary`.'
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
    View: null as never,
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

  const View: LoaderRef<T>['View'] = (render, viewOpts) => {
    const Wrapped: FunctionComponent<any> = (props) =>
      h(ref.Boundary, {
        fallback: viewOpts?.fallback,
        errorFallback: viewOpts?.errorFallback,
        children: h(ViewRenderer<T> as any, { loaderRef: ref, props, render }),
      });
    return Wrapped;
  };
  ref.View = View;

  return ref;
}
