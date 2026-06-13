import type { Context, MiddlewareHandler } from 'hono';
import {
  isOutcome,
  timeoutOutcome,
  type AppConfig,
  type ServerMiddleware,
  type ServerLoaderCtx,
  type Middleware,
  type StreamObserver,
} from '@hono-preact/iso';
import {
  runRequestScope,
  dispatchServer,
  partitionUse,
} from '@hono-preact/iso/internal';
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

type SerializedLocation = {
  path: string;
  pathParams: Record<string, string>;
  searchParams: Record<string, string>;
};

type LoaderFn = (props: {
  c: Context;
  location: SerializedLocation;
  signal: AbortSignal;
}) => Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;

type LoaderEntry = {
  fn: LoaderFn;
  use: ReadonlyArray<unknown>;
  timeoutMs?: number | false;
};

async function buildLoadersMap(
  glob: LazyGlob | EagerGlob
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
          result[`${moduleKey}::${name}`] = { fn: val as LoaderFn, use: [] };
        } else if (val && typeof (val as { fn?: unknown }).fn === 'function') {
          const ref = val as {
            fn: LoaderFn;
            use?: ReadonlyArray<unknown>;
            timeoutMs?: number | false;
          };
          result[`${moduleKey}::${name}`] = {
            fn: ref.fn,
            use: ref.use ?? [],
            timeoutMs: ref.timeoutMs,
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
   * Per-page layer lookup keyed by the matched route's location path.
   * Returns the composed page-layer `use` for the matched route pattern,
   * sourced from the route manifest's `routeUse` (which already folds in
   * ancestor `use` outer-first). The lookup may be sync (an in-memory map)
   * or async (loaded lazily on first request). The handler awaits the result
   * either way. Default returns an empty array.
   */
  resolvePageUse?: (
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
  glob: LazyGlob | EagerGlob,
  opts: LoadersHandlerOptions = {}
): MiddlewareHandler {
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

    const resolvedTimeoutMs: number | false =
      entry.timeoutMs !== undefined ? entry.timeoutMs : defaultTimeoutMs;
    const timeoutSignal =
      resolvedTimeoutMs === false
        ? undefined
        : AbortSignal.timeout(resolvedTimeoutMs);
    const signal = timeoutSignal
      ? AbortSignal.any([c.req.raw.signal, timeoutSignal])
      : c.req.raw.signal;

    // Chain ordering is outer -> inner: app-level middleware wraps every
    // request, page-level wraps loaders owned by that page, and per-loader
    // middleware wraps just this call. Outer middleware runs first on the
    // way in and last on the way out, matching every middleware system
    // users have seen (Hono, Express, Koa).
    const rootUse = appConfig?.use ?? [];
    const pageUse = (await resolvePageUse?.(validatedLocation.path)) ?? [];
    const fullUse: ReadonlyArray<Middleware | StreamObserver<unknown, never>> =
      [...rootUse, ...pageUse, ...entry.use] as ReadonlyArray<
        Middleware | StreamObserver<unknown, never>
      >;
    const { middleware: allMiddleware, observers } = partitionUse(fullUse);
    const serverMw = allMiddleware.filter(
      (m): m is ServerMiddleware<'loader'> => m.runs === 'server'
    );
    const ctx: ServerLoaderCtx = {
      scope: 'loader',
      c,
      signal,
      location: validatedLocation,
      module,
      loader: loaderName,
    };

    try {
      const result = await runRequestScope(
        async () => {
          const dispatch = await dispatchServer<unknown, 'loader'>({
            middleware: serverMw,
            ctx,
            inner: async () => {
              const inner = await entry.fn({
                c,
                location: validatedLocation,
                signal,
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

      if (isAsyncGenerator(result)) {
        return sseGeneratorResponse(c, result, {
          emitResult: false,
          observers,
          observerCtx: ctx,
          signal: timeoutSignal,
          timeoutMs:
            typeof resolvedTimeoutMs === 'number'
              ? resolvedTimeoutMs
              : undefined,
        });
      }
      if (result instanceof ReadableStream) {
        return sseReadableStreamResponse(c, result, {
          observers,
          observerCtx: ctx,
          signal: timeoutSignal,
          timeoutMs:
            typeof resolvedTimeoutMs === 'number'
              ? resolvedTimeoutMs
              : undefined,
        });
      }
      return c.json(result);
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
      onError?.(err, { module, loader: loaderName });
      // In production we never leak the loader's error message: it may
      // carry PII, internal stack hints, or details that help an attacker
      // probe the system. Loader errors users want to surface should be
      // returned as data, not thrown.
      const message =
        dev && err instanceof Error ? err.message : 'Loader failed';
      return c.json({ error: message }, 500);
    }
  };
}
