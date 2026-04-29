import type { RouteHook } from 'preact-iso';
import type { LoaderCache } from '../cache.js';
import { isBrowser } from '../is-browser.js';
import type { LoaderRef } from './define-loader.js';

export async function prefetch<T>(
  ref: LoaderRef<T>,
  opts: { location?: RouteHook; cache?: LoaderCache<T> } = {}
): Promise<T> {
  const fakeLocation =
    opts.location ?? ({ path: '', query: {} } as unknown as RouteHook);
  const cache = opts.cache ?? ref.cache;
  const result = await ref.fn({ location: fakeLocation });
  if (isBrowser()) cache?.set(result);
  return result;
}
