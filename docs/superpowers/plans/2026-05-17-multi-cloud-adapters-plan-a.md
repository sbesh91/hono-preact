# Multi-Cloud Adapters — Plan A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded Cloudflare build/dev toolchain in `honoPreact()` with a deployment-adapter abstraction, and ship the Cloudflare adapter built on `@cloudflare/vite-plugin`, leaving `apps/site` green.

**Architecture:** `honoPreact()` takes a required `adapter` object exposing two methods — `vitePlugins()` (terminal build/dev plugins) and `wrapEntry()` (the platform tail of the server entry). The framework generates a platform-agnostic core Hono app module; the adapter generates a thin wrapper importing it. Server-entry generation splits into core-module + adapter-wrapper. The Cloudflare adapter delegates to `@cloudflare/vite-plugin` (workerd dev + build).

**Tech Stack:** TypeScript, Vite 8, `@cloudflare/vite-plugin`, Vitest, pnpm workspaces. The spec is `docs/superpowers/specs/2026-05-17-multi-cloud-adapter-architecture-design.md`.

**Scope note:** This is Plan A of two. Plan B (Node adapter, `apps/example-node`, WebSocket verification) is written after Task 0's spike. Plan A delivers a working framework on the new architecture with Cloudflare as the only adapter.

**Interface deviation from the spec:** The spec's `HonoPreactAdapterContext` listed `command` and `outDir`. Neither is known when `honoPreact()` builds its plugin array (Vite supplies them only via plugin hooks). Plan A therefore narrows the context to the statically-known fields (`root`, `coreAppModuleId`, `entryWrapperId`); adapters needing `command`/`outDir` read them from their own plugin hooks.

**Simplification from the spec:** The spec called for adapters to wrap their toolchain import in a try/catch with a friendly "install X" message. Plan A uses a plain static import of `@cloudflare/vite-plugin` in the adapter module. If the optional peer is not installed, Node's module-resolution error already names the missing package. A friendly wrapper would require async plugin construction for marginal gain — dropped as YAGNI.

---

## File Structure

**Created:**
- `packages/vite/src/adapter.ts` — the `HonoPreactAdapter` / `HonoPreactAdapterContext` interface types. No runtime code.
- `packages/vite/src/adapter-cloudflare.ts` — `cloudflareAdapter()` factory. Standalone module, deliberately NOT re-exported by `index.ts`, so importing `hono-preact/vite` never loads `@cloudflare/vite-plugin`.
- `packages/hono-preact/src/adapter-cloudflare.ts` — umbrella subpath re-export.
- `docs/superpowers/research/2026-05-17-cloudflare-vite-plugin-spike.md` — Task 0 findings.

**Modified:**
- `packages/vite/src/server-entry.ts` — split generation into core-app-module + adapter-wrapper.
- `packages/vite/src/hono-preact.ts` — required `adapter` option; gut `configPlugin`; splice `adapter.vitePlugins()`; remove `entry`/`useGeneratedEntry`; drop hardcoded `@hono/vite-build` + `@hono/vite-dev-server`.
- `packages/vite/src/client-shim.ts` — fix the `apply` gate that branches on `mode === 'client'`.
- `packages/vite/src/index.ts` — export the adapter types; update server-entry exports.
- `packages/vite/package.json` — peer-dep changes.
- `packages/vite/src/__tests__/hono-preact.test.ts` — rewritten.
- `packages/hono-preact/package.json` — `exports` subpath, dependency changes.
- `packages/hono-preact/scripts/consolidate.mjs` — handle the new subpath.
- `apps/site/vite.config.ts`, `apps/site/package.json`, `apps/site/wrangler.jsonc` — Cloudflare-adapter migration.
- `apps/site/src/pages/docs/deployment.mdx` — rewritten.

**Untouched (verified):** `packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts` uses `serverOnlyPlugin` directly, not `honoPreact()`, so it needs no adapter. The spec's mention of updating it was incorrect.

---

## Task 0: Compatibility spike (hard go/no-go gate)

No production code is committed. This task answers the unknowns the rest of the plan depends on. If `@cloudflare/vite-plugin` cannot run on Vite 8, STOP and revisit the spec.

**Files:**
- Create: `docs/superpowers/research/2026-05-17-cloudflare-vite-plugin-spike.md`

- [ ] **Step 1: Stand up a throwaway probe project**

Outside the repo (e.g. `/tmp/cf-spike`), scaffold a minimal project: `npm init -y`, install `vite@8.0.8`, `@cloudflare/vite-plugin`, `wrangler`, `hono`. Add a trivial `wrangler.jsonc` with `main` pointing at a hand-written `src/worker.ts` that does `export default new Hono().get('*', c => c.text('ok'))`, and a `vite.config.ts` using `cloudflare()`.

- [ ] **Step 2: Verify dev**

Run: `npx vite dev`
Expected: dev server boots, `GET /` returns `ok`. Record any Vite-8 incompatibility errors.

- [ ] **Step 3: Verify build**

Run: `npx vite build`
Expected: build succeeds. Record the output directory layout — exact paths of the client assets, the worker bundle, and any generated `wrangler.json`.

- [ ] **Step 4: Probe the open integration questions**

Answer each, in the project, by experiment:
1. Does `@cloudflare/vite-plugin` accept a `.tsx` file as `wrangler.jsonc` `main`? (Plan A's generated entry wrapper is `.tsx`.)
2. At what point does the plugin read `main` — config resolution, or later? Does the file referenced by `main` need to exist on disk before `vite dev` / `vite build` starts? (Determines whether the framework can write the entry in `buildStart` or must write earlier.)
3. What does the build output layout imply for `wrangler.jsonc` `assets` and worker-source-leak protection — are client assets and the worker emitted into separate directories?
4. Does a WebSocket `GET` with `Upgrade: websocket` reach worker code under `vite dev`? (Confirms the spec's core WS premise; full WS verification is Plan B.)

- [ ] **Step 5: Write findings and commit**

Write `docs/superpowers/research/2026-05-17-cloudflare-vite-plugin-spike.md` with: pass/fail on Vite 8, the build output layout, and explicit answers to the four questions in Step 4. These answers feed Task 2 (entry write timing), Task 3 (adapter), and Task 8 (`apps/site` `wrangler.jsonc`).

```bash
git add docs/superpowers/research/2026-05-17-cloudflare-vite-plugin-spike.md
git commit -m "research: @cloudflare/vite-plugin Vite 8 compatibility spike"
```

- [ ] **Step 6: Go/no-go decision**

If Step 2 or Step 3 failed on Vite 8: STOP. Report to the user; the spec must be revisited. Otherwise proceed to Task 1.

---

## Task 1: Define the adapter interface

**Files:**
- Create: `packages/vite/src/adapter.ts`
- Test: `packages/vite/src/__tests__/adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { HonoPreactAdapter, HonoPreactAdapterContext } from '../adapter.js';

describe('HonoPreactAdapter interface', () => {
  it('a conforming object satisfies the interface and produces an entry tail', () => {
    const ctx: HonoPreactAdapterContext = {
      root: '/project',
      coreAppModuleId: '/project/node_modules/.vite/hono-preact/core-app.tsx',
      entryWrapperId: '/project/node_modules/.vite/hono-preact/server-entry.tsx',
    };
    const adapter: HonoPreactAdapter = {
      name: 'fake',
      vitePlugins: () => [],
      wrapEntry: (c) => `export { default } from ${JSON.stringify(c.coreAppModuleId)};\n`,
    };
    expect(adapter.name).toBe('fake');
    expect(adapter.vitePlugins(ctx)).toEqual([]);
    expect(adapter.wrapEntry(ctx)).toContain('core-app.tsx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/vite/src/__tests__/adapter.test.ts`
Expected: FAIL — cannot find module `../adapter.js`.

- [ ] **Step 3: Create the interface module**

```ts
// packages/vite/src/adapter.ts
import type { Plugin } from 'vite';

/**
 * Static context the framework hands an adapter. `command` and `outDir`
 * are intentionally absent: they are not known when honoPreact() builds its
 * plugin array. Adapters that need them read them from their own plugin
 * hooks (config / configResolved).
 */
export interface HonoPreactAdapterContext {
  /** Vite project root (process.cwd() when honoPreact() is called). */
  root: string;
  /** Absolute path of the framework-generated core Hono app module. */
  coreAppModuleId: string;
  /** Absolute path where the adapter's wrapEntry() output is written. */
  entryWrapperId: string;
}

/**
 * A deployment target. `vitePlugins()` contributes the terminal build/dev
 * plugins; `wrapEntry()` returns the platform tail that imports the core
 * Hono app module and adapts it to the runtime.
 */
export interface HonoPreactAdapter {
  name: string;
  vitePlugins(ctx: HonoPreactAdapterContext): Plugin[];
  wrapEntry(ctx: HonoPreactAdapterContext): string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/vite/src/__tests__/adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/adapter.ts packages/vite/src/__tests__/adapter.test.ts
git commit -m "feat(vite): add HonoPreactAdapter interface"
```

---

## Task 2: Split entry generation

Rename `generateServerEntrySource` to `generateCoreAppModule` (its body is unchanged — it already emits the Hono app and `export default app`), introduce two on-disk paths, and make `serverEntryPlugin` write both the core app module and the adapter's wrapper.

**Files:**
- Modify: `packages/vite/src/server-entry.ts`
- Modify: `packages/vite/src/__tests__/server-entry.test.ts` — this file already exists (PR #49 added ~285 lines of tests). It references the symbols this task renames/removes (`generateServerEntrySource`, `GENERATED_SERVER_ENTRY_RELATIVE`, `generatedServerEntryAbsPath`), so its existing references must be migrated, not just extended.

> **PR #49 context:** `server-entry.ts` was rewritten by the reserved-path-middleware merge. `generateServerEntrySource` now emits `.route('/', userApp)` ahead of `/__loaders` / `/__actions`, and `findApiShadowingRoutes` (formerly `findApiCatchAllRoutes`) fails the build on shadowing routes. This task only renames/splits; it does not change that route ordering or the shadowing logic.

- [ ] **Step 1: Write the failing tests**

Add to `packages/vite/src/__tests__/server-entry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  generateCoreAppModule,
  generatedCoreAppAbsPath,
  generatedEntryWrapperAbsPath,
} from '../server-entry.js';

describe('generateCoreAppModule', () => {
  it('emits the Hono app with loaders, actions, renderPage and a default export', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
    });
    expect(src).toContain("loadersHandler");
    expect(src).toContain("actionsHandler");
    expect(src).toContain("renderPage");
    expect(src).toContain('export default app;');
  });

  it('mounts the user api app when apiAbsPath is provided', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: '/p/src/api.ts',
    });
    expect(src).toContain("import userApp from '/p/src/api.ts'");
    expect(src).toContain(".route('/', userApp)");
  });
});

describe('generated entry paths', () => {
  it('core app and entry wrapper resolve to distinct files under the vite cache', () => {
    const core = generatedCoreAppAbsPath('/p');
    const wrapper = generatedEntryWrapperAbsPath('/p');
    expect(core).toContain('node_modules/.vite/hono-preact/');
    expect(wrapper).toContain('node_modules/.vite/hono-preact/');
    expect(core).not.toBe(wrapper);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/vite/src/__tests__/server-entry.test.ts`
Expected: FAIL — `generateCoreAppModule` / the new path helpers are not exported.

- [ ] **Step 3: Rename the generator and add the path constants**

In `packages/vite/src/server-entry.ts`: rename `generateServerEntrySource` to `generateCoreAppModule` (signature and body unchanged — it already produces `export default app`). Rename its options interface `GenerateServerEntrySourceOptions` to `GenerateCoreAppModuleOptions`.

Replace the `GENERATED_SERVER_ENTRY_RELATIVE` constant and `generatedServerEntryAbsPath` function (and their doc comment) with:

```ts
// Both generated files live in the Vite cache dir. The wrapper keeps the
// `server-entry.tsx` name because that is the file the adapter's build/dev
// plugins (and wrangler.jsonc `main`) point at; the core app module is a
// separate file the wrapper imports.
export const GENERATED_CORE_APP_RELATIVE =
  'node_modules/.vite/hono-preact/core-app.tsx';
export const GENERATED_ENTRY_WRAPPER_RELATIVE =
  'node_modules/.vite/hono-preact/server-entry.tsx';

export function generatedCoreAppAbsPath(cwd: string = process.cwd()): string {
  return path.resolve(cwd, GENERATED_CORE_APP_RELATIVE);
}

export function generatedEntryWrapperAbsPath(
  cwd: string = process.cwd()
): string {
  return path.resolve(cwd, GENERATED_ENTRY_WRAPPER_RELATIVE);
}
```

- [ ] **Step 4: Update `serverEntryPlugin` to write both files in the `config` hook**

> **Resolved by Task 0's spike:** `@cloudflare/vite-plugin@1.37.1` reads `wrangler.jsonc` `main` and does `fs.existsSync` on it inside Vite's `config` hook — the earliest hook. The generated entry wrapper MUST exist on disk before the adapter's plugins run their `config` hook. `serverEntryPlugin` is `enforce: 'pre'` and ordered ahead of `...adapter.vitePlugins()` in the `honoPreact()` array, so its own `config` hook runs first — write the files there. Files are then written on every config resolution (including IDE probes / typecheck-only runs); that side-effect is unavoidable given the spike finding and is accepted.

Change `ServerEntryPluginOptions`: remove `outputPath`; add `adapter: HonoPreactAdapter`, `coreAppPath: string`, `entryWrapperPath: string`. Add `import type { HonoPreactAdapter } from './adapter.js';`.

Replace the plugin's `configResolved` + `buildStart` hooks (and drop the now-unneeded "buildStart fired before configResolved" guard) so the shape is:

```ts
export function serverEntryPlugin(opts: ServerEntryPluginOptions): Plugin {
  let apiAbsPath: string | undefined;

  return {
    name: 'hono-preact:server-entry',
    enforce: 'pre',
    // Write generated files in `config` — the earliest hook — so the entry
    // wrapper exists before @cloudflare/vite-plugin's own `config` hook does
    // fs.existsSync on wrangler.jsonc `main`.
    config(userConfig) {
      const root = userConfig.root
        ? path.resolve(userConfig.root)
        : process.cwd();
      const layoutAbsPath = path.isAbsolute(opts.layout)
        ? opts.layout
        : path.resolve(root, opts.layout);
      const routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(root, opts.routes);
      const candidateApi = path.isAbsolute(opts.api)
        ? opts.api
        : path.resolve(root, opts.api);
      apiAbsPath = fs.existsSync(candidateApi) ? candidateApi : undefined;

      const source = generateCoreAppModule({
        layoutAbsPath,
        routesAbsPath,
        apiAbsPath,
      });
      fs.mkdirSync(path.dirname(opts.coreAppPath), { recursive: true });
      fs.writeFileSync(opts.coreAppPath, source, 'utf8');

      const wrapper = opts.adapter.wrapEntry({
        root,
        coreAppModuleId: opts.coreAppPath,
        entryWrapperId: opts.entryWrapperPath,
      });
      fs.writeFileSync(opts.entryWrapperPath, wrapper, 'utf8');
    },
    buildStart() {
      // The api.ts shadowing diagnostic stays in buildStart: it needs
      // this.warn / this.error, which the `config` hook context lacks.
      if (!apiAbsPath) return;
      // ... existing findApiShadowingRoutes warn/error block, verbatim ...
    },
  };
}
```

Keep the existing `findApiShadowingRoutes` block (the api.ts shadowing warnings + build-failure `this.error`, from PR #49) verbatim inside `buildStart`.

- [ ] **Step 5: Update `packages/vite/src/index.ts` exports**

Replace lines 5-9 (`GENERATED_SERVER_ENTRY_RELATIVE`, `generatedServerEntryAbsPath`, `serverEntryPlugin`) with:

```ts
export {
  GENERATED_CORE_APP_RELATIVE,
  GENERATED_ENTRY_WRAPPER_RELATIVE,
  generatedCoreAppAbsPath,
  generatedEntryWrapperAbsPath,
  serverEntryPlugin,
} from './server-entry.js';
export type { HonoPreactAdapter, HonoPreactAdapterContext } from './adapter.js';
```

- [ ] **Step 6: Migrate the existing `server-entry.test.ts` references**

The PR #49 tests reference the renamed/removed symbols. Update `packages/vite/src/__tests__/server-entry.test.ts`:
- In the import block and the `describe('generateServerEntrySource', ...)` block: rename every `generateServerEntrySource` call to `generateCoreAppModule`. Rename the `describe` title to `'generateCoreAppModule'`. The option fields (`layoutAbsPath`, `routesAbsPath`, `apiAbsPath`) are unchanged, and the asserted output is unchanged, so only the function name moves.
- Replace the `describe('serverEntryPlugin', ...)` block's assertions on `GENERATED_SERVER_ENTRY_RELATIVE` and `generatedServerEntryAbsPath` with equivalent assertions on `GENERATED_ENTRY_WRAPPER_RELATIVE` + `generatedEntryWrapperAbsPath` and `GENERATED_CORE_APP_RELATIVE` + `generatedCoreAppAbsPath` (both new path pairs from Step 3). Update the import block to match.
- Update the stale comment in the `describe('mount-order composition', ...)` block that says "Mirrors the order generateServerEntrySource emits" to name `generateCoreAppModule`.
- Leave every `findApiShadowingRoutes` test untouched — that symbol is unchanged.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run packages/vite/src/__tests__/server-entry.test.ts`
Expected: PASS — both the new tests from Step 1 and the migrated PR #49 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/vite/src/server-entry.ts packages/vite/src/index.ts packages/vite/src/__tests__/server-entry.test.ts
git commit -m "feat(vite): split server-entry into core app module and adapter wrapper"
```

---

## Task 3: Cloudflare adapter

**Files:**
- Create: `packages/vite/src/adapter-cloudflare.ts`
- Modify: `packages/vite/package.json` (devDependency)
- Test: `packages/vite/src/__tests__/adapter-cloudflare.test.ts`

- [ ] **Step 1: Add `@cloudflare/vite-plugin` as a devDependency of the vite package**

`adapter-cloudflare.ts` statically imports `@cloudflare/vite-plugin`, so the package must be resolvable from `packages/vite` for the test (and the package build) to run. Add to `packages/vite/package.json` `devDependencies`, at the version Task 0's spike validated:

```json
    "@cloudflare/vite-plugin": "^1.37.1",
```

Run: `pnpm install`
Expected: completes cleanly.

- [ ] **Step 2: Write the failing test**

`vitePlugins()` is not unit-tested here — calling `cloudflare()` eagerly reads `wrangler.jsonc` and is properly exercised by Task 8's `apps/site` dev/build verification. This test covers only the pure methods.

```ts
import { describe, it, expect } from 'vitest';
import { cloudflareAdapter } from '../adapter-cloudflare.js';

const ctx = {
  root: '/p',
  coreAppModuleId: '/p/node_modules/.vite/hono-preact/core-app.tsx',
  entryWrapperId: '/p/node_modules/.vite/hono-preact/server-entry.tsx',
};

describe('cloudflareAdapter', () => {
  it('is named "cloudflare"', () => {
    expect(cloudflareAdapter().name).toBe('cloudflare');
  });

  it('wrapEntry re-exports the core app module default', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    expect(tail).toBe(
      `export { default } from "/p/node_modules/.vite/hono-preact/core-app.tsx";\n`
    );
  });

  it('exposes a vitePlugins function', () => {
    expect(typeof cloudflareAdapter().vitePlugins).toBe('function');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/vite/src/__tests__/adapter-cloudflare.test.ts`
Expected: FAIL — cannot find module `../adapter-cloudflare.js`.

- [ ] **Step 4: Implement the adapter**

```ts
// packages/vite/src/adapter-cloudflare.ts
//
// Standalone module. NOT re-exported by index.ts: importing `hono-preact/vite`
// must never pull in `@cloudflare/vite-plugin`. Only importing
// `hono-preact/adapter-cloudflare` loads this file.
import { cloudflare } from '@cloudflare/vite-plugin';
import type { Plugin } from 'vite';
import type { HonoPreactAdapter } from './adapter.js';

export function cloudflareAdapter(): HonoPreactAdapter {
  return {
    name: 'cloudflare',
    vitePlugins() {
      // `@cloudflare/vite-plugin` drives both workerd dev and the build via
      // the Environment API, and reads the worker entry from wrangler.jsonc
      // `main`. It needs no entry argument from the framework.
      // `cloudflare()` may return a single plugin or an array; normalize so
      // the HonoPreactAdapter contract (a flat Plugin[]) holds either way.
      const produced = cloudflare() as Plugin | Plugin[];
      return Array.isArray(produced) ? produced : [produced];
    },
    wrapEntry(ctx) {
      // A Hono app's default export is already a valid Workers fetch handler,
      // so the platform tail is a bare re-export of the core app module.
      return `export { default } from ${JSON.stringify(ctx.coreAppModuleId)};\n`;
    },
  };
}
```

> **Resolved by Task 0's spike:** `cloudflare()` works on Vite 8.0.8 with no arguments — no `configPath` or `viteEnvironment` options are required. Call it bare as shown.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/vite/src/__tests__/adapter-cloudflare.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/adapter-cloudflare.ts packages/vite/package.json packages/vite/src/__tests__/adapter-cloudflare.test.ts pnpm-lock.yaml
git commit -m "feat(vite): add Cloudflare adapter"
```

---

## Task 4: Rewire `honoPreact()`

Make `adapter` required, gut `configPlugin`, splice `adapter.vitePlugins()`, remove `entry`/`useGeneratedEntry` and the hardcoded `@hono/vite-build` + `@hono/vite-dev-server`. The test rewrite is the failing-test step.

**Files:**
- Modify: `packages/vite/src/hono-preact.ts`
- Modify: `packages/vite/src/__tests__/hono-preact.test.ts`

- [ ] **Step 1: Rewrite the test file (the failing tests)**

Replace the entire contents of `packages/vite/src/__tests__/hono-preact.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { honoPreact } from '../hono-preact.js';
import type { HonoPreactAdapter } from '../adapter.js';

function fakeAdapter(): HonoPreactAdapter {
  return {
    name: 'fake',
    vitePlugins: () => [{ name: 'fake-adapter:plugin' }],
    wrapEntry: (c) => `export { default } from ${JSON.stringify(c.coreAppModuleId)};\n`,
  };
}

type NamedPlugin = { name?: string };

describe('honoPreact adapter requirement', () => {
  it('throws when called without an adapter', () => {
    // @ts-expect-error - exercising the runtime guard
    expect(() => honoPreact({})).toThrow(/adapter/i);
  });

  it('throws when called with no options at all', () => {
    // @ts-expect-error - exercising the runtime guard
    expect(() => honoPreact()).toThrow(/adapter/i);
  });
});

describe('honoPreact plugin assembly', () => {
  it('emits the framework plugins in pipeline order, then the adapter plugins, then preact', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() }) as NamedPlugin[];
    const names = plugins.map((p) => p.name);
    expect(names.slice(0, 8)).toEqual([
      'hono-preact:config',
      'hono-preact:client-shim',
      'hono-preact:client-entry',
      'hono-preact:server-entry',
      'server-loader-validation',
      'module-key',
      'server-only',
      'hono-preact:guard-strip',
    ]);
  });

  it('splices the adapter-contributed plugins into the chain', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() }) as NamedPlugin[];
    expect(plugins.map((p) => p.name)).toContain('fake-adapter:plugin');
  });

  it('includes the preact preset plugins', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() }) as NamedPlugin[];
    expect(plugins.map((p) => p.name)).toContain('vite:preact-jsx');
  });
});

describe('honoPreact config plugin', () => {
  it('contributes only shared config: preact dedupe, esnext target, static assetsDir', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    const cfg = plugins.find((p) => p.name === 'hono-preact:config');
    if (!cfg || typeof cfg.config !== 'function') {
      throw new Error('config plugin not found');
    }
    const result = cfg.config({}, { command: 'build', mode: 'production' }) as {
      resolve: { dedupe: string[] };
      build: { target: string; assetsDir: string };
    };
    expect(result.resolve.dedupe).toContain('preact');
    expect(result.resolve.dedupe).toContain('preact-iso');
    expect(result.build.target).toBe('esnext');
    expect(result.build.assetsDir).toBe('static');
  });

  it('does not branch on mode (no client-only rollupOptions)', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    const cfg = plugins.find((p) => p.name === 'hono-preact:config');
    const a = (cfg!.config as Function)({}, { command: 'build', mode: 'client' });
    const b = (cfg!.config as Function)({}, { command: 'build', mode: 'production' });
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/vite/src/__tests__/hono-preact.test.ts`
Expected: FAIL — `honoPreact` still has the old signature/behavior.

- [ ] **Step 3: Rewrite `hono-preact.ts`**

Replace the entire contents of `packages/vite/src/hono-preact.ts` with:

```ts
import preact from '@preact/preset-vite';
import { type Plugin } from 'vite';
import { clientShimPlugin } from './client-shim.js';
import { clientEntryPlugin, VIRTUAL_CLIENT_ENTRY_ID } from './client-entry.js';
import { serverLoaderValidationPlugin } from './server-loader-validation.js';
import { moduleKeyPlugin } from './module-key-plugin.js';
import { serverOnlyPlugin } from './server-only.js';
import { guardStripPlugin } from './guard-strip.js';
import {
  generatedCoreAppAbsPath,
  generatedEntryWrapperAbsPath,
  serverEntryPlugin,
} from './server-entry.js';
import type { HonoPreactAdapter, HonoPreactAdapterContext } from './adapter.js';

export interface HonoPreactOptions {
  /** Deployment target. Required. See hono-preact/adapter-cloudflare. */
  adapter: HonoPreactAdapter;

  // Source paths (for the generated core app module). All optional.
  layout?: string; // default 'src/Layout.tsx'
  routes?: string; // default 'src/routes.ts'
  api?: string; // default 'src/api.ts' (only loaded if file exists)
  clientEntry?: string; // default 'virtual:hono-preact/client'
}

export function honoPreact(options: HonoPreactOptions): Plugin[] {
  const {
    adapter,
    layout = 'src/Layout.tsx',
    routes = 'src/routes.ts',
    api = 'src/api.ts',
    clientEntry = VIRTUAL_CLIENT_ENTRY_ID,
  } = options ?? {};

  if (!adapter) {
    throw new Error(
      '[hono-preact] honoPreact() requires an `adapter` option. ' +
        "Import one, e.g. `import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare'`, " +
        'and pass `honoPreact({ adapter: cloudflareAdapter() })`.'
    );
  }

  const coreAppPath = generatedCoreAppAbsPath();
  const entryWrapperPath = generatedEntryWrapperAbsPath();
  const ctx: HonoPreactAdapterContext = {
    root: process.cwd(),
    coreAppModuleId: coreAppPath,
    entryWrapperId: entryWrapperPath,
  };

  // Only genuinely platform-agnostic config lives here. Client-vs-server
  // build config is owned by the adapter's plugins (Environment API).
  const configPlugin: Plugin = {
    name: 'hono-preact:config',
    config() {
      return {
        resolve: {
          dedupe: ['preact', 'preact/compat', 'preact/hooks', 'preact-iso'],
        },
        build: {
          target: 'esnext' as const,
          assetsDir: 'static',
        },
      };
    },
  };

  return [
    configPlugin,
    clientShimPlugin(clientEntry),
    clientEntryPlugin({ routes }),
    serverEntryPlugin({
      layout,
      routes,
      api,
      adapter,
      coreAppPath,
      entryWrapperPath,
    }),
    serverLoaderValidationPlugin(),
    moduleKeyPlugin(),
    serverOnlyPlugin(),
    guardStripPlugin(),
    ...adapter.vitePlugins(ctx),
    ...preact(),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/vite/src/__tests__/hono-preact.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full vite-package test suite for regressions**

Run: `pnpm vitest run packages/vite`
Expected: PASS. If `server-entry`-related plugin tests fail, reconcile them with the new `ServerEntryPluginOptions` shape from Task 2.

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/hono-preact.ts packages/vite/src/__tests__/hono-preact.test.ts
git commit -m "feat(vite): require adapter option, remove hardcoded Cloudflare toolchain"
```

---

## Task 5: Fix the `client-shim` apply gate

`client-shim.ts:24-27` gates on `mode === 'client'`. Under the Environment API there is no separate `--mode client` build pass. The `transform` already self-gates by entry id, so the `apply` gate just needs to stop excluding the unified build.

**Files:**
- Modify: `packages/vite/src/client-shim.ts`
- Test: `packages/vite/src/__tests__/client-shim.test.ts` (create if absent; otherwise extend)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { clientShimPlugin } from '../client-shim.js';

describe('clientShimPlugin apply gate', () => {
  it('applies during serve', () => {
    const p = clientShimPlugin('virtual:hono-preact/client');
    const apply = p.apply as Function;
    expect(apply({}, { command: 'serve', mode: 'development' })).toBe(true);
  });

  it('applies during a unified build (no client mode)', () => {
    const p = clientShimPlugin('virtual:hono-preact/client');
    const apply = p.apply as Function;
    expect(apply({}, { command: 'build', mode: 'production' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/vite/src/__tests__/client-shim.test.ts`
Expected: FAIL — the second assertion fails; `apply` currently returns `false` for `mode: 'production'`.

- [ ] **Step 3: Simplify the `apply` gate**

In `packages/vite/src/client-shim.ts`, replace the `apply` method (lines 24-27):

```ts
    apply(_, { command }) {
      // The shim is needed for dev and for the build. The `transform` hook
      // below self-gates to the client entry module, so it never injects
      // into SSR/worker code regardless of build environment.
      return command === 'serve' || command === 'build';
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/vite/src/__tests__/client-shim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/client-shim.ts packages/vite/src/__tests__/client-shim.test.ts
git commit -m "fix(vite): drop mode-based gate from client-shim apply"
```

---

## Task 6: Vite package peer dependencies

**Files:**
- Modify: `packages/vite/package.json`

- [ ] **Step 1: Update `peerDependencies` and `peerDependenciesMeta`**

In `packages/vite/package.json`, replace the existing `peerDependencies` block (identified by content; its line range shifted after Task 3 added a devDependency) with:

```json
  "peerDependencies": {
    "@cloudflare/vite-plugin": "^1.37.1",
    "@preact/preset-vite": "^2.10.5",
    "vite": ">=6.0.0",
    "wrangler": "^4.92.0"
  },
  "peerDependenciesMeta": {
    "@cloudflare/vite-plugin": { "optional": true },
    "wrangler": { "optional": true }
  },
```

> The `@cloudflare/vite-plugin` and `wrangler` version ranges must match what Task 0's spike validated on Vite 8 — update them to the spike's confirmed versions. `@hono/vite-build` and `@hono/vite-dev-server` are removed entirely.

- [ ] **Step 2: Verify the workspace still installs**

Run: `pnpm install`
Expected: completes without peer-dependency errors.

- [ ] **Step 3: Commit**

```bash
git add packages/vite/package.json pnpm-lock.yaml
git commit -m "chore(vite): swap Cloudflare toolchain into optional peer deps"
```

---

## Task 7: Umbrella subpath wiring

Expose `hono-preact/adapter-cloudflare`. The `@hono-preact/vite` package gains an `./adapter-cloudflare` export; the umbrella re-exports it; `consolidate.mjs` learns the new specifier.

**Files:**
- Modify: `packages/vite/package.json`
- Create: `packages/hono-preact/src/adapter-cloudflare.ts`
- Modify: `packages/hono-preact/package.json`
- Modify: `packages/hono-preact/scripts/consolidate.mjs`

- [ ] **Step 1: Add the `./adapter-cloudflare` export to the vite package**

In `packages/vite/package.json`, replace the `exports` block (identified by content) with:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./adapter-cloudflare": {
      "types": "./dist/adapter-cloudflare.d.ts",
      "import": "./dist/adapter-cloudflare.js"
    }
  },
```

- [ ] **Step 2: Create the umbrella re-export module**

```ts
// packages/hono-preact/src/adapter-cloudflare.ts
export * from '@hono-preact/vite/adapter-cloudflare';
```

- [ ] **Step 3: Add the umbrella `./adapter-cloudflare` export and fix dependencies**

In `packages/hono-preact/package.json`, add to `exports` after the `./vite` entry:

```json
    "./adapter-cloudflare": {
      "types": "./dist/adapter-cloudflare.d.ts",
      "import": "./dist/adapter-cloudflare.js"
    },
```

Remove `@hono/vite-build` and `@hono/vite-dev-server` from `dependencies` (lines 60-61). Add a `peerDependencies` + `peerDependenciesMeta` pair for the adapter toolchain (merge with the existing `peerDependencies` block):

```json
  "peerDependencies": {
    "@cloudflare/vite-plugin": "^1.37.1",
    "hono": ">=4.0.0",
    "hoofd": ">=1.0.0",
    "preact": ">=10.0.0",
    "preact-iso": ">=2.11.0",
    "preact-render-to-string": ">=6.0.0",
    "vite": ">=6.0.0",
    "wrangler": "^4.92.0"
  },
  "peerDependenciesMeta": {
    "@cloudflare/vite-plugin": { "optional": true },
    "wrangler": { "optional": true }
  },
```

- [ ] **Step 4: Teach `consolidate.mjs` the new specifier**

In `packages/hono-preact/scripts/consolidate.mjs`, add to the `DIST_PATHS` map (after the `'@hono-preact/vite'` line):

```js
  '@hono-preact/vite/adapter-cloudflare': 'vite/adapter-cloudflare.js',
```

Update the rewrite regex (line 98) to match the new specifier — change `vite` to `vite\/adapter-cloudflare|vite`:

```js
    /(['"])(@hono-preact\/(?:iso\/internal|iso|server|vite\/adapter-cloudflare|vite))(['"])/g,
```

- [ ] **Step 5: Verify the umbrella builds and consolidates**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: completes; `packages/hono-preact/dist/adapter-cloudflare.js` exists and imports from `./vite/adapter-cloudflare.js`.

- [ ] **Step 6: Commit**

```bash
git add packages/vite/package.json packages/hono-preact/src/adapter-cloudflare.ts packages/hono-preact/package.json packages/hono-preact/scripts/consolidate.mjs
git commit -m "feat(hono-preact): expose hono-preact/adapter-cloudflare subpath"
```

---

## Task 8: Migrate `apps/site` to the Cloudflare adapter

**Files:**
- Modify: `apps/site/vite.config.ts`
- Modify: `apps/site/package.json`
- Modify: `apps/site/wrangler.jsonc`

- [ ] **Step 1: Update `vite.config.ts`**

In `apps/site/vite.config.ts`: add the import `import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare';` next to the `honoPreact` import; change `honoPreact()` (line 70) to `honoPreact({ adapter: cloudflareAdapter() })`.

Add a resolve alias so the workspace source is used (insert in the `alias` array, after the `hono-preact/vite` entry):

```ts
      {
        find: 'hono-preact/adapter-cloudflare',
        replacement: resolve(__dirname, '../../packages/hono-preact/src/adapter-cloudflare.ts'),
      },
```

- [ ] **Step 2: Update `package.json` scripts and dev dependencies**

In `apps/site/package.json`:
- `scripts.build`: change to `"NODE_ENV=production vite build"` (the two-pass `--mode client &&` is removed).
- `scripts.preview`: change to `"vite preview"`.
- `devDependencies`: remove `@hono/vite-build`, `@hono/vite-dev-server`, and `miniflare`; add `"@cloudflare/vite-plugin"` at the version Task 0's spike validated. Keep `wrangler`.

- [ ] **Step 3: Update `wrangler.jsonc`**

In `apps/site/wrangler.jsonc`:
- Change `main` to point at the generated entry wrapper: `"main": "node_modules/.vite/hono-preact/server-entry.tsx"`.
- Delete the `run_worker_first` block (lines 17-20) and its explanatory comment — `@cloudflare/vite-plugin` emits client assets and the worker into separate directories, so the worker source cannot be served as a static asset.
- Adjust `assets.directory` to the client-assets directory the spike found in Task 0 Step 3.
- Leave the `routes` (custom domain), `compatibility_*`, `preview_urls`, and `observability` blocks unchanged.

> **Spike dependency:** the exact `main`/`assets` values are governed by Task 0 Step 3-4 findings. If the spike found `@cloudflare/vite-plugin` generates its own deploy `wrangler.json` in the output dir, `wrangler deploy` must target that — note it in Task 9's docs.

- [ ] **Step 4: Verify dev**

Run: `pnpm --filter site dev`
Expected: dev server boots; the site renders in a browser; navigation, a loader-backed page, and an action all work. Stop the server.

- [ ] **Step 5: Verify build**

Run: `pnpm --filter site build`
Expected: build succeeds; the worker bundle and client assets are emitted. Confirm no worker source is exposed under the static assets directory.

- [ ] **Step 6: Commit**

```bash
git add apps/site/vite.config.ts apps/site/package.json apps/site/wrangler.jsonc pnpm-lock.yaml
git commit -m "feat(site): migrate to the Cloudflare adapter"
```

---

## Task 8B: Framework client build-environment config

**Plan gap discovered during Task 8.** With the legacy `mode === 'client'` two-pass build removed (Task 4), nothing configured the `client` build environment's input, so `vite build` produced no browser JavaScript — `apps/site/dist/client/` held only CSS.

**Fix (verified end to end):** the framework `configPlugin` contributes the `client` environment's build input from its `config()` hook. The client entry (`virtual:hono-preact/client`) is framework-owned (every adapter needs the identical browser bundle), so it belongs in `configPlugin`, not an adapter, and it stays zero-config: no user wiring, no API addition.

> **Investigation note (for Plan B and future framework work):** an earlier round of this task wrongly concluded a plugin could not set the client input and proposed a user-wired `honoPreactEnvironments()` export. That was an artifact of testing against a stale built umbrella `dist/`. A consuming app's `vite.config.ts` imports `honoPreact` from the *built* `hono-preact` package, not from workspace source, so framework edits do not take effect until the umbrella is rebuilt. Always run `pnpm --filter '@hono-preact/*' --filter hono-preact build` before building a consuming app after changing framework source. With that done, the plugin `config()` approach works.

**Files:**
- Modify: `packages/vite/src/hono-preact.ts`
- Modify: `packages/vite/src/__tests__/hono-preact.test.ts`

- [x] **Step 1: Failing test.** Added an `it` to the `describe('honoPreact config plugin', ...)` block asserting `configPlugin.config()` returns `environments.client.build.rollupOptions` with `input: ['virtual:hono-preact/client']` and `output.entryFileNames === 'static/client.js'`.

- [x] **Step 2: Run — fails** (`environments` undefined).

- [x] **Step 3: Extend `configPlugin.config()`** in `hono-preact.ts` to return, alongside `resolve` + `build`:

```ts
        environments: {
          client: {
            build: {
              rollupOptions: {
                input: [clientEntry],
                output: {
                  entryFileNames: 'static/client.js',
                  chunkFileNames: 'static/[name]-[hash].js',
                  assetFileNames: 'static/[name]-[hash].[ext]',
                },
              },
            },
          },
        },
```

`clientEntry` is already in scope in `honoPreact()`.

- [x] **Step 4: Run tests — pass** (`pnpm vitest run packages/vite/src/__tests__/hono-preact.test.ts`, 8/8).

- [x] **Step 5: Re-verify the `apps/site` build.** Rebuild the umbrella, then `pnpm --filter site build`; confirmed `apps/site/dist/client/static/client.js` plus the route chunks exist and no `__cloudflare_fallback_entry__` is emitted.

- [x] **Step 6: Commit** — `fix(vite): build the client bundle via the client environment config` (commit `63a51a8`).

---

## Task 9: Rewrite the deployment docs

**Files:**
- Modify: `apps/site/src/pages/docs/deployment.mdx`

- [ ] **Step 1: Rewrite the page**

Rewrite `apps/site/src/pages/docs/deployment.mdx` to reflect the new flow:
- **Development:** `npm run dev` runs `vite dev`; the Cloudflare adapter runs the dev server inside workerd via `@cloudflare/vite-plugin`, so dev mirrors production (real bindings, WebSocket upgrades).
- **Build:** `npm run build` is a single `vite build` (the two-pass section is removed); describe the output layout per Task 0's spike findings.
- **Preview:** `npm run preview` runs `vite preview`.
- **`wrangler.jsonc`:** document `main` pointing at the generated entry wrapper, the `assets` directory, and that `run_worker_first` is no longer needed.
- **Deploy:** `npm run deploy` runs `wrangler deploy` against the build output.

Keep the page's existing voice and heading structure; only the mechanics change.

- [ ] **Step 2: Verify the docs site renders the page**

Run: `pnpm --filter site dev`
Expected: the `/docs/deployment` page renders without MDX errors. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/pages/docs/deployment.mdx
git commit -m "docs(site): rewrite deployment page for the Cloudflare adapter"
```

---

## Task 10: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: PASS. Investigate and fix any failure before proceeding.

- [ ] **Step 2: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS. Common fixable issues: stale imports of the removed `GENERATED_SERVER_ENTRY_RELATIVE` / `generatedServerEntryAbsPath`, or references to the removed `entry` option.

- [ ] **Step 3: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format` and commit the result.

- [ ] **Step 4: Final commit if needed**

```bash
git add -A
git commit -m "chore: typecheck and format fixes for the adapter migration"
```

---

## Self-Review Notes

- **Spec coverage:** Plan A covers the adapter interface, entry-generation split, Cloudflare adapter, packaging (umbrella subpath + optional peers), `configPlugin` gutting, the `client-shim` discriminator fix, `apps/site` migration, and the deployment docs. The Node adapter, `apps/example-node`, and WebSocket verification are explicitly Plan B.
- **`entry` option removal:** handled by Task 4 (the rewritten `HonoPreactOptions` has no `entry` field; `useGeneratedEntry` branching is gone).
- **Discriminator audit:** Task 5 fixes the only plugin that branched on `mode` (`client-shim`); `server-only`, `module-key`, `guard-strip`, and `client-entry` were verified during planning to be `ssr`-based or environment-neutral and need no change.
- **Deferred to Plan B:** Node adapter and its peers (`@hono/node-server`, `@hono/node-ws`); WebSocket integration tests; the `apps/example-node` build-and-run smoke test.
