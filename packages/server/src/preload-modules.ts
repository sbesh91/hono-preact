// The client entry's static-import closure, surfaced to the SSR document as
// `modulepreload` hints so the browser can fetch those chunks alongside the
// entry instead of discovering them only after it downloads and parses the
// entry (the first-load "second wave"; see issue #249).
//
// Two delivery mechanisms, both universal:
//  - `preloadLinkTags`   -> `<link rel="modulepreload">` injected into <head>.
//  - `preloadLinkHeader` -> a `Link:` response header (honored before body
//    parse, and promotable to 103 Early Hints by the CDN/adapter).
//
// The URL list itself is build-generated (hashed asset paths), so it is trusted
// input; these builders do no escaping beyond what the values already guarantee.

/**
 * A platform-provided source of the closure URLs. Installed by the adapter's
 * generated entry: Node reads the build artifact via `fs` at boot; Cloudflare
 * reads it via the `ASSETS` binding at first render. May be async (the CF read
 * is a subrequest). The closure is build-static, so the result is memoized and
 * shared across every request in the isolate — the reader runs at most once.
 */
export type PreloadModulesReader = () =>
  | readonly string[]
  | Promise<readonly string[]>;

let reader: PreloadModulesReader | undefined;
let cache: string[] | undefined;
let pending: Promise<string[]> | undefined;

/** Install the platform reader (see {@link PreloadModulesReader}). */
export function installPreloadModules(r: PreloadModulesReader): void {
  reader = r;
  cache = undefined;
  pending = undefined;
}

/**
 * The client entry's static-import closure as root-relative URLs, or `[]` when
 * no reader is installed. Memoized: the reader runs once per isolate, and
 * concurrent callers share the in-flight read.
 */
export function resolvePreloadModules(): Promise<string[]> {
  if (cache) return Promise.resolve(cache);
  if (!reader) return Promise.resolve([]);
  if (!pending) {
    pending = Promise.resolve(reader()).then((urls) => {
      cache = [...urls];
      return cache;
    });
  }
  return pending;
}

/** Test-only: drop the installed reader and memoized closure. */
export function __resetPreloadModulesForTests(): void {
  reader = undefined;
  cache = undefined;
  pending = undefined;
}

/** One `<link rel="modulepreload">` tag string per url (empty in, empty out). */
export function preloadLinkTags(urls: readonly string[]): string[] {
  return urls.map((u) => `<link rel="modulepreload" href="${u}" />`);
}

/**
 * An RFC 8288 `Link` header value preloading every url as a module, or
 * `undefined` when there is nothing to preload (so callers skip the header
 * rather than emit an empty one).
 */
export function preloadLinkHeader(urls: readonly string[]): string | undefined {
  if (urls.length === 0) return undefined;
  return urls.map((u) => `<${u}>; rel=modulepreload`).join(', ');
}
