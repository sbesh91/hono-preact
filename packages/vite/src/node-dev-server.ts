import type { Plugin, ViteBuilder, ViteDevServer } from 'vite';
import { createServerModuleRunner } from 'vite';
import type { HonoPreactAdapterContext } from './adapter.js';
import { toFetchRequest, writeFetchResponse } from './node-request.js';

export function nodeBuildPlugin(ctx: HonoPreactAdapterContext): Plugin {
  return {
    name: 'hono-preact:node-build',
    config() {
      return {
        environments: {
          // The Node target has no Cloudflare-style plugin to set the client
          // outDir, so set it here. wrapEntry()'s serveStatic expects the
          // client bundle at dist/client.
          client: {
            build: { outDir: 'dist/client' },
          },
          ssr: {
            build: {
              outDir: 'dist/server',
              ssr: true,
              rollupOptions: {
                input: [ctx.entryWrapperId],
              },
            },
          },
        },
        builder: {
          async buildApp(builder: ViteBuilder) {
            await builder.build(builder.environments.client);
            await builder.build(builder.environments.ssr);
          },
        },
      };
    },
  };
}

export interface NodeDevServerOptions {
  /**
   * Paths that must reach SSR in dev even though they collide with the
   * built-in Vite-internal pass-through prefixes (`/@`, `/node_modules/`).
   * A string matches by prefix; a RegExp matches by `.test()`. Matched
   * against the query-stripped request path.
   *
   * This cannot override Vite's own endpoints (its HMR client, `/@id/`,
   * `/@fs/`, `/@react-refresh`): those always reach Vite regardless of any
   * pattern given here, so this option can't break HMR or module loading.
   *
   * @example /^\/@(?!vite\/|id\/|fs\/)[^/]+$/ // an app with /@:username profile routes
   */
  devSsrInclude?: readonly (string | RegExp)[];
}

/**
 * Prefixes Vite owns outright: its HMR client, its module-id and filesystem
 * resolution endpoints, and the React-refresh runtime it injects for JSX
 * fast refresh. Serving any of these from the framework's router instead of
 * Vite's own middleware breaks HMR and module loading, so `devSsrInclude`
 * cannot override them; they are checked before any user pattern.
 */
const VITE_OWNED_PREFIXES = ['/@vite/', '/@id/', '/@fs/', '/@react-refresh'];

/**
 * True when `path` matches any force-to-SSR pattern.
 *
 * RegExp patterns are matched flag-normalized (see `normalizePatterns`) even
 * if the caller passes a raw `g`/`y` pattern: a global/sticky RegExp is
 * stateful under `.test()` via `lastIndex`, and this function must give the
 * same answer for the same input regardless of how many times it has been
 * called before.
 */
export function shouldForceSsr(
  path: string,
  patterns: readonly (string | RegExp)[]
): boolean {
  return patterns.some((p) => {
    const stateless = normalizePattern(p);
    return typeof stateless === 'string'
      ? path.startsWith(stateless)
      : stateless.test(path);
  });
}

/**
 * Strip the `g` and `y` flags from a single pattern: both make `.test()`
 * stateful via `lastIndex`, which would make a user's pattern match every
 * other request.
 */
function normalizePattern(p: string | RegExp): string | RegExp {
  if (typeof p === 'string') return p;
  return p.flags.includes('g') || p.flags.includes('y')
    ? new RegExp(p.source, p.flags.replace(/[gy]/g, ''))
    : p;
}

/**
 * Pre-normalize every pattern once at plugin construction, so per-request
 * matching in the dev middleware never re-allocates a stripped-flags RegExp.
 * `shouldForceSsr` still normalizes on every call too, via `normalizePattern`:
 * it is exported as a pure function direct callers may invoke with raw,
 * un-normalized patterns.
 */
function normalizePatterns(
  patterns: readonly (string | RegExp)[]
): readonly (string | RegExp)[] {
  return patterns.map(normalizePattern);
}

export function nodeDevServerPlugin(
  ctx: HonoPreactAdapterContext,
  options: NodeDevServerOptions = {}
): Plugin {
  const forcePatterns = normalizePatterns(options.devSsrInclude ?? []);
  return {
    name: 'hono-preact:node-dev-server',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const runner = createServerModuleRunner(server.environments.ssr);

      // Wire the WebSocket upgrade. @hono/node-ws's injectWebSocket(target)
      // just calls target.on('upgrade', fn); we pass a shim that captures
      // that handler so we can invoke it with Node's real upgrade args.
      // Multiple 'upgrade' listeners coexist fine with Vite's own HMR one.
      server.httpServer?.on('upgrade', async (req, socket, head) => {
        try {
          const { injectWebSocket } = await runner.import(ctx.entryWrapperId);
          if (!injectWebSocket) return;
          let handler:
            | ((req: unknown, socket: unknown, head: unknown) => void)
            | undefined;
          (injectWebSocket as (target: unknown) => void)({
            on(
              event: string,
              fn: (req: unknown, socket: unknown, head: unknown) => void
            ) {
              if (event === 'upgrade') handler = fn;
            },
          });
          handler?.(req, socket, head);
        } catch (err) {
          console.error('[hono-preact] dev ws upgrade error', err);
          socket.destroy();
        }
      });

      // Register the SSR middleware synchronously (not via the returned post
      // hook). The post hook runs after Vite's spaFallbackMiddleware, which
      // rewrites req.url to /index.html and makes the SSR app 404. Synchronous
      // registration puts this ahead of Vite's HTML/SPA middlewares.
      server.middlewares.use(async (req, res, next) => {
        try {
          // Vite-internal requests (its HMR client, source modules under
          // /@fs and /@id, optimized deps) must reach Vite's later
          // middlewares, or client hydration and HMR break. The SSR app only
          // owns application routes, so pass these through. Same model as
          // @hono/vite-dev-server's `exclude` option.
          const path = (req.url ?? '').split('?')[0];
          // Vite's own endpoints always pass through: no `devSsrInclude`
          // pattern can claim them, so getting that option wrong can't break
          // HMR or module loading.
          if (VITE_OWNED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
            return next();
          }
          // The remaining built-in prefixes (`/@`, `/node_modules/`) are
          // overridable: an app route like /@:username needs to win here, or
          // it disappears into the pass-through below and never reaches SSR
          // in dev, while working fine in production. Only consult the user's
          // patterns for requests that could actually be affected, i.e. ones
          // that already match a built-in prefix.
          if (path.startsWith('/@') || path.startsWith('/node_modules/')) {
            if (!shouldForceSsr(path, forcePatterns)) return next();
          }

          const { default: app } = (await runner.import(
            ctx.entryWrapperId
          )) as { default: { fetch: (request: Request) => Promise<Response> } };

          const request = await toFetchRequest(req);
          const response = await app.fetch(request);
          await writeFetchResponse(res, response);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
