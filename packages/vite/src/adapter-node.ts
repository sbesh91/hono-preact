// packages/vite/src/adapter-node.ts
//
// Standalone module. NOT re-exported by index.ts: importing `hono-preact/vite`
// must never pull in `@hono/node-server`. Only importing
// `hono-preact/adapter-node` loads this file.
import type { HonoPreactAdapter, HonoPreactAdapterContext } from './adapter.js';
import { nodeBuildPlugin, nodeDevServerPlugin } from './node-dev-server.js';

export function nodeAdapter(): HonoPreactAdapter {
  return {
    name: 'node',
    vitePlugins(ctx: HonoPreactAdapterContext) {
      return [nodeBuildPlugin(ctx), nodeDevServerPlugin(ctx)];
    },
    wrapEntry(ctx) {
      const hasApi = ctx.apiModuleId != null;

      // The outer app serves built client assets under /static/* and mounts
      // the framework's core Hono app at the root.
      //
      // The serve() boot is guarded by `import.meta.env.PROD`. In `vite dev`
      // the Node dev plugin loads this wrapper through the SSR module runner
      // purely to obtain `app` (and `injectWebSocket`); PROD is false there so
      // no rogue HTTP server starts. In the production build it constant-folds
      // to true and the bundle boots a real server.
      //
      // The framework owns the single node-ws instance: it powers GET /__sockets
      // (via the installed upgrader) and any raw api.ts WS routes (via the public
      // upgradeWebSocket, which reads the same installed upgrader).
      return (
        `import { serve } from '@hono/node-server';\n` +
        `import { serveStatic } from '@hono/node-server/serve-static';\n` +
        `import { Hono } from 'hono';\n` +
        `import { createNodeWebSocket } from '@hono/node-ws';\n` +
        `import { installWebSocketUpgrader } from 'hono-preact/internal/runtime';\n` +
        `import coreApp from ${JSON.stringify(ctx.coreAppModuleId)};\n` +
        (hasApi
          ? `import * as __api from ${JSON.stringify(ctx.apiModuleId)};\n`
          : '') +
        `\n` +
        `const app = new Hono()\n` +
        `  .use('/static/*', serveStatic({ root: './dist/client' }))\n` +
        `  .route('/', coreApp);\n` +
        `\n` +
        `// The framework owns the single node-ws instance: it powers GET /__sockets\n` +
        `// (via the installed upgrader) and any raw api.ts WS (via the public\n` +
        `// upgradeWebSocket, which reads the same installed upgrader).\n` +
        `const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });\n` +
        `installWebSocketUpgrader(upgradeWebSocket);\n` +
        `\n` +
        `export { app, injectWebSocket };\n` +
        `export default app;\n` +
        `\n` +
        `if (import.meta.env.PROD) {\n` +
        `  const port = Number(process.env.PORT) || 3000;\n` +
        `  const server = serve({ fetch: app.fetch, port });\n` +
        `  console.log(\`hono-preact: listening on http://localhost:\${port}\`);\n` +
        `  injectWebSocket(server);\n` +
        `}\n`
      );
    },
  };
}
