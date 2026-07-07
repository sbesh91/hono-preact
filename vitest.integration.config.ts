import { defineConfig } from 'vitest/config';

// WebSocket-in-dev integration tests boot real Vite dev servers (and workerd
// for the Cloudflare case). They are CPU-heavy and unreliable inside the
// parallel unit-test pool: contention starves both these tests and their
// neighbors. They run here instead, isolated and without file parallelism.
//
// The create-hono-preact scaffold-integration test packs the umbrella, scaffolds
// a fresh app, installs, and builds for both adapters. It can take 60-180s per
// adapter, so the per-test timeout is bumped accordingly.
export default defineConfig({
  test: {
    include: [
      'packages/vite/src/__tests__/websocket-dev.test.ts',
      'packages/vite/src/__tests__/cf-room.test.ts',
      'packages/vite/src/__tests__/optimize-scan-entries.test.ts',
      'packages/vite/src/__tests__/cf-pubsub.test.ts',
      'packages/vite/src/__tests__/cf-socket.test.ts',
      'packages/create-hono-preact/__tests__/scaffold-integration.test.ts',
    ],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
