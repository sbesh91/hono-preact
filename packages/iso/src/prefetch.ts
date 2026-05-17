import type { RouteHook } from 'preact-iso';
import { exec } from 'preact-iso';
import type { LoaderCache } from './cache.js';
import type { LoaderRef } from './define-loader.js';
import { isBrowser } from './is-browser.js';
import { runLoader } from './internal/loader-runner.js';
import { serializeLocationForCache } from './internal/cache-key.js';

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
    const matched = exec(path, opts.route, {
      path,
      query: searchParams,
      params: {},
    });
    if (matched && matched.pathParams) {
      pathParams = matched.pathParams as Record<string, string>;
    }
  }

  return { path, searchParams, pathParams };
}

let prefetchSeq = 0;

/**
 * Prefetch a loader's data and write the result into its cache.
 *
 * In the browser this delegates to the same RPC path that `loader.View()` uses
 * at runtime: a POST to `/__loaders`. In SSR or test environments it falls
 * back to invoking the loader function directly. This matches `runLoader`'s
 * dispatch and means consumers do not need to know which side they are on.
 *
 * For non-streaming loaders the returned promise resolves with the final
 * value. For streaming loaders it resolves with the first chunk; subsequent
 * chunks update the cache as they arrive.
 */
export async function prefetch<T>(
  ref: LoaderRef<T>,
  opts: PrefetchOptions<T> = {}
): Promise<T> {
  const location =
    opts.location ?? buildLocation({ url: opts.url, route: opts.route });
  const cache = opts.cache ?? ref.cache;
  // Compute the cache key the loader runtime would use, so a warm cache for
  // THIS specific location short-circuits the fetch. Without this check, a
  // hover handler that fires repeatedly (mouse over → off → back over the
  // same link, an intersection observer re-entering visibility, an idle
  // prefetch scheduled twice) would issue a redundant request every time.
  // The docs already promise no-op-on-cache-hit behavior; this makes the
  // code match.
  const locKey = serializeLocationForCache(location, ref.params);
  if (cache?.has(locKey)) {
    const cached = cache.get(locKey);
    if (cached !== null) return cached;
  }

  const id = `prefetch:${++prefetchSeq}`;
  const signal = new AbortController().signal;

  const result = await runLoader<T>(ref, location, id, signal, {
    onChunk: (v) => {
      cache?.set(v, locKey);
    },
    onError: () => {
      // Errors after the first chunk are swallowed: prefetch is best-effort
      // and the page itself will see the same failure when it actually loads.
    },
    onEnd: () => {},
  });

  // Key the final write on locKey so two prefetches for different URLs
  // (hovering /movies/41 then /movies/42) don't collide on the legacy
  // single-slot "locKey: null matches any" fallback the cache supports for
  // back-compat.
  if (isBrowser()) cache?.set(result, locKey);
  return result;
}
