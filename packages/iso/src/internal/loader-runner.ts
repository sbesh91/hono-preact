import type { RouteHook } from 'preact-iso';
import type { LoaderRef } from '../define-loader.js';
import { isBrowser } from '../is-browser.js';
import { fetchLoaderData } from './loader-fetch.js';
import { registerServerStreamingLoader } from './streaming-ssr.js';

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
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function' &&
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
    // Phase 2b will replace `c: undefined` with the seeded Hono Context from runRequestScope.
    const result = await (loaderRef.fn({ c: undefined as any, location, signal }) as Promise<unknown>);
    if (isAsyncGenerator(result)) {
      const step = await result.next();
      if (step.done) {
        return undefined as T; // generator returned without yielding
      }
      registerServerStreamingLoader(id, result);
      return step.value as T;
    }
    return result as T;
  })();
}
