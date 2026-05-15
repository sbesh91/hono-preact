import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@hono-preact/iso/internal': path.resolve(__dirname, 'packages/iso/src/internal.ts'),
      '@hono-preact/iso/is-browser.js': path.resolve(__dirname, 'packages/iso/src/is-browser.tsx'),
      '@hono-preact/iso': path.resolve(__dirname, 'packages/iso/src/index.ts'),
      '@hono-preact/server': path.resolve(__dirname, 'packages/server/src/index.ts'),
      '@hono-preact/vite': path.resolve(__dirname, 'packages/vite/src/index.ts'),
      'hono-preact/server': path.resolve(__dirname, 'packages/hono-preact/src/server.ts'),
      'hono-preact/vite': path.resolve(__dirname, 'packages/hono-preact/src/vite.ts'),
      'hono-preact/internal': path.resolve(__dirname, 'packages/hono-preact/src/internal.ts'),
      'hono-preact': path.resolve(__dirname, 'packages/hono-preact/src/index.ts'),
      '@': path.resolve(__dirname, 'apps/site/src'),
    },
  },
  test: {
    include: [
      'packages/iso/src/**/__tests__/**/*.test.{ts,tsx}',
      'packages/server/src/**/__tests__/**/*.test.{ts,tsx}',
      'packages/vite/src/**/__tests__/**/*.test.ts',
      'packages/hono-preact/__tests__/**/*.test.{ts,tsx}',
      'apps/site/src/**/__tests__/**/*.test.{ts,tsx}',
    ],
    setupFiles: ['./vitest.setup.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: [
        'packages/iso/src/**/*.{ts,tsx}',
        'packages/server/src/**/*.{ts,tsx}',
        'packages/vite/src/**/*.ts',
      ],
      exclude: [
        'packages/*/src/**/__tests__/**',
        'packages/iso/src/index.ts',
        'packages/server/src/index.ts',
        'packages/server/src/context.ts',
        'packages/hono-preact/**',
      ],
    },
  },
});
