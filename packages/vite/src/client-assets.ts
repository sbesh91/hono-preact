import type { Plugin } from 'vite';

/**
 * Produces the asset's bytes. Called EXACTLY ONCE during the build and PER
 * REQUEST in dev, so a dev edit shows up without a server restart while the
 * build stays deterministic. May be sync or async.
 */
export type ClientAssetSource = () =>
  | string
  | Uint8Array
  | Promise<string | Uint8Array>;

/** Output file name (relative to the client out dir) to its byte source. */
export type ClientAssets = Record<string, ClientAssetSource>;

const CONTENT_TYPES: Record<string, string> = {
  txt: 'text/plain; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  xml: 'application/xml; charset=utf-8',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  svg: 'image/svg+xml',
};

/**
 * Content type from the file extension. Unknown extensions get
 * `application/octet-stream` rather than a guess: serving a wrong type is
 * worse than serving an opaque one.
 */
export function contentTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = fileName.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

// Normalizes a request path to the asset key: strips the query and the leading
// slash so `/llms.txt?v=2` matches the declared `llms.txt`.
function assetKeyFromUrl(url: string): string {
  const path = url.split('?')[0] ?? '';
  return path.startsWith('/') ? path.slice(1) : path;
}

// Hono route-pattern characters. A name containing one of these registers a
// PARAMETERIZED route under the Node adapter's `app.get('/' + name, ...)`
// mount rather than a literal path, which is a different silent surprise
// than the one this validation is chiefly guarding against.
const HONO_PATTERN_CHARS = /[:*?]/;

/**
 * Validates a declared asset key against the contract documented on
 * `ClientAssets`: a path relative to the client out dir, with no leading
 * slash and no traversal. A key that violates it fails silently in three
 * different ways depending on where it is read (dev falls through to the SSR
 * catch-all, the Node adapter registers an unreachable route, and the build
 * emits a file at a literal path like `/llms.txt`), so this throws eagerly at
 * plugin-construction time instead.
 */
function assertValidAssetKey(key: string): void {
  if (key === '') {
    throw new Error(
      'hono-preact: honoPreact({ assets }) keys must not be empty; ' +
        'use a path relative to the client out dir, e.g. `llms.txt`.'
    );
  }
  if (key.startsWith('/') || key.startsWith('./') || key.startsWith('../')) {
    throw new Error(
      `hono-preact: honoPreact({ assets }) key ${JSON.stringify(key)} must ` +
        'not start with `/`, `./`, or `../`; it is a path relative to the ' +
        `client out dir, not a URL. Use ${JSON.stringify(key.replace(/^(\.\.\/|\.\/|\/)+/, ''))} ` +
        `instead, which serves at /${key.replace(/^(\.\.\/|\.\/|\/)+/, '')}.`
    );
  }
  if (key.split('/').includes('..')) {
    throw new Error(
      `hono-preact: honoPreact({ assets }) key ${JSON.stringify(key)} must ` +
        'not contain a `..` path segment; it must stay inside the client ' +
        'out dir.'
    );
  }
  if (HONO_PATTERN_CHARS.test(key)) {
    throw new Error(
      `hono-preact: honoPreact({ assets }) key ${JSON.stringify(key)} must ` +
        'not contain `:`, `*`, or `?`; those are Hono route-pattern ' +
        'characters and would register a parameterized route under the ' +
        'Node adapter instead of the literal file name intended.'
    );
  }
}

/**
 * Registers both halves of a build-emitted, dev-served asset from one
 * declaration, so the two cannot drift.
 */
export function emitClientAsset(assets: ClientAssets): Plugin {
  const entries = Object.entries(assets);
  for (const [key] of entries) {
    assertValidAssetKey(key);
  }
  return {
    name: 'hono-preact:client-assets',

    // Emit into the CLIENT build only. The worker build shares no asset root,
    // and emitting there would put the file somewhere nothing serves it from.
    async generateBundle() {
      if (this.environment && this.environment.name !== 'client') return;
      for (const [fileName, source] of entries) {
        const value = await source();
        this.emitFile({
          type: 'asset',
          fileName,
          source: typeof value === 'string' ? value : Buffer.from(value),
        });
      }
    },

    configureServer(server) {
      // Registered in the PRE-hook position (the body of configureServer, not
      // the returned post hook). The post hook lands after spaFallbackMiddleware
      // and the SSR catch-all, which would 404 every asset path. See
      // node-dev-server.ts for the same hazard documented at its origin.
      server.middlewares.use((req, res, next) => {
        const key = assetKeyFromUrl(req.url || '');
        const source = assets[key];
        if (!source) {
          next();
          return;
        }
        // Called per request on purpose: regenerating on each hit is what makes
        // an edit visible without a dev-server restart, with no cache to
        // invalidate by hand. Wrapped in Promise.resolve().then(source) rather
        // than Promise.resolve(source()) so a thunk that throws SYNCHRONOUSLY
        // still lands in the catch below instead of escaping the middleware.
        Promise.resolve()
          .then(() => source())
          .then((value) => {
            res.setHeader('Content-Type', contentTypeFor(key));
            res.end(typeof value === 'string' ? value : Buffer.from(value));
          })
          .catch(next);
      });
    },
  };
}
