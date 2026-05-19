import { defineConfig } from 'vitest/config';

// WebSocket-in-dev integration tests boot real Vite dev servers (and workerd
// for the Cloudflare case). They are CPU-heavy and unreliable inside the
// parallel unit-test pool: contention starves both these tests and their
// neighbors. They run here instead, isolated and without file parallelism.
export default defineConfig({
  test: {
    include: ['packages/vite/src/__tests__/websocket-dev.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
