import type { RouteHook } from 'preact-iso';
import type { LoaderRef } from '../define-loader.js';
import { isBrowser } from '../is-browser.js';
import { fetchLoaderData } from './loader-fetch.js';

export type LoaderRunCallbacks<T> = {
  onChunk: (value: T) => void;
  onError: (err: Error) => void;
  onEnd: () => void;
};

/**
 * Invoke a loader at runtime. Picks between client-side RPC fetch
 * (when in browser + has __moduleKey) and direct fn invocation (SSR
 * or test).
 *
 * The direct-fn path is server-only (it dispatches server middleware, calls
 * `createCaller`, and registers streaming with the SSR registry), so it lives
 * in `loader-runner-server.ts` and is pulled in via a dynamic `import()`. A
 * browser loader route always takes the fetch path, so it never bundles or
 * fetches that server chunk (REVIEW.md §5, "server stays off the client").
 */
export function runLoader<T>(
  loaderRef: LoaderRef<T, boolean>,
  location: RouteHook,
  id: string,
  signal: AbortSignal,
  callbacks: LoaderRunCallbacks<T>
): Promise<T> {
  const useFetchPath =
    isBrowser() &&
    typeof fetch === 'function' &&
    loaderRef.__moduleKey !== undefined;

  if (useFetchPath) {
    const loaderName = loaderRef.__loaderName ?? 'default';
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

  // Direct-fn (SSR / test) path. Loaded lazily so the server-only dispatch
  // cluster never ships to a browser loader route. The client never reaches
  // this branch (the `isBrowser()` gate above), so it never fetches the chunk;
  // the server/worker build resolves it normally. Callers already `await` the
  // result, so the extra microtask is transparent, and the request scope
  // (AsyncLocalStorage) persists across the dynamic import.
  return import('./loader-runner-server.js').then((m) =>
    m.runLoaderServer<T>(loaderRef, location, id, signal)
  );
}
