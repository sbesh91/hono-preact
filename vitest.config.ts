import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@hono-preact/iso/internal': path.resolve(__dirname, 'packages/iso/src/internal.ts'),
      '@hono-preact/iso': path.resolve(__dirname, 'packages/iso/src/index.ts'),
    },
  },
  test: {
    include: [
      'packages/iso/src/__tests__/**/*.test.{ts,tsx}',
      'packages/server/src/__tests__/**/*.test.{ts,tsx}',
      'packages/vite/src/__tests__/**/*.test.ts',
      'apps/app/src/**/__tests__/**/*.test.{ts,tsx}',
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
        'packages/*/src/__tests__/**',
        'packages/iso/src/index.ts',
        'packages/server/src/index.ts',
        'packages/server/src/context.ts',
        'packages/hono-preact/**',
      ],
    },
  },
});
