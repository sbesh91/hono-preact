// Cloudflare closure reader for the modulepreload feature (issue #249).
//
// The worker environment builds BEFORE the client on Cloudflare, so the hashed
// closure filenames don't exist when the worker is bundled and can't be baked
// in as a constant. Workerd also has no `fs`. So the worker reads the closure
// artifact (written into the client output by the vite preload-manifest plugin)
// at runtime through the `ASSETS` binding, on the first render. The result is
// memoized by `resolvePreloadModules`, so this runs at most once per isolate.
//
// Requires the worker to bind its assets as `ASSETS`
// (`assets.binding` in wrangler). Absent binding or any read failure -> `[]`
// (no hints), never an error: preload is an optimization, not a correctness
// dependency.

import { PRELOAD_MANIFEST_URL } from '@hono-preact/iso/internal/runtime';
import { getRealtimeRuntime } from './cf-pubsub.js';

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

function isFetcher(value: unknown): value is Fetcher {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fetch' in value &&
    typeof value.fetch === 'function'
  );
}

/**
 * A {@link PreloadModulesReader} that fetches the closure artifact via the
 * worker's `ASSETS` binding (read off the per-request realtime runtime, which
 * the generated worker entry installs for every request).
 */
export function makeAssetsPreloadReader(): () => Promise<string[]> {
  return async () => {
    const assets = getRealtimeRuntime()?.env.ASSETS;
    if (!isFetcher(assets)) return [];
    try {
      const res = await assets.fetch(
        new Request('https://assets.invalid' + PRELOAD_MANIFEST_URL)
      );
      if (!res.ok) return [];
      const data: unknown = await res.json();
      return Array.isArray(data)
        ? data.filter((u): u is string => typeof u === 'string')
        : [];
    } catch {
      return [];
    }
  };
}
