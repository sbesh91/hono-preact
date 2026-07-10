// packages/vite/src/adapter-node.ts
//
// Standalone module. NOT re-exported by index.ts: importing `hono-preact/vite`
// must never pull in `@hono/node-server`. Only importing
// `hono-preact/adapter-node` loads this file.
import type { HonoPreactAdapter, HonoPreactAdapterContext } from './adapter.js';
import { PRELOAD_MANIFEST_FILE } from '@hono-preact/iso/internal/runtime';
import { nodeBuildPlugin, nodeDevServerPlugin } from './node-dev-server.js';

export function nodeAdapter(): HonoPreactAdapter {
  return {
    name: 'node',
    vitePlugins(ctx: HonoPreactAdapterContext) {
      return [nodeBuildPlugin(ctx), nodeDevServerPlugin(ctx)];
    },
    wrapEntry(ctx) {
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
        `import { installPreloadModules } from 'hono-preact/server/internal/runtime';\n` +
        `import { readFileSync } from 'node:fs';\n` +
        `import coreApp from ${JSON.stringify(ctx.coreAppModuleId)};\n` +
        `\n` +
        // The modulepreload artifact (entry closure + per-route chunk map,
        // plus globalCss/routeCss, which are render-critical), written to the
        // client build output by the framework's preload-manifest plugin.
        // Read from disk once (resolvePreloadManifest memoizes on success),
        // so the file is loaded lazily at the first render, not at import
        // time.
        //
        // Guarded on PROD, the same gate the serve() boot below uses: `vite
        // dev` loads this wrapper through the SSR module runner, where
        // dist/client never exists yet (or, worse, holds a STALE build from
        // before the dev server started -- reading it would serve hashed
        // stylesheet URLs that 404 render-blockingly; see render.tsx's dev
        // seam, which is the actual reason dev must never reach this read at
        // all, not just skip the warn). PROD is a build-time constant Vite
        // replaces statically, so the whole branch compiles away in dev.
        //
        // A real production read failure RETHROWS rather than degrading to
        // `{}` here: resolvePreloadManifest's own catch is what should own
        // the warn and the non-memoized retry, so a transient failure (e.g. a
        // deploy racing this read) recovers on the next request instead of
        // shipping every subsequent render unstyled for the process's
        // lifetime.
        `installPreloadModules(() => {\n` +
        `  if (!import.meta.env.PROD) return {};\n` +
        `  try {\n` +
        `    return JSON.parse(readFileSync('./dist/client/${PRELOAD_MANIFEST_FILE}', 'utf8'));\n` +
        `  } catch (err) {\n` +
        `    throw new Error('[hono-preact] preload manifest read failed at ./dist/client/${PRELOAD_MANIFEST_FILE}: ' + (err instanceof Error ? err.message : String(err)));\n` +
        `  }\n` +
        `});\n` +
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
