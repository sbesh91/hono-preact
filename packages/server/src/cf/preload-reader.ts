// Cloudflare closure reader for the modulepreload feature (issue #249).
//
// The worker environment builds BEFORE the client on Cloudflare, so the hashed
// chunk filenames don't exist when the worker is bundled and can't be baked in
// as a constant. Workerd also has no `fs`. So the worker reads the preload
// artifact (written into the client output by the vite preload-manifest plugin)
// at runtime through the `ASSETS` binding, on the first render.
//
// Two distinct failure shapes, deliberately handled differently:
//
//  - ABSENCE (no `ASSETS` binding configured, or the binding 404s the
//    manifest path): a static fact about this deploy, not a transient
//    condition -- retrying the same request would just fail the same way.
//    This is also the ordinary shape of `wrangler dev` (no client build ever
//    ran, so no manifest exists on the bound assets). These branches RETURN
//    `{}`, which `resolvePreloadManifest` treats as a successful read and
//    memoizes: the warn below therefore fires at most once per isolate
//    (every later call short-circuits on the memoized promise before this
//    reader runs again), gated on `import.meta.env.PROD` so `wrangler dev`
//    stays silent.
//  - TRANSPORT FAILURE (the fetch itself throws, a non-OK non-404 response,
//    or the body fails to parse as JSON): a condition that may well clear on
//    retry (a network blip, a transient 5xx, a race with an in-progress
//    deploy). These branches THROW, so `resolvePreloadManifest`'s own catch
//    owns the warn (it has the same per-request context: "a read failed just
//    now") AND leaves the read un-memoized, retrying on the next request
//    instead of shipping every subsequent render unstyled for the isolate's
//    lifetime.
//
// Requires the worker to bind its assets as `ASSETS` (`assets.binding` in
// wrangler) to ever succeed; a missing binding is treated as ABSENCE, not a
// transport failure (see above).

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
 * Log an ABSENCE reason (see the module doc above). Gated on
 * `import.meta.env.PROD`: `wrangler dev` (via `@cloudflare/vite-plugin`, which
 * drives both dev and build) never has a built `__hp-preload.json` either, so
 * the no-binding/404 cases would otherwise fire on every single dev request.
 * `import.meta.env.PROD` is a build-time constant Vite replaces statically
 * (see types.d.ts), so this whole branch compiles away in dev. A real
 * production ABSENCE fires this warn once per isolate (the `{}` return is
 * memoized by resolvePreloadManifest, so this reader does not run again).
 */
function warnAbsent(reason: string): void {
  if (!import.meta.env.PROD) return;
  console.warn(
    `[hono-preact] preload manifest unavailable (${reason}); page ships without render-critical CSS this request`
  );
}

/**
 * A {@link PreloadModulesReader} that fetches the closure artifact via the
 * worker's `ASSETS` binding (read off the per-request realtime runtime, which
 * the generated worker entry installs for every request).
 */
export function makeAssetsPreloadReader(): () => Promise<unknown> {
  return async () => {
    const assets = getRealtimeRuntime()?.env.ASSETS;
    if (!isFetcher(assets)) {
      warnAbsent('no ASSETS binding is configured on this worker');
      return {};
    }
    let res: Response;
    try {
      res = await assets.fetch(
        new Request('https://assets.invalid' + PRELOAD_MANIFEST_URL)
      );
    } catch (err) {
      throw new Error(
        `[hono-preact] preload manifest ASSETS fetch threw: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (res.status === 404) {
      // The build produced no manifest at this path, or nothing was ever
      // deployed under it: a static fact for this isolate, not a transport
      // failure. Also the ordinary shape of `wrangler dev` (see module doc).
      warnAbsent('the build produced no preload manifest (404)');
      return {};
    }
    if (!res.ok) {
      throw new Error(
        `[hono-preact] preload manifest ASSETS fetch returned HTTP ${res.status}`
      );
    }
    try {
      // Raw parsed artifact; resolvePreloadManifest validates + normalizes it.
      return await res.json();
    } catch (err) {
      throw new Error(
        `[hono-preact] preload manifest body failed to parse as JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };
}
