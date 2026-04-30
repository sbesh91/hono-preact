import type { RouteHook } from 'preact-iso';
import { exec } from 'preact-iso';
import type { LoaderCache } from './cache.js';
import { isBrowser } from './is-browser.js';
import type { LoaderRef } from './define-loader.js';

export interface PrefetchOptions<T> {
  url?: string;
  route?: string;
  location?: RouteHook;
  cache?: LoaderCache<T>;
}

function buildLocation(opts: { url?: string; route?: string }): RouteHook {
  if (!opts.url) {
    return { path: '', searchParams: {}, pathParams: {} };
  }

  const parsed = new URL(opts.url, 'http://_');
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  const searchParams: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    searchParams[key] = value;
  });

  let pathParams: Record<string, string> = {};
  if (opts.route) {
    const matched = exec(path, opts.route, { path, query: searchParams, params: {} });
    if (matched && matched.pathParams) {
      pathParams = matched.pathParams as Record<string, string>;
    }
  }

  return { path, searchParams, pathParams };
}

export async function prefetch<T>(
  ref: LoaderRef<T>,
  opts: PrefetchOptions<T> = {}
): Promise<T> {
  const location = opts.location ?? buildLocation({ url: opts.url, route: opts.route });
  const cache = opts.cache ?? ref.cache;
  const result = await ref.fn({ location });
  if (isBrowser()) cache?.set(result);
  return result;
}
