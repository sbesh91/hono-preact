// The framework plugin + adapter are imported from the workspace `@hono-preact/vite`
// package (its built dist), NOT the bare `hono-preact/*` umbrella: the umbrella is
// not reachable from inside packages/vite (it would be a circular dep). Vite applies
// resolve.alias to the app's module graph, NOT to the config file's own imports, so
// the config resolves these two factory functions through node_modules while the
// aliases below redirect every framework import the GENERATED server-entry makes
// (hono-preact/server/internal/cloudflare, etc.) to source.
import { honoPreact } from '@hono-preact/vite';
import { cloudflareAdapter } from '@hono-preact/vite/adapter-cloudflare';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// This fixture lives inside the monorepo, so the framework umbrella + workspace
// packages are aliased to source (mirrors apps/site). Resolving to source keeps
// the test off stale `dist/` and ensures the Cloudflare-only realtime door
// (cf/realtime-do.ts, which value-imports `cloudflare:workers`) resolves through
// the workerd build the @cloudflare/vite-plugin drives. Longest-prefix-first so
// the subpath doors win over the bare `hono-preact` alias.
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = (p: string) => resolve(__dirname, '../../../../../', p);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: 'hono-preact/internal/runtime',
        replacement: pkg('hono-preact/src/internal-runtime.ts'),
      },
      {
        find: 'hono-preact/internal',
        replacement: pkg('hono-preact/src/internal.ts'),
      },
      {
        find: 'hono-preact/server/internal/cloudflare',
        replacement: pkg('hono-preact/src/server-internal-cloudflare.ts'),
      },
      {
        find: 'hono-preact/server/internal/runtime',
        replacement: pkg('hono-preact/src/server-internal-runtime.ts'),
      },
      {
        find: 'hono-preact/server',
        replacement: pkg('hono-preact/src/server.ts'),
      },
      { find: 'hono-preact/vite', replacement: pkg('hono-preact/src/vite.ts') },
      {
        find: 'hono-preact/adapter-cloudflare',
        replacement: pkg('hono-preact/src/adapter-cloudflare.ts'),
      },
      { find: 'hono-preact', replacement: pkg('hono-preact/src/index.ts') },
      {
        find: '@hono-preact/iso/internal/runtime',
        replacement: pkg('iso/src/internal-runtime.ts'),
      },
      {
        find: '@hono-preact/iso/internal',
        replacement: pkg('iso/src/internal.ts'),
      },
      { find: '@hono-preact/iso', replacement: pkg('iso/src/index.ts') },
      {
        find: '@hono-preact/server/internal/cloudflare',
        replacement: pkg('server/src/internal-cloudflare.ts'),
      },
      {
        find: '@hono-preact/server/internal/runtime',
        replacement: pkg('server/src/internal-runtime.ts'),
      },
      { find: '@hono-preact/server', replacement: pkg('server/src/index.ts') },
    ],
  },
  plugins: [honoPreact({ adapter: cloudflareAdapter() })],
});
