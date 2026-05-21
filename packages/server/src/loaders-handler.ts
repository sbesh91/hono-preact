import type { Context, MiddlewareHandler } from 'hono';
import {
  GuardRedirect,
  isOutcome,
  type AppConfig,
  type Outcome,
  type ServerMiddleware,
  type ServerLoaderCtx,
  type Middleware,
} from '@hono-preact/iso';
import {
  runRequestScope,
  dispatchServer,
  partitionUse,
} from '@hono-preact/iso/internal';
import {
  sseGeneratorResponse,
  sseReadableStreamResponse,
  isAsyncGenerator,
} from './sse.js';

type GlobModule = {
  default?: unknown;
  __moduleKey?: unknown;
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

    const sl = (mod as any).serverLoaders;
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
          const ref = val as { fn: LoaderFn; use?: ReadonlyArray<unknown> };
          result[`${moduleKey}::${name}`] = { fn: ref.fn, use: ref.use ?? [] };
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
   * Returns the `use` array declared on `definePage(..., { use })` for the
   * matching page. Defaults to an empty array; the framework's generated
   * server entry will populate it once the route-server-modules consumer
   * indexes pageUse by route.
   */
  resolvePageUse?: (path: string) => ReadonlyArray<unknown>;
}

function translateOutcomeForLoader(c: Context, outcome: Outcome): Response {
  if (outcome.__outcome === 'redirect') {
    if (outcome.headers) {
      for (const [k, v] of Object.entries(outcome.headers)) c.header(k, v);
    }
    return c.json(
      {
        __outcome: 'redirect',
        to: outcome.to,
        status: outcome.status,
        headers: outcome.headers,
      },
      200
    );
  }
  if (outcome.__outcome === 'deny') {
    if (outcome.headers) {
      for (const [k, v] of Object.entries(outcome.headers)) c.header(k, v);
    }
    return c.json(
      { __outcome: 'deny', message: outcome.message },
      outcome.status
    );
  }
  // render outcome should never reach the loader RPC; this is defense in depth.
  return c.json(
    {
      __outcome: 'error',
      message: 'render outcome is page-scope only',
    },
    500
  );
}

export function loadersHandler(
  glob: LazyGlob | EagerGlob,
  opts: LoadersHandlerOptions = {}
): MiddlewareHandler {
  const { dev = false, onError, appConfig, resolvePageUse } = opts;
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

    const signal = c.req.raw.signal;

    // Chain ordering is outer -> inner: app-level middleware wraps every
    // request, page-level wraps loaders owned by that page, and per-loader
    // middleware wraps just this call. Outer middleware runs first on the
    // way in and last on the way out, matching every middleware system
    // users have seen (Hono, Express, Koa).
    const rootUse = appConfig?.use ?? [];
    const pageUse = resolvePageUse?.(validatedLocation.path) ?? [];
    const fullUse = [
      ...rootUse,
      ...pageUse,
      ...entry.use,
    ] as ReadonlyArray<Middleware>;
    const allMiddleware = partitionUse(fullUse).middleware;
    const serverMw = allMiddleware.filter(
      (m): m is ServerMiddleware<'loader'> => m.runs === 'server'
    );
    const ctx: ServerLoaderCtx = {
      scope: 'loader',
      c,
      signal,
      location: validatedLocation as never,
      module,
      loader: loaderName,
    };

    try {
      const result = await runRequestScope(
        async () => {
          const dispatch = await dispatchServer<unknown, 'loader'>({
            middleware: serverMw,
            ctx,
            inner: async () =>
              entry.fn({ c, location: validatedLocation, signal }),
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
        return sseGeneratorResponse(c, result, { emitResult: false });
      }
      if (result instanceof ReadableStream) {
        return sseReadableStreamResponse(c, result as ReadableStream<unknown>);
      }
      return c.json(result);
    } catch (err) {
      if (isOutcome(err)) {
        return translateOutcomeForLoader(c, err);
      }
      // GuardRedirect (legacy) is still thrown by guards.tsx until Phase 8.
      // Keep the legacy `{ __redirect }` wire shape so existing client stubs
      // and tests continue to work; the new `__outcome` envelope replaces it
      // when callers migrate to middleware outcomes.
      if (err instanceof GuardRedirect) {
        return c.json({ __redirect: err.location });
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
