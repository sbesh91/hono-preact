import { readRequestSlot, writeRequestSlot } from './request-scoped-slot.js';

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
  const list = readRequestSlot<ServerLoaderStream[]>(REGISTRY_KEY) ?? [];
  list.push({ loaderId, gen });
  writeRequestSlot(REGISTRY_KEY, list);
}

/**
 * Take ownership of the registered streaming loaders for the current
 * request. After this returns, the registry is cleared. Called from
 * `renderPage` after prerender resolves, while still inside
 * `runRequestScope`.
 */
export function takeServerStreamingLoaders(): ServerLoaderStream[] {
  const list = readRequestSlot<ServerLoaderStream[]>(REGISTRY_KEY) ?? [];
  writeRequestSlot<ServerLoaderStream[]>(REGISTRY_KEY, []);
  return list;
}
