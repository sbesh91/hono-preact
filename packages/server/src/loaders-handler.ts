import type { Context, MiddlewareHandler } from 'hono';
import { GuardRedirect } from '@hono-preact/iso';
import { runRequestScope } from '@hono-preact/iso/internal';
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

async function buildLoadersMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, LoaderFn>> {
  const result: Record<string, LoaderFn> = {};
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
        //      property carries the original loader (used by user code)
        if (typeof val === 'function') {
          result[`${moduleKey}::${name}`] = val as LoaderFn;
        } else if (val && typeof (val as { fn?: unknown }).fn === 'function') {
          result[`${moduleKey}::${name}`] = (val as { fn: LoaderFn }).fn;
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
}

export function loadersHandler(
  glob: LazyGlob | EagerGlob,
  opts: LoadersHandlerOptions = {}
): MiddlewareHandler {
  const { dev = false, onError } = opts;
  let cachedMapPromise: Promise<Record<string, LoaderFn>> | null = null;

  return async (c) => {
    const loadersMapPromise = dev
      ? buildLoadersMap(glob)
      : (cachedMapPromise ??= buildLoadersMap(glob).catch((err) => {
          cachedMapPromise = null;
          return Promise.reject(err);
        }));

    let loadersMap: Record<string, LoaderFn>;
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

    const loaderFn = loadersMap[`${module}::${loaderName}`];
    if (!loaderFn) {
      return c.json(
        { error: `Loader '${module}::${loaderName}' not found` },
        404
      );
    }

    const signal = c.req.raw.signal;

    try {
      const result = await runRequestScope(
        () =>
          Promise.resolve(loaderFn({ c, location: validatedLocation, signal })),
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
      // GuardRedirect thrown from a loader (or a guard that runs inside it)
      // is a control-flow signal, not an error. The client RPC stub
      // recognizes the `__redirect` envelope and navigates the browser
      // rather than surfacing this as a thrown error in user code.
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
