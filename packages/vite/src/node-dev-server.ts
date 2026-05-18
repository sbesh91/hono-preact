import type { Plugin, ViteBuilder, ViteDevServer } from 'vite';
import { createServerModuleRunner } from 'vite';
import type { HonoPreactAdapterContext } from './adapter.js';

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

export function nodeDevServerPlugin(ctx: HonoPreactAdapterContext): Plugin {
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
          if (path.startsWith('/@') || path.startsWith('/node_modules/')) {
            return next();
          }

          const { default: app } = (await runner.import(
            ctx.entryWrapperId
          )) as { default: { fetch: (request: Request) => Promise<Response> } };

          const url = `http://${req.headers.host}${req.url}`;
          const method = req.method ?? 'GET';
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers.set(k, v);
            else if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
          }
          let body: ArrayBuffer | undefined;
          if (method !== 'GET' && method !== 'HEAD') {
            const chunks: Buffer[] = [];
            for await (const c of req) chunks.push(c as Buffer);
            if (chunks.length) {
              const buf = Buffer.concat(chunks);
              // Copy into a fresh ArrayBuffer: BodyInit accepts ArrayBuffer,
              // and this sidesteps Buffer<ArrayBufferLike> typing friction.
              body = buf.buffer.slice(
                buf.byteOffset,
                buf.byteOffset + buf.byteLength
              ) as ArrayBuffer;
            }
          }
          const request = new Request(url, { method, headers, body });
          const response = await app.fetch(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          if (response.body) {
            const reader = response.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          }
          res.end();
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
