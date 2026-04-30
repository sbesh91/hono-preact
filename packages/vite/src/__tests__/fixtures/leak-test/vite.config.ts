import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { serverOnlyPlugin } from '../../../index.js';

// Minimal fixture vite config used by the build-bundle-leak test.
//
// We intentionally do NOT use the full `honoPreact` plugin here: it bundles
// `@hono/vite-build/cloudflare-workers` and `@hono/vite-dev-server`, which
// would force a Cloudflare Workers server build and a dev-server runtime.
// The leak test only needs to verify the *client* transform output, so a
// plain SPA build with `serverOnlyPlugin` is sufficient (and dramatically
// faster + more reproducible).
export default defineConfig({
  // Resolve workspace packages to their TS sources so the fixture doesn't
  // depend on a prior build step in this worktree.
  resolve: {
    alias: [
      {
        find: '@hono-preact/iso',
        replacement: resolve(__dirname, '../../../../../iso/src/index.ts'),
      },
    ],
    dedupe: ['preact', 'preact/compat', 'preact/hooks', 'preact-iso'],
  },
  plugins: [serverOnlyPlugin(), preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'static/client.js',
        chunkFileNames: 'static/[name]-[hash].js',
        assetFileNames: 'static/[name]-[hash].[ext]',
      },
    },
  },
});
