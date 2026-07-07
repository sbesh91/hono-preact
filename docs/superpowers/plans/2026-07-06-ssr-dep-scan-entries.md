# SSR Dep Scan Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the dev-only `__H` prerender crash on the first request to a route whose module graph pulls in a dependency not reachable from the SSR entry, by pre-bundling the whole route graph's deps at server startup.

**Architecture:** Add one `configEnvironment(name)` hook to the existing `hono-preact:config` plugin. For every non-`client` environment it returns `{ optimizeDeps: { entries: [<absolute routes path>] } }`, so Vite's esbuild dep scanner crawls the route manifest at startup and pre-bundles every dep the routes reach. No runtime dep discovery means no mid-render `[vite] program reload`, which is what swaps the Preact module instance and throws `__H`.

**Tech Stack:** Vite 8 (environments API + `configEnvironment` hook), Vitest, `@cloudflare/vite-plugin` (worker SSR env), Preact / preact-iso prerender.

## Global Constraints

- No em-dashes in code, comments, or commit messages (repo writing-style rule). Use a comma, colon, or two sentences.
- The fix must live in `packages/vite/src/hono-preact.ts` on the `hono-preact:config` plugin (framework-level, adapter-agnostic). Do not add `routes` to `HonoPreactAdapterContext`.
- `optimizeDeps.entries` value must be an absolute path resolved from the project root, not the raw relative `routes` string.
- Prefer reshaping over casts (repo cast policy). The hook's return type is a partial Vite env config; no cast should be needed.
- Framework dist must be current before `pnpm typecheck` / consuming builds: after editing `packages/vite`, run the framework build (see CI-parity note in each task).

---

### Task 1: Add the `configEnvironment` scan-entry hook

**Files:**
- Modify: `packages/vite/src/hono-preact.ts` (add `import { resolve } from 'node:path'`; add a `configEnvironment` method to the `configPlugin` object defined around line 70-97)
- Test: `packages/vite/src/__tests__/hono-preact.test.ts` (extend the existing `describe('honoPreact config plugin', ...)` block)

**Interfaces:**
- Consumes: `honoPreact({ adapter })` returns `Plugin[]`; the plugin named `hono-preact:config` now exposes both `config(userConfig, env)` and `configEnvironment(name)`.
- Produces: `configEnvironment(name: string)` returns `{ optimizeDeps: { entries: string[] } } | undefined`. It returns `undefined` for `name === 'client'`, and for any other name returns `{ optimizeDeps: { entries: [resolve(process.cwd(), routes)] } }` where `routes` is the resolved `honoPreact` option (default `'src/routes.ts'`). No later task depends on new exported symbols.

- [ ] **Step 1: Write the failing test**

Add to `packages/vite/src/__tests__/hono-preact.test.ts`, inside `describe('honoPreact config plugin', ...)`:

```ts
import { resolve } from 'node:path';

it('seeds non-client environments with the routes manifest as an optimizeDeps scan entry', () => {
  const plugins = honoPreact({ adapter: fakeAdapter() });
  const cfg = plugins.find((p) => p.name === 'hono-preact:config');
  if (!cfg || typeof cfg.configEnvironment !== 'function') {
    throw new Error('config plugin has no configEnvironment hook');
  }
  const expected = resolve(process.cwd(), 'src/routes.ts');

  // The worker/SSR environment (any non-client name) gets the scan entry.
  const ssr = cfg.configEnvironment('ssr', {}, {
    command: 'serve',
    mode: 'development',
  });
  expect(ssr).toEqual({ optimizeDeps: { entries: [expected] } });

  const worker = cfg.configEnvironment('hono_preact', {}, {
    command: 'serve',
    mode: 'development',
  });
  expect(worker).toEqual({ optimizeDeps: { entries: [expected] } });
});

it('does not seed the client environment (no SSR prerender there)', () => {
  const plugins = honoPreact({ adapter: fakeAdapter() });
  const cfg = plugins.find((p) => p.name === 'hono-preact:config');
  if (!cfg || typeof cfg.configEnvironment !== 'function') {
    throw new Error('config plugin has no configEnvironment hook');
  }
  const client = cfg.configEnvironment('client', {}, {
    command: 'serve',
    mode: 'development',
  });
  expect(client).toBeUndefined();
});

it('honors a custom routes path in the scan entry', () => {
  const plugins = honoPreact({ adapter: fakeAdapter(), routes: 'app/routing.ts' });
  const cfg = plugins.find((p) => p.name === 'hono-preact:config');
  if (!cfg || typeof cfg.configEnvironment !== 'function') {
    throw new Error('config plugin has no configEnvironment hook');
  }
  const ssr = cfg.configEnvironment('ssr', {}, {
    command: 'serve',
    mode: 'development',
  });
  expect(ssr).toEqual({
    optimizeDeps: { entries: [resolve(process.cwd(), 'app/routing.ts')] },
  });
});
```

Note: `configEnvironment`'s third argument is a `ConfigEnv`-shaped object; the hook ignores it, so the exact value in the test does not matter. If `cfg.configEnvironment` is typed as an object form rather than a function in some Vite versions, normalize with `typeof cfg.configEnvironment === 'function' ? cfg.configEnvironment : cfg.configEnvironment.handler` before calling. Check the type once during Step 3 and adjust the test guard to match.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/vite test -- hono-preact`
Expected: FAIL, the three new assertions error with "config plugin has no configEnvironment hook" (the method does not exist yet).

- [ ] **Step 3: Implement the hook**

In `packages/vite/src/hono-preact.ts`:

1. Add the import near the top (after the existing `vite` import on line 2):

```ts
import { resolve } from 'node:path';
```

2. Add a `configEnvironment` method to the `configPlugin` object (it currently has only `name` and `config`). Place it right after the closing `},` of the `config()` method:

```ts
    // Seed every non-client environment's dep optimizer with the routes
    // manifest as a scan entry, so esbuild crawls the full route graph at
    // startup and pre-bundles every dep the routes reach (framework and app
    // alike). Without this, deps behind the route views' dynamic imports and
    // the docs content-glob are discovered at request time; the resulting
    // re-optimize + program-reload races the async prerender and swaps the
    // Preact module instance mid-render (the `__H` crash). `configEnvironment`
    // is called once per environment with its name, so `name !== 'client'`
    // covers the Node `ssr` env and the Cloudflare worker env alike, with no
    // per-adapter code and without knowing the adapter's env name.
    configEnvironment(name: string) {
      if (name === 'client') return;
      return { optimizeDeps: { entries: [resolve(process.cwd(), routes)] } };
    },
```

`routes` is already in scope (destructured at the top of `honoPreact()`), and `process.cwd()` matches how `ctx.root` is derived, so the entry is an absolute path independent of the optimizer's cwd assumptions.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/vite test -- hono-preact`
Expected: PASS, all assertions in `describe('honoPreact config plugin', ...)` green, including the three new ones.

- [ ] **Step 5: CI-parity checks for the touched package**

Run, in order:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm format:check
pnpm typecheck
```
Expected: all pass. (`format:check` failing is the common miss; if it does, run `pnpm format` and re-check.)

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/hono-preact.ts packages/vite/src/__tests__/hono-preact.test.ts
git commit -m "fix(vite): seed SSR optimizer with routes scan entry to prevent dev prerender __H crash"
```

---

### Task 2: Cold-start integration regression test

This task guards the end-to-end behavior: a honoPreact Cloudflare app booted with a cold optimizer cache must serve its first request (whose lazy route view imports an otherwise-unscanned dep) as 200, not 500. It reproduces the exact race the fix closes.

**Files:**
- Create: `packages/vite/src/__tests__/fixtures/optimize-scan/wrangler.jsonc`
- Create: `packages/vite/src/__tests__/fixtures/optimize-scan/vite.config.ts`
- Create: `packages/vite/src/__tests__/fixtures/optimize-scan/src/routes.ts`
- Create: `packages/vite/src/__tests__/fixtures/optimize-scan/src/Layout.tsx`
- Create: `packages/vite/src/__tests__/fixtures/optimize-scan/src/late-view.tsx`
- Create: `packages/vite/src/__tests__/optimize-scan-entries.test.ts`
- Modify: `vitest.integration.config.ts` (add the new test to the `include` array)

**Interfaces:**
- Consumes: the `configEnvironment` hook shipped in Task 1 (via `honoPreact({ adapter: cloudflareAdapter() })` in the fixture's `vite.config.ts`).
- Produces: nothing other tasks consume. Terminal regression guard.

- [ ] **Step 1: Create the fixture app**

The fixture is a minimal honoPreact + Cloudflare app with exactly one route whose lazy view imports a dep (`@floating-ui/dom`, resolvable through the workspace root `node_modules`) that the SSR entry scan would otherwise miss, plus a `useEffect` so the render exercises `preact/hooks` during the async prerender await.

`packages/vite/src/__tests__/fixtures/optimize-scan/wrangler.jsonc`:
```jsonc
{
  "name": "optimize_scan",
  "main": "src/worker.ts",
  "compatibility_date": "2024-12-01"
}
```

`packages/vite/src/__tests__/fixtures/optimize-scan/vite.config.ts`:
```ts
import { honoPreact } from 'hono-preact/vite';
import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [honoPreact({ adapter: cloudflareAdapter() })],
});
```

`packages/vite/src/__tests__/fixtures/optimize-scan/src/routes.ts`:
```ts
import { defineRoutes } from 'hono-preact';

export default defineRoutes([
  { path: '/', view: () => import('./late-view.js') },
]);
```

`packages/vite/src/__tests__/fixtures/optimize-scan/src/Layout.tsx`:
```tsx
import { ClientScript } from 'hono-preact';
import type { ComponentChildren } from 'preact';

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html>
      <head />
      <body>
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}
```

`packages/vite/src/__tests__/fixtures/optimize-scan/src/late-view.tsx`:
```tsx
import { useEffect } from 'preact/hooks';
// Imported only from this lazily-imported route view, so the SSR entry scan
// would miss it without the routes-manifest scan entry. That late discovery is
// what triggered the mid-render reload and the __H crash.
import { computePosition } from '@floating-ui/dom';

export default function LateView() {
  useEffect(() => {
    // Reference the dep so it is a real, non-elided import.
    void computePosition;
  }, []);
  return <h1>late view ok</h1>;
}
```

Note: this fixture needs a `src/worker.ts` only if the Cloudflare plugin requires the wrangler `main` to exist for dev. honoPreact generates the worker entry itself; mirror whichever existing honoPreact CF fixture boots under `createServer` (grep `fixtures/*/wrangler.jsonc` for one whose `main` points at a generated entry, and copy that arrangement). If none exists, add a one-line `src/worker.ts` that re-exports the generated entry, matching `apps/site`'s wrangler `main`.

- [ ] **Step 2: Write the regression test (expected to reproduce the crash first)**

`packages/vite/src/__tests__/optimize-scan-entries.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, 'fixtures/optimize-scan');

function serverPort(server: ViteDevServer): number {
  const addr = server.httpServer!.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

describe('SSR optimizer scan entries: cold first-request', () => {
  let server: ViteDevServer;
  let originalCwd: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(fixtureRoot);
    // force: true mirrors `vite --force`, guaranteeing a cold optimizer cache
    // so the first request exercises the discovery path the fix must pre-empt.
    server = await createServer({
      root: fixtureRoot,
      server: { port: 0 },
      optimizeDeps: { force: true },
    });
    await server.listen();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    process.chdir(originalCwd);
  });

  it('serves the first request to a lazy route with a late dep as 200, not a __H 500', async () => {
    const res = await fetch(`http://localhost:${serverPort(server)}/`);
    const body = await res.text();
    expect(body).not.toContain('__H');
    expect(res.status).toBe(200);
  }, 30_000);
});
```

- [ ] **Step 3: Prove the guard bites (temporarily revert the fix)**

Confirm the test reproduces the crash without Task 1's hook, so it is a real regression guard and not a tautology:

```bash
git stash push -- packages/vite/src/hono-preact.ts
pnpm --filter '@hono-preact/*' build
pnpm test:integration -- optimize-scan-entries
```
Expected: FAIL, response is 500 and/or body contains `__H`.

Then restore the fix:
```bash
git stash pop
pnpm --filter '@hono-preact/*' build
```

If the test does NOT fail without the fix (the fixture did not reproduce the race), the single top-level lazy route may not force discovery during the prerender await. Make the dep heavier to discover: add a second lazily-imported nested route/layout (`layout: () => import('./late-layout.js')` wrapping the view) so the prerender awaits a chunk boundary during which the dep is discovered, matching the real `DocsLayout` shape. Re-run Step 3 until red without the fix.

- [ ] **Step 4: Run the test with the fix in place**

Run: `pnpm test:integration -- optimize-scan-entries`
Expected: PASS, status 200, body contains `late view ok`, no `__H`.

- [ ] **Step 5: Register the test in the integration config**

Edit `vitest.integration.config.ts`, add to the `include` array:
```ts
      'packages/vite/src/__tests__/optimize-scan-entries.test.ts',
```

- [ ] **Step 6: Full CI-parity pass**

Run the pre-push sequence from the repo's CLAUDE.md, in order:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all pass. Run `pnpm format` if `format:check` fails, then re-run.

- [ ] **Step 7: Commit**

```bash
git add packages/vite/src/__tests__/fixtures/optimize-scan packages/vite/src/__tests__/optimize-scan-entries.test.ts vitest.integration.config.ts
git commit -m "test(vite): cold-start regression guard for the SSR prerender __H crash"
```

---

## Manual end-to-end verification (after both tasks)

Confirm the original real-world symptom is gone on `apps/site`:

```bash
# From a clean optimizer cache, boot the site and hit the docs page on the FIRST request.
pnpm --filter site dev   # starts vite --force (cold cache) in one terminal
# in another terminal, immediately:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:<port>/docs/quick-start
```
Expected: `200` on the very first hit (before the fix: `500`). Repeat after restarting `pnpm --filter site dev` to confirm it holds across the `--force` cache wipe.

## Self-Review Notes

- Spec coverage: the `configEnvironment` fix (spec "Placement") is Task 1; the cold-start integration test (spec "Testing" item 1) is Task 2; the unit test (spec "Testing" item 2) is Task 1 Steps 1-4. The CF-clobber risk (spec "Risks") is exercised by Task 2 (if the injected entries are clobbered, Task 2 fails and the fallback is to move the same hook into each adapter plugin).
- No placeholders: every code step shows full content; the one conditional (Task 2 Step 3 fallback) gives the concrete remedy.
- Type consistency: `configEnvironment(name)` return shape `{ optimizeDeps: { entries: string[] } } | undefined` is identical in the unit test (Task 1) and the implementation (Task 1 Step 3).
