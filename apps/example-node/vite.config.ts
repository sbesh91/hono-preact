import { honoPreact } from 'hono-preact/vite';
import { nodeAdapter } from 'hono-preact/adapter-node';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: 'hono-preact/internal', replacement: resolve(__dirname, '../../packages/hono-preact/src/internal.ts') },
      { find: 'hono-preact/server/internal/runtime', replacement: resolve(__dirname, '../../packages/hono-preact/src/server-internal-runtime.ts') },
      { find: 'hono-preact/server', replacement: resolve(__dirname, '../../packages/hono-preact/src/server.ts') },
      { find: 'hono-preact/vite', replacement: resolve(__dirname, '../../packages/hono-preact/src/vite.ts') },
      { find: 'hono-preact/adapter-node', replacement: resolve(__dirname, '../../packages/hono-preact/src/adapter-node.ts') },
      { find: 'hono-preact', replacement: resolve(__dirname, '../../packages/hono-preact/src/index.ts') },
      { find: '@hono-preact/iso/internal', replacement: resolve(__dirname, '../../packages/iso/src/internal.ts') },
      { find: '@hono-preact/iso', replacement: resolve(__dirname, '../../packages/iso/src/index.ts') },
      { find: '@hono-preact/server/internal/runtime', replacement: resolve(__dirname, '../../packages/server/src/internal-runtime.ts') },
      { find: '@hono-preact/server', replacement: resolve(__dirname, '../../packages/server/src/index.ts') },
    ],
  },
  plugins: [honoPreact({ adapter: nodeAdapter() })],
});
