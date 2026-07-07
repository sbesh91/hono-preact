// The client entry's static-import closure, surfaced to the SSR document as
// `modulepreload` hints so the browser can fetch those chunks alongside the
// entry instead of discovering them only after it downloads and parses the
// entry (the first-load "second wave"; see issue #249).
//
// Two delivery mechanisms, both universal: the SSR document injects
// `<link rel="modulepreload">` tags (assembled in document-shell.ts, which owns
// the escaping), and `preloadLinkHeader` builds a `Link:` response header
// (honored before body parse, and promotable to 103 Early Hints by the
// CDN/adapter).

/**
 * A platform-provided source of the closure URLs. Installed by the adapter's
 * generated entry: Node reads the build artifact via `fs` at boot; Cloudflare
 * reads it via the `ASSETS` binding at first render. May be async (the CF read
 * is a subrequest). The closure is build-static, so a successful read is
 * memoized and shared across every request in the isolate; the reader runs at
 * most once.
 */
export type PreloadModulesReader = () =>
  | readonly string[]
  | Promise<readonly string[]>;

let reader: PreloadModulesReader | undefined;
let pending: Promise<string[]> | undefined;

/** Install the platform reader (see {@link PreloadModulesReader}). */
export function installPreloadModules(r: PreloadModulesReader): void {
  reader = r;
  pending = undefined;
}

/**
 * The client entry's static-import closure as root-relative URLs, or `[]` when
 * no reader is installed. Memoized via the in-flight promise so the reader runs
 * once per isolate and concurrent callers share it.
 *
 * Preload is an optimization, never a correctness dependency, so this can never
 * throw or reject: a reader that rejects or returns a non-array degrades to
 * `[]`. A failed read is NOT memoized (the in-flight promise is cleared), so a
 * transient failure retries on the next request instead of disabling preload
 * for the isolate's lifetime.
 */
export function resolvePreloadModules(): Promise<string[]> {
  if (pending) return pending;
  if (!reader) return Promise.resolve([]);
  const inFlight = Promise.resolve()
    .then(() => reader!())
    .then((urls) =>
      Array.isArray(urls)
        ? urls.filter((u): u is string => typeof u === 'string')
        : []
    )
    .catch(() => {
      if (pending === inFlight) pending = undefined;
      return [];
    });
  pending = inFlight;
  return pending;
}

/** Test-only: drop the installed reader and memoized closure. */
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
 * An RFC 8288 `Link` header value preloading the closure as modules, or
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
