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
   * This is additive only. The built-in prefixes stay in force for everything
   * else, so no app config can break HMR or module loading by getting the
   * Vite-internal list wrong.
   *
   * @example ['/@'] // an app with /@:username profile routes
   */
  devSsrInclude?: readonly (string | RegExp)[];
}

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
    if (typeof p === 'string') return path.startsWith(p);
    const stateless =
      p.flags.includes('g') || p.flags.includes('y')
        ? new RegExp(p.source, p.flags.replace(/[gy]/g, ''))
        : p;
    return stateless.test(path);
  });
}

/**
 * Strip the `g` and `y` flags: both make `.test()` stateful via `lastIndex`,
 * which would make a user's pattern match every other request.
 */
function normalizePatterns(
  patterns: readonly (string | RegExp)[]
): readonly (string | RegExp)[] {
  return patterns.map((p) =>
    typeof p === 'string'
      ? p
      : new RegExp(p.source, p.flags.replace(/[gy]/g, ''))
  );
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
          // `devSsrInclude` is checked FIRST: an app route like /@:username
          // otherwise disappears into the Vite-internal pass-through below and
          // never reaches SSR in dev, while working fine in production.
          if (
            !shouldForceSsr(path, forcePatterns) &&
            (path.startsWith('/@') || path.startsWith('/node_modules/'))
          ) {
            return next();
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
