import type { Plugin, ViteBuilder } from 'vite';
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

export function nodeDevServerPlugin(_ctx: HonoPreactAdapterContext): Plugin {
  return { name: 'hono-preact:node-dev-server' };
}
