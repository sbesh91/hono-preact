# Distributed route files and micro-frontend (MFE) feasibility

**Date:** 2026-05-31
**Status:** Research / feasibility analysis only (no implementation intent)
**Question:** Can `routes.ts` be split across files in large apps, and could hono-preact serve a micro-frontend architecture?

## TL;DR

- **Distributed route files:** already fully supported today. It is a pure file-organization refactor, zero framework changes.
- **Runtime/plugin route registration within one build & one server (Flavor A):** a real, tractable framework feature. Medium effort, no architectural fight.
- **True federated MFE with independent deploys (Flavor B):** the framework's SSR-first, single-build-graph design is fundamentally at odds with runtime-loaded *server* code. The pragmatic MFE story on this stack is a path-prefix gateway in front of N independent hono-preact deployments, which needs no framework work at all.

## Distributed route files (supported today)

`defineRoutes` is a runtime function taking `RouteDef[]` and returning a `RoutesManifest`
(`packages/iso/src/define-routes.tsx:454`). There is **no build-time static analysis of
`routes.ts`** the Vite plugin generates `import routes from '<routesAbsPath>'` and consumes
whatever is default-exported (`packages/vite/src/server-entry.ts:49`). No babel/AST walk of the
routes file, no `import.meta.glob` over the route tree. (The only AST analysis in the plugin
targets `api.ts` and `app-config.ts`, never `routes.ts`.)

Validation runs at `defineRoutes()` call time, not build time, so a composed array is validated as
one tree. Therefore routes can be split by feature and spread:

```ts
// src/routes/demo.ts
import type { RouteDef } from 'hono-preact';
export const demoRoutes: RouteDef[] = [
  { path: '/demo', layout: () => import('../pages/demo/demo-layout.js'), children: [
    { path: '', view: () => import('../pages/demo/index.js') },
    { path: 'login', view: () => import('../pages/demo/login.js'),
      server: () => import('../pages/demo/login.server.js') },
  ]},
];

// src/routes.ts
import { defineRoutes } from 'hono-preact';
import { demoRoutes } from './routes/demo.js';
export default defineRoutes([
  { path: '/', view: () => import('./pages/home.js') },
  ...demoRoutes,
  { path: '*', view: () => import('./pages/not-found.js') },
]);
```

`children` arrays can equally be imported and spread. The only requirement is that the default
export is the single `RoutesManifest` the server entry imports.

## Where the build/runtime coupling lives

The manifest is a **one-shot eager computation**. `defineRoutes()` walks the tree once and produces
four frozen arrays: `tree`, `flat`, `serverImports`, `serverRoutes`. Nothing is observable or
mutable afterward. Three layers consume it, binding at three different times:

### 1. Build-time (Rollup graph) the hardest wall

Every route is a `() => import('./pages/x.js')` thunk. Rollup must *see* each thunk to emit it as a
code-split chunk in the build output. The generated server entry hardcodes
`import routes from '<routesAbsPath>'` (`server-entry.ts:49`) pointing at one module. There is no
enumeration of route chunks beyond what is reachable from that single import. A route whose code
lives in a separately built, separately deployed bundle is simply not in this graph.

### 2. Module-init (server boot) static closures

The generated `core-app.tsx` computes, once at import:

```js
const serverModules = routeServerModules(routes);
const pageUseResolvers  = makePageUseResolvers(routes.serverRoutes, { dev });
const pageActionResolvers = makePageActionResolvers(routes.serverRoutes, { dev });
```

The Hono handlers (`.post('/__loaders')`, `.post('*')`, `.get('*')`, `server-entry.ts:59-69`) then
close over those resolvers. Loaders/actions resolve `byPath` against a map frozen at boot. Note the
handlers are already wildcard (`*`) handlers that dispatch by matched path; they do not register a
Hono route per page.

### 3. Render-time the friendly layer

`<Routes routes={routes}>` (`define-routes.tsx:470`) maps `routes.flat` into preact-iso `<Route>`
children, and preact-iso matches over its children at render. If `routes.flat` grew and the
component re-rendered, new routes would light up. This layer could accept runtime registration with
little fuss.

## Flavor A: runtime/plugin route registration (one build, one server)

Feature modules register themselves at boot; routes assembled dynamically rather than from one
literal. **Feasible, medium effort.** Sketch:

- Replace the frozen manifest with a live registry: `createRouteRegistry()` returning
  `{ register(subtree), manifest, subscribe() }`. `register` re-runs `flattenTree` /
  `collectServerRoutes` for the new subtree, appends, and notifies.
- Server resolvers already key `byPath`. Change `makePage*Resolvers` to consult the registry's live
  path-map instead of capturing a snapshot array. The Hono handlers stay as-is (already wildcard,
  dispatch by matched path), so no per-route Hono registration is needed; only the resolver lookup
  must read live state.
- Client `<Routes>` subscribes to the registry and re-renders on `register`.

**Constraint that does not go away:** every registered route's `import()` thunk must still exist in
the Rollup graph. "Dynamic" here means *assembled at runtime from modules that are all in this
build* (conditional / lazy / plugin-style, e.g. optional feature packs or per-tenant route sets),
not *loaded from another deployment*. Useful, but not independent deployability.

## Flavor B: true federated MFE (independent builds & deploys)

The wall is SSR.

- **Client side: tractable.** With `@originjs/vite-plugin-federation` or native import-maps, a
  remote exposes `remote/Page` and the host does `lazy(() => import('remote/Page'))`. A remote could
  ship a manifest fragment fetched at runtime and `register()` it into the Flavor-A registry.
  Cross-MFE SPA navigation works because it is all one client runtime.
- **Server side: this is where it breaks.** SSR of a federated route needs *both* the remote's view
  *and* its `.server.js` (loaders/actions) executing inside the **host's** Node/Workers runtime.
  Three ways out, all with teeth:
  1. Host fetches + evaluates remote server bundles at runtime. Fragile on Node; effectively a
     non-starter on Cloudflare Workers (dynamic eval of arbitrary remote code).
  2. Render federated routes **client-only** (no SSR for those routes). Keeps MFE but discards the
     framework's headline SSR + streaming loaders for exactly the federated routes guts the value
     proposition.
  3. **Gateway / composition model (recommended).** Each MFE is its own full hono-preact
     deployment; a thin Hono reverse-proxy gateway routes by path prefix
     (`/team-a/* -> deployment A`, `/team-b/* -> deployment B`). Every team gets independent build +
     deploy + SSR + loaders, with **zero framework changes**, because each app is already a
     standalone Hono app. Cost: navigation *across* MFE boundaries is a hard navigation (full
     document load) unless an app-shell owns the chrome and treats each MFE as a region. Within an
     MFE you keep full SPA + SSR.

## Verdict

- **Distributed route files:** already supported; pure file-org refactor.
- **Flavor A (runtime registration, one build):** a self-contained framework feature worth scoping
  if the goal is one app assembling its route set dynamically/conditionally. Live registry +
  resolvers reading live state + subscribing `<Routes>`. The Rollup-graph constraint is inherent and
  acceptable for the plugin/feature-pack use case.
- **Flavor B (federated, independent deploys):** if "MFE" means team-autonomous independent deploys,
  reach for the gateway model (no framework work). Server-side runtime federation is not achievable
  without either dropping SSR for federated routes or evaluating untrusted remote code in the host.

## Key file references

- `packages/iso/src/define-routes.tsx:454` `defineRoutes`, manifest computation
- `packages/iso/src/define-routes.tsx:470` `Routes` component (renders `routes.flat`)
- `packages/iso/src/define-routes.tsx:163-216` `collectServerImports` / `collectServerRoutes`
- `packages/vite/src/server-entry.ts:35-72` generated core-app module (single `routes` import,
  boot-time resolver closures)
- `packages/vite/src/server-entry.ts:122-220` AST analysis (targets `api.ts` only, not `routes.ts`)
