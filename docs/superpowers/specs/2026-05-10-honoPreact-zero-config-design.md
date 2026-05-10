# `honoPreact()` Zero-Config Design

**Date:** 2026-05-10
**Status:** Draft
**Supersedes:** §3 of `2026-05-09-v0.1-framework-direction.md` (the original `defineApp()` proposal).

## TL;DR

Item 3 of the v0.1 sequencing reframes from "introduce a `defineApp()` config wrapper" to "make `honoPreact()` work with zero required arguments and own the server entry."

The user's `vite.config.ts` collapses to:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { honoPreact } from 'hono-preact/vite';
export default defineConfig({ plugins: [honoPreact()] });
```

The user's `src/server.tsx` is deleted. Custom Hono routes move to `src/api.ts` (optional). The framework generates the server entry as a virtual module.

## Why not `defineApp()`

The original spec (§3 of the v0.1 framework direction) proposed `defineApp({ layout, routes, plugins })` as a config wrapper that returned a full Vite `UserConfig`. We reconsidered:

- The existing `honoPreact()` plugin already drives `resolve.dedupe`, `build.target`, `build.assetsDir`, `ssr.noExternal`, conditional client/server config, and bundles its sub-plugins. There is no Vite surface a config wrapper would reach that the plugin cannot.
- A config wrapper introduces a parallel API surface forever: every build-tuning escape hatch (`clientBuild`, `serverBuild`, `sharedBuild`, future Vite features) must be exposed twice or hidden behind the wrapper.
- The README payoff of `defineApp()` over `defineConfig({ plugins: [honoPreact()] })` is two lines and one import. Real but small.
- The naming-symmetry argument with `defineRoutes`/`defineLoader`/`defineAction`/`definePage` is aesthetic; those shape runtime behavior and live in the runtime package, while a config wrapper would live in the vite package and shape build behavior. They are not the same thing.
- Plugin-only is forwards-compatible: when Vite ships a feature, plugin users get it for free; wrapper users wait for us to expose it.

The plugin form is also more honest about what is happening: the user can read the plugin order, insert their own plugin before or after, and reach for any Vite config field. The wrapper would hide all of that behind option keys.

Decision: drop `defineApp()`. Enhance `honoPreact()` to need no required arguments and own the server entry.

## `honoPreact()` API after item 3

```ts
interface HonoPreactOptions {
  // Source paths. All optional with sensible defaults.
  layout?: string;       // default 'src/Layout.tsx'
  routes?: string;       // default 'src/routes.ts'
  api?: string;          // default 'src/api.ts' (only loaded if file exists)
  clientEntry?: string;  // default 'src/client.tsx' (item 4 will swap to virtual)

  // Server entry. Defaults to a generated virtual module. Rare override.
  entry?: string;        // if omitted, framework uses 'virtual:hono-preact/server'

  // Build-tuning escape hatches (preserved from today).
  clientBuild?: BuildEnvironmentOptions;
  serverBuild?: BuildEnvironmentOptions;
  sharedBuild?: BuildEnvironmentOptions;
}

declare function honoPreact(options?: HonoPreactOptions): Plugin[];
```

Notable changes from today:

- `entry` is no longer required. When omitted, the framework generates the server entry as a virtual module and points the hono build/dev plugins at it.
- `preact()` is added to the returned plugin array. The user no longer imports or registers `@preact/preset-vite`.
- New optional `layout`, `routes`, `api` options exist solely so the generated server entry knows which paths to import.
- All other build-tuning options (`clientBuild`, `serverBuild`, `sharedBuild`) are preserved unchanged for power users.

The day-one user config:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { honoPreact } from 'hono-preact/vite';
export default defineConfig({ plugins: [honoPreact()] });
```

The demo (with MDX, stripped to essentials):

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { honoPreact } from 'hono-preact/vite';
import mdx from '@mdx-js/rollup';

export default defineConfig({
  resolve: { alias: [/* monorepo workspace aliases, dies at v0.1 §7 */] },
  plugins: [
    honoPreact(),
    Object.assign(mdx({ /* options */ }), { enforce: 'pre' as const }),
  ],
});
```

(The MDX option object and the `VISUALIZE=1` rollup-visualizer block are user-owned and stay as they are; omitted here for brevity.)

Goes from ~60 lines to ~25. The user no longer writes `preact()`, `clientShimPlugin`, the loader/action handler glue, the `process.env.PROD` ternary, or `entry: 'src/server.tsx'`.

## Generated server entry

`honoPreact()` registers a virtual module `virtual:hono-preact/server`. Its content is generated from the resolved `layout`, `routes`, and (if present) `api` paths.

```tsx
// virtual:hono-preact/server  — generated, never touched by user
import { Hono } from 'hono';
import { env } from '@hono-preact/iso';
import {
  actionsHandler,
  loadersHandler,
  location,
  renderPage,
  routeServerModules,
} from '@hono-preact/server';
import Layout from '/src/Layout.tsx';        // resolved from options.layout
import routes from '/src/routes.ts';          // resolved from options.routes
// Optional, only included if the file exists at config time:
import userApp from '/src/api.ts';            // resolved from options.api

env.current = 'server';
const serverModules = routeServerModules(routes);

export const app = new Hono()
  .post('/__loaders', loadersHandler(serverModules))
  .post('/__actions', actionsHandler(serverModules))
  .route('/', userApp)                        // mounted before catch-all
  .use(location)
  .get('*', (c) => renderPage(c, <Layout context={c} />));

export default app;
```

Key calls:

- `layout` and `routes` paths are resolved by Vite, so `import` works for `.ts`/`.tsx` sources directly.
- `api` is loaded conditionally. The plugin checks for the file's existence at config time; if absent, the `import userApp from ...` and `.route('/', userApp)` lines are omitted from the generated source.
- `app.route('/', userApp)` mounts the user's Hono app before the framework's catch-all. Any custom routes or `app.use(...)` middleware in `api.ts` always run first.
- `env.current = 'server'` is no longer the user's concern. (`env.current` leaving the public surface is part of v0.1 §9's cuts list.)
- The dev-only `dotenv` loader block from today's `server.tsx` goes away. Vite already loads `.env` files into `import.meta.env`, and Hono runtime config goes through bindings.
- `defaultTitle: 'hono-preact'` in `renderPage` is hardcoded for item 3. Item 4 introduces `<Head>` in the layout, which is where it actually belongs; once item 4 lands, this argument disappears entirely.

### Verification step for the implementation plan

Confirm `@hono/vite-build/cloudflare-workers` and `@hono/vite-dev-server` accept a virtual module ID (`virtual:hono-preact/server`) as their `entry`. They should — virtual modules go through Vite's normal `resolveId`/`load` plugin pipeline, which is how SSR plugins typically work — but if not, the workaround is a tiny on-disk shim file generated by the plugin into a temp dir and pointed at instead. This needs to be checked first before designing the rest of the plugin's wiring.

## `api.ts` contract

`src/api.ts` default-exports a `Hono` instance:

```ts
// src/api.ts
import { Hono } from 'hono';
import { getWatched } from './server/watched.js';

export default new Hono()
  .get('/api/watched/:movieId/photo', async (c) => {
    const id = Number(c.req.param('movieId'));
    if (!Number.isFinite(id)) return c.notFound();
    const rec = await getWatched(id);
    if (!rec?.photo) return c.notFound();
    return new Response(
      new Blob([rec.photo.bytes], { type: rec.photo.contentType }),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  });
```

The framework mounts it via `app.route('/', userApp)` before the framework's `.get('*')` catch-all. The user's middleware and routes always run first.

This matches every Hono tutorial: create an app, chain methods. The user's mental model is "my Hono app gets mounted into the framework's Hono app," which is exactly what happens.

### Catch-all warning at build time

A small Vite plugin parses `api.ts` with `@babel/parser` (already in the codebase via `serverOnlyPlugin`) and walks for the common catch-all shapes:

| Pattern | Caught? | Notes |
|---|---|---|
| `app.get('*', ...)` / `app.all('*', ...)` | Yes | Literal `'*'` first arg. |
| `app.get('/*', ...)` | Yes | Literal `'/*'` first arg. |
| `app.notFound(...)` | Yes | Same effect as a catch-all. |
| `app.get(somePath, ...)` where `somePath` is a variable | No | Skip; not worth the false-positive noise. |
| `app.use(...)` with no path | No | Legitimate global middleware. |

The plugin emits a warning, not an error:

```
[hono-preact] src/api.ts registers a catch-all route ('*'). It will be
shadowed by the framework's renderPage handler. Move it to a more specific
path, or accept that it won't fire.
```

The build succeeds either way. The user can ignore the warning if they really meant it.

## Demo migration

**Files deleted from `apps/app/src/`:**

- `server.tsx` — replaced by the generated virtual module.

**Files created in `apps/app/src/`:**

- `api.ts` — the `/api/watched/:movieId/photo` route that was inline in `server.tsx`. Roughly 12 lines.

**Files modified:**

- `apps/app/vite.config.ts` — drops `entry: 'src/server.tsx'`, drops `preact()` from the plugins array, drops the `import preact from '@preact/preset-vite'`. Keeps the workspace alias block (dies at v0.1 §7) and the visualizer block. Net change: ~60 lines to ~25 lines.

**What stays user-authored** (the v0.1 spec's "six things" pitch):

- `src/Layout.tsx` (unchanged)
- `src/routes.ts` (unchanged)
- `src/views/**` (unchanged)
- `src/views/*.server.ts` (unchanged)
- `src/api.ts` (newly minimal, was inline in server.tsx)
- `vite.config.ts` (smaller)

## Behavior parity to verify

| Today | How to verify |
|---|---|
| `/__loaders` and `/__actions` POST endpoints work | Existing loader/action e2e flows in demo. |
| `/api/watched/:movieId/photo` GET works | Manual smoke or unit test against the served route. |
| `.use(location)` runs before `renderPage` | Existing SSR navigation flows. |
| `renderPage` gets the correct `Layout` and Hono context | Existing SSR render. |
| `env.current === 'server'` during SSR | Existing server-only assertions. |

## Out of scope for item 3

- `client.tsx` deletion, `<Head>`, `<ClientScript />` (item 4).
- Killing the `import.meta.env.PROD` script-tag ternary in `Layout.tsx` (item 4).
- The workspace alias block in `apps/app/vite.config.ts` (v0.1 §7 — package consolidation).
- Any runtime behavior change. Item 3 only relocates where the server entry is authored.

## Replaces

- `apps/app/src/server.tsx` (the entire file).
- The `entry: 'src/server.tsx'` argument to `honoPreact()`.
- The user's hand-authored `preact()` registration in `vite.config.ts`.
- The `dotenv` dev-time block at the top of `server.tsx`.
- The user's manual `env.current = 'server'` assignment.
