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

      const apiImport = hasApi
        ? `import * as __api from ${JSON.stringify(ctx.apiModuleId)};\n`
        : '';
      const injectExport = hasApi
        ? `export const injectWebSocket = __api.injectWebSocket;\n`
        : '';
      const injectBoot = hasApi
        ? `  if (__api.injectWebSocket) __api.injectWebSocket(server);\n`
        : '';

      // The outer app serves built client assets under /static/* and mounts
      // the framework's core Hono app at the root.
      //
      // The serve() boot is guarded by `import.meta.env.PROD`. In `vite dev`
      // the Node dev plugin loads this wrapper through the SSR module runner
      // purely to obtain `app` (and `injectWebSocket`); PROD is false there so
      // no rogue HTTP server starts. In the production build it constant-folds
      // to true and the bundle boots a real server.
      return (
        `import { serve } from '@hono/node-server';\n` +
        `import { serveStatic } from '@hono/node-server/serve-static';\n` +
        `import { Hono } from 'hono';\n` +
        `import coreApp from ${JSON.stringify(ctx.coreAppModuleId)};\n` +
        apiImport +
        `\n` +
        `const app = new Hono()\n` +
        `  .use('/static/*', serveStatic({ root: './dist/client' }))\n` +
        `  .route('/', coreApp);\n` +
        `\n` +
        `export { app };\n` +
        `export default app;\n` +
        injectExport +
        `\n` +
        `if (import.meta.env.PROD) {\n` +
        `  const port = Number(process.env.PORT) || 3000;\n` +
        `  const server = serve({ fetch: app.fetch, port });\n` +
        `  console.log(\`hono-preact: listening on http://localhost:\${port}\`);\n` +
        injectBoot +
        `}\n`
      );
    },
  };
}
