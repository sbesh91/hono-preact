import type { MiddlewareHandler } from 'hono';
import {
  isOutcome,
  timeoutOutcome,
  createCaller,
  type AppConfig,
  type ServerLoaderCtx,
  type StandardSchemaV1,
} from '@hono-preact/iso';
import { runRequestScope, dispatchServer } from '@hono-preact/iso/internal';
import {
  coerceLoaderLocation,
  type LooseLoaderFn,
} from '@hono-preact/iso/internal/runtime';
import { composeServerChain } from './compose-server-chain.js';
import { assertPageUseResolver } from './page-use-guard.js';
import { translateOutcomeForLoader } from './outcome-translation.js';
import {
  sseGeneratorResponse,
  sseReadableStreamResponse,
  isAsyncGenerator,
} from './sse.js';

type GlobModule = {
  default?: unknown;
  __moduleKey?: unknown;
  serverLoaders?: unknown;
  [key: string]: unknown;
};
type LazyGlob = Record<string, () => Promise<unknown>>;
type EagerGlob = Record<string, GlobModule>;
// routeServerModules returns the manifest's serverImports array directly;
// buildLoadersMap only uses values (Object.entries discards the key), so
// ReadonlyArray<() => Promise<unknown>> is an accepted shape at runtime.
type LazyArray = ReadonlyArray<() => Promise<unknown>>;

type SerializedLocation = {
  path: string;
  pathParams: Record<string, string>;
  searchParams: Record<string, string>;
};

type LoaderEntry = {
  fn: LooseLoaderFn;
  use: ReadonlyArray<unknown>;
  timeoutMs?: number | false;
  searchSchema?: StandardSchemaV1;
  paramsSchema?: StandardSchemaV1;
  /** Route pattern this loader is bound to (from `ref.__routeId`). `undefined`
   * for route-independent loaders created with bare `defineLoader(fn)`. */
  routeId?: string;
};

async function buildLoadersMap(
  glob: LazyGlob | EagerGlob | LazyArray
): Promise<Record<string, LoaderEntry>> {
  const result: Record<string, LoaderEntry> = {};
  for (const [, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    const moduleKey = mod.__moduleKey;
    if (typeof moduleKey !== 'string') continue;

    const sl = mod.serverLoaders;
    if (sl && typeof sl === 'object') {
      for (const [name, val] of Object.entries(sl)) {
        // Two accepted shapes:
        //   1. a raw loader function `(ctx) => ...` (used by unit-test fixtures)
        //   2. a `LoaderRef` returned by `defineLoader(fn)`, whose `.fn`
        //      property carries the original loader and `.use` carries any
        //      attached middleware/observers.
        if (typeof val === 'function') {
          result[`${moduleKey}::${name}`] = {
            fn: val as LooseLoaderFn,
            use: [],
          };
        } else if (val && typeof (val as { fn?: unknown }).fn === 'function') {
          const ref = val as {
            fn: LooseLoaderFn;
            use?: ReadonlyArray<unknown>;
            timeoutMs?: number | false;
            searchSchema?: StandardSchemaV1;
            paramsSchema?: StandardSchemaV1;
            __routeId?: string;
          };
          result[`${moduleKey}::${name}`] = {
            fn: ref.fn,
            use: ref.use ?? [],
            timeoutMs: ref.timeoutMs,
            searchSchema: ref.searchSchema,
            paramsSchema: ref.paramsSchema,
            routeId: ref.__routeId,
          };
        }
      }
    }
  }
  return result;
}

function validateLocation(loc: unknown): SerializedLocation | null {
  if (typeof loc !== 'object' || loc === null) return null;
  const o = loc as Record<string, unknown>;
  if (typeof o.path !== 'string') return null;
  if (typeof o.pathParams !== 'object' || o.pathParams === null) return null;
  if (typeof o.searchParams !== 'object' || o.searchParams === null)
    return null;
  return {
    path: o.path,
    pathParams: o.pathParams as Record<string, string>,
    searchParams: o.searchParams as Record<string, string>,
  };
}

export interface LoadersHandlerOptions {
  /**
   * When true, rebuild the loaders map on every request (so edits to
   * `.server.ts` files take effect without a server restart). When false
   * (default), the map is built once on first request and cached for the
   * life of the process. The framework's generated server entry passes
   * `{ dev: import.meta.env.DEV }`; custom wirings should set this
   * explicitly rather than relying on a Vite-only build-time constant.
   */
  dev?: boolean;
  /**
   * Called for every error a loader throws. Use it to hook into your
   * observability stack (Sentry, console, etc.). The handler still
   * responds with a sanitized 500; the hook is purely a side channel.
   */
  onError?: (err: unknown, ctx: { module: string; loader: string }) => void;
  /**
   * Root layer of the middleware chain. The framework's generated server
   * entry threads the user's `defineApp({ use })` result here. Each loader
   * request composes the chain as
   * `[...appConfig.use, ...resolvePageUse(path), ...loader.use]`.
   */
  appConfig?: AppConfig;
  /**
   * Page-layer `use` lookup keyed by a route-bound loader's OWN declared route
   * PATTERN (`ref.__routeId`, e.g. `/movies/:id`), NOT a concrete URL. Returns
   * the composed page-layer `use` for that pattern, sourced from the route
   * manifest's `routeUse` (which already folds in ancestor `use` outer-first).
   * The lookup may be sync (an in-memory map) or async (loaded lazily on first
   * request). The handler awaits the result either way.
   *
   * Pass `pageUseResolver.byPattern` from makePageUseResolver: it resolves the
   * pattern key exactly. Do NOT pass `byPath` here; that URL fuzzy-matcher can
   * resolve a pattern to a sibling same-shaped pattern's guards (`/a/:x` vs
   * `/a/:y`), applying the wrong page's auth chain.
   *
   * REQUIRED: page-level `use` is where route/layout auth gates live, so an
   * absent resolver would silently drop them on the loader RPC path, exposing
   * data the gate should protect. The handler validates this at construction
   * and throws rather than fetching loaders through a guard-less chain.
   */
  resolvePageUse: (
    path: string
  ) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;
  /**
   * Default loader timeout in milliseconds applied when a loader does not
   * declare its own `timeoutMs`. Defaults to 30000 (30 seconds). Pass
   * `false` to disable the default (only loader-level `timeoutMs` enforces
   * a deadline).
   */
  defaultTimeoutMs?: number | false;
}

export function loadersHandler(
  glob: LazyGlob | EagerGlob | LazyArray,
  opts: LoadersHandlerOptions
): MiddlewareHandler {
  assertPageUseResolver(opts?.resolvePageUse, {
    handler: 'loadersHandler',
    option: 'opts.resolvePageUse',
    surface: 'loader RPC path',
  });
  const {
    dev = false,
    onError,
    appConfig,
    resolvePageUse,
    defaultTimeoutMs = 30_000,
  } = opts;
  let cachedMapPromise: Promise<Record<string, LoaderEntry>> | null = null;

  return async (c) => {
    const loadersMapPromise = dev
      ? buildLoadersMap(glob)
      : (cachedMapPromise ??= buildLoadersMap(glob).catch((err) => {
          cachedMapPromise = null;
          return Promise.reject(err);
        }));

    let loadersMap: Record<string, LoaderEntry>;
    try {
      loadersMap = await loadersMapPromise;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to load loaders: ${message}` }, 503);
    }

    let body: { module: unknown; loader: unknown; location: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { module, loader: loaderName, location } = body;
    if (typeof module !== 'string') {
      return c.json(
        { error: 'Request body must include string field: module' },
        400
      );
    }
    if (typeof loaderName !== 'string') {
      return c.json(
        { error: 'Request body must include string field: loader' },
        400
      );
    }

    const validatedLocation = validateLocation(location);
    if (!validatedLocation) {
      return c.json(
        {
          error:
            'Request body must include object field: location with shape { path: string, pathParams: object, searchParams: object }',
        },
        400
      );
    }

    const entry = loadersMap[`${module}::${loaderName}`];
    if (!entry) {
      return c.json(
        { error: `Loader '${module}::${loaderName}' not found` },
        404
      );
    }

    // Chain ordering is app (outermost) -> page -> per-loader (`use`).
    // Route-bound loaders (ref.__routeId set) resolve guards from their OWN
    // declared route, not the client-sent path; route-independent loaders
    // (bare defineLoader) receive no page tier. A route-bound loader whose
    // declared route the resolver cannot handle is rejected immediately (500)
    // rather than being run guard-less, which would silently drop auth gates.
    const routeBound = typeof entry.routeId === 'string';
    let composedChain: Awaited<ReturnType<typeof composeServerChain<'loader'>>>;
    try {
      composedChain = await composeServerChain<'loader'>({
        requestSignal: c.req.raw.signal,
        unitTimeoutMs: entry.timeoutMs,
        defaultTimeoutMs,
        appConfig,
        resolvePageUse: routeBound ? resolvePageUse : () => [],
        path: routeBound ? entry.routeId! : '',
        unitUse: entry.use,
      });
    } catch (err) {
      if (routeBound) {
        // resolvePageUse threw for the declared route id; fail closed so the
        // loader never runs through a guard-less chain.
        const msg = err instanceof Error ? err.message : String(err);
        return c.json(
          {
            error: `Route-bound loader '${entry.routeId}' could not resolve its page-use chain: ${msg}`,
          },
          500
        );
      }
      throw err;
    }
    const { serverMw, observers, resolvedTimeoutMs, timeoutSignal, signal } =
      composedChain;
    const ctx: ServerLoaderCtx = {
      scope: 'loader',
      c,
      signal,
      location: validatedLocation,
      module,
      loader: loaderName,
    };

    // A loader-attributable failure: fire onError and return the RPC error
    // envelope. In production we never leak the loader's error message (it may
    // carry PII, internal stack hints, or probing signal); loader errors users
    // want to surface should be returned as data, not thrown.
    const loaderFailure = (err: unknown) => {
      onError?.(err, { module, loader: loaderName });
      const message =
        dev && err instanceof Error ? err.message : 'Loader failed';
      return c.json({ error: message }, 500);
    };

    // The try scopes loader EXECUTION. Building the SSE Response for a streaming
    // result is kept OUTSIDE it (below): the generator/stream body runs lazily
    // during the response, so a fault there is framework wiring, not the
    // loader's throw, and must not be reported as 'Loader failed'. A finite
    // value, by contrast, is serialized synchronously by c.json -- a
    // non-serializable return is a loader-data fault, so that one IS attributed.
    let result: unknown;
    try {
      result = await runRequestScope(
        async () => {
          const dispatch = await dispatchServer<unknown, 'loader'>({
            middleware: serverMw,
            ctx,
            inner: async () => {
              const { pathParams, searchParams } = await coerceLoaderLocation(
                {
                  searchSchema: entry.searchSchema,
                  paramsSchema: entry.paramsSchema,
                },
                validatedLocation.pathParams,
                validatedLocation.searchParams
              );
              const inner = await entry.fn({
                c,
                location: {
                  path: validatedLocation.path,
                  pathParams,
                  searchParams,
                },
                signal,
                call: createCaller(c).call,
              });
              // A loader that does `return redirect('/login')` instead of
              // `throw redirect('/login')` would otherwise ship the outcome
              // JSON shape as a normal 200 response and bypass envelope
              // translation. Normalize by re-throwing so the existing
              // outcome-catching path translates it.
              if (isOutcome(inner)) throw inner;
              return inner;
            },
          });
          if (dispatch.kind === 'outcome') {
            // Throw to unify with non-outcome error translation below.
            throw dispatch.outcome;
          }
          return dispatch.value;
        },
        { honoContext: c }
      );
    } catch (err) {
      if (isOutcome(err)) {
        return translateOutcomeForLoader(c, err);
      }
      // Distinguish a deadline-driven abort from any other thrown error.
      // AbortSignal.timeout sets signal.reason to a DOMException named
      // 'TimeoutError'; AbortSignal.any propagates that reason. Re-check the
      // composed signal because the loader's own throw may be the
      // *consequence* of the signal aborting (e.g. fetch rejecting with the
      // abort reason).
      if (
        timeoutSignal?.aborted &&
        timeoutSignal.reason instanceof DOMException &&
        timeoutSignal.reason.name === 'TimeoutError' &&
        typeof resolvedTimeoutMs === 'number'
      ) {
        return translateOutcomeForLoader(c, timeoutOutcome(resolvedTimeoutMs));
      }
      return loaderFailure(err);
    }

    if (isAsyncGenerator(result)) {
      return sseGeneratorResponse(c, result, {
        emitResult: false,
        observers,
        observerCtx: ctx,
        signal: timeoutSignal,
        timeoutMs:
          typeof resolvedTimeoutMs === 'number' ? resolvedTimeoutMs : undefined,
      });
    }
    if (result instanceof ReadableStream) {
      return sseReadableStreamResponse(c, result, {
        observers,
        observerCtx: ctx,
        signal: timeoutSignal,
        timeoutMs:
          typeof resolvedTimeoutMs === 'number' ? resolvedTimeoutMs : undefined,
      });
    }
    // Serializing the finite value can throw (e.g. a BigInt or circular ref in
    // the loader's return): that is a loader-data fault, attributed like any
    // other loader throw rather than left to the default error handler.
    try {
      return c.json(result);
    } catch (err) {
      return loaderFailure(err);
    }
  };
}
