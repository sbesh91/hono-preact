import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import type { LoaderRef } from '../define-loader.js';
import { isBrowser } from '../is-browser.js';
import { getRequestHonoContext } from '../cache.js';
import { fetchLoaderData } from './loader-fetch.js';
import { registerServerStreamingLoader } from './streaming-ssr.js';
import type {
  ServerMiddleware,
  ServerLoaderCtx,
  Middleware,
} from '../define-middleware.js';
import { dispatchServer } from './middleware-runner.js';
import { partitionUse } from './use-partitioner.js';

export type LoaderRunCallbacks<T> = {
  onChunk: (value: T) => void;
  onError: (err: Error) => void;
  onEnd: () => void;
};

function isAsyncGenerator(
  value: unknown
): value is AsyncGenerator<unknown, unknown, unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] === 'function' &&
    typeof (value as { next?: unknown }).next === 'function'
  );
}

/**
 * Invoke a loader at runtime. Picks between client-side RPC fetch
 * (when in browser + has __moduleKey) and direct fn invocation (SSR
 * or test). Direct fn handles async-generator + ReadableStream by
 * unwrapping the first chunk and registering continued chunks with
 * the per-id streaming-SSR registry.
 */
export function runLoader<T>(
  loaderRef: LoaderRef<T>,
  location: RouteHook,
  id: string,
  signal: AbortSignal,
  callbacks: LoaderRunCallbacks<T>
): Promise<T> {
  const useFetchPath =
    isBrowser() &&
    typeof fetch === 'function' &&
    loaderRef.__moduleKey !== undefined;

  const loaderName = loaderRef.__loaderName ?? 'default';

  if (useFetchPath) {
    return fetchLoaderData<T>(
      loaderRef.__moduleKey!,
      loaderName,
      {
        path: location.path,
        pathParams: (location.pathParams ?? {}) as Record<string, string>,
        searchParams: (location.searchParams ?? {}) as Record<string, string>,
      },
      signal,
      callbacks
    );
  }

  // Direct-fn path. Result may be a Promise<T>, a
  // Promise<ReadableStream<T>>, or an AsyncGenerator<T>. For an async
  // generator (server-side streaming loader), take the first chunk
  // for the Suspense render and register the rest with the per-request
  // streaming-ssr registry so renderPage can flush further chunks.
  return (async () => {
    const ctx = {
      location,
      signal,
      get c(): Context {
        const c = getRequestHonoContext<Context>();
        if (c === undefined) {
          throw new Error(
            'ctx.c is not available: this loader was invoked without an active server request scope. ' +
              'Loaders that read ctx.c run inside loadersHandler (RPC) or renderPage (SSR); test/edge paths must avoid reading it.'
          );
        }
        return c;
      },
    };

    const runInner = async (): Promise<unknown> => {
      const result = await (loaderRef.fn(ctx) as Promise<unknown>);
      if (isAsyncGenerator(result)) {
        const step = await result.next();
        if (step.done) return undefined; // generator returned without yielding
        registerServerStreamingLoader(id, result);
        return step.value;
      }
      return result;
    };

    // If per-loader middleware is attached, dispatch the chain around the
    // loader fn. We pre-build a ServerLoaderCtx that proxies `c` through the
    // same lazy getter to keep test paths (no request scope) compatible when
    // middleware doesn't read c. Empty middleware path bypasses the dispatcher
    // so existing call sites keep their exact prior behavior.
    const allMiddleware = partitionUse(
      (loaderRef.use ?? []) as ReadonlyArray<Middleware>
    ).middleware;
    const serverMw = allMiddleware.filter(
      (m): m is ServerMiddleware<'loader'> => m.runs === 'server'
    );

    if (serverMw.length === 0) {
      return (await runInner()) as T;
    }

    const serverCtx: ServerLoaderCtx = Object.defineProperties(
      {
        scope: 'loader' as const,
        signal,
        location,
        module: loaderRef.__moduleKey ?? '<unkeyed>',
        loader: loaderName,
      } as Omit<ServerLoaderCtx, 'c'>,
      {
        c: {
          get: () => ctx.c,
          enumerable: true,
        },
      }
    ) as ServerLoaderCtx;

    const dispatch = await dispatchServer<unknown, 'loader'>({
      middleware: serverMw,
      ctx: serverCtx,
      inner: runInner,
    });

    if (dispatch.kind === 'outcome') {
      throw dispatch.outcome;
    }
    return dispatch.value as T;
  })();
}
