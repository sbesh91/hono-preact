// Cloudflare closure reader for the modulepreload feature (issue #249).
//
// The worker environment builds BEFORE the client on Cloudflare, so the hashed
// chunk filenames don't exist when the worker is bundled and can't be baked in
// as a constant. Workerd also has no `fs`. So the worker reads the preload
// artifact (written into the client output by the vite preload-manifest plugin)
// at runtime through the `ASSETS` binding, on the first render. The result is
// memoized by `resolvePreloadManifest`, so this runs at most once per isolate.
//
// Requires the worker to bind its assets as `ASSETS`
// (`assets.binding` in wrangler). Absent binding or any read failure -> `{}`
// (no hints, no render-critical CSS), never an error: preload is an
// optimization, but `globalCss`/`routeCss` are render-critical, so every
// failure mode here is logged (see warnDegraded below) rather than passing
// silently. resolvePreloadManifest's own catch also warns, but it never
// fires for THIS reader: every branch below already returns `{}` instead of
// throwing/rejecting, so the context (which failure mode) would otherwise be
// lost. Logging it here, where the context exists, is the fix.

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
 * Log a degraded-read reason before the reader returns `{}`. Gated on
 * `import.meta.env.PROD`: `wrangler dev` (via `@cloudflare/vite-plugin`, which
 * drives both dev and build) never has a built `__hp-preload.json` either, so
 * the no-binding/non-OK-response cases would otherwise fire on every single
 * dev request. `import.meta.env.PROD` is a build-time constant Vite replaces
 * statically (see types.d.ts), so this whole branch compiles away in dev; a
 * real production failure still warns on every affected request (a failed
 * read is not memoized, per resolvePreloadManifest, so an ongoing prod
 * misconfiguration keeps being visible rather than going silent after once).
 */
function warnDegraded(reason: string, err?: unknown): void {
  if (!import.meta.env.PROD) return;
  const message = `[hono-preact] preload manifest read failed (${reason}); page ships without render-critical CSS this request`;
  if (err !== undefined) {
    console.warn(message, err);
  } else {
    console.warn(message);
  }
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
      warnDegraded('no ASSETS binding is configured on this worker');
      return {};
    }
    let res: Response;
    try {
      res = await assets.fetch(
        new Request('https://assets.invalid' + PRELOAD_MANIFEST_URL)
      );
    } catch (err) {
      warnDegraded('the ASSETS fetch threw', err);
      return {};
    }
    if (!res.ok) {
      warnDegraded(`the ASSETS fetch returned HTTP ${res.status}`);
      return {};
    }
    try {
      // Raw parsed artifact; resolvePreloadManifest validates + normalizes it.
      return await res.json();
    } catch (err) {
      warnDegraded('the manifest body failed to parse as JSON', err);
      return {};
    }
  };
}
