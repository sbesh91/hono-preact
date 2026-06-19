import { h } from 'preact';
import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
} from 'preact';
import { useContext } from 'preact/hooks';
import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';
import type { Serialize } from './internal/serialize.js';
import { createCache, type LoaderCache } from './cache.js';
import { LoaderDataContext, LoaderErrorContext } from './internal/contexts.js';
import { Loader as LoaderHost } from './internal/loader.js';
import { ViewRenderer } from './internal/view-renderer.js';
import type {
  AccumulateOptions,
  StreamStatus,
} from './internal/use-loader-runner.js';
import type { LoaderUse } from './internal/use-types.js';
import type { Middleware } from './define-middleware.js';
import type { StreamObserver } from './define-stream-observer.js';
export type { StreamStatus } from './internal/use-loader-runner.js';

export type LoaderCtx<TParams = Record<string, string>> = {
  c: Context;
  location: Omit<RouteHook, 'pathParams'> & { pathParams: TParams };
  signal: AbortSignal;
};

export type Loader<T, TParams = Record<string, string>> =
  | ((ctx: LoaderCtx<TParams>) => Promise<T>)
  | ((ctx: LoaderCtx<TParams>) => Promise<ReadableStream<T>>)
  | ((ctx: LoaderCtx<TParams>) => AsyncGenerator<T, void, unknown>);

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly __moduleKey?: string;
  readonly __loaderName?: string;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  readonly params: string[] | '*';
  /** True for a `live` loader (client-only subscription, never runs on SSR). */
  readonly live: boolean;
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
  /**
   * The loader's data as the client receives it: `Serialize<T>`, the JSON
   * round-trip of the server-side return `T` (e.g. a `Date` field arrives as a
   * string). Typing this as `T` would be a lie on the client/hydration path.
   */
  useData(): Serialize<T>;
  useError(): Error | null;
  invalidate(): void;
  Boundary: ComponentType<{
    fallback?: ComponentChildren;
    errorFallback?:
      | ComponentChildren
      | ((err: Error, reset: () => void) => ComponentChildren);
    accumulate?: AccumulateOptions;
    children: ComponentChildren;
  }>;
  // Accumulating (streaming/live) form: selected by passing `initial` + `reduce`.
  // `data` is the folded accumulator; `status` reflects the connection.
  View<Acc, P extends Record<string, unknown> = {}>(
    render: (
      args: P & {
        data: Acc;
        status: StreamStatus;
        error: Error | null;
        reload: () => void;
      }
    ) => ComponentChildren,
    opts: {
      initial: Acc;
      // The client folds the JSON-round-tripped chunk (`Serialize<T>`), the same
      // wire shape `useData()` / the single-value `.View` form surface.
      reduce: (acc: Acc, chunk: Serialize<T>) => Acc;
      fallback?: ComponentChildren;
      errorFallback?:
        | ComponentChildren
        | ((err: Error, reset: () => void) => ComponentChildren);
    }
  ): FunctionComponent<P>;
  // Single-value form.
  View<P extends Record<string, unknown> = {}>(
    render: (
      args: P & { data: Serialize<T>; error: Error | null; reload: () => void }
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
 * A loader reference with its data type erased: for APIs that operate ON a
 * loader (invalidate, prefetch) without reading its data shape.
 *
 * Uses `LoaderRef<any>`, not `LoaderRef<unknown>`, deliberately. `LoaderRef<T>`
 * is invariant in `T` (it surfaces `T` through `useData(): Serialize<T>`), so a
 * concrete `LoaderRef<Movie>` is NOT assignable to `LoaderRef<unknown>`. The
 * `any` argument erases the data type so any loader is accepted; these call
 * sites never inspect the data with a meaningful type.
 */
export type AnyLoaderRef = LoaderRef<any>;

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
  /**
   * Marks this loader as a long-lived client-only subscription. A `live`
   * loader is consumed ONLY via `loader.View(render, { initial, reduce })`: it is never invoked
   * during SSR (so an infinite generator cannot hang the document response),
   * and its timeout defaults to `false` (no 30s cap) unless `timeoutMs` is set.
   * `loader.View` / `loader.Boundary` / `loader.useData()` throw for live
   * loaders.
   */
  live?: boolean;
};

// Stash a shared cache map on globalThis so duplicate copies of
// @hono-preact/iso (workspace hoisting quirks) still see the same map.
// The module-key plugin threads `{ __moduleKey }` into every `defineLoader`
// call (both the `defineLoader(fn, opts)` and `defineLoader(routeId, fn, opts)`
// forms) at EVERY importer of a `.server.*` module, so without this dedup each
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
): LoaderRef<T>;
export function defineLoader<RouteId extends RegisteredPaths, T>(
  route: RouteId,
  fn: Loader<T, RouteParams<RouteId>>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T>;
export function defineLoader(
  fnOrRoute: Loader<unknown> | string,
  fnOrOpts?: Loader<unknown> | DefineLoaderOpts<unknown>,
  maybeOpts?: DefineLoaderOpts<unknown>
): LoaderRef<unknown> {
  // Normalize the two overload forms. The route id is type-level only (it
  // selects the param shape for the loader fn); it is not stored on the ref
  // and does not affect cache/`params` behavior.
  const isRouteForm = typeof fnOrRoute === 'string';
  const fn = (isRouteForm ? fnOrOpts : fnOrRoute) as Loader<unknown>;
  const opts = (isRouteForm ? maybeOpts : fnOrOpts) as
    | DefineLoaderOpts<unknown>
    | undefined;

  const live = opts?.live ?? false;

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
      const existing = shared.get(__id) as LoaderCache<unknown> | undefined;
      if (existing) {
        cache = existing;
      } else {
        cache = createCache<unknown>();
        shared.set(__id, cache as LoaderCache<unknown>);
      }
    } else {
      // Unkeyed loaders only happen when consumers call defineLoader(fn)
      // directly without the plugin transform (i.e. in tests). Each call
      // gets a fresh cache.
      cache = createCache<unknown>();
    }
  }

  const ref: LoaderRef<unknown> = {
    __id,
    __moduleKey: opts?.__moduleKey,
    __loaderName: opts?.__loaderName,
    fn,
    cache: cache!,
    params: opts?.params ?? [],
    live,
    timeoutMs: opts?.timeoutMs ?? (live ? false : undefined),
    // LoaderUse<T, boolean> structurally collapses to the same shape the
    // partitioner accepts; the cast hides only the generic narrowing on
    // StreamObserver's TChunk/TResult which is invariant. Identity-preserving.
    use: (opts?.use ?? []) as ReadonlyArray<
      Middleware | StreamObserver<unknown, never>
    >,
    useData() {
      if (live) {
        throw new Error(
          'This is a `live` loader: consume it via `loader.View(render, { initial, reduce })`, not `loader.useData()`.'
        );
      }
      const ctx = useContext(LoaderDataContext);
      if (!ctx) {
        throw new Error(
          'loader.useData() must be called inside a `loader.View` render function or inside a `loader.Boundary`.'
        );
      }
      return ctx.data as unknown;
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
    Boundary: (props) => {
      // The same `accumulate` <-> `live` invariant `View` enforces, applied to
      // the lower-level escape hatch (`View` delegates here, so these guards
      // must allow live+accumulate, which is exactly what `View` passes).
      if (live && !props.accumulate) {
        // A live loader has no single value; a bare `.Boundary` would suspend
        // forever on the infinite generator.
        throw new Error(
          'This is a `live` loader: consume it via `loader.View(render, { initial, reduce })`, not `loader.Boundary`.'
        );
      }
      if (props.accumulate && !live) {
        // The accumulating form is hydration-safe only for live loaders (which
        // skip SSR). A non-live loader rendered through it would SSR resolved
        // content and then re-fetch on hydration (a content flash).
        throw new Error(
          'The accumulating `{ initial, reduce }` form requires a `live` loader. Consume a finite stream with the single-value `loader.View(render)` form.'
        );
      }
      return h(LoaderHost<unknown>, {
        loader: ref,
        fallback: props.fallback,
        errorFallback: props.errorFallback,
        accumulate: props.accumulate,
        children: props.children,
      });
    },
    // `render: (args: any)` (not `any`) keeps the call shape while satisfying
    // both public overloads; `any` survives only on `reduce` (the unavoidable
    // variance seam between the two opts shapes). The public contract is the
    // two `View` overloads above; this implementation signature is internal.
    View: (
      render: (args: any) => ComponentChildren,
      viewOpts?: {
        initial?: unknown;
        reduce?: (acc: any, chunk: any) => any;
        fallback?: ComponentChildren;
        errorFallback?:
          | ComponentChildren
          | ((err: Error, reset: () => void) => ComponentChildren);
      }
    ) => {
      // The accumulating (streaming) form is selected by `initial` + `reduce`.
      // A live loader has no single value, so it must use the accumulating form;
      // conversely the accumulating form is hydration-safe only for live loaders.
      const accumulate =
        viewOpts &&
        typeof viewOpts.reduce === 'function' &&
        'initial' in viewOpts
          ? { initial: viewOpts.initial, reduce: viewOpts.reduce }
          : undefined;
      if (live && !accumulate) {
        throw new Error(
          'This is a `live` loader: consume it via `loader.View(render, { initial, reduce })`.'
        );
      }
      if (accumulate && !live) {
        throw new Error(
          'The accumulating `loader.View(render, { initial, reduce })` form requires a `live` loader. Consume a finite stream with the single-value `loader.View(render)` form.'
        );
      }
      const Wrapped: FunctionComponent<any> = (props) =>
        h(ref.Boundary, {
          fallback: viewOpts?.fallback,
          errorFallback: viewOpts?.errorFallback,
          accumulate,
          children: h(ViewRenderer<unknown>, {
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
