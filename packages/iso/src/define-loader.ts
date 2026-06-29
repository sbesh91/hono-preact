import { h } from 'preact';
import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
} from 'preact';
import { useContext } from 'preact/hooks';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';
import type { Serialize } from './internal/serialize.js';
import { createCache, type LoaderCache } from './cache.js';
import { LoaderDataContext, LoaderErrorContext } from './internal/contexts.js';
import { Loader as LoaderHost } from './internal/loader.js';
import { ViewRenderer } from './internal/view-renderer.js';
import { isBrowser } from './is-browser.js';
import type { AccumulateOptions } from './internal/use-loader-runner.js';
import type { LoaderState, StreamState, StreamStatus } from './loader-state.js';
import type { LoaderUse } from './internal/use-types.js';
import type { Middleware } from './define-middleware.js';
import type { StreamObserver } from './define-stream-observer.js';
import { validateTimeoutMs } from './internal/timeout.js';
export type { StreamStatus, LoaderState, StreamState } from './loader-state.js';

export type LoaderCtx<
  TParams = Record<string, string>,
  TSearch = Record<string, string>,
> = {
  c: Context;
  location: Omit<RouteHook, 'pathParams' | 'searchParams'> & {
    pathParams: TParams;
    searchParams: TSearch;
  };
  signal: AbortSignal;
};

export type Loader<
  T,
  TParams = Record<string, string>,
  TSearch = Record<string, string>,
> =
  | ((ctx: LoaderCtx<TParams, TSearch>) => Promise<T>)
  | ((ctx: LoaderCtx<TParams, TSearch>) => Promise<ReadableStream<T>>)
  | ((ctx: LoaderCtx<TParams, TSearch>) => AsyncGenerator<T, void, unknown>);

// The accumulating (streaming) `.View` form: live loaders only. The render fn
// receives the `StreamState<Acc>` discriminated union (pattern-match on
// `status`); the folded accumulator rides the data-carrying arms. The chunk
// handed to `reduce` is the JSON-round-tripped wire shape (`Serialize<T>`). The
// explicit reload callback is read via `useReload()`, not handed in.
type AccumulatingView<T> = <Acc, P extends Record<string, unknown> = {}>(
  render: (args: StreamState<Acc> & P) => ComponentChildren,
  opts: {
    initial: Acc;
    reduce: (acc: Acc, chunk: Serialize<T>) => Acc;
    errorFallback?:
      | ComponentChildren
      | ((err: Error, reset: () => void) => ComponentChildren);
  }
) => FunctionComponent<P>;

// The single-value `.View` form: non-live loaders. The render fn receives the
// `LoaderState<Serialize<T>>` discriminated union (pattern-match on `status`);
// the loader value (the JSON round-trip the client receives) rides the
// data-carrying arms. The explicit reload callback is read via `useReload()`,
// not handed in.
type SingleValueView<T> = <P extends Record<string, unknown> = {}>(
  render: (args: LoaderState<Serialize<T>> & P) => ComponentChildren,
  opts?: {
    errorFallback?:
      | ComponentChildren
      | ((err: Error, reset: () => void) => ComponentChildren);
  }
) => FunctionComponent<P>;

/**
 * A reference to a defined loader. `Live` (the liveness discriminant, fixed by
 * `defineLoader({ live })`) selects the consumption surface at the type level:
 *
 * - `LoaderRef<T, true>` (a `live` loader) exposes ONLY the accumulating
 *   `View(render, { initial, reduce })` form; `useData` and `Boundary` are
 *   `never` (a live loader has no single value).
 * - `LoaderRef<T, false>` exposes ONLY the single-value `View(render)` form,
 *   plus `useData()` and `Boundary`.
 *
 * Using the wrong form is therefore a compile error rather than a runtime throw.
 * `Live` defaults to `false` (the common, non-live case) so a bare `LoaderRef<T>`
 * has a callable single-value `.View`. Code that must accept either liveness
 * (internals, `AnyLoaderRef`) parameterizes it as `LoaderRef<T, boolean>`, whose
 * `View` is the union of both shapes (not directly callable; such code never
 * calls `.View`, it only holds/forwards the ref).
 */
export interface LoaderRef<T, Live extends boolean = false> {
  readonly __id: symbol;
  readonly __moduleKey?: string;
  readonly __loaderName?: string;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  readonly params: string[] | '*';
  /** Search-params schema, as authored on `defineLoader({ searchSchema })`. */
  readonly searchSchema?: StandardSchemaV1;
  /** Path-params schema, as authored on `defineLoader({ paramsSchema })`. */
  readonly paramsSchema?: StandardSchemaV1;
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
   * Consume the loader's data as a discriminated `LoaderState<Serialize<T>>`:
   * pattern-match on `status` (`loading` | `success` | `revalidating` |
   * `error`). The data-carrying arms expose `Serialize<T>`, the JSON round-trip
   * of the server-side return `T` (e.g. a `Date` field arrives as a string).
   * `never` on a `live` loader (it has no single value).
   */
  useData: Live extends true ? never : () => LoaderState<Serialize<T>>;
  useError(): Error | null;
  invalidate(): void;
  /**
   * The lower-level state-based boundary (single-value loaders): it renders its
   * children eagerly and provides the loader's state on context, which children
   * read via `useData()` (pattern-match on `status`). `never` on a `live`
   * loader: consume it via the accumulating `.View` form instead.
   */
  Boundary: Live extends true
    ? never
    : ComponentType<{
        errorFallback?:
          | ComponentChildren
          | ((err: Error, reset: () => void) => ComponentChildren);
        accumulate?: AccumulateOptions;
        children: ComponentChildren;
      }>;
  /**
   * Consume the loader through the framework's `.View` convention. The form is
   * fixed by liveness: a `live` loader exposes only the accumulating
   * `View(render, { initial, reduce })` form; a non-live loader exposes only the
   * single-value `View(render)` form. The other form is a compile error.
   */
  View: Live extends true ? AccumulatingView<T> : SingleValueView<T>;
}

/**
 * A loader reference with its data type erased: for APIs that operate ON a
 * loader (invalidate, prefetch) without reading its data shape.
 *
 * Uses `LoaderRef<any>`, not `LoaderRef<unknown>`, deliberately. `LoaderRef<T>`
 * is invariant in `T` (it surfaces `T` through `useData(): LoaderState<Serialize<T>>`),
 * so a concrete `LoaderRef<Movie>` is NOT assignable to `LoaderRef<unknown>`. The
 * `any` argument erases the data type so any loader is accepted; these call
 * sites never inspect the data with a meaningful type. `boolean` (not the default
 * `false`) erases liveness so a live `LoaderRef<T, true>` is also accepted.
 */
export type AnyLoaderRef = LoaderRef<any, boolean>;

/** The two schema options a loader may carry. */
export type LoaderSchemaOptions = {
  paramsSchema?: StandardSchemaV1;
  searchSchema?: StandardSchemaV1;
};

/**
 * The pathParams type a loader's ctx sees, given its opts `O`: the
 * `paramsSchema` output if present, else `Fallback` (the bare-form default or
 * the route form's `RouteParams<RouteId>`).
 */
export type ParamsFromOptions<
  O,
  Fallback = Record<string, string>,
> = O extends {
  paramsSchema: infer P extends StandardSchemaV1;
}
  ? StandardSchemaV1.InferOutput<P>
  : Fallback;

/** The searchParams type a loader's ctx sees, given its opts `O`. */
export type SearchFromOptions<O> = O extends {
  searchSchema: infer S extends StandardSchemaV1;
}
  ? StandardSchemaV1.InferOutput<S>
  : Record<string, string>;

/**
 * Plugin-emitted opts for `defineLoader`. The `__moduleKey` field is threaded
 * in by the `moduleKeyPlugin` Vite transform; user code does not set it.
 * `cache` is an opt-in for sharing a cache instance across multiple loaders;
 * when omitted, `defineLoader` creates a fresh one.
 */
export type DefineLoaderOptions<T> = {
  __moduleKey?: string;
  __loaderName?: string;
  cache?: LoaderCache<T>;
  params?: string[] | '*';
  /**
   * Standard Schema validating + coercing `ctx.location.searchParams`. NOTE:
   * distinct from `params` above (that is the cache-key dependency list). On
   * failure the loader RPC responds 400 and the error boundary catches it.
   */
  searchSchema?: StandardSchemaV1;
  /**
   * Standard Schema validating + coercing `ctx.location.pathParams`. On failure
   * the loader RPC responds 404. Non-live loaders only.
   */
  paramsSchema?: StandardSchemaV1;
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
// NOTE on process-global identity, and why it is safe. `Symbol.for(...)` keys
// this map in the process-wide Symbol registry, so the REGISTRY is shared
// across every consumer of @hono-preact/iso in the same V8 isolate, including a
// long-lived Node process serving multiple tenants from one realm. What the
// registry holds is the cache INSTANCE per loader id, never a cached value: the
// instance is a set of closures over its own key, and on the server it reads
// and writes cached values through the per-request AsyncLocalStorage store (see
// `createCache` in cache.ts). So two concurrent requests, hence two tenants,
// each get their own per-request store and never observe each other's cached
// data even though they hold the same cache instance. The shared identity is
// intentional: in the browser it is what lets sibling routes (and duplicate
// hoisted copies of iso) share one cache, so a cross-route `ref.invalidate()`
// is seen everywhere; on the server the per-request ALS store supplies the
// isolation. There is no cross-tenant data leak here, so the registry stays a
// process-global by design rather than being threaded per request.
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

/**
 * The streaming-only statuses: the part of the streaming vocabulary that never
 * appears on a single-value `LoaderState` (the shared `error` stays on the
 * `LoaderState` side). Derived from the status union via `Exclude`, so the
 * exclusion set has ONE source of truth: adding a `StreamStatus` member forces
 * this map to list it (a missing key is a compile error) and it cannot drift.
 */
type StreamOnlyStatus = Exclude<StreamStatus, LoaderState<unknown>['status']>;
const STREAM_ONLY_STATUSES: Record<StreamOnlyStatus, true> = {
  connecting: true,
  open: true,
  closed: true,
};

/**
 * Narrow `LoaderDataContext`'s union to the single-value `LoaderState` half by
 * excluding the stream-only statuses. A non-live loader always carries a
 * `LoaderState` on context, so this lets `useData()` return the context value
 * directly (no re-projection, no cast). The shared `error` status stays on the
 * `LoaderState` side, which is correct: `useData()` is never called on a `live`
 * loader (it throws first).
 */
function isLoaderState(
  s: LoaderState<unknown> | StreamState<unknown>
): s is LoaderState<unknown> {
  return !(s.status in STREAM_ONLY_STATUSES);
}

// `{ live: true }` selects the accumulating-only `LoaderRef<T, true>`; these
// overloads are listed first so the literal `live: true` matches before the
// general (non-live) form. Omitting `live` (or `live: false`) yields the
// single-value `LoaderRef<T, false>`.
export function defineLoader<T>(
  fn: Loader<T>,
  opts: DefineLoaderOptions<T> & { live: true }
): LoaderRef<T, true>;
export function defineLoader<RouteId extends RegisteredPaths, T>(
  route: RouteId,
  fn: Loader<T, RouteParams<RouteId>>,
  opts: DefineLoaderOptions<T> & { live: true }
): LoaderRef<T, true>;
// Non-live bare form, with schema inference.
export function defineLoader<T, O extends LoaderSchemaOptions = {}>(
  fn: Loader<T, ParamsFromOptions<O>, SearchFromOptions<O>>,
  opts?: DefineLoaderOptions<T> & O
): LoaderRef<T, false>;
// Non-live route form, with schema inference (params default to RouteParams).
export function defineLoader<
  RouteId extends RegisteredPaths,
  T,
  O extends LoaderSchemaOptions = {},
>(
  route: RouteId,
  fn: Loader<
    T,
    ParamsFromOptions<O, RouteParams<RouteId>>,
    SearchFromOptions<O>
  >,
  opts?: DefineLoaderOptions<T> & O
): LoaderRef<T, false>;
export function defineLoader(
  fnOrRoute: Loader<unknown> | string,
  fnOrOpts?: Loader<unknown> | DefineLoaderOptions<unknown>,
  maybeOpts?: DefineLoaderOptions<unknown>
): LoaderRef<unknown, boolean> {
  // Normalize the two overload forms. The route id is type-level only (it
  // selects the param shape for the loader fn); it is not stored on the ref
  // and does not affect cache/`params` behavior.
  const isRouteForm = typeof fnOrRoute === 'string';
  const fn = (isRouteForm ? fnOrOpts : fnOrRoute) as Loader<unknown>;
  const opts = (isRouteForm ? maybeOpts : fnOrOpts) as
    | DefineLoaderOptions<unknown>
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
    searchSchema: opts?.searchSchema,
    paramsSchema: opts?.paramsSchema,
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
      // The context carries the already-projected union (built once in
      // `loader.tsx`); return it BY REFERENCE so consumers see a referentially
      // stable value across re-renders (review #7) rather than a fresh
      // projection each call. A non-live loader always carries a `LoaderState`
      // (the runner never projects `toStreamState` for it); `isLoaderState`
      // narrows to that without a cast, and the throw is unreachable defense.
      if (!isLoaderState(ctx)) {
        throw new Error(
          'loader.useData() read a streaming state on a non-live loader; this is an internal invariant violation.'
        );
      }
      return ctx;
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
        // forever on the infinite generator. Defense-in-depth for JS callers:
        // the discriminated `LoaderRef<T, true>` already makes this a type error
        // (and `Boundary` is `never` on a live loader). Keyed on `live === true`,
        // which is only ever true on the server (the client `serverLoaders` stub
        // does not carry `live`), so it never fires spuriously in the browser.
        throw new Error(
          'This is a `live` loader: consume it via `loader.View(render, { initial, reduce })`, not `loader.Boundary`.'
        );
      }
      if (!isBrowser() && props.accumulate && !live) {
        // The accumulating form is hydration-safe only for live loaders (which
        // skip SSR). A non-live loader rendered through it runs during SSR and
        // re-fetches on hydration (a content flash), or hangs renderToStringAsync
        // if its generator is infinite. `LoaderRef<T, false>.View` already makes
        // this a type error; the `.Boundary accumulate` escape hatch does not, so
        // guard it server-side. Keyed on `!isBrowser()` so it never fires on the
        // client stub (always browser, always `live: false`).
        throw new Error(
          'The accumulating `{ initial, reduce }` form requires a `live` loader. Consume a finite stream with the single-value `loader.View(render)` form.'
        );
      }
      return h(LoaderHost<unknown>, {
        loader: ref,
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
        // Defense-in-depth for JS callers; `LoaderRef<T, true>.View` is the
        // accumulating form only, so this is already a type error in TS. Keyed
        // on `live === true` (server-only; the client stub omits `live`), so it
        // never fires in the browser where the discriminant is type-level.
        throw new Error(
          'This is a `live` loader: consume it via `loader.View(render, { initial, reduce })`.'
        );
      }
      if (!isBrowser() && accumulate && !live) {
        // Non-live + accumulate runs the loader during SSR (content flash on
        // hydration, or a hang for an infinite generator). A type error for TS
        // callers (`LoaderRef<T, false>.View` is single-value only); guarded
        // server-side here for JS callers. `!isBrowser()` keeps it off the
        // client stub (always browser, always `live: false`).
        throw new Error(
          'The accumulating `loader.View(render, { initial, reduce })` form requires a `live` loader. Consume a finite stream with the single-value `loader.View(render)` form.'
        );
      }
      const Wrapped: FunctionComponent<any> = (props) =>
        h(ref.Boundary, {
          errorFallback: viewOpts?.errorFallback,
          accumulate,
          children: h(ViewRenderer, {
            props,
            render,
          }),
        });
      return Wrapped;
    },
  };

  return ref;
}
