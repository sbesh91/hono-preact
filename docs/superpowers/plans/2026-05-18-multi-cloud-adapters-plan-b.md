# Multi-Cloud Adapters — Plan B (Node adapter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Node deployment adapter for `hono-preact`, built on Vite's native Environment API (no `@hono/vite-*` tooling), plus a minimal `apps/example-node` app and WebSocket-in-dev verification on both the Node and Cloudflare adapters.

**Architecture:** `nodeAdapter()` implements the existing `HonoPreactAdapter` interface (shipped in Plan A). Its `vitePlugins()` contributes a `config`-hook plugin that defines the server (`ssr`) build environment and a `builder` so one `vite build` emits both the browser bundle and the Node server bundle, plus a dev plugin whose `configureServer` hook runs the server via Vite's SSR module runner and wires the HTTP `upgrade` event for WebSockets. Its `wrapEntry()` composes an outer Hono app (`serveStatic` for `dist/client`, then the core app) booted with `@hono/node-server`'s `serve()`.

**Tech Stack:** TypeScript, Vite 8 Environment API, `@hono/node-server`, `@hono/node-ws`, Vitest, pnpm workspaces. Spec: `docs/superpowers/specs/2026-05-17-multi-cloud-adapter-architecture-design.md`.

**Builds on Plan A (merged):** the `HonoPreactAdapter` interface (`packages/vite/src/adapter.ts`), the core-app-module / entry-wrapper split (`server-entry.ts`), `honoPreact()` requiring an `adapter`, and `configPlugin` owning the `client` build environment config. Plan B does not change any of that; it adds a second adapter alongside `cloudflareAdapter()`.

**Lessons from Plan A carried in:**
- A consuming app's `vite.config.ts` imports `honoPreact` from the *built* umbrella `dist/`. After changing framework source, always run `pnpm --filter '@hono-preact/*' --filter hono-preact build` before building a consuming app, or the change will not take effect.
- The generated entry wrapper must exist on disk before the build/dev plugins resolve config; `serverEntryPlugin` already writes it in its `config` hook. The Node adapter's plugins must not assume an earlier time.
- The `client` build environment is already configured by `configPlugin` (Plan A). The Node adapter only configures the *server* environment.

---

## File Structure

**Created:**
- `packages/vite/src/adapter-node.ts` — `nodeAdapter()` factory: `vitePlugins()`, `wrapEntry()`. Standalone module, NOT re-exported by `index.ts` (importing `hono-preact/vite` must not pull in `@hono/node-server`).
- `packages/vite/src/node-dev-server.ts` — the dev plugin (`configureServer` middleware + WebSocket `upgrade` wiring). Kept separate from `adapter-node.ts` so the adapter factory stays small and the dev server is independently testable.
- `packages/hono-preact/src/adapter-node.ts` — umbrella subpath re-export.
- `apps/example-node/` — minimal Node-target app: `package.json`, `vite.config.ts`, `tsconfig.json`, `src/Layout.tsx`, `src/routes.ts`, `src/api.ts`, two page components, one `.server.ts` loader, one action, one `/ws` WebSocket route.
- `docs/superpowers/research/2026-05-18-node-environment-api-spike.md` — Task 0 findings.
- Tests: `packages/vite/src/__tests__/adapter-node.test.ts`, `packages/vite/src/__tests__/node-dev-server.test.ts`, `packages/vite/src/__tests__/websocket-dev.test.ts`.

**Modified:**
- `packages/vite/package.json` — add `./adapter-node` export; add `@hono/node-server` + `@hono/node-ws` as optional peer deps and as devDependencies (for tests).
- `packages/hono-preact/package.json` — add `./adapter-node` export; add the two peers.
- `packages/hono-preact/scripts/consolidate.mjs` — teach it the `@hono-preact/vite/adapter-node` specifier.

**Untouched:** `adapter.ts`, `hono-preact.ts`, `server-entry.ts`, `adapter-cloudflare.ts`, `apps/site`. Plan B is purely additive.

---

## Task 0: Node Environment-API spike (implementation gate)

No production code is committed. This task validates the three mechanisms the Node adapter depends on, none of which Plan A's spike exercised. If any fails, STOP and revisit the spec's Node-adapter / D2 section.

**Files:**
- Create: `docs/superpowers/research/2026-05-18-node-environment-api-spike.md`

- [ ] **Step 1: Scaffold a throwaway project**

Outside the repo (e.g. `/tmp/node-env-spike`): `npm init -y`; install `vite@8.0.8`, `hono`, `@hono/node-server`, `@hono/node-ws`. Create a trivial Hono app module and a `vite.config.ts`.

- [ ] **Step 2: Validate a multi-environment build**

Configure a `client` environment and an `ssr` environment plus `builder.buildApp`, so a single `vite build` emits a browser bundle and a Node-runnable server bundle. Run `npx vite build`. Record: does one `vite build` produce both; what is the output layout; does the server bundle run under `node`.

- [ ] **Step 3: Validate an SSR dev middleware**

In a `configureServer` hook, create a module runner against the `ssr` environment (`createServerModuleRunner` or `server.environments.ssr` runner), load the server entry, and add a Connect middleware that converts the Node request to a `Request`, calls the app's `fetch`, and writes the `Response` back. Run `npx vite dev`, confirm `GET /` is served by the SSR app, and confirm editing a server module hot-reloads.

- [ ] **Step 4: Validate WebSocket upgrade wiring**

Using `@hono/node-ws`'s `createNodeWebSocket` / `injectWebSocket`, attach an `upgrade` listener to the Vite dev server's `httpServer` in `configureServer`. Confirm a WebSocket client connecting to a `/ws` route during `vite dev` reaches the handler (open/message/close run).

- [ ] **Step 5: Write findings and commit**

Write `docs/superpowers/research/2026-05-18-node-environment-api-spike.md`: the working `environments` + `builder` config shape, the working module-runner dev-middleware shape, the working `upgrade`-wiring shape, the build output layout, resolved `@hono/node-server` and `@hono/node-ws` versions, and any Vite-8 API specifics (exact import names for the module runner). Commit only that file:

```bash
git add docs/superpowers/research/2026-05-18-node-environment-api-spike.md
git commit -m "research: Node Environment-API spike for the Node adapter"
```

- [ ] **Step 6: Go/no-go**

If Steps 2-4 all succeed, proceed. If any fails, STOP and report — the D2 "framework-owned Node dev middleware" decision must be reconsidered (fallback: reintroduce `@hono/vite-dev-server` for the Node dev path only).

> The concrete code in Tasks 2 and 3 below is written from the spec's intended design. Where the spike's findings differ (exact module-runner API, config shape), the spike findings win — adjust those tasks to match the committed spike doc.

---

## Task 1: Node adapter skeleton and `wrapEntry()`

**Files:**
- Create: `packages/vite/src/adapter-node.ts`
- Modify: `packages/vite/package.json` (devDependencies)
- Test: `packages/vite/src/__tests__/adapter-node.test.ts`

- [ ] **Step 1: Add `@hono/node-server` and `@hono/node-ws` as devDependencies**

`adapter-node.ts` and its tests import these. Add to `packages/vite/package.json` `devDependencies` at the versions Task 0's spike resolved (use the spike's exact versions):

```json
    "@hono/node-server": "^1.19.0",
    "@hono/node-ws": "^1.2.0",
```

Run `pnpm install`. Expected: clean.

- [ ] **Step 2: Write the failing test**

`vitePlugins()` is exercised by Task 5's example-app build/dev, not unit-tested here (it constructs dev/build plugins). This test covers the pure surface.

```ts
import { describe, it, expect } from 'vitest';
import { nodeAdapter } from '../adapter-node.js';

const ctx = {
  root: '/p',
  coreAppModuleId: '/p/node_modules/.vite/hono-preact/core-app.tsx',
  entryWrapperId: '/p/node_modules/.vite/hono-preact/server-entry.tsx',
};

describe('nodeAdapter', () => {
  it('is named "node"', () => {
    expect(nodeAdapter().name).toBe('node');
  });

  it('wrapEntry composes an outer app: static assets, core app, serve()', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    expect(tail).toContain("from '@hono/node-server'");
    expect(tail).toContain('serveStatic');
    expect(tail).toContain(ctx.coreAppModuleId);
    expect(tail).toContain('serve(');
  });

  it('exposes a vitePlugins function', () => {
    expect(typeof nodeAdapter().vitePlugins).toBe('function');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/vite/src/__tests__/adapter-node.test.ts`
Expected: FAIL — cannot find module `../adapter-node.js`.

- [ ] **Step 4: Implement the adapter skeleton**

```ts
// packages/vite/src/adapter-node.ts
//
// Standalone module. NOT re-exported by index.ts: importing `hono-preact/vite`
// must never pull in `@hono/node-server`. Only importing
// `hono-preact/adapter-node` loads this file.
import type { Plugin } from 'vite';
import type { HonoPreactAdapter, HonoPreactAdapterContext } from './adapter.js';
import { nodeBuildPlugin, nodeDevServerPlugin } from './node-dev-server.js';

export function nodeAdapter(): HonoPreactAdapter {
  return {
    name: 'node',
    vitePlugins(ctx: HonoPreactAdapterContext): Plugin[] {
      return [nodeBuildPlugin(ctx), nodeDevServerPlugin(ctx)];
    },
    wrapEntry(ctx: HonoPreactAdapterContext): string {
      // Node has no CDN asset layer, so the entry composes an outer Hono app:
      // static files first, then the framework's core app, booted with a
      // Node HTTP listener. `serveStatic` root is the client build output.
      return (
        `import { serve } from '@hono/node-server';\n` +
        `import { serveStatic } from '@hono/node-server/serve-static';\n` +
        `import { Hono } from 'hono';\n` +
        `import coreApp from ${JSON.stringify(ctx.coreAppModuleId)};\n` +
        `\n` +
        `const app = new Hono()\n` +
        `  .use('/static/*', serveStatic({ root: './dist/client' }))\n` +
        `  .route('/', coreApp);\n` +
        `\n` +
        `const port = Number(process.env.PORT) || 3000;\n` +
        `serve({ fetch: app.fetch, port });\n` +
        `console.log('hono-preact (node) listening on :' + port);\n` +
        `\n` +
        `export default app;\n`
      );
    },
  };
}
```

`nodeBuildPlugin` and `nodeDevServerPlugin` are created in Tasks 2 and 3. To make this task compile and its test pass on its own, first create `packages/vite/src/node-dev-server.ts` with two stub exports:

```ts
// packages/vite/src/node-dev-server.ts
import type { Plugin } from 'vite';
import type { HonoPreactAdapterContext } from './adapter.js';

export function nodeBuildPlugin(_ctx: HonoPreactAdapterContext): Plugin {
  return { name: 'hono-preact:node-build' };
}

export function nodeDevServerPlugin(_ctx: HonoPreactAdapterContext): Plugin {
  return { name: 'hono-preact:node-dev-server' };
}
```

Tasks 2 and 3 fill these in.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/vite/src/__tests__/adapter-node.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/adapter-node.ts packages/vite/src/node-dev-server.ts packages/vite/package.json packages/vite/src/__tests__/adapter-node.test.ts pnpm-lock.yaml
git commit -m "feat(vite): add Node adapter skeleton and wrapEntry"
```

---

## Task 2: Node build environment config (`nodeBuildPlugin`)

Fill in `nodeBuildPlugin` so one `vite build` emits the Node server bundle alongside the client bundle. The exact `environments` / `builder` shape is governed by Task 0's spike findings — implement to match the committed spike doc.

**Files:**
- Modify: `packages/vite/src/node-dev-server.ts`
- Test: `packages/vite/src/__tests__/node-dev-server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { nodeBuildPlugin } from '../node-dev-server.js';

const ctx = {
  root: '/p',
  coreAppModuleId: '/p/node_modules/.vite/hono-preact/core-app.tsx',
  entryWrapperId: '/p/node_modules/.vite/hono-preact/server-entry.tsx',
};

describe('nodeBuildPlugin', () => {
  it('contributes an ssr build environment whose input is the entry wrapper', () => {
    const plugin = nodeBuildPlugin(ctx);
    const cfg = (plugin.config as Function)(
      {},
      { command: 'build', mode: 'production' }
    ) as {
      environments: { ssr: { build: { rollupOptions: { input: string[] } } } };
    };
    expect(cfg.environments.ssr.build.rollupOptions.input).toEqual([
      ctx.entryWrapperId,
    ]);
  });

  it('builds the app via a builder.buildApp orchestrator', () => {
    const plugin = nodeBuildPlugin(ctx);
    const cfg = (plugin.config as Function)(
      {},
      { command: 'build', mode: 'production' }
    ) as { builder: { buildApp: unknown } };
    expect(typeof cfg.builder.buildApp).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/vite/src/__tests__/node-dev-server.test.ts`
Expected: FAIL — the stub `nodeBuildPlugin` returns no `config`.

- [ ] **Step 3: Implement `nodeBuildPlugin`**

Replace the `nodeBuildPlugin` stub in `packages/vite/src/node-dev-server.ts`. The plugin's `config` hook defines the `ssr` environment (entry = the framework's generated entry wrapper, Node platform, no externalization of the framework runtime) and a `builder.buildApp` that builds the `client` environment then the `ssr` environment. Use the exact `environments` / `builder` shape the Task 0 spike recorded as working; the structure is:

```ts
export function nodeBuildPlugin(ctx: HonoPreactAdapterContext): Plugin {
  return {
    name: 'hono-preact:node-build',
    config() {
      return {
        environments: {
          ssr: {
            build: {
              outDir: 'dist/server',
              rollupOptions: { input: [ctx.entryWrapperId] },
            },
          },
        },
        builder: {
          async buildApp(builder) {
            await builder.build(builder.environments.client);
            await builder.build(builder.environments.ssr);
          },
        },
      };
    },
  };
}
```

> **Spike dependency:** if Task 0 found a different working shape (e.g. `ssr` must set `ssr: true` / a specific `consumer`, or the server bundle needs `build.ssr` rather than `rollupOptions.input`, or the Node bundle must not be code-split), adopt the spike's shape and update the Step 1 test assertions to match.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/vite/src/__tests__/node-dev-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/node-dev-server.ts packages/vite/src/__tests__/node-dev-server.test.ts
git commit -m "feat(vite): Node adapter build environment config"
```

---

## Task 3: Node dev server middleware (`nodeDevServerPlugin`)

Fill in `nodeDevServerPlugin`: a `configureServer` hook that serves the SSR app in dev via Vite's module runner and wires the WebSocket `upgrade` event. The concrete module-runner API and middleware shape come from Task 0's spike doc.

**Files:**
- Modify: `packages/vite/src/node-dev-server.ts`
- Test: `packages/vite/src/__tests__/node-dev-server.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

A full dev-server integration test belongs in Task 6 (it needs a running server). Here, assert the plugin's shape only:

```ts
import { nodeDevServerPlugin } from '../node-dev-server.js';

describe('nodeDevServerPlugin', () => {
  it('is a serve-only plugin with a configureServer hook', () => {
    const plugin = nodeDevServerPlugin({
      root: '/p',
      coreAppModuleId: '/p/a.tsx',
      entryWrapperId: '/p/b.tsx',
    });
    expect(plugin.name).toBe('hono-preact:node-dev-server');
    expect(plugin.apply).toBe('serve');
    expect(typeof plugin.configureServer).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/vite/src/__tests__/node-dev-server.test.ts`
Expected: FAIL — the stub has no `apply` / `configureServer`.

- [ ] **Step 3: Implement `nodeDevServerPlugin`**

Replace the `nodeDevServerPlugin` stub. The `configureServer` hook: (a) loads the generated entry wrapper through Vite's SSR module runner so the Hono app and its server modules are HMR-aware; (b) returns a post-middleware that converts the Node request to a `Request`, calls the app's `fetch`, and streams the `Response` back; (c) attaches an `upgrade` listener to `server.httpServer` via `@hono/node-ws`'s `injectWebSocket`. Implement to the shape the Task 0 spike recorded. Skeleton:

```ts
export function nodeDevServerPlugin(ctx: HonoPreactAdapterContext): Plugin {
  return {
    name: 'hono-preact:node-dev-server',
    apply: 'serve',
    configureServer(server) {
      // Module runner for the `ssr` environment — loads the entry wrapper
      // with HMR so server-code edits hot-reload. Exact API per spike.
      // WebSocket: createNodeWebSocket({ app }).injectWebSocket(httpServer)
      // wired against server.httpServer for `upgrade` events.
      // Request path: return a post-hook middleware that runs app.fetch.
      return () => {
        server.middlewares.use(async (req, res) => {
          // build Request -> app.fetch -> write Response (per spike)
        });
      };
    },
  };
}
```

> **Spike dependency:** this is the task most governed by Task 0. Use the spike doc's verified module-runner code, request/response conversion, and `upgrade`-wiring verbatim. If the spike could not get HMR or the `upgrade` event working, STOP and escalate before writing a partial implementation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/vite/src/__tests__/node-dev-server.test.ts`
Expected: PASS (shape test). End-to-end dev verification is Task 6.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/node-dev-server.ts packages/vite/src/__tests__/node-dev-server.test.ts
git commit -m "feat(vite): Node adapter dev server middleware"
```

---

## Task 4: Umbrella `hono-preact/adapter-node` subpath

Mirrors Plan A's Task 7 (the Cloudflare subpath), which is the reference for every step here.

**Files:**
- Modify: `packages/vite/package.json`
- Create: `packages/hono-preact/src/adapter-node.ts`
- Modify: `packages/hono-preact/package.json`
- Modify: `packages/hono-preact/scripts/consolidate.mjs`

- [ ] **Step 1: Add the `./adapter-node` export to the vite package**

In `packages/vite/package.json` `exports`, add after the `./adapter-cloudflare` entry:

```json
    "./adapter-node": {
      "types": "./dist/adapter-node.d.ts",
      "import": "./dist/adapter-node.js"
    },
```

- [ ] **Step 2: Create the umbrella re-export module**

```ts
// packages/hono-preact/src/adapter-node.ts
export * from '@hono-preact/vite/adapter-node';
```

- [ ] **Step 3: Add the umbrella `./adapter-node` export and peer deps**

In `packages/hono-preact/package.json`: add to `exports` after `./adapter-cloudflare`:

```json
    "./adapter-node": {
      "types": "./dist/adapter-node.d.ts",
      "import": "./dist/adapter-node.js"
    },
```

Add `@hono/node-server` and `@hono/node-ws` to `peerDependencies` (at the spike's resolved versions) and mark both optional in `peerDependenciesMeta`:

```json
    "@hono/node-server": "^1.19.0",
    "@hono/node-ws": "^1.2.0",
```

```json
    "@hono/node-server": { "optional": true },
    "@hono/node-ws": { "optional": true },
```

- [ ] **Step 4: Add `@hono/node-server` and `@hono/node-ws` as optional peers of the vite package**

In `packages/vite/package.json`, add the two packages to `peerDependencies` and mark them optional in `peerDependenciesMeta` (they are already devDependencies from Task 1; this declares the consumer-facing peer contract).

- [ ] **Step 5: Teach `consolidate.mjs` the new specifier**

In `packages/hono-preact/scripts/consolidate.mjs`, add to `DIST_PATHS` after the `'@hono-preact/vite/adapter-cloudflare'` line:

```js
  '@hono-preact/vite/adapter-node': 'vite/adapter-node.js',
```

Update the rewrite regex to include `vite/adapter-node` in the alternation (longest-match-first, before `vite`):

```js
    /(['"])(@hono-preact\/(?:iso\/internal|iso|server|vite\/adapter-cloudflare|vite\/adapter-node|vite))(['"])/g,
```

- [ ] **Step 6: Verify the umbrella builds and consolidates**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: completes; `packages/hono-preact/dist/adapter-node.js` exists and its `@hono-preact/vite/adapter-node` import is rewritten to `./vite/adapter-node.js`.

- [ ] **Step 7: Commit**

```bash
git add packages/vite/package.json packages/hono-preact/src/adapter-node.ts packages/hono-preact/package.json packages/hono-preact/scripts/consolidate.mjs pnpm-lock.yaml
git commit -m "feat(hono-preact): expose hono-preact/adapter-node subpath"
```

---

## Task 5: `apps/example-node` example app

A minimal Node-target app that exercises the adapter end to end and serves as the Node docs reference.

**Files:**
- Create: `apps/example-node/package.json`, `apps/example-node/tsconfig.json`, `apps/example-node/vite.config.ts`
- Create: `apps/example-node/src/Layout.tsx`, `src/routes.ts`, `src/api.ts`, `src/pages/home.tsx`, `src/pages/about.tsx`, `src/pages/data.server.ts` (a loader), and an action
- Create: `apps/example-node/src/pages/ws.ts` (a WebSocket route, registered in `api.ts`)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "example-node",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "start": "node dist/server/server-entry.js"
  },
  "dependencies": {
    "hono-preact": "workspace:*",
    "hono": "^4.12.14",
    "preact": "^10.29.1",
    "preact-iso": "github:preactjs/preact-iso#v3"
  },
  "devDependencies": {
    "@hono/node-server": "^1.19.0",
    "@hono/node-ws": "^1.2.0",
    "@preact/preset-vite": "^2.10.5",
    "preact-render-to-string": "^6.6.7",
    "typescript": "*",
    "vite": "*"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts`**

Mirror `apps/site/vite.config.ts` but with `nodeAdapter()` and only the umbrella source aliases (no MDX, no visualizer):

```ts
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
      { find: 'hono-preact/server', replacement: resolve(__dirname, '../../packages/hono-preact/src/server.ts') },
      { find: 'hono-preact/vite', replacement: resolve(__dirname, '../../packages/hono-preact/src/vite.ts') },
      { find: 'hono-preact/adapter-node', replacement: resolve(__dirname, '../../packages/hono-preact/src/adapter-node.ts') },
      { find: 'hono-preact', replacement: resolve(__dirname, '../../packages/hono-preact/src/index.ts') },
      { find: '@hono-preact/iso/internal', replacement: resolve(__dirname, '../../packages/iso/src/internal.ts') },
      { find: '@hono-preact/iso', replacement: resolve(__dirname, '../../packages/iso/src/index.ts') },
      { find: '@hono-preact/server', replacement: resolve(__dirname, '../../packages/server/src/index.ts') },
    ],
  },
  plugins: [honoPreact({ adapter: nodeAdapter() })],
});
```

> Note: the consuming app's `vite.config.ts` imports `honoPreact` from the *built* umbrella `dist/`. Run `pnpm --filter '@hono-preact/*' --filter hono-preact build` before the first `vite build`/`dev` here, and after any framework change.

- [ ] **Step 3: Create the app source**

Create `tsconfig.json` (copy `apps/site/tsconfig.json`), `src/Layout.tsx`, `src/routes.ts` (two routes: `/` → home, `/about` → about), `src/pages/home.tsx`, `src/pages/about.tsx`, `src/pages/data.server.ts` (one `defineLoader` returning a value the home page renders), and one action. Keep each file minimal — this app exists to exercise the adapter, not to demo features. Model the file shapes on `apps/site/src/`.

- [ ] **Step 4: Create the WebSocket route**

`src/api.ts` exports a Hono app with a `/ws` route using `@hono/node-ws`'s `upgradeWebSocket` (echo server: `onMessage` sends back `echo: <data>`). `api.ts` is mounted by the framework ahead of the reserved RPC paths.

- [ ] **Step 5: Build and run**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm --filter example-node build
pnpm --filter example-node start
```

Expected: build emits `dist/client/` and `dist/server/`; `node` boots the server; `curl localhost:3000/` returns SSR HTML; `/about` works; the loader-backed value renders.

- [ ] **Step 6: Commit**

```bash
git add apps/example-node pnpm-lock.yaml
git commit -m "feat(example-node): minimal Node-target example app"
```

---

## Task 6: WebSocket verification (both adapters)

**Files:**
- Create: `packages/vite/src/__tests__/websocket-dev.test.ts`
- Modify: `apps/site/src/api.ts` is NOT touched; the Cloudflare WS test uses a fixture.

- [ ] **Step 1: Write the Node WebSocket dev-server test**

An integration test that starts `apps/example-node` under `vite dev` (programmatically via Vite's `createServer`), connects a WebSocket client to `/ws`, sends a message, and asserts the echo reply. This proves the Node adapter's `upgrade` wiring (Task 3).

```ts
import { describe, it, expect } from 'vitest';
// Start example-node's vite dev server, connect ws://.../ws, assert echo.
// Use Vite's createServer API + the `ws` client (a dev dependency).
```

Write the full test body using the dev-server start pattern Task 0's spike validated.

- [ ] **Step 2: Run it — verify Node WS works**

Run: `pnpm vitest run packages/vite/src/__tests__/websocket-dev.test.ts`
Expected: PASS — the upgrade reaches the handler and the echo returns.

- [ ] **Step 3: Add the Cloudflare WebSocket dev-server test**

In the same file, a second test boots the `@cloudflare/vite-plugin` dev server (a small fixture worker with a `hono/cloudflare-workers` `upgradeWebSocket` `/ws` route) and connects a WebSocket client. This confirms the spec's claim that Cloudflare WS works in dev for free.

- [ ] **Step 4: Run the file — both tests pass**

Run: `pnpm vitest run packages/vite/src/__tests__/websocket-dev.test.ts`
Expected: PASS (Node and Cloudflare).

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/__tests__/websocket-dev.test.ts
git commit -m "test(vite): WebSocket-in-dev verification for both adapters"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Rebuild the umbrella, then run the whole test suite**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm test
```

Expected: PASS. Investigate any failure before proceeding.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, `pnpm format` and commit.

- [ ] **Step 4: Build both example apps**

```bash
pnpm --filter site build
pnpm --filter example-node build
```

Expected: both succeed; `apps/site/dist/client/static/client.js` and `apps/example-node/dist/server/` are present.

- [ ] **Step 5: Final commit if needed**

```bash
git add -A
git commit -m "chore: typecheck and format fixes for the Node adapter"
```

---

## Self-Review Notes

- **Spec coverage:** Plan B covers the spec's Node-adapter section — Environment-API build (Task 2), framework-owned dev middleware with WebSocket support (Task 3), the `serveStatic` + `serve()` `wrapEntry` (Task 1), optional peer deps and the umbrella subpath (Task 4), the `apps/example-node` reference app (Task 5), and WebSocket verification on both adapters (Task 6). The spec's "Node adapter uses no `@hono/vite-*` tooling" is satisfied — only `@hono/node-server` and `@hono/node-ws` (runtime deps) are added.
- **Spike-dependent tasks:** Tasks 2 and 3 carry explicit "Spike dependency" notes. Their concrete code is the spec's intended shape; Task 0's findings override where they differ. This is deliberate — the Vite-native Node dev middleware was never exercised before this plan.
- **Isolation:** `adapter-node.ts` is not re-exported by `index.ts`, mirroring `adapter-cloudflare.ts`, so `hono-preact/vite` stays free of `@hono/node-server`.
- **Out of scope:** Bun and Deno adapters; converting `apps/site` to be adapter-swappable; any change to the Cloudflare adapter or Plan A code.
