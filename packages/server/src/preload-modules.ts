// The client entry's static-import closure and the per-route chunk map, surfaced
// to the SSR document as `modulepreload` hints so the browser can fetch those
// chunks alongside the entry instead of discovering them only after it downloads
// and parses the entry / matches the route (the first-load "second wave" and the
// later "route wave"; see issue #249).
//
// Delivery is universal: the SSR document injects `<link rel="modulepreload">`
// tags (assembled in document-shell.ts, which owns the escaping), and
// `preloadLinkHeader` builds a `Link:` response header (honored before body
// parse, and promotable to 103 Early Hints by the CDN/adapter).

import type { RoutePreloadMap } from './route-preload-match.js';

/**
 * The build artifact the adapter reader returns, once resolved and normalized:
 * `closure` is the client entry's static-import closure (root-relative URLs),
 * `routes` maps each route pattern to the chunks its matched layout/view need.
 */
export interface PreloadManifest {
  closure: string[];
  routes: RoutePreloadMap;
  /** Per-route render-critical stylesheet URLs (same shape/matching as routes). */
  routeCss: RoutePreloadMap;
}

/**
 * A platform-provided source of the build artifact. Installed by the adapter's
 * generated entry: Node reads it via `fs` at boot; Cloudflare reads it via the
 * `ASSETS` binding at first render. May be async (the CF read is a subrequest).
 * Returns the raw parsed JSON (shape unvalidated); `resolvePreloadManifest`
 * normalizes it. The artifact is build-static, so a successful read is memoized
 * and shared across every request in the isolate; the reader runs at most once.
 */
export type PreloadModulesReader = () => unknown | Promise<unknown>;

let reader: PreloadModulesReader | undefined;
let pending: Promise<PreloadManifest> | undefined;

const EMPTY: PreloadManifest = { closure: [], routes: {}, routeCss: {} };

/** Install the platform reader (see {@link PreloadModulesReader}). */
export function installPreloadModules(r: PreloadModulesReader): void {
  reader = r;
  pending = undefined;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/** Coerce the raw route map, dropping any malformed entries. */
function normalizeRoutes(raw: unknown): RoutePreloadMap {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: RoutePreloadMap = {};
  for (const [pattern, v] of Object.entries(raw)) {
    if (!Array.isArray(v)) continue;
    const chunks = v.filter(isString);
    if (chunks.length > 0) out[pattern] = chunks;
  }
  return out;
}

/** Coerce the raw artifact into a {@link PreloadManifest}, defaulting each part. */
function normalizeManifest(raw: unknown): PreloadManifest {
  const obj =
    typeof raw === 'object' && raw !== null
      ? (raw as { closure?: unknown; routes?: unknown; routeCss?: unknown })
      : {};
  const closure = Array.isArray(obj.closure)
    ? obj.closure.filter(isString)
    : [];
  return {
    closure,
    routes: normalizeRoutes(obj.routes),
    routeCss: normalizeRoutes(obj.routeCss),
  };
}

/**
 * The resolved, normalized build artifact, or an empty manifest when no reader
 * is installed. Memoized via the in-flight promise so the reader runs once per
 * isolate and concurrent callers share it.
 *
 * Preload is an optimization, never a correctness dependency, so this can never
 * throw or reject: a reader that rejects or returns a malformed value degrades
 * to an empty manifest. A failed read is NOT memoized (the in-flight promise is
 * cleared), so a transient failure retries on the next request instead of
 * disabling preload for the isolate's lifetime.
 */
export function resolvePreloadManifest(): Promise<PreloadManifest> {
  if (pending) return pending;
  if (!reader) return Promise.resolve(EMPTY);
  const inFlight = Promise.resolve()
    .then(() => reader!())
    .then(normalizeManifest)
    .catch(() => {
      if (pending === inFlight) pending = undefined;
      return EMPTY;
    });
  pending = inFlight;
  return pending;
}

/** Test-only: drop the installed reader and memoized manifest. */
export function __resetPreloadModulesForTests(): void {
  reader = undefined;
  pending = undefined;
}

// A `Link` response header carrying the whole closure can grow large; CDNs cap
// total response-header bytes (Cloudflare ~16KB across all headers). Stop well
// short so the header is never dropped at the edge and there is room for other
// headers. The in-document `<link>` tags are unbounded and still cover the full
// closure, so the header is a best-effort earliest-hint, not the only channel.
const LINK_HEADER_BUDGET = 12_000;

/**
 * An RFC 8288 `Link` header value preloading the given URLs as modules, or
 * `undefined` when there is nothing to preload (so callers skip the header
 * rather than emit an empty one). Truncated at {@link LINK_HEADER_BUDGET} bytes,
 * keeping the longest whole-entry prefix that fits.
 */
export function preloadLinkHeader(urls: readonly string[]): string | undefined {
  let out = '';
  for (const u of urls) {
    const part = `<${u}>; rel=modulepreload`;
    const next = out ? `${out}, ${part}` : part;
    if (next.length > LINK_HEADER_BUDGET) break;
    out = next;
  }
  return out || undefined;
}
