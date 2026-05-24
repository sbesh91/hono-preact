import { h } from 'preact';
import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
} from 'preact';
import { useContext } from 'preact/hooks';
import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import { createCache, type LoaderCache } from './cache.js';
import { LoaderDataContext, LoaderErrorContext } from './internal/contexts.js';
import { Loader as LoaderHost } from './internal/loader.js';
import { ReloadContext } from './reload-context.js';
import type { LoaderUse } from './internal/use-types.js';
import type { Middleware } from './define-middleware.js';
import type { StreamObserver } from './define-stream-observer.js';

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
  /**
   * Raw value as authored on `defineLoader({ timeoutMs })`. `undefined`
   * means "use the handler's configured default"; `false` means "no
   * timeout, only the request signal aborts".
   */
  readonly timeoutMs?: number | false;
  /**
   * Per-loader middleware and (for streaming loaders) stream observers,
   * exactly as authored on `defineLoader({ use })`. The handler-side
   * dispatcher calls `partitionUse(ref.use)` to split middleware from
   * observers; both partitions flow through the SSR/RPC streaming pump.
   * Typed as the union the partitioner accepts so the contract is
   * advertised at the consumer rather than hidden behind `unknown`.
   */
  readonly use: ReadonlyArray<Middleware | StreamObserver<unknown, never>>;
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
  /**
   * Per-loader timeout in milliseconds. When omitted, the handler applies
   * its configured default (30s). Pass `false` to disable the timeout for
   * this loader (rely solely on the request signal).
   */
  timeoutMs?: number | false;
  /**
   * Per-loader middleware and (for streaming loaders) stream observers.
   * The element type LoaderUse<T, Streaming> structurally gates stream
   * observers off non-streaming loaders, but a tighter compile-time gate
   * via defineLoader overloads can be added in a follow-up if needed.
   */
  use?: LoaderUse<T, boolean>;
};

// Stash a shared cache map on globalThis so duplicate copies of
// @hono-preact/iso (workspace hoisting quirks) still see the same map.
// The serverOnlyPlugin emits a `defineLoader(fn, { __moduleKey })` call at
// EVERY importer of a `.server.*` module, so without this dedup each
// importer would get its own private LoaderCache and `ref.invalidate()`
// would only clear the calling importer's copy. That breaks cross-route
// invalidation (movie.tsx invalidating `moviesListLoader` no longer flushes
// the list page's cache).
//
// CAVEAT — process-global identity. `Symbol.for(...)` produces a key in the
// process-wide Symbol registry, so this map is shared across every consumer
// of @hono-preact/iso running in the same V8 isolate. On Cloudflare Workers
// (process-per-isolate, short-lived) this is fine. On a long-lived Node
// process serving multiple tenants from one JS realm, the registry IS
// shared across tenants — a loader registered by tenant A's
// `pages/movies.server.ts` and tenant B's are colocated. Per-loader cache
// keys (the `__moduleKey` + cache identity symbol minted at defineLoader
// time) prevent cross-tenant DATA leaks; what's shared is the cache
// registry's identity, not the cache contents. Even so, v0.2 should move
// this to a per-app registry (via runRequestScope or an explicit app
// handle) so this is not an implicit footgun.
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
  return render({ data, error, reload, ...props });
}

function validateTimeoutMs(
  value: number | false | undefined,
  context: string
): void {
  if (value === undefined || value === false) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${context}: timeoutMs must be a non-negative finite number or false, got ${String(value)}`
    );
  }
}

export function defineLoader<T>(
  fn: Loader<T>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T> {
  validateTimeoutMs(opts?.timeoutMs, 'defineLoader');
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
    timeoutMs: opts?.timeoutMs,
    // LoaderUse<T, boolean> structurally collapses to the same shape the
    // partitioner accepts; the cast hides only the generic narrowing on
    // StreamObserver's TChunk/TResult which is invariant. Identity-preserving.
    use: (opts?.use ?? []) as ReadonlyArray<
      Middleware | StreamObserver<unknown, never>
    >,
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
    // `Boundary` and `View` close over `ref`. The captures are by reference
    // and only deref at call time (component render), so the cycle is safe;
    // both are fully initialized before any consumer can invoke them.
    Boundary: ({ fallback, errorFallback, children }) =>
      h(LoaderHost<T>, {
        loader: ref,
        fallback,
        errorFallback,
        children,
      }),
    View: (render, viewOpts) => {
      const Wrapped: FunctionComponent<any> = (props) =>
        h(ref.Boundary, {
          fallback: viewOpts?.fallback,
          errorFallback: viewOpts?.errorFallback,
          children: h(ViewRenderer<T>, {
            loaderRef: ref,
            props,
            render,
          }),
        });
      return Wrapped;
    },
  };

  return ref;
}
