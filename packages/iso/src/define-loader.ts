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
import type { Serialize } from './internal/serialize.js';
import { createCache, type LoaderCache } from './cache.js';
import { LoaderDataContext, LoaderErrorContext } from './internal/contexts.js';
import { Loader as LoaderHost } from './internal/loader.js';
import { ViewRenderer } from './internal/view-renderer.js';
import type { AccumulateOptions } from './internal/use-loader-runner.js';
import type { LoaderState, StreamState, StreamStatus } from './loader-state.js';
import type { LoaderUse } from './internal/use-types.js';
import type { Middleware } from './define-middleware.js';
import type { StreamObserver } from './define-stream-observer.js';
import { validateTimeoutMs } from './internal/timeout.js';
import type { ServerCaller } from './server-caller.js';
export type { StreamStatus, LoaderState, StreamState } from './loader-state.js';

/**
 * The marker that selects the STANDALONE shape of `LoaderCtx`. It is the
 * default for `LoaderCtx`'s `TParams`, so a bare `LoaderCtx` (no route generic)
 * is route-independent: it has no `location`. A real params type (supplied by
 * `serverRoute(r).loader`, or written explicitly as `LoaderCtx<RouteParams<r>>`)
 * is never this marker, so it selects the route-bound shape instead. Type-only
 * (`declare const`), so it adds nothing to the runtime bundle, and unexported,
 * so user code can never accidentally name it.
 */
declare const STANDALONE_CTX: unique symbol;
type StandaloneCtxMarker = typeof STANDALONE_CTX;

/** Fields every loader ctx carries, whether standalone or route-bound. */
type LoaderCtxBase = {
  c: Context;
  signal: AbortSignal;
  /**
   * Invoke another loader or action server-side with no HTTP round-trip,
   * reusing the current request scope. Returns a `CallResult` discriminated
   * union; narrow on `ok`.
   */
  call: ServerCaller['call'];
};

/** The `location` field a route-bound ctx adds, with its params typed. */
type LoaderCtxLocation<TParams, TSearch> = {
  location: Omit<RouteHook, 'pathParams' | 'searchParams'> & {
    pathParams: TParams;
    searchParams: TSearch;
  };
};

/**
 * The single loader ctx type. One surface, two shapes selected by its generic:
 *
 * - `LoaderCtx` (no generic) is STANDALONE: the shape a bare `defineLoader(fn)`
 *   loader receives. No `location`, because a standalone loader is
 *   route-independent.
 * - `LoaderCtx<TParams, TSearch>` is ROUTE-BOUND: it adds a typed `location`
 *   (path/search params). `serverRoute(r).loader(fn)` supplies this generic
 *   automatically from the route pattern (and any param/search schema); write
 *   it explicitly as `LoaderCtx<RouteParams<'/r/:id'>>` only when annotating a
 *   callback TypeScript cannot contextually type (e.g. inside `liveStream`).
 *
 * The standalone-vs-route choice falls out of which constructor you call, so a
 * loader author names just `LoaderCtx`; the generic is inferred for them.
 */
export type LoaderCtx<
  TParams = StandaloneCtxMarker,
  TSearch = Record<string, string>,
> = LoaderCtxBase &
  ([TParams] extends [StandaloneCtxMarker]
    ? {}
    : LoaderCtxLocation<TParams, TSearch>);

export type Loader<
  T,
  TParams = Record<string, string>,
  TSearch = Record<string, string>,
> =
  | ((ctx: LoaderCtx<TParams, TSearch>) => Promise<T>)
  | ((ctx: LoaderCtx<TParams, TSearch>) => Promise<ReadableStream<T>>)
  | ((ctx: LoaderCtx<TParams, TSearch>) => AsyncGenerator<T, void, unknown>);

// The accumulating (streaming) `.View` form: streaming loaders only. The render fn
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

// The single-value `.View` form: non-streaming loaders. The render fn receives the
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
 * A reference to a defined loader. `Live` (the streaming discriminant, fixed by
 * the fn return type: `AsyncGenerator` -> `true`, `Promise` -> `false`) selects
 * the consumption surface at the type level:
 *
 * - `LoaderRef<T, true>` (a streaming loader) exposes ONLY the accumulating
 *   `View(render, { initial, reduce })` form; `useData` and `Boundary` are
 *   `never` (a streaming loader has no single value).
 * - `LoaderRef<T, false>` exposes ONLY the single-value `View(render)` form,
 *   plus `useData()` and `Boundary`.
 *
 * Using the wrong form is therefore a compile error rather than a runtime throw.
 * `Live` defaults to `false` (the common, non-streaming case) so a bare
 * `LoaderRef<T>` has a callable single-value `.View`. Code that must accept
 * either form (internals, `AnyLoaderRef`) parameterizes it as
 * `LoaderRef<T, boolean>`, whose `View` is the union of both shapes (not
 * directly callable; such code never calls `.View`, it only holds/forwards the ref).
 */
export interface LoaderRef<T, Live extends boolean = false> {
  readonly __id: symbol;
  readonly __moduleKey?: string;
  readonly __loaderName?: string;
  /** The route pattern this loader is bound to (e.g. `/movies/:id`), set by
   * `serverRoute(r).loader(fn)`. `undefined` for route-independent loaders
   * created with bare `defineLoader(fn)`. Consumed by the server dispatcher
   * to select the route-matched loader set. */
  readonly __routeId?: string;
  /** Whether this loader is bound to a route (created via `serverRoute().loader`).
   * Derived from `__routeId` on the server ref; threaded explicitly onto the
   * client stub by the Vite plugin (which has no route string to set
   * `__routeId`). `LoaderHost` reads it to refuse a route-bound loader consumed
   * with no resolvable location on either side. */
  readonly __routeBound: boolean;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  readonly params: string[] | '*';
  /** Search-params schema, as authored on `serverRoute(r).loader(fn, { searchSchema })`. */
  readonly searchSchema?: StandardSchemaV1;
  /** Path-params schema, as authored on `serverRoute(r).loader(fn, { paramsSchema })`. */
  readonly paramsSchema?: StandardSchemaV1;
  /** True when this loader opts out of SSR (client-only subscription). Set via
   * `{ live: true }` in opts; runtime flag only (the streaming discriminant
   * `Live` is driven by the fn return type). */
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
   * `never` on a streaming loader (it has no single value).
   */
  useData: Live extends true ? never : () => LoaderState<Serialize<T>>;
  useError(): Error | null;
  invalidate(): void;
  /**
   * The lower-level state-based boundary (single-value loaders): it renders its
   * children eagerly and provides the loader's state on context, which children
   * read via `useData()` (pattern-match on `status`). `never` on a streaming
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
   * fixed by the fn return type: a streaming loader (AsyncGenerator fn) exposes
   * only the accumulating `View(render, { initial, reduce })` form; a
   * single-value loader (Promise fn) exposes only the single-value `View(render)`
   * form. The other form is a compile error.
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
 * `false`) erases liveness so a streaming `LoaderRef<T, true>` is also accepted.
 */
export type AnyLoaderRef = LoaderRef<any, boolean>;

/** The two schema options a route-bound loader may carry. */
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
 * Full internal opts shared by `makeLoaderRef` and `_defineRouteLoader`.
 * Plugin-emitted opts for `defineLoader`. The `__moduleKey` field is threaded
 * in by the `moduleKeyPlugin` Vite transform; user code does not set it.
 * `cache` is an opt-in for sharing a cache instance across multiple loaders;
 * when omitted, `makeLoaderRef` creates a fresh one.
 * Route-specific fields (`paramsSchema`, `searchSchema`, `params`) are
 * present here but absent from `StandaloneOpts` (which is derived via `Omit`).
 */
export type DefineLoaderOptions<T> = {
  /**
   * Marks this loader as a client-only subscription that never runs on SSR
   * (the `{ live }` flag controls runtime SSR skip behavior; the streaming
   * type discriminant is driven by the fn return type instead). Usually
   * composed via `liveStream`; pass `true` when the generator is an unbounded
   * subscription that must not hang `renderToStringAsync`.
   */
  live?: boolean;
  cache?: LoaderCache<T>;
  /**
   * Per-loader timeout in milliseconds. When omitted, the handler applies
   * its configured default (30s). Pass `false` to disable the timeout for
   * this loader (rely solely on the request signal). Streaming loaders
   * (AsyncGenerator fn, live or not) default to `false` (no 30s cap, since a
   * stream legitimately runs long) unless this is set explicitly.
   */
  timeoutMs?: number | false;
  /**
   * Per-loader middleware and (for streaming loaders) stream observers.
   */
  use?: LoaderUse<T, boolean>;
  /** Set by the module-key Vite plugin; not intended for user code. */
  __moduleKey?: string;
  __loaderName?: string;
  /** Set by `_defineRouteLoader`; not intended for user code. */
  __routeId?: string;
  /** Set by the Vite plugin's client loader stub to mark a route-bound loader
   * when no `__routeId` string is available client-side; not for user code. */
  __routeBound?: boolean;
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
};

/**
 * Opts shape for a bare `defineLoader(fn, opts?)` call: `DefineLoaderOptions`
 * minus the route-only fields. Derived so there is a single source of truth.
 * Internal only; caller code relies on inference rather than naming this type.
 */
type StandaloneOpts<T> = Omit<
  DefineLoaderOptions<T>,
  'paramsSchema' | 'searchSchema' | 'params'
>;

// Stash a shared cache map on globalThis so duplicate copies of
// @hono-preact/iso (workspace hoisting quirks) still see the same map.
// The module-key plugin threads `{ __moduleKey }` into every `defineLoader`
// call at EVERY importer of a `.server.*` module, so without this dedup each
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
 * excluding the stream-only statuses. A non-streaming loader always carries a
 * `LoaderState` on context, so this lets `useData()` return the context value
 * directly (no re-projection, no cast). The shared `error` status stays on the
 * `LoaderState` side, which is correct: `useData()` is never called on a
 * streaming loader (it throws first).
 */
function isLoaderState(
  s: LoaderState<unknown> | StreamState<unknown>
): s is LoaderState<unknown> {
  return !(s.status in STREAM_ONLY_STATUSES);
}

/**
 * Symbol that `liveStream` stamps onto the generator function it returns.
 * `makeLoaderRef` reads it via `isLiveStreamFn` (no cast; plain `in` check)
 * to auto-set `live: true` without requiring callers to pass the flag.
 * Exported so `server-route.ts` can import it for tagging without a cast.
 */
export const LIVE_STREAM_MARKER = Symbol('hono-preact/liveStream');

/** Returns true when fn was produced by `liveStream` (carries the marker). */
function isLiveStreamFn(fn: object): boolean {
  return LIVE_STREAM_MARKER in fn;
}

// Detect whether a fn is an async generator function at runtime so we can
// guard `.View`/`.Boundary`/`.useData()` without coupling the guard to the
// `live` SSR flag (which is a separate concept after the redesign). The
// prototype check is the standard V8/SpiderMonkey/JavaScriptCore idiom; it does
// not rely on `.name`, which can be minified away.
const ASYNC_GENERATOR_FN_PROTO = Object.getPrototypeOf(async function* () {});

function isAsyncGeneratorFn(fn: unknown): boolean {
  return (
    typeof fn === 'function' &&
    Object.getPrototypeOf(fn) === ASYNC_GENERATOR_FN_PROTO
  );
}

// Overload ordering is load-bearing: the streaming (AsyncGenerator) overload is
// listed FIRST, so a loosely-typed fn (any / union return type) resolves to the
// streaming ref. Well-typed fns (clear Promise or AsyncGenerator return) resolve
// correctly to the matching discriminant.
//
// `{ live }` is a RUNTIME SSR flag only (skip on server when true). The type
// discriminant is driven solely by the fn return type: AsyncGenerator fn ->
// LoaderRef<T, true> (accumulating .View only); Promise fn -> LoaderRef<T, false>
// (single-value .View + Boundary + useData).

// `defineLoader` infers the STANDALONE ctx: a bare `LoaderCtx` (no route
// generic), which has no `location`. A standalone loader is route-independent;
// reach for `serverRoute(r).loader` when path/search params are needed.

/** Streaming / accumulating loader: fn returns an AsyncGenerator. */
export function defineLoader<T>(
  fn: (ctx: LoaderCtx) => AsyncGenerator<T, void, unknown>,
  opts?: StandaloneOpts<T>
): LoaderRef<T, true>;
/** Single-value loader: fn returns a Promise. */
export function defineLoader<T>(
  fn: (ctx: LoaderCtx) => Promise<T>,
  opts?: StandaloneOpts<T>
): LoaderRef<T, false>;
export function defineLoader(
  fn: Loader<unknown>,
  opts?: StandaloneOpts<unknown>
): LoaderRef<unknown, boolean> {
  return makeLoaderRef(fn, opts);
}

/**
 * Internal route-binding helper used by `serverRoute(r).loader(fn, opts)`.
 * Passes `__routeId` in opts so the ref knows which route it is bound to.
 * NOT exported from `index.ts`; import directly from `define-loader.js` in
 * server-route.ts and tests only.
 *
 * Overload ordering mirrors `defineLoader`: streaming (AsyncGenerator) first so
 * loosely-typed fns resolve to the streaming ref. The third overload accepts the
 * `Loader<unknown>` union used internally by `serverRoute`'s dispatch shim.
 */
/** Streaming route-bound loader: fn returns an AsyncGenerator. The ctx is the
 * route-bound `LoaderCtx<Record<string, string>>` (has `location`); the precise
 * param types are supplied by `serverRoute(r).loader`'s public overloads. */
export function _defineRouteLoader<T>(
  routeId: string,
  fn: (
    ctx: LoaderCtx<Record<string, string>>
  ) => AsyncGenerator<T, void, unknown>,
  opts?: DefineLoaderOptions<T>
): LoaderRef<T, true>;
/** Single-value route-bound loader: fn returns a Promise. */
export function _defineRouteLoader<T>(
  routeId: string,
  fn: (ctx: LoaderCtx<Record<string, string>>) => Promise<T>,
  opts?: DefineLoaderOptions<T>
): LoaderRef<T, false>;
/** Internal shim: accepts the `Loader<unknown>` union forwarded by `serverRoute`. */
export function _defineRouteLoader(
  routeId: string,
  fn: Loader<unknown>,
  opts?: DefineLoaderOptions<unknown>
): LoaderRef<unknown, boolean>;
export function _defineRouteLoader(
  routeId: string,
  fn: Loader<unknown>,
  opts?: DefineLoaderOptions<unknown>
): LoaderRef<unknown, boolean> {
  return makeLoaderRef(fn, { ...opts, __routeId: routeId });
}

/**
 * Internal constructor for the Vite plugin's client loader stub. Unlike public
 * `defineLoader` (which infers the STANDALONE ctx, no `location`), the fn here
 * receives the route-bound ctx, so the stub reads `ctx.location` to forward it
 * to the loader RPC with NO cast. NOT exported from `index.ts`; imported
 * directly by `internal/loader-stub.ts`.
 */
export function _defineLoaderStub<T>(
  fn: (ctx: LoaderCtx<Record<string, string>>) => Promise<T>,
  opts?: DefineLoaderOptions<T>
): LoaderRef<T, false>;
export function _defineLoaderStub(
  fn: Loader<unknown>,
  opts?: DefineLoaderOptions<unknown>
): LoaderRef<unknown, boolean> {
  return makeLoaderRef(fn, opts);
}

function makeLoaderRef(
  fn: Loader<unknown>,
  opts?: DefineLoaderOptions<unknown>
): LoaderRef<unknown, boolean> {
  // liveStream-tagged fns are inherently unbounded; always live regardless of
  // opts. Honouring an explicit { live: false } on a liveStream fn would
  // SSR-pump a never-completing generator, so the marker wins unconditionally.
  // `live` has exactly ONE runtime job: tell the SSR runner to SKIP this
  // generator (an unbounded subscription must not run during renderToStringAsync
  // / the streaming document drain). It does NOT drive the SSR state projection
  // (that is keyed on the consumption form in `loader.tsx`) nor the timeout
  // default (keyed on `isStreaming` below).
  const live = isLiveStreamFn(fn) ? true : (opts?.live ?? false);
  // Runtime streaming discriminant: fn is an async generator function.
  // Used for .View / .Boundary / useData() guards and the timeout default,
  // independent of the `live` SSR-skip flag.
  const isStreaming = isAsyncGeneratorFn(fn);

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
    __routeId: opts?.__routeId,
    fn,
    cache: cache!,
    params: opts?.params ?? [],
    searchSchema: opts?.searchSchema,
    paramsSchema: opts?.paramsSchema,
    live,
    // Route-bound iff created via `serverRoute().loader` (which threads a
    // `__routeId`) or explicitly flagged by the client stub the Vite plugin
    // emits. Read by `LoaderHost` to refuse a route-bound loader consumed with
    // no resolvable location, on BOTH the server and the client.
    __routeBound: opts?.__routeBound ?? opts?.__routeId !== undefined,
    // Streaming loaders (bounded OR unbounded) legitimately run longer than the
    // single-shot default; the handler's 30s cap would abort a long stream
    // mid-flight. Keyed on `isStreaming`, NOT `live`, so a finite (non-live)
    // streaming loader is exempt too. Single-value loaders keep the default.
    timeoutMs: opts?.timeoutMs ?? (isStreaming ? false : undefined),
    // LoaderUse<T, boolean> structurally collapses to the same shape the
    // partitioner accepts; the cast hides only the generic narrowing on
    // StreamObserver's TChunk/TResult which is invariant. Identity-preserving.
    use: (opts?.use ?? []) as ReadonlyArray<
      Middleware | StreamObserver<unknown, never>
    >,
    useData() {
      if (isStreaming) {
        throw new Error(
          'This is a streaming loader: consume it via `loader.View(render, { initial, reduce })`, not `loader.useData()`.'
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
      // projection each call. A non-streaming loader always carries a `LoaderState`
      // (the runner never projects `toStreamState` for it); `isLoaderState`
      // narrows to that without a cast, and the throw is unreachable defense.
      if (!isLoaderState(ctx)) {
        throw new Error(
          'loader.useData() read a streaming state on a non-streaming loader; this is an internal invariant violation.'
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
      // The same `accumulate` <-> `isStreaming` invariant `View` enforces,
      // applied to the lower-level escape hatch (`View` delegates here, so
      // these guards must allow streaming+accumulate, which is exactly what
      // `View` passes).
      if (isStreaming && !props.accumulate) {
        // A streaming loader has no single value; a bare `.Boundary` would
        // suspend forever on the infinite generator. Defense-in-depth for JS
        // callers: the discriminated `LoaderRef<T, true>` already makes this a
        // type error (and `Boundary` is `never` on a streaming loader). Keyed
        // on the fn prototype check, which is reliable across both SSR and
        // client paths.
        throw new Error(
          'This is a streaming loader: consume it via `loader.View(render, { initial, reduce })`, not `loader.Boundary`.'
        );
      }
      // Non-streaming + accumulate is valid on the server: `DataReader` keys the
      // SSR projection on the consumption form (accumulate), so an accumulating
      // consumer renders the `connecting` StreamState on the server, matching the
      // client's first render (it reconnects on mount).
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
      // A streaming loader has no single value, so it must use the accumulating
      // form; conversely the accumulating form is hydration-safe only for
      // streaming loaders.
      const accumulate =
        viewOpts &&
        typeof viewOpts.reduce === 'function' &&
        'initial' in viewOpts
          ? { initial: viewOpts.initial, reduce: viewOpts.reduce }
          : undefined;
      if (isStreaming && !accumulate) {
        // Defense-in-depth for JS callers; `LoaderRef<T, true>.View` is the
        // accumulating form only, so this is already a type error in TS.
        throw new Error(
          'This is a streaming loader: consume it via `loader.View(render, { initial, reduce })`.'
        );
      }
      // Non-streaming + accumulate is valid on the server: `DataReader` keys the
      // SSR projection on the consumption form (accumulate), so an accumulating
      // consumer renders the `connecting` StreamState on the server, matching the
      // client's first render (it reconnects on mount).
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
