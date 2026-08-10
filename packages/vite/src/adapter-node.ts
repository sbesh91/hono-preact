// packages/vite/src/adapter-node.ts
//
// Standalone module. NOT re-exported by index.ts: importing `hono-preact/vite`
// must never pull in `@hono/node-server`. Only importing
// `hono-preact/adapter-node` loads this file.
import type { HonoPreactAdapter, HonoPreactAdapterContext } from './adapter.js';
import { PRELOAD_MANIFEST_FILE } from '@hono-preact/iso/internal/contract';
import {
  nodeBuildPlugin,
  nodeDevServerPlugin,
  type NodeDevServerOptions,
} from './node-dev-server.js';

export interface NodeAdapterOptions {
  /**
   * Paths that must reach SSR in dev even though they collide with the Vite
   * dev server's internal `/@` and `/node_modules/` prefixes. A string matches
   * by prefix, a RegExp by `.test()`. Additive: the built-in prefixes still
   * apply to everything else.
   *
   * @example nodeAdapter({ devSsrInclude: ['/@'] })
   */
  devSsrInclude?: NodeDevServerOptions['devSsrInclude'];
}

export function nodeAdapter(
  options: NodeAdapterOptions = {}
): HonoPreactAdapter {
  return {
    name: 'node',
    vitePlugins(ctx: HonoPreactAdapterContext) {
      return [
        nodeBuildPlugin(ctx),
        nodeDevServerPlugin(ctx, { devSsrInclude: options.devSsrInclude }),
      ];
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
        `import { join } from 'node:path';\n` +
        `import coreApp from ${JSON.stringify(ctx.coreAppModuleId)};\n` +
        `\n` +
        // The built server entry lands at <root>/dist/server/, so the client
        // build is deterministically ../client from it. Resolving from
        // import.meta.dirname rather than the process cwd is what lets the
        // built server run from anywhere: a systemd unit with no
        // WorkingDirectory, a Docker image with a different WORKDIR, or a
        // monorepo script invoked from the repo root.
        `const __hpClientDir = join(import.meta.dirname, '../client');\n` +
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
        `    return JSON.parse(readFileSync(join(__hpClientDir, '${PRELOAD_MANIFEST_FILE}'), 'utf8'));\n` +
        `  } catch (err) {\n` +
        `    throw new Error('[hono-preact] preload manifest read failed in ' + __hpClientDir + ': ' + (err instanceof Error ? err.message : String(err)));\n` +
        `  }\n` +
        `});\n` +
        `\n` +
        `const app = new Hono();\n` +
        `// Only in production: in dev this wrapper is loaded from\n` +
        `// node_modules/.vite/hono-preact/, where ../client does not exist, and\n` +
        `// Vite serves client assets itself. serveStatic existsSync-checks its\n` +
        `// root at setup and would console.error on every dev boot.\n` +
        `if (import.meta.env.PROD) {\n` +
        `  app.use('/static/*', serveStatic({ root: __hpClientDir }));\n` +
        `}\n` +
        `app.route('/', coreApp);\n` +
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
