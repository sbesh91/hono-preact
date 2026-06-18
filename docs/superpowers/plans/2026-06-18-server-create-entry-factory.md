# createServerEntry Factory (issue #126, hybrid option) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve issue #126 (server handlers are public but their required resolver factories are private) by extracting the generated server entry's wiring into a single *private* `createServerEntry` factory the codegen calls, then fully internalizing the low-level handlers and resolver factories so the public `hono-preact/server` surface is honest and minimal.

**Architecture:** Today `generateCoreAppModule` (in `packages/vite`) emits ~40 lines of wiring as a string that imports the public handlers (`loadersHandler`, `pageActionHandler`, `renderPage`) AND the private factories (`makePageUseResolver`, `makePageActionResolvers`, `routeServerModules`). We move that wiring into a typed `createServerEntry(opts)` runtime function in `packages/server`, expose it ONLY on the private `hono-preact/server/internal/runtime` door, and shrink the codegen to a ~10-line shim that calls it. The handlers and resolver factories then become module-internal to `packages/server` (no longer exported from any entry point). `renderPage`, `HonoContext`, `useHonoContext` stay public. This is the "hybrid" from the design discussion: the *internal* architecture gains a single typed, testable wiring function (the codegen dogfoods it on every request, so there is no parity-drift risk), while the *public* surface is identical to the issue's option 1. Promoting `createServerEntry` to public later (if a real own-the-root composition requirement appears) becomes a one-line re-export.

**Tech Stack:** TypeScript, Hono, Preact, preact-iso, Vitest. pnpm workspace monorepo. `packages/server` (`@hono-preact/server`), `packages/vite` (`@hono-preact/vite`), `packages/hono-preact` (umbrella that consolidates the workspace dists and owns the published `hono-preact/*` export map), `apps/site` (dogfood).

## Global Constraints

- **No em-dashes** (`—`) in prose, code comments, commit messages. Use commas, colons, parentheses, or two sentences. (CLI flags / table separators / code identifiers are exempt.)
- **No type casts where a reshape works.** Build real typed fixtures (`const manifest: RoutesManifest = {...}`) rather than `as RoutesManifest`. The only acceptable cast boundaries are the existing ones already in the touched files (structural reads of user module exports).
- **This is a public-API change.** It removes `loadersHandler`, `LoadersHandlerOptions`, `pageActionHandler`, `PageActionHandlerOptions`, `ActionEntry` from the `hono-preact/server` public surface. It ships under the minor/major release policy, NOT a patch. (No release work is in this plan; that is a separate step.)
- **Worktree:** Serena indexes the main checkout, not this worktree. Use `rg` / Read / Edit only; do NOT use Serena symbol/edit tools.
- **Pre-push gate (run in this order, per `.github/workflows/ci.yml`):** (1) `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`, (2) `pnpm format:check`, (3) `pnpm typecheck`, (4) `pnpm test:coverage`, (5) `pnpm test:integration`, (6) `pnpm --filter site build`. `format:check` is the most-forgotten step; run `pnpm format` before every commit and review `git status` after, because per-task commits that skip formatting leave committed files format-dirty while the working-tree check still passes.
- **Do not commit or push to a remote / open a PR unless explicitly told.** Local commits per task are fine (and pre-authorized for this subagent-driven plan).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/server/src/create-server-entry.ts` | The new private factory that assembles the framework's core Hono app (loaders RPC, action POST, SSR catch-all, optional api mount). Single responsibility: wiring. | **Create** |
| `packages/server/src/__tests__/create-server-entry.test.ts` | Behavioral tests for the factory: page-use guard preservation on the loader RPC path, api-mounted-first ordering, api-optional. | **Create** |
| `packages/server/src/internal-runtime.ts` | The `hono-preact/server/internal/runtime` door. After this work it exports ONLY `createServerEntry` (+ its options type). | **Modify** |
| `packages/server/src/index.ts` | The public `hono-preact/server` entry. After this work: `renderPage`, `HonoContext`, `useHonoContext` only. | **Modify** |
| `packages/server/src/__tests__/pe-form-no-js.integration.test.ts` | Retarget two imports off the trimmed entry points onto relative module paths. | **Modify** |
| `packages/vite/src/server-entry.ts` | `generateCoreAppModule` shrinks to emit a shim that calls `createServerEntry`. | **Modify** |
| `packages/vite/src/__tests__/server-entry.test.ts` | Rewrite the `generateCoreAppModule` string assertions for the new shim; the deep wiring assertions move to the factory's own test. | **Modify** |
| `packages/hono-preact/__tests__/exports.test.ts` | Flip the `hono-preact/server` public-surface assertions; add a `hono-preact/server/internal/runtime` block. | **Modify** |
| `apps/site/src/pages/docs/structure.mdx` | Remove the two bullets that advertise the now-internal handlers/`routeServerModules`. | **Modify** |
| `apps/site/src/pages/docs/render-page.mdx` | Update the stale reference to the removed factory names; point at the internal `createServerEntry`. | **Modify** |

No change to `packages/hono-preact/package.json` (the `./server/internal/runtime` export already exists) or `packages/hono-preact/scripts/consolidate.mjs` (it already maps `@hono-preact/server/internal/runtime` → `server/internal-runtime.js`). We change *what* that door exports, not the door itself.

---

### Task 1: Extract the `createServerEntry` private factory

Build the factory and its behavioral tests while the handlers/resolver factories are STILL exported everywhere, so the build stays green. Add `createServerEntry` to the internal-runtime door (alongside the existing factory exports, which Task 3 removes later).

**Files:**
- Create: `packages/server/src/create-server-entry.ts`
- Create: `packages/server/src/__tests__/create-server-entry.test.ts`
- Modify: `packages/server/src/internal-runtime.ts`

**Interfaces:**
- Consumes (existing, unchanged): `routeServerModules`, `makePageUseResolver` from `./route-server-modules.js`; `makePageActionResolvers` from `./page-action-resolvers.js`; `loadersHandler` from `./loaders-handler.js`; `pageActionHandler` from `./page-action-handler.js`; `renderPage` from `./render.js`; `env`, `LOADERS_RPC_PATH` from `@hono-preact/iso/internal/runtime`; `Routes` + types `AppConfig`, `RoutesManifest` from `@hono-preact/iso`; `LocationProvider` from `preact-iso`; `Hono` from `hono`; `h` from `preact`.
- Produces (later tasks rely on this exact shape):
  - `createServerEntry(opts: CreateServerEntryOptions): Hono`
  - `interface CreateServerEntryOptions { routes: RoutesManifest; layout: ComponentType<{ children?: ComponentChildren }>; appConfig?: AppConfig; api?: Hono; dev?: boolean; }`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/create-server-entry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { h } from 'preact';
import {
  defineServerMiddleware,
  defineLoader,
  type RoutesManifest,
} from '@hono-preact/iso';
import { createServerEntry } from '../create-server-entry.js';

// A minimal RoutesManifest sufficient for the loader RPC path. The SSR (GET)
// and action paths are exercised end-to-end by the dogfood site build and the
// integration suite; these unit tests target the wiring guarantees that the
// generated entry used to verify only indirectly via generated-string asserts.
function manifest(
  parts: Partial<RoutesManifest> & Pick<RoutesManifest, 'serverImports' | 'routeUse'>
): RoutesManifest {
  return {
    tree: [],
    flat: [],
    serverRoutes: [],
    ...parts,
  };
}

// A trivial layout so createServerEntry's tree closure typechecks; the loader
// RPC and api-mount tests never render it.
const Layout = ({ children }: { children?: unknown }) => h('div', null, children as never);

describe('createServerEntry', () => {
  it('threads the manifest routeUse page guard onto the loader RPC path (issue #122 parity)', async () => {
    const calls: string[] = [];
    const pageGuard = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('page:before');
      await next();
      calls.push('page:after');
    });
    const loader = defineLoader<string>(
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [] }
    );

    const app = createServerEntry({
      routes: manifest({
        serverImports: [
          async () => ({ __moduleKey: 'test/m', serverLoaders: { l: loader } }),
        ],
        routeUse: [{ path: '/x', use: [pageGuard] }],
      }),
      layout: Layout,
      dev: true,
    });

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBe('ok');
    // The page guard from manifest.routeUse ran around the loader: proof that
    // createServerEntry wired makePageUseResolver(routes).byPath into the
    // loaders handler rather than composing a guard-less chain.
    expect(calls).toEqual(['page:before', 'inner', 'page:after']);
  });

  it('mounts the api app ahead of the reserved /__loaders path', async () => {
    let loadersRan = false;
    const blocked = defineServerMiddleware<'loader'>(async () => {});

    const api = new Hono();
    api.use('*', async (c, next) => {
      // Reject everything so we can prove the api layer runs first.
      if (new URL(c.req.url).pathname === '/__loaders') {
        return c.text('blocked-by-api', 403);
      }
      await next();
    });

    const loader = defineLoader<string>(
      async () => {
        loadersRan = true;
        return 'ok';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [] }
    );

    const app = createServerEntry({
      routes: manifest({
        serverImports: [
          async () => ({ __moduleKey: 'test/m', serverLoaders: { l: loader } }),
        ],
        routeUse: [{ path: '/x', use: [blocked] }],
      }),
      layout: Layout,
      api,
      dev: true,
    });

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toBe('blocked-by-api');
    expect(loadersRan).toBe(false);
  });

  it('works without an api app', async () => {
    const loader = defineLoader<string>(async () => 'ok', {
      __moduleKey: 'test/m',
      __loaderName: 'l',
      use: [],
    });
    const app = createServerEntry({
      routes: manifest({
        serverImports: [
          async () => ({ __moduleKey: 'test/m', serverLoaders: { l: loader } }),
        ],
        routeUse: [],
      }),
      layout: Layout,
      dev: true,
    });
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBe('ok');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/server test -- create-server-entry`
Expected: FAIL — `Cannot find module '../create-server-entry.js'` (the factory does not exist yet).

- [ ] **Step 3: Write the factory**

Create `packages/server/src/create-server-entry.ts`:

```ts
import { Hono } from 'hono';
import { h, type ComponentType, type ComponentChildren } from 'preact';
import { LocationProvider } from 'preact-iso';
import { Routes, type AppConfig, type RoutesManifest } from '@hono-preact/iso';
import { env, LOADERS_RPC_PATH } from '@hono-preact/iso/internal/runtime';
import { loadersHandler } from './loaders-handler.js';
import { pageActionHandler } from './page-action-handler.js';
import { renderPage } from './render.js';
import {
  routeServerModules,
  makePageUseResolver,
} from './route-server-modules.js';
import { makePageActionResolvers } from './page-action-resolvers.js';

export interface CreateServerEntryOptions {
  /** The manifest produced by defineRoutes(...) in the user's routes file. */
  routes: RoutesManifest;
  /** The user's root Layout component; wraps the routed tree during SSR. */
  layout: ComponentType<{ children?: ComponentChildren }>;
  /** defineApp(...) result. Defaults to an empty config when omitted. */
  appConfig?: AppConfig;
  /** Optional user-authored Hono app, mounted ahead of the reserved paths. */
  api?: Hono;
  /** Rebuild server-module maps per request so .server edits hot-reload. */
  dev?: boolean;
}

/**
 * Assemble the framework's core Hono app: the loaders RPC endpoint, the page
 * action POST handler, and the SSR catch-all, with an optional user api app
 * mounted first so user middleware composes ahead of the reserved paths.
 *
 * This is the single wiring contract the framework's generated server entry
 * calls. It is framework-private (exposed only on
 * hono-preact/server/internal/runtime); it has no standalone user story today.
 * It exists as a real typed function rather than codegen string concatenation
 * so the wiring is type-checked and unit-tested, and so the generated entry
 * exercises the exact same path it would hand a user if this ever goes public.
 */
export function createServerEntry(opts: CreateServerEntryOptions): Hono {
  const { routes, layout: Layout, appConfig = { use: [] }, api, dev = false } =
    opts;

  // The act of building a server entry implies server mode; the iso runtime
  // reads env.current to branch server-only code paths. Set it before the
  // handlers (which run per request) can observe it.
  env.current = 'server';

  const serverModules = routeServerModules(routes);
  const pageUseResolver = makePageUseResolver(routes);
  const pageActionResolvers = makePageActionResolvers(routes.serverRoutes, {
    dev,
  });

  // Build the routed tree lazily: only the SSR (GET) and action-rerender paths
  // need it, and constructing per call keeps the two call sites from sharing a
  // mutable vnode.
  const pageTree = () =>
    h(Layout, null, h(LocationProvider, null, h(Routes, { routes })));

  const app = new Hono();
  // Mount the user app first so middleware it registers (csrf, auth, etc.)
  // composes ahead of the framework's reserved /__loaders + catch-all routes.
  if (api) app.route('/', api);
  app
    .post(
      LOADERS_RPC_PATH,
      loadersHandler(serverModules, {
        dev,
        appConfig,
        resolvePageUse: pageUseResolver.byPath,
      })
    )
    .post(
      '*',
      pageActionHandler({
        resolverByPath: pageActionResolvers.byPath,
        resolvePageUseByPath: pageUseResolver.byPath,
        renderPage,
        resolvePageNode: pageTree,
        appConfig,
      })
    )
    .get('*', (c) => renderPage(c, pageTree(), { appConfig }));

  return app;
}
```

- [ ] **Step 4: Add the factory to the private internal-runtime door**

Modify `packages/server/src/internal-runtime.ts` to add the export (keep the existing factory exports for now; Task 3 removes them):

```ts
// @hono-preact/server/internal/runtime: framework-emitted tier.
//
// These factories exist ONLY because the framework's generated server entry
// imports and calls them (serverEntryPlugin). They are a private contract
// between this version's vite plugins and this version's runtime; they have
// no standalone user story. DO NOT IMPORT FROM USER CODE; this door is
// undocumented and may change in any non-major release in lockstep with the
// codegen that emits it.
export {
  createServerEntry,
  type CreateServerEntryOptions,
} from './create-server-entry.js';
export {
  routeServerModules,
  makePageUseResolver,
} from './route-server-modules.js';
export { makePageActionResolvers } from './page-action-resolvers.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/server test -- create-server-entry`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck the server package**

Run: `pnpm --filter @hono-preact/server exec tsc --noEmit`
Expected: no errors. (If the `routeUse[].use` array rejects the `defineServerMiddleware` value, import `type PageUse` from `@hono-preact/iso` and annotate; it should not, since that is exactly what real manifests put there.)

- [ ] **Step 7: Commit**

```bash
pnpm format
git add packages/server/src/create-server-entry.ts packages/server/src/__tests__/create-server-entry.test.ts packages/server/src/internal-runtime.ts
git commit -m "feat(server): add private createServerEntry factory wiring the core app"
```

---

### Task 2: Rewrite the codegen to emit a factory shim

Shrink `generateCoreAppModule` from a 40-line wiring block to a shim that imports `createServerEntry` from the internal door and calls it. Update the codegen's string-assertion test. After this, nothing outside `packages/server` imports the handlers or resolver factories.

**Files:**
- Modify: `packages/vite/src/server-entry.ts:16-77` (the `generateCoreAppModule` function body)
- Modify: `packages/vite/src/__tests__/server-entry.test.ts` (the `generateCoreAppModule` describe block + the one `serverEntryPlugin` assertion that checks `.route('/', userApp)`)

**Interfaces:**
- Consumes: `createServerEntry` (Task 1) via the generated import `from 'hono-preact/server/internal/runtime'`.
- Produces: the generated core-app module text. Unchanged public contract: still `export const app` AND `export default app` (both adapters consume the default export; the named export is kept for parity).

- [ ] **Step 1: Update the codegen test first (these are the new expectations)**

In `packages/vite/src/__tests__/server-entry.test.ts`, replace the entire `describe('generateCoreAppModule', ...)` block (lines 28-188) with assertions for the shim. The new block:

```ts
describe('generateCoreAppModule', () => {
  it('emits a createServerEntry shim with a default export', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
    });
    expect(src).toContain(
      `import { createServerEntry } from 'hono-preact/server/internal/runtime';`
    );
    expect(src).toContain('createServerEntry({');
    expect(src).toContain('export default app;');
  });

  it('imports Layout and routes by absolute path', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/proj/src/Layout.tsx',
      routesAbsPath: '/proj/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
    });
    expect(src).toContain(`import Layout from '/proj/src/Layout.tsx';`);
    expect(src).toContain(`import routes from '/proj/src/routes.ts';`);
    expect(src).toContain('routes,');
    expect(src).toContain('layout: Layout,');
    expect(src).toContain('dev: import.meta.env.DEV,');
  });

  it('passes the user api app via the api option when present', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: '/p/src/api.ts',
      appConfigAbsPath: undefined,
    });
    expect(src).toContain(`import userApp from '/p/src/api.ts';`);
    expect(src).toContain('api: userApp,');
  });

  it('omits the api import and option when no api file exists', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
    });
    expect(src).not.toContain('api.ts');
    expect(src).not.toContain('userApp');
    expect(src).not.toContain('api:');
  });

  it('imports the user appConfig when the file exists', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: '/p/src/app-config.ts',
    });
    expect(src).toContain(`import appConfig from '/p/src/app-config.ts';`);
    expect(src).not.toContain('const appConfig = { use: [] };');
    expect(src).toContain('appConfig,');
  });

  it('falls back to an inline empty appConfig when no file exists', () => {
    const src = generateCoreAppModule({
      layoutAbsPath: '/p/src/Layout.tsx',
      routesAbsPath: '/p/src/routes.ts',
      apiAbsPath: undefined,
      appConfigAbsPath: undefined,
    });
    expect(src).not.toContain('app-config');
    expect(src).toContain('const appConfig = { use: [] };');
    expect(src).toContain('appConfig,');
  });
});
```

Then, in the `serverEntryPlugin` describe block, find the test `'config writes a core app that includes api when the file exists'` and change its api assertion (currently `expect(code).toContain(\`.route('/', userApp)\`);`, around line 469) to:

```ts
    expect(code).toContain(`import userApp from '${path.join(tmp, 'src', 'api.ts')}';`);
    expect(code).toContain('api: userApp,');
```

Leave the bottom `describe('mount-order composition ...')` block unchanged: it hand-builds an app to document the principle and does not call `generateCoreAppModule`.

- [ ] **Step 2: Run the codegen test to verify it fails**

Run: `pnpm --filter @hono-preact/vite test -- server-entry`
Expected: FAIL — the old `generateCoreAppModule` still emits the long form, so the new `createServerEntry` assertions fail.

- [ ] **Step 3: Rewrite `generateCoreAppModule`**

In `packages/vite/src/server-entry.ts`, replace the function body (the `return (...)` block and its preceding comments, lines ~20-76) so the whole function reads:

```ts
export function generateCoreAppModule(
  opts: GenerateCoreAppModuleOptions
): string {
  const { layoutAbsPath, routesAbsPath, apiAbsPath, appConfigAbsPath } = opts;

  const apiImport = apiAbsPath ? `import userApp from '${apiAbsPath}';\n` : '';
  const apiOption = apiAbsPath ? `  api: userApp,\n` : '';

  // appConfig is optional: when no app-config.ts file exists, fall back to an
  // empty config so the middleware chain still composes without the user
  // authoring anything. The default-export shape mirrors the
  // `import appConfig from './app-config'` convention so consumers can adopt
  // the file later without other entry changes.
  const appConfigImport = appConfigAbsPath
    ? `import appConfig from '${appConfigAbsPath}';\n`
    : `const appConfig = { use: [] };\n`;

  // The generated entry delegates all wiring to the framework-private
  // createServerEntry factory (loaders RPC, action POST, SSR catch-all, and the
  // optional api mount). The factory lives behind hono-preact/server/internal/
  // runtime: a version-coupled contract this codegen emits, not a public API.
  return (
    `import { createServerEntry } from 'hono-preact/server/internal/runtime';\n` +
    `import Layout from '${layoutAbsPath}';\n` +
    `import routes from '${routesAbsPath}';\n` +
    apiImport +
    appConfigImport +
    `\n` +
    `export const app = createServerEntry({\n` +
    `  routes,\n` +
    `  layout: Layout,\n` +
    `  appConfig,\n` +
    apiOption +
    `  dev: import.meta.env.DEV,\n` +
    `});\n` +
    `\n` +
    `export default app;\n`
  );
}
```

The `LOADERS_RPC_PATH` import at the top of `server-entry.ts` stays: it is still used by `RESERVED_PATHS` for the api-shadowing diagnostic. The `GenerateCoreAppModuleOptions` interface is unchanged.

- [ ] **Step 4: Run the codegen test to verify it passes**

Run: `pnpm --filter @hono-preact/vite test -- server-entry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry.test.ts
git commit -m "refactor(vite): emit a createServerEntry shim instead of inline wiring"
```

---

### Task 3: Internalize the handlers and resolver factories

Now that the codegen calls `createServerEntry` and nothing else imports the handlers/factories from an entry point, trim them off both the public entry and the internal-runtime door. Retarget the two server tests that imported them from entry points. Update the umbrella public-surface test.

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/internal-runtime.ts`
- Modify: `packages/server/src/__tests__/pe-form-no-js.integration.test.ts:5-6`
- Modify: `packages/hono-preact/__tests__/exports.test.ts`

**Interfaces:**
- Produces: the final public/private surface.
  - `hono-preact/server` exports: `renderPage`, `HonoContext`, `useHonoContext`.
  - `hono-preact/server/internal/runtime` exports: `createServerEntry`, `CreateServerEntryOptions`.
  - `loadersHandler`, `pageActionHandler`, `LoadersHandlerOptions`, `PageActionHandlerOptions`, `ActionEntry`, `routeServerModules`, `makePageUseResolver`, `makePageActionResolvers` are module-internal to `packages/server` (importable only via relative paths, used by `create-server-entry.ts` and the unit tests).

- [ ] **Step 1: Update the umbrella exports test first (new expectations)**

In `packages/hono-preact/__tests__/exports.test.ts`, replace the `describe('hono-preact/server export', ...)` block (lines 71-85) with:

```ts
describe('hono-preact/server export', () => {
  it('surfaces the SSR + context public API', async () => {
    const m = await import('hono-preact/server');
    expect(typeof m.renderPage).toBe('function');
    expect(typeof m.HonoContext).toBe('function');
    expect(typeof m.useHonoContext).toBe('function');
  });

  it('no longer surfaces the low-level handlers (moved to /server/internal/runtime wiring)', async () => {
    const m = await import('hono-preact/server');
    expect('loadersHandler' in m).toBe(false);
    expect('pageActionHandler' in m).toBe(false);
  });

  it('no longer surfaces the framework-emitted resolver factories', async () => {
    const m = await import('hono-preact/server');
    expect('routeServerModules' in m).toBe(false);
    expect('makePageUseResolver' in m).toBe(false);
    expect('makePageActionResolvers' in m).toBe(false);
  });
});

describe('hono-preact/server/internal/runtime export', () => {
  it('surfaces the framework-emitted createServerEntry factory', async () => {
    const m = await import('hono-preact/server/internal/runtime');
    expect(typeof m.createServerEntry).toBe('function');
  });

  it('does not re-surface the low-level handlers or resolver factories', async () => {
    const m = await import('hono-preact/server/internal/runtime');
    expect('loadersHandler' in m).toBe(false);
    expect('pageActionHandler' in m).toBe(false);
    expect('routeServerModules' in m).toBe(false);
    expect('makePageUseResolver' in m).toBe(false);
    expect('makePageActionResolvers' in m).toBe(false);
  });
});
```

- [ ] **Step 2: Retarget the two entry-point imports in the PE-form integration test**

In `packages/server/src/__tests__/pe-form-no-js.integration.test.ts`, change lines 5-6 from:

```ts
import { pageActionHandler, renderPage } from '../index.js';
import { makePageActionResolvers } from '../internal-runtime.js';
```

to import each symbol from its defining module directly:

```ts
import { renderPage } from '../render.js';
import { pageActionHandler } from '../page-action-handler.js';
import { makePageActionResolvers } from '../page-action-resolvers.js';
```

(`renderPage` is still on `../index.js`, but importing it from `../render.js` keeps this test's imports uniform with the others in the package and independent of the entry surface.)

- [ ] **Step 3: Trim the public entry**

Replace `packages/server/src/index.ts` with:

```ts
export { HonoContext, useHonoContext } from './context.js';
export { renderPage } from './render.js';
```

- [ ] **Step 4: Trim the internal-runtime door**

Replace `packages/server/src/internal-runtime.ts` with:

```ts
// @hono-preact/server/internal/runtime: framework-emitted tier.
//
// createServerEntry exists ONLY because the framework's generated server entry
// imports and calls it (serverEntryPlugin). It is a private contract between
// this version's vite plugins and this version's runtime; it has no standalone
// user story. DO NOT IMPORT FROM USER CODE; this door is undocumented and may
// change in any non-major release in lockstep with the codegen that emits it.
export {
  createServerEntry,
  type CreateServerEntryOptions,
} from './create-server-entry.js';
```

- [ ] **Step 5: Run the server package suite + typecheck**

Run: `pnpm --filter @hono-preact/server test`
Expected: PASS (all existing handler/resolver tests still import via relative paths; the retargeted PE-form test passes).

Run: `pnpm --filter @hono-preact/server exec tsc --noEmit`
Expected: no errors (no remaining importer of the trimmed symbols from `./index.js` / `./internal-runtime.js`).

- [ ] **Step 6: Rebuild the umbrella dist and run the umbrella exports test**

The exports test imports `hono-preact/server`, which the vitest alias resolves to the workspace source, but the umbrella consolidate output must be current for a faithful check.

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Then: `pnpm --filter hono-preact test -- exports`
Expected: PASS (server block + new server/internal/runtime block).

- [ ] **Step 7: Commit**

```bash
pnpm format
git add packages/server/src/index.ts packages/server/src/internal-runtime.ts packages/server/src/__tests__/pe-form-no-js.integration.test.ts packages/hono-preact/__tests__/exports.test.ts
git commit -m "refactor(server): internalize loaders/action handlers and resolver factories"
```

---

### Task 4: Update the docs

Remove the structure.mdx bullets that advertise the now-internal handlers/`routeServerModules`, and correct the render-page.mdx reference that names the removed factories. Describe what is, not what changed (no "formerly" / migration breadcrumbs).

**Files:**
- Modify: `apps/site/src/pages/docs/structure.mdx:90-91`
- Modify: `apps/site/src/pages/docs/render-page.mdx:68`

- [ ] **Step 1: Trim the structure.mdx server-package bullet list**

In `apps/site/src/pages/docs/structure.mdx`, under `### \`hono-preact/server\` (workspace package)`, delete these two bullets (lines 90-91):

```markdown
- **`pageActionHandler`**, **`loadersHandler`**: page POST action handler and `POST /__loaders` middleware. Accept either a Vite `import.meta.glob` result or the record produced by `routeServerModules`.
- **`routeServerModules`**: adapter that converts a `RoutesManifest` into the lazy-glob shape the handlers consume.
```

Leave the `renderPage`, `HonoContext`/`useHonoContext`, and `location` bullets in place. The remaining list then describes exactly the public `hono-preact/server` surface (plus `location`, which is out of scope here).

- [ ] **Step 2: Correct the render-page.mdx custom-server-routes paragraph**

In `apps/site/src/pages/docs/render-page.mdx`, replace the final paragraph of the `## Custom server routes` section (the one beginning "`renderPage` is public", line 68) with:

```markdown
`renderPage` is public (see [Usage](#usage) above), so a custom catch-all can call it directly when you need bespoke layout injection or a `defaultTitle`. The loader and page-action handlers are not a public hand-wiring surface, though. The framework's generated entry delegates the full wiring to an internal `createServerEntry` factory behind `hono-preact/server/internal/runtime`, a private, version-coupled contract the codegen emits. That factory builds the route-use resolver carrying your page-level `use` guards (including auth gates) and threads it into both handlers, so a page guard can never be silently dropped on the loader or action path. Because the factory is internal, hand-assembling a full entry depends on a door that can change in any non-major release: pin your framework version if you reach for it. Short of an alternate runtime, prefer `api.ts` plus the generated entry.
```

(Line 53's narrative, "mounting `loadersHandler` on `POST /__loaders` ...", stays: it accurately describes the request topology the generated entry produces.)

- [ ] **Step 3: Verify the site still builds**

Run: `pnpm --filter site build`
Expected: success (MDX compiles; no broken references).

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/site/src/pages/docs/structure.mdx apps/site/src/pages/docs/render-page.mdx
git commit -m "docs: stop advertising the now-internal server handlers"
```

---

### Task 5: Full pre-push verification

The change spans four packages (server, vite, umbrella, site). Run the entire CI mirror once, in order, to catch cross-package fallout (build, format, typecheck, unit coverage, integration, site build).

**Files:** none (verification only).

- [ ] **Step 1: Build all framework packages**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: all build, including the umbrella consolidate step.

- [ ] **Step 2: Format check**

Run: `pnpm format:check`
Expected: clean. If it fails, run `pnpm format`, then `git add -A && git commit -m "chore: format"` and re-run.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Unit tests with coverage**

Run: `pnpm test:coverage`
Expected: all pass, including `packages/server` (`create-server-entry`, the retargeted PE-form test) and `packages/hono-preact` (`exports`).

- [ ] **Step 5: Integration tests**

Run: `pnpm test:integration`
Expected: all pass (these exercise the generated entry end-to-end, which now routes through `createServerEntry`).

- [ ] **Step 6: Site build**

Run: `pnpm --filter site build`
Expected: success. This is the real end-to-end check that the generated core-app shim resolves `createServerEntry` from `hono-preact/server/internal/runtime` and wires a working worker.

- [ ] **Step 7: Final working-tree review**

Run: `git status` and `git log --oneline -6`
Expected: clean working tree, four task commits present, no stray format-dirty files. Do not push or open a PR unless explicitly asked.

---

## Self-Review

**Spec coverage (issue #126):**
- "Handlers public but required resolver factories private" → resolved: handlers + factories are now both internal; the only door is the single `createServerEntry` contract (Tasks 1-3).
- "Keep `renderPage` public regardless" → preserved in trimmed `index.ts` (Task 3, Step 3).
- "Schedule under the minor/major release policy" → captured in Global Constraints; no release work in this plan.
- Hybrid-specific: codegen dogfoods the public-shaped factory (no parity drift) → Task 2; promotion-readiness → `createServerEntry` is a complete, tested function behind one door.

**Placeholder scan:** every code/test/doc step contains the literal content. No "TBD"/"handle errors"/"similar to". The one conditional fallback (annotate `PageUse` if the fixture rejects the middleware value, Task 1 Step 6) is a named, exact remedy, not a placeholder.

**Type consistency:** `createServerEntry` / `CreateServerEntryOptions` names and shape are identical across Task 1 (definition), Task 1 Step 4 + Task 3 Step 4 (internal-runtime re-export), and Task 2 (generated import). The generated option keys (`routes`, `layout`, `appConfig`, `api`, `dev`) match the interface fields exactly. The factory passes `resolverByPath` / `resolvePageUseByPath` / `renderPage` / `resolvePageNode` / `appConfig` to `pageActionHandler` exactly as the current codegen does, and `dev` / `appConfig` / `resolvePageUse` to `loadersHandler`. Mount order (api → loaders → action POST → GET catch-all) matches the current codegen and is locked by a behavioral test.
