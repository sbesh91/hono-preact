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
import {
  fanStart,
  fanChunk,
  fanEnd,
  fanError,
} from './stream-observer-runner.js';

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
    const handle = fetchLoaderData<T>(
      loaderRef.__moduleKey!,
      loaderName,
      {
        path: location.path,
        pathParams: (location.pathParams ?? {}) as Record<string, string>,
        searchParams: (location.searchParams ?? {}) as Record<string, string>,
      },
      signal
    );
    // Stream subsequent chunks to the caller's callbacks. Teardown is driven by
    // the request `signal` (abort stops the pump), so the unsubscribe handle is
    // not retained here.
    handle.subscribe(callbacks);
    return handle.first;
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

    // Partition the loader's `use` array into middleware + observers. The
    // dispatcher only consumes middleware; observers attach to the streaming
    // pump below so chunks emitted during SSR flush observer hooks the same
    // way the RPC/SSE path does.
    const { middleware: allMiddleware, observers } = partitionUse(
      (loaderRef.use ?? []) as ReadonlyArray<Middleware>
    );
    const serverMw = allMiddleware.filter(
      (m): m is ServerMiddleware<'loader'> => m.runs === 'server'
    );

    // Pre-build a ServerLoaderCtx so observers and middleware see the same
    // ctx shape they see on the RPC path. `c` proxies through the lazy
    // getter so test paths (no request scope) keep working when no consumer
    // reads it.
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

    /**
     * Wrap a generator that has already yielded its first chunk so that
     * subsequent yields fire observer hooks. Index 0 has already fired
     * before this wrapper runs (see runInner below), so we count from 1.
     *
     * Implemented as a real `async function*` (not a hand-rolled object)
     * so the result conforms to AsyncGenerator's full structural contract
     * (including `[Symbol.asyncDispose]` on newer libs).
     */
    function wrapGeneratorWithObservers(
      gen: AsyncGenerator<unknown, unknown, unknown>,
      startIndex: number
    ): AsyncGenerator<unknown, unknown, unknown> {
      async function* wrapped() {
        let chunks = startIndex;
        try {
          while (true) {
            const step = await gen.next();
            if (step.done) {
              fanEnd(observers, serverCtx, {
                chunks,
                result: step.value,
              });
              return step.value;
            }
            fanChunk(observers, serverCtx, step.value, chunks);
            chunks += 1;
            yield step.value;
          }
        } catch (err) {
          fanError(observers, serverCtx, err, { chunks });
          throw err;
        }
      }
      return wrapped();
    }

    const runInner = async (): Promise<unknown> => {
      const result = await loaderRef.fn(ctx);
      if (isAsyncGenerator(result)) {
        if (observers.length > 0) {
          fanStart(observers, serverCtx);
        }
        const step = await result.next();
        if (step.done) {
          // Generator returned without yielding. Fire onEnd with chunks=0
          // so observers see a clean lifecycle even on empty streams.
          if (observers.length > 0) {
            fanEnd(observers, serverCtx, {
              chunks: 0,
              result: step.value,
            });
          }
          return undefined;
        }
        if (observers.length > 0) {
          fanChunk(observers, serverCtx, step.value, 0);
          // Register the OBSERVED wrapper so renderPage's drain fires
          // onChunk for every subsequent yield and onEnd / onError at
          // termination.
          registerServerStreamingLoader(
            id,
            wrapGeneratorWithObservers(result, 1)
          );
        } else {
          registerServerStreamingLoader(id, result);
        }
        return step.value;
      }
      return result;
    };

    // Empty middleware path bypasses the dispatcher so existing call sites
    // keep their exact prior behavior. Observer fanout above still fires
    // through runInner; the dispatcher is only about ordered middleware
    // before/after the inner.
    if (serverMw.length === 0) {
      return (await runInner()) as T;
    }

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
