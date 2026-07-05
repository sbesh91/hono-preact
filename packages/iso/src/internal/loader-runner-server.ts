import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import type { LoaderRef } from '../define-loader.js';
import { getRequestHonoContext } from '../cache.js';
import { registerServerStreamingLoader } from './streaming-ssr.js';
import type {
  ServerMiddleware,
  ServerLoaderCtx,
  Middleware,
} from '../define-middleware.js';
import { dispatchServer } from './middleware-runner.js';
import { partitionUse } from './use-partitioner.js';
import { coerceLoaderLocation, type LooseLoaderFn } from './loader-schema.js';
import { createCaller } from '../server-caller.js';
import {
  fanStart,
  fanChunk,
  fanEnd,
  fanError,
} from './stream-observer-runner.js';

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
 * The direct-fn loader path: invoke the loader function in-process (SSR or
 * test), dispatch its server middleware, and register any streaming
 * async-generator with the per-request streaming-SSR registry. This module is
 * loaded lazily by runLoader (a dynamic import) precisely because everything it
 * imports (createCaller, dispatchServer, streaming-SSR, the partitioner, the
 * request scope) is server-only: a browser loader route takes the RPC-fetch
 * path and must never bundle this code. The dynamic import resolves from the
 * server/worker bundle; the client never reaches this branch, so it never
 * fetches the split chunk.
 *
 * Result may be a Promise<T>, a Promise<ReadableStream<T>>, or an
 * AsyncGenerator<T>. For an async generator (server-side streaming loader),
 * take the first chunk for the Suspense render and register the rest with the
 * per-request streaming-ssr registry so renderPage can flush further chunks.
 */
export async function runLoaderServer<T>(
  loaderRef: LoaderRef<T, boolean>,
  location: RouteHook,
  id: string,
  signal: AbortSignal
): Promise<T> {
  const loaderName = loaderRef.__loaderName ?? 'default';

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
    // coerceLoaderLocation no-ops when both schemas are absent, so the same
    // code shape works for schema and no-schema loaders. This mirrors the RPC
    // path (loaders-handler.ts), which calls coerceLoaderLocation
    // unconditionally, ensuring the two paths cannot diverge.
    const coerced = await coerceLoaderLocation(
      {
        searchSchema: loaderRef.searchSchema,
        paramsSchema: loaderRef.paramsSchema,
      },
      location.pathParams ?? {},
      location.searchParams ?? {}
    );
    // Post-coercion location params are `unknown` (schema output type erased
    // at the ref); the loader author's typed param shape came from the
    // defineLoader generic. LooseLoaderFn is the sanctioned structural-read
    // boundary shared by BOTH paths (SSR here + RPC loaders-handler).
    const invoke = loaderRef.fn as unknown as LooseLoaderFn;
    // Construct the arg explicitly rather than spreading `ctx` to avoid
    // triggering the lazy `c` getter during object spread. `call` is also
    // lazy so test paths that never invoke it don't trip the scope guard.
    const result = await invoke({
      signal: ctx.signal,
      get c() {
        return ctx.c;
      },
      get call() {
        return createCaller(ctx.c).call;
      },
      location: {
        ...location,
        pathParams: coerced.pathParams,
        searchParams: coerced.searchParams,
      },
    });
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
}
