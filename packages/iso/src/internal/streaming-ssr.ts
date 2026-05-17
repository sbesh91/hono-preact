import { getRequestStore } from '../cache.js';

export type ServerLoaderStream = {
  loaderId: string;
  gen: AsyncGenerator<unknown, unknown, unknown>;
};

const REGISTRY_KEY = Symbol.for('@hono-preact/streaming-ssr-registry');

/**
 * Register a streaming loader's remaining generator iterations for the
 * current request. Called from LoaderHost's server-side branch after the
 * first chunk is already in the rendered HTML.
 */
export function registerServerStreamingLoader(
  loaderId: string,
  gen: AsyncGenerator<unknown, unknown, unknown>
): void {
  const store = getRequestStore();
  if (!store) return; // outside any request scope (e.g., client)
  let list = store.get(REGISTRY_KEY) as ServerLoaderStream[] | undefined;
  if (!list) {
    list = [];
    store.set(REGISTRY_KEY, list);
  }
  list.push({ loaderId, gen });
}

/**
 * Take ownership of the registered streaming loaders for the current
 * request. After this returns, the registry is cleared. Called from
 * `renderPage` after prerender resolves, while still inside
 * `runRequestScope`.
 */
export function takeServerStreamingLoaders(): ServerLoaderStream[] {
  const store = getRequestStore();
  if (!store) return [];
  const list =
    (store.get(REGISTRY_KEY) as ServerLoaderStream[] | undefined) ?? [];
  store.set(REGISTRY_KEY, []);
  return list;
}
