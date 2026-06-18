import { defineConfig, configDefaults } from 'vitest/config';
import { readFileSync } from 'fs';
import path from 'path';

// Mirror the Vite build's `define` (apps/site/vite.config.ts) so components
// that read the injected framework version render under vitest instead of
// throwing on an undefined global.
const frameworkVersion = JSON.parse(
  readFileSync(
    path.resolve(__dirname, 'packages/hono-preact/package.json'),
    'utf8'
  )
).version as string;

export default defineConfig({
  define: {
    __HONO_PREACT_VERSION__: JSON.stringify(frameworkVersion),
  },
  resolve: {
    alias: {
      '@hono-preact/iso/internal/runtime': path.resolve(
        __dirname,
        'packages/iso/src/internal-runtime.ts'
      ),
      '@hono-preact/iso/internal': path.resolve(
        __dirname,
        'packages/iso/src/internal.ts'
      ),
      '@hono-preact/iso/is-browser.js': path.resolve(
        __dirname,
        'packages/iso/src/is-browser.tsx'
      ),
      '@hono-preact/iso/page': path.resolve(
        __dirname,
        'packages/iso/src/page-only.ts'
      ),
      '@hono-preact/iso': path.resolve(__dirname, 'packages/iso/src/index.ts'),
      '@hono-preact/server': path.resolve(
        __dirname,
        'packages/server/src/index.ts'
      ),
      '@hono-preact/vite': path.resolve(
        __dirname,
        'packages/vite/src/index.ts'
      ),
      'hono-preact/server': path.resolve(
        __dirname,
        'packages/hono-preact/src/server.ts'
      ),
      'hono-preact/vite': path.resolve(
        __dirname,
        'packages/hono-preact/src/vite.ts'
      ),
      'hono-preact/internal/runtime': path.resolve(
        __dirname,
        'packages/hono-preact/src/internal-runtime.ts'
      ),
      'hono-preact/internal': path.resolve(
        __dirname,
        'packages/hono-preact/src/internal.ts'
      ),
      'hono-preact/adapter-cloudflare': path.resolve(
        __dirname,
        'packages/vite/src/adapter-cloudflare.ts'
      ),
      'hono-preact/adapter-node': path.resolve(
        __dirname,
        'packages/vite/src/adapter-node.ts'
      ),
      'hono-preact/page': path.resolve(
        __dirname,
        'packages/hono-preact/src/page.ts'
      ),
      'hono-preact': path.resolve(
        __dirname,
        'packages/hono-preact/src/index.ts'
      ),
      'hono-preact-ui': path.resolve(__dirname, 'packages/ui/src/index.ts'),
      '@': path.resolve(__dirname, 'apps/site/src'),
    },
  },
  test: {
    include: [
      'packages/iso/src/**/__tests__/**/*.test.{ts,tsx}',
      'packages/ui/src/**/__tests__/**/*.test.{ts,tsx}',
      'packages/server/src/**/__tests__/**/*.test.{ts,tsx}',
      'packages/vite/src/**/__tests__/**/*.test.ts',
      'packages/hono-preact/__tests__/**/*.test.{ts,tsx}',
      'packages/create-hono-preact/__tests__/**/*.test.{ts,tsx}',
      'apps/site/src/**/__tests__/**/*.test.{ts,tsx}',
      'scripts/__tests__/**/*.test.mjs',
    ],
    // Type-level tests (`*.test-d.ts`) assert on conditional/template-literal
    // types via `expectTypeOf`/`@ts-expect-error`. They run ONLY under
    // `pnpm test:types` (`vitest --typecheck.only`), never on the hot `pnpm
    // test` path, and tsc enforces the assertions so a type regression fails
    // the build. They live beside runtime tests under `__tests__/` (which the
    // package `tsconfig`s exclude from emit), so nothing leaks into `dist/`.
    typecheck: {
      include: ['packages/**/src/**/__tests__/**/*.test-d.{ts,tsx}'],
      tsconfig: './tsconfig.typecheck.json',
    },
    // websocket-dev.test.ts boots real Vite dev servers (and workerd); it is
    // CPU-heavy and starves the parallel pool. It runs separately via
    // `pnpm test:integration` (vitest.integration.config.ts).
    exclude: [
      ...configDefaults.exclude,
      'packages/vite/src/__tests__/websocket-dev.test.ts',
      'packages/create-hono-preact/__tests__/scaffold-integration.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
    environment: 'node',
    // Stop happy-dom from trying to fetch and execute every <script src=...>
    // and <link rel=stylesheet href=...> it sees in SSR'd output. Those
    // loads fail (the virtual module ids don't exist outside Vite, and the
    // stylesheet URLs don't resolve in the test runner), raising
    // DOMExceptions that surface as unhandled rejections and clutter the
    // output. We don't exercise actual script/CSS loading in unit tests;
    // disabling both removes the spurious failure mode.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
        },
      },
    },
    // Even with the script/CSS loaders disabled, happy-dom still throws
    // DOMException to signal the disabled-load path. Those throws settle as
    // unhandled rejections and Vitest's reporter prints them on top of the
    // test summary. Suppress them by name so a wall of identical happy-dom
    // stack traces stops drowning out real signal. Test failures still
    // surface via assertions; only the orphan rejections are silenced.
    dangerouslyIgnoreUnhandledErrors: true,
    // Suppress happy-dom's noisy DOMException stacks (virtual-module script
    // loads + aborted stylesheet fetches) so a real uncaught rejection
    // isn't lost in the wall. Return false to swallow; true to keep.
    onConsoleLog(log) {
      if (
        log.includes('JavaScript file loading is disabled') ||
        log.includes('Failed to execute "fetch()" on "Window"') ||
        log.includes('NetworkError when attempting to fetch resource')
      ) {
        return false;
      }
      return true;
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: [
        'packages/iso/src/**/*.{ts,tsx}',
        'packages/server/src/**/*.{ts,tsx}',
        'packages/vite/src/**/*.ts',
        'packages/ui/src/**/*.{ts,tsx}',
      ],
      exclude: [
        'packages/*/src/**/__tests__/**',
        'packages/iso/src/index.ts',
        'packages/server/src/index.ts',
        'packages/server/src/context.ts',
        'packages/hono-preact/**',
        'packages/ui/src/index.ts',
        'packages/ui/src/dialog/index.ts',
        'packages/ui/src/popover/index.ts',
        'packages/ui/src/tooltip/index.ts',
        'packages/ui/src/combobox/index.ts',
      ],
    },
  },
});
