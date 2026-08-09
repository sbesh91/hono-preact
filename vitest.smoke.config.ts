import { defineConfig } from 'vitest/config';

// The page-render smoke suite. It boots real Vite dev servers (and workerd, for
// the Cloudflare adapter) and asks each for real pages, so it is far too slow
// and too CPU-hungry to sit in the unit pool -- and, like the integration
// suite, it is starved into flakiness by file parallelism.
//
// It runs at MERGE time (the `merge_group` event), not on every PR push: see
// the `smoke` job in .github/workflows/ci.yml.
export default defineConfig({
  test: {
    include: ['smoke/**/*.smoke.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
