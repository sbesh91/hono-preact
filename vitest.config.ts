import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/iso/src/__tests__/**/*.test.{ts,tsx}',
      'packages/server/src/__tests__/**/*.test.ts',
      'packages/vite/src/__tests__/**/*.test.ts',
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
        'packages/iso/src/preload.ts',
        'packages/server/src/context.ts',
        'packages/hono-preact/**',
      ],
    },
  },
});
