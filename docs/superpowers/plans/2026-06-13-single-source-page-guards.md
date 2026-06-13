# Single-source Page Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `use` on the route node the single declared source of a page-layer guard, gating render (SSR + client nav + hydration) and RPC (loaders + actions) from one array, with inheritance down the tree.

**Architecture:** Add `use?: PageUse` to `RouteDef`. The render builder wraps each `use`-bearing node's component in a `PageMiddlewareHost` (nesting composes ancestor -> leaf), threading bare-grouping `use` down to descendants. The manifest precomputes a `routeUse` array (`{ path, use }` composed per matchable pattern) that the server resolver matches by URL. `definePage`'s `use` option and the `.server.ts` `pageUse` export are removed.

**Tech Stack:** TypeScript, Preact, preact-iso, Hono, Vite, Babel (`@babel/parser`), Vitest, happy-dom, `@testing-library/preact`. Spec: `docs/superpowers/specs/2026-06-13-single-source-page-guards-design.md`.

---

## Sequencing note (read before starting)

Framework changes land first (tasks 1-4, 6-7), the site migrates in one task (task 5), then docs and a full-CI gate (tasks 8-9). Between task 4 (server reads `routeUse`) and task 5 (site adopts node `use`) the **site's** RPC guards are temporarily inactive because the site has no node `use` yet. This is expected: each framework package's own Vitest stays green per task, and task 9 runs the full workspace typecheck + integration suite that validates the site end to end. Do not add throwaway "compose both old and new" glue to paper over the window; just keep the task order.

## File Structure

**iso (`packages/iso/src/`)**
- `define-routes.tsx` — add `RouteDef.use`; relax `validate`; thread `pendingUse` + host-wrap in `flattenTree`/`buildInnerRoutes`/`makeLayoutGroupComponent`; add `collectRouteUse`; add `routeUse` to `RoutesManifest`; import `PageMiddlewareHost`.
- `define-page.tsx` — drop `use` from `PageBindings` (task 6).
- `internal/use-types.ts` — `PageUse` already exists; no change.

**server (`packages/server/src/`)**
- `route-server-modules.ts` — replace `makePageUseResolvers` with `makePageUseResolver(manifest)` (manifest-driven, synchronous); keep `routeServerModules`.
- `internal-runtime.ts` — export `makePageUseResolver` (was `makePageUseResolvers`).

**vite (`packages/vite/src/`)**
- `server-entry.ts` — wire `makePageUseResolver(routes)` into the generated core app.
- `server-exports-contract.ts` — remove `pageUse` from both export lists (task 7).

**apps/site (`apps/site/src/`)**
- `routes.ts` — restructure `/demo` under a guarded `projects` grouping (task 5).
- `pages/demo/{projects,project-issues,issue}.server.ts` — remove `pageUse` (task 5).
- `pages/demo/{projects,project-issues,issue}.tsx` — drop `definePage` `use` arg (task 5).
- `pages/docs/middleware.mdx` + other docs — rewrite page-layer sections (task 8).

**Tests**
- `packages/iso/src/__tests__/define-routes.test.tsx` — validation + grouping recursion + render-guard tests.
- `packages/iso/src/__tests__/page-guards-render.test.tsx` (new) — node-`use` render gating.
- `packages/iso/src/__tests__/define-routes-server.test.tsx` — `routeUse` composition.
- `packages/server/src/__tests__/page-use-resolver.test.ts` (new) — `makePageUseResolver`.
- `packages/vite/src/__tests__/server-entry.test.ts` — generated wiring.
- `packages/vite/src/__tests__/server-loaders-parser.test.ts` — `pageUse` removed from recognized set.

---

### Task 1: `RouteDef.use` type + validation relaxation

**Files:**
- Modify: `packages/iso/src/define-routes.tsx` (`RouteDef` ~line 31-37; `validate` ~line 119-170)
- Test: `packages/iso/src/__tests__/define-routes.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `define-routes.test.tsx` inside the `describe('defineRoutes validation', …)` block:

```tsx
import { defineServerMiddleware } from '../define-middleware.js';

const mw = defineServerMiddleware(async (_ctx, next) => {
  await next();
});

it('accepts `use` on a leaf node', () => {
  expect(() =>
    defineRoutes([{ path: '/', view: noopView, use: [mw] }])
  ).not.toThrow();
});

it('accepts `use` on a bare grouping that contains a nested layout', () => {
  expect(() =>
    defineRoutes([
      {
        path: '/app',
        layout: noopLayout,
        children: [
          {
            path: 'area',
            use: [mw],
            children: [
              { path: '', view: noopView },
              {
                path: ':id',
                layout: noopLayout,
                children: [{ path: '', view: noopView }],
              },
            ],
          },
        ],
      },
    ])
  ).not.toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-routes.test.tsx`
Expected: the grouping-with-nested-layout test FAILs with the `v0.1` "may only contain view leaves" error thrown by `validate`.

- [ ] **Step 3: Add `use` to `RouteDef` and relax `validate`**

In `define-routes.tsx`, add the import near the other internal imports:

```tsx
import type { PageUse } from './internal/use-types.js';
```

Extend `RouteDef`:

```tsx
export type RouteDef = {
  path: string;
  view?: LazyImport<ComponentType<ViewProps>>;
  layout?: LazyImport<ComponentType<LayoutProps>>;
  server?: LazyServerImport;
  children?: readonly RouteDef[];
  /**
   * Page-layer middleware/observers for this node and every descendant.
   * Composed outer-to-inner with `appConfig.use` and unit-level `use`.
   * Runs on the page render (SSR + client nav) and on the loader/action
   * RPC paths. The single declared source of a page guard.
   */
  use?: PageUse;
};
```

Replace the `ValidationContext` machinery and the `validate` body's grouping restriction. Change the signature to drop the `context` parameter and delete the `layout-grouping` branch:

```tsx
function validate(routes: ReadonlyArray<RouteDef>, parentPath = ''): void {
  for (const r of routes) {
    const here = parentPath + (r.path.startsWith('/') ? r.path : '/' + r.path);
    const hasView = !!r.view;
    const hasLayout = !!r.layout;
    const hasChildren = !!(r.children && r.children.length > 0);

    if (hasView && hasLayout) {
      throw new Error(
        `Route ${here}: cannot declare both \`view\` and \`layout\`.`
      );
    }
    if (hasView && hasChildren) {
      throw new Error(`Route ${here}: \`view\` route cannot have \`children\`.`);
    }
    if (hasLayout && !hasChildren) {
      throw new Error(`Route ${here}: \`layout\` requires \`children\`.`);
    }
    if (!hasView && !hasLayout && !hasChildren) {
      throw new Error(
        `Route ${here}: must declare \`view\`, \`layout\`+\`children\`, or \`children\`.`
      );
    }
    if (parentPath !== '' && r.path.startsWith('/')) {
      throw new Error(`Route ${here}: child path must not start with \`/\`.`);
    }

    if (hasChildren) {
      validate(r.children!, here === '/' ? '' : here);
    }
  }
}
```

Delete the now-unused `ValidationContext` type and its doc comment (lines ~108-118).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-routes.test.tsx`
Expected: PASS. (If a pre-existing test asserted the `layout-grouping` rejection, update it: that shape is now legal. Search the file for `view leaves` and `layout-grouping` and remove/repurpose those assertions.)

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes.test.tsx
git commit -m "feat(iso): allow \`use\` on any route node; lift grouping restriction"
```

---

### Task 2: Manifest `routeUse` field + `collectRouteUse`

**Files:**
- Modify: `packages/iso/src/define-routes.tsx` (`RoutesManifest` ~line 66-91; `defineRoutes` ~line 463-475)
- Test: `packages/iso/src/__tests__/define-routes-server.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `define-routes-server.test.tsx`:

```tsx
import { defineServerMiddleware } from '../define-middleware.js';

const a = defineServerMiddleware(async (_c, next) => next());
const b = defineServerMiddleware(async (_c, next) => next());

it('composes routeUse outer-to-inner down the tree', () => {
  const m = defineRoutes([
    {
      path: '/app',
      layout: noopLayout,
      children: [
        { path: 'open', view: noopView },
        {
          path: 'area',
          use: [a],
          children: [
            { path: '', view: noopView, server: noopServer },
            {
              path: ':id',
              layout: noopLayout,
              use: [b],
              children: [{ path: '', view: noopView, server: noopServer }],
            },
          ],
        },
      ],
    },
  ]);
  const byPath = new Map(m.routeUse.map((r) => [r.path, r.use]));
  expect(byPath.get('/app/open')).toEqual([]);
  expect(byPath.get('/app/area')).toEqual([a]);
  expect(byPath.get('/app/area/:id')).toEqual([a, b]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-routes-server.test.tsx`
Expected: FAIL — `m.routeUse` is undefined.

- [ ] **Step 3: Add `routeUse` to the manifest and implement `collectRouteUse`**

In `define-routes.tsx`, extend `RoutesManifest`:

```tsx
export type RoutesManifest<
  T extends readonly RouteDef[] = readonly RouteDef[],
> = {
  tree: ReadonlyArray<RouteDef>;
  flat: ReadonlyArray<FlatRoute>;
  serverImports: ReadonlyArray<LazyServerImport>;
  serverRoutes: ReadonlyArray<ServerRoute>;
  /**
   * Composed page-layer `use` per matchable route pattern (ancestors
   * outer-first, then the node's own `use`). The server resolver matches a
   * request URL to the most specific pattern here and runs the array. Emitted
   * for every node that can be an RPC target (`view` / `layout` / `server`);
   * bare groupings propagate their `use` into descendants via composition
   * rather than appearing themselves.
   */
  routeUse: ReadonlyArray<{ path: string; use: PageUse }>;
  readonly __tree?: T;
};
```

Add the collector near `collectServerRoutes`:

```tsx
function collectRouteUse(
  routes: ReadonlyArray<RouteDef>,
  parentPath = '',
  inherited: PageUse = []
): Array<{ path: string; use: PageUse }> {
  const out: Array<{ path: string; use: PageUse }> = [];
  for (const r of routes) {
    const here =
      parentPath === '' ? r.path : parentPath + (r.path === '' ? '' : '/' + r.path);
    const composed: PageUse = r.use ? [...inherited, ...r.use] : inherited;
    if (r.view || r.layout || r.server) {
      out.push({ path: here, use: composed });
    }
    if (r.children) {
      out.push(...collectRouteUse(r.children, here === '/' ? '' : here, composed));
    }
  }
  return out;
}
```

Wire it into `defineRoutes`:

```tsx
  return {
    tree,
    flat: flattenTree(tree, viewCache, keyCache),
    serverImports: collectServerImports(tree),
    serverRoutes: collectServerRoutes(tree),
    routeUse: collectRouteUse(tree),
  };
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-routes-server.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes-server.test.tsx
git commit -m "feat(iso): precompute composed routeUse on the manifest"
```

---

### Task 3: Render-side guard hosting (node `use` gates render)

**Files:**
- Modify: `packages/iso/src/define-routes.tsx` (`getOrCreateLazyView`/`makeLayoutGroupComponent`/`buildInnerRoutes`/`flattenTree`)
- Test: `packages/iso/src/__tests__/page-guards-render.test.tsx` (new)

This is the largest task. The render builder gains a `pendingUse` accumulator: it is appended with each bare-grouping's `use` as the walk descends, and applied (with the node's own `use`) at the first node that renders a component (leaf or layout group). Leaves wrap their view in a `PageMiddlewareHost`; layout groups wrap inside `makeLayoutGroupComponent` using the layout's own derived location.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/page-guards-render.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import { render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';
import { defineClientMiddleware } from '../define-middleware.js';
import { redirect } from '../outcomes.js';

const leaf = (text: string) => () =>
  Promise.resolve({ default: () => h('div', null, text) });
const passLayout = () =>
  Promise.resolve({
    default: ({ children }: { children: unknown }) => children as never,
  });

describe('node use gates the render', () => {
  it('a client guard on a grouping redirects descendants', async () => {
    const denyAll = defineClientMiddleware(async () => {
      throw redirect('/login');
    });
    const routes = defineRoutes([
      { path: '/login', view: leaf('LOGIN') },
      {
        path: '/area',
        use: [denyAll],
        children: [{ path: 'secret', view: leaf('SECRET') }],
      },
    ]);
    const { queryByText } = render(
      h(LocationProvider as never, { url: '/area/secret' }, h(Routes, { routes }))
    );
    // The guard short-circuits, so SECRET never commits.
    await waitFor(() => {
      expect(queryByText('SECRET')).toBeNull();
    });
  });

  it('an unguarded sibling renders normally', async () => {
    const routes = defineRoutes([
      { path: '/login', view: leaf('LOGIN') },
      {
        path: '/area',
        use: [
          defineClientMiddleware(async () => {
            throw redirect('/login');
          }),
        ],
        children: [{ path: 'secret', view: leaf('SECRET') }],
      },
    ]);
    const { findByText } = render(
      h(LocationProvider as never, { url: '/login' }, h(Routes, { routes }))
    );
    expect(await findByText('LOGIN')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/page-guards-render.test.tsx`
Expected: FAIL — `SECRET` renders because `use` is not yet applied on the render side.

- [ ] **Step 3: Implement the host-wrapping + `pendingUse` threading**

In `define-routes.tsx` add the host import and a wrap helper:

```tsx
import { PageMiddlewareHost } from './internal/page-middleware-host.js';
import type { PageUse } from './internal/use-types.js';

// Wrap a leaf view in a page-middleware host carrying the node's composed
// page-layer `use`. Identity is recomputed per registration; leaves are
// registered once each, so the shared-component memo (getOrCreateLazyView)
// is unaffected. No-op when there is nothing to run.
function withLeafGuard(
  component: ComponentType<ViewProps>,
  use: PageUse
): ComponentType<ViewProps> {
  if (use.length === 0) return component;
  const Guarded: ComponentType<ViewProps> = (location) =>
    h(
      PageMiddlewareHost as ComponentType<{
        use: PageUse;
        location: ViewProps;
        children: VNode<any>;
      }>,
      { use, location },
      h(component, location)
    );
  Guarded.displayName = `Guarded(${component.displayName ?? component.name ?? 'View'})`;
  return Guarded;
}
```

Give `makeLayoutGroupComponent` a `guardUse` parameter and wrap its output. Change its signature and the `Wrapper` return:

```tsx
function makeLayoutGroupComponent(
  layoutImport: NonNullable<RouteDef['layout']>,
  server: RouteDef['server'] | undefined,
  layoutPathPattern: string,
  children: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  guardUse: PageUse
): ComponentType<ViewProps> {
  return asViewComponent(
    lazy(async () => {
      const [{ default: Layout }, serverMod] = await Promise.all([
        layoutImport(),
        server ? server() : Promise.resolve(undefined),
      ]);
      const inner = buildInnerRoutes(children, viewCache);
      const Wrapper: ComponentType<ViewProps> = (location) => {
        const layoutLocation = deriveLayoutLocation(location, layoutPathPattern);
        const layoutNode = h(
          Layout,
          null,
          h(
            asRouteComponent(Router),
            { onLoadStart: __noteLoadStart, onLoadEnd: __noteLoadEnd },
            ...inner
          )
        );
        const withLocations = wrapWithRouteLocations(
          serverMod,
          layoutLocation,
          layoutNode
        );
        return guardUse.length === 0
          ? withLocations
          : h(
              PageMiddlewareHost as ComponentType<{
                use: PageUse;
                location: ViewProps;
                children: VNode<any>;
              }>,
              { use: guardUse, location: layoutLocation },
              withLocations
            );
      };
      return { default: Wrapper };
    })
  );
}
```

Rewrite `buildInnerRoutes` to thread `pendingUse` and recurse generally through bare groupings (replacing the view-leaves-only inlining):

```tsx
function buildInnerRoutes(
  children: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  pendingUse: PageUse = []
): VNode<any>[] {
  const nodes: VNode<any>[] = [];
  for (const child of children) {
    const ownUse: PageUse = child.use
      ? [...pendingUse, ...child.use]
      : pendingUse;
    if (child.view) {
      const component = withLeafGuard(
        getOrCreateLazyView(child.view, child.server, viewCache),
        ownUse
      );
      nodes.push(h(Route, { path: child.path, component: asRouteComponent(component) }));
    } else if (child.layout && child.children) {
      const Group = makeLayoutGroupComponent(
        child.layout,
        child.server,
        child.path,
        child.children,
        viewCache,
        ownUse
      );
      nodes.push(h(Route, { path: child.path, component: asRouteComponent(Group) }));
      nodes.push(
        h(Route, { path: child.path + '/*', component: asRouteComponent(Group) })
      );
    } else if (child.children) {
      // Bare grouping: prefix child paths and carry `use` down. A grouping
      // may now contain nested layouts/groupings, not just view leaves.
      const prefixed = child.children.map((grand) => ({
        ...grand,
        path: child.path === '' ? grand.path : child.path + '/' + grand.path,
      }));
      nodes.push(...buildInnerRoutes(prefixed, viewCache, ownUse));
    }
  }
  return nodes;
}
```

Rewrite `flattenTree` to thread `pendingUse` and host-wrap the same way:

```tsx
function flattenTree(
  routes: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>,
  keyCache: Map<ComponentType<ViewProps>, string>,
  parentPath = '',
  pendingUse: PageUse = []
): FlatRoute[] {
  const keyFor = (c: ComponentType<ViewProps>): string => {
    let k = keyCache.get(c);
    if (!k) {
      k = `r${keyCache.size}`;
      keyCache.set(c, k);
    }
    return k;
  };
  const out: FlatRoute[] = [];
  for (const r of routes) {
    const here =
      parentPath === '' ? r.path : parentPath + (r.path === '' ? '' : '/' + r.path);
    const ownUse: PageUse = r.use ? [...pendingUse, ...r.use] : pendingUse;

    if (r.view) {
      const component = withLeafGuard(
        getOrCreateLazyView(r.view, r.server, viewCache),
        ownUse
      );
      out.push({ path: here, component, key: keyFor(component) });
    } else if (r.layout && r.children) {
      const Group = makeLayoutGroupComponent(
        r.layout,
        r.server,
        here,
        r.children,
        viewCache,
        ownUse
      );
      const key = keyFor(Group);
      out.push({ path: here, component: Group, key });
      out.push({ path: here + '/*', component: Group, key });
    } else if (r.children) {
      const childParent = here === '/' ? '' : here;
      out.push(...flattenTree(r.children, viewCache, keyCache, childParent, ownUse));
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/page-guards-render.test.tsx src/__tests__/define-routes.test.tsx`
Expected: PASS for both files (the new render tests and the existing route tests, including the `/docs` + `/docs/*` shared-component behavior).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/page-guards-render.test.tsx
git commit -m "feat(iso): apply node \`use\` as nested page-middleware hosts on render"
```

---

### Task 4: Server `makePageUseResolver` from the manifest + generated-entry wiring

**Files:**
- Modify: `packages/server/src/route-server-modules.ts`
- Modify: `packages/server/src/internal-runtime.ts`
- Modify: `packages/vite/src/server-entry.ts` (`generateCoreAppModule`)
- Test: `packages/server/src/__tests__/page-use-resolver.test.ts` (new)
- Test: `packages/vite/src/__tests__/server-entry.test.ts`

- [ ] **Step 1: Write the failing server test**

Create `packages/server/src/__tests__/page-use-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makePageUseResolver } from '../route-server-modules.js';

const a = { __kind: 'middleware', runs: 'server', fn: async () => {} } as const;
const b = { __kind: 'middleware', runs: 'server', fn: async () => {} } as const;

// Minimal manifest stub: the resolver only reads `routeUse`.
const manifest = {
  routeUse: [
    { path: '/demo/projects', use: [a] },
    { path: '/demo/projects/:projectId', use: [a, b] },
    { path: '/demo/login', use: [] },
  ],
} as never;

describe('makePageUseResolver', () => {
  it('returns the composed use for the most specific matching pattern', () => {
    const r = makePageUseResolver(manifest);
    expect(r.byPath('/demo/projects')).toEqual([a]);
    expect(r.byPath('/demo/projects/42')).toEqual([a, b]);
  });
  it('returns [] for an unguarded path and for no match', () => {
    const r = makePageUseResolver(manifest);
    expect(r.byPath('/demo/login')).toEqual([]);
    expect(r.byPath('/nope')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/page-use-resolver.test.ts`
Expected: FAIL — `makePageUseResolver` is not exported.

- [ ] **Step 3: Replace `makePageUseResolvers` with `makePageUseResolver`**

In `route-server-modules.ts`, delete `makePageUseResolvers`, `pageUseFromMod`, and `PageUseModule`; keep `routeServerModules`. Add:

```ts
import type { RoutesManifest } from '@hono-preact/iso';
import { findBestPattern } from './route-pattern.js';

/**
 * Build the page-layer `use` resolver from the route manifest. The composed
 * `use` per pattern is static tree data (`manifest.routeUse`), so this is a
 * synchronous lookup: match the request URL to the most specific pattern and
 * return its array (empty when nothing matches or the route is unguarded).
 *
 * NOTE: framework-private. The only intended consumer is the generated server
 * entry.
 */
export function makePageUseResolver(manifest: RoutesManifest): {
  byPath: (path: string) => ReadonlyArray<unknown>;
} {
  const map = new Map(manifest.routeUse.map((r) => [r.path, r.use]));
  return {
    byPath(path: string) {
      const pattern = findBestPattern(map.keys(), path);
      return pattern === null ? [] : (map.get(pattern) ?? []);
    },
  };
}
```

Update `internal-runtime.ts`:

```ts
export {
  routeServerModules,
  makePageUseResolver,
} from './route-server-modules.js';
export { makePageActionResolvers } from './page-action-resolvers.js';
```

In `server-entry.ts`, change the import block and the resolver construction inside `generateCoreAppModule`:

```ts
    `import {\n` +
    `  makePageActionResolvers,\n` +
    `  makePageUseResolver,\n` +
    `  routeServerModules,\n` +
    `} from 'hono-preact/server/internal/runtime';\n` +
```

```ts
    `const serverModules = routeServerModules(routes);\n` +
    `const pageUseResolver = makePageUseResolver(routes);\n` +
    `const pageActionResolvers = makePageActionResolvers(routes.serverRoutes, { dev });\n` +
```

And the two wiring lines:

```ts
    `  .post('${LOADERS_RPC_PATH}', loadersHandler(serverModules, { dev, appConfig, resolvePageUse: pageUseResolver.byPath }))\n` +
    `  .post('*', pageActionHandler({\n` +
    `    resolverByPath: pageActionResolvers.byPath,\n` +
    `    resolvePageUseByPath: pageUseResolver.byPath,\n` +
```

- [ ] **Step 4: Update the server-entry test and run all three packages' affected tests**

In `packages/vite/src/__tests__/server-entry.test.ts`, update the string assertions that reference `makePageUseResolvers`/`pageUseResolvers` to `makePageUseResolver`/`pageUseResolver` (search the file for `PageUse`). Then:

Run: `pnpm --filter @hono-preact/server exec vitest run && pnpm --filter @hono-preact/vite exec vitest run src/__tests__/server-entry.test.ts`
Expected: PASS. (Any `route-server-modules`/`makePageUseResolvers` server tests must be deleted or rewritten against `makePageUseResolver`; search `packages/server/src/__tests__` for `makePageUseResolvers`.)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry.test.ts
git commit -m "feat(server): resolve page-layer use from the manifest routeUse map"
```

---

### Task 5: Site migration to node `use`

**Files:**
- Modify: `apps/site/src/routes.ts`
- Modify: `apps/site/src/pages/demo/projects.server.ts`, `project-issues.server.ts`, `issue.server.ts`
- Modify: `apps/site/src/pages/demo/projects.tsx:96`, `project-issues.tsx:73`, `issue.tsx:247`

- [ ] **Step 1: Restructure `routes.ts`**

Import `requireSession` and nest the protected routes under a guarded `projects` grouping. Replace the `/demo` node's children in the `routeTree`:

```ts
import { requireSession } from './demo/guard.js';
```

```ts
  {
    path: '/demo',
    layout: () => import('./pages/demo/demo-layout.js'),
    children: [
      { path: '', view: () => import('./pages/demo/index.js') },
      {
        path: 'login',
        view: () => import('./pages/demo/login.js'),
        server: () => import('./pages/demo/login.server.js'),
      },
      {
        path: 'projects',
        use: requireSession,
        children: [
          {
            path: '',
            view: () => import('./pages/demo/projects.js'),
            server: () => import('./pages/demo/projects.server.js'),
          },
          {
            path: ':projectId',
            layout: () => import('./pages/demo/project-layout.js'),
            children: [
              {
                path: '',
                view: () => import('./pages/demo/project-issues.js'),
                server: () => import('./pages/demo/project-issues.server.js'),
              },
              {
                path: 'issues/:issueId',
                view: () => import('./pages/demo/issue.js'),
                server: () => import('./pages/demo/issue.server.js'),
              },
            ],
          },
        ],
      },
    ],
  },
```

- [ ] **Step 2: Remove `pageUse` from the three `.server.ts` files**

In `projects.server.ts`, `project-issues.server.ts`, `issue.server.ts`, delete the `import { requireSession } …` line and the `export const pageUse = requireSession;` line (and the explanatory comment above it). Leave `serverLoaders` / `serverActions` and any other imports intact.

- [ ] **Step 3: Drop the `use` argument from the three `definePage` calls**

- `projects.tsx:96` → `export default definePage(ProjectsView);`
- `project-issues.tsx:73` → `export default definePage(ProjectIssuesView);`
- `issue.tsx:247` → `export default definePage(IssueView);`

Remove the now-unused `requireSession` import from each `.tsx` (keep `DEMO_AUTHED_KEY` where still used, e.g. `projects.tsx`).

- [ ] **Step 4: Verify the site builds, typechecks, and the typed-params registration still resolves**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm --filter site build && pnpm typecheck`
Expected: PASS. The matched URLs are unchanged, so `RoutePaths<typeof routeTree>` and `typed-route-params.assert.ts` still hold. (`definePage` still accepts a single arg; its `use` option is removed in task 6, so passing none now is already valid.)

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/routes.ts apps/site/src/pages/demo
git commit -m "refactor(site): single-source the demo auth guard via node \`use\`"
```

---

### Task 6: Remove `definePage`'s `use` option

**Files:**
- Modify: `packages/iso/src/define-page.tsx`
- Test: `packages/iso/src/__tests__/` (any `define-page`/`page` test referencing `use`)

- [ ] **Step 1: Write/adjust the failing test**

In the relevant define-page test (search `packages/iso/src/__tests__` for `definePage` + `use`), assert the option is gone — e.g. that `PageBindings` has no `use`. If a test passed `{ use: [...] }` to `definePage`, change it to assert a type error is no longer the contract by removing that usage; add:

```tsx
it('definePage accepts only Wrapper and errorFallback bindings', () => {
  // @ts-expect-error `use` is no longer a definePage binding
  definePage(() => null, { use: [] });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-page.test.tsx`
Expected: FAIL — `@ts-expect-error` is unsatisfied because `use` is still accepted. (Vitest type errors surface via the build; if the file is not typechecked by vitest, this assertion is validated by `pnpm typecheck` in task 9. Keep the assertion regardless.)

- [ ] **Step 3: Remove `use` from `definePage`**

Rewrite `define-page.tsx`:

```tsx
import type { ComponentType, FunctionComponent, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import { Page, type WrapperProps } from './page.js';

export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
};

export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = (location) => (
    <Page
      Wrapper={bindings?.Wrapper}
      errorFallback={bindings?.errorFallback}
      location={location}
    >
      <Component />
    </Page>
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
```

`Page` keeps its `use?: PageUse` prop (now always undefined from `definePage`); the route builder is the sole supplier of page-layer `use`. No change to `page.tsx`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-page.tsx packages/iso/src/__tests__
git commit -m "refactor(iso): remove definePage \`use\` (node \`use\` is the source)"
```

---

### Task 7: Drop `pageUse` from the `.server.*` exports contract

**Files:**
- Modify: `packages/vite/src/server-exports-contract.ts`
- Test: `packages/vite/src/__tests__/server-loaders-parser.test.ts`

- [ ] **Step 1: Update the failing test**

In `server-loaders-parser.test.ts`, change the recognized-use-export assertions (lines ~159-163):

```ts
it('lists the recognized use-export names', () => {
  expect(RECOGNIZED_USE_EXPORTS.has('pageUse')).toBe(false);
  expect(RECOGNIZED_USE_EXPORTS.has('loaderUse')).toBe(true);
  expect(RECOGNIZED_USE_EXPORTS.has('actionUse')).toBe(true);
});
```

Update the two tests that use `pageUse` as the example named export (the "detects a top-level pageUse named export" and "parseServerLoaders ignores a sibling pageUse export" blocks) to use `loaderUse` instead, so they still exercise `hasNamedUseExport`/sibling-skipping with a name that remains recognized.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/server-loaders-parser.test.ts`
Expected: FAIL — `pageUse` is still in the set.

- [ ] **Step 3: Remove `pageUse` from both lists**

In `server-exports-contract.ts`, drop `'pageUse'` from `RECOGNIZED_SERVER_EXPORTS` and `RECOGNIZED_USE_EXPORTS`, and update the comments so they no longer describe `pageUse` as load-bearing:

```ts
export const RECOGNIZED_SERVER_EXPORTS = [
  'serverActions',
  'serverLoaders',
  'loaderUse',
  'actionUse',
] as const;
```

```ts
export const RECOGNIZED_USE_EXPORTS = ['loaderUse', 'actionUse'] as const;
```

Adjust the status comment: `serverLoaders`/`serverActions` are the value-bearing exports; `loaderUse`/`actionUse` remain reserved (handlers don't read them); remove the `pageUse` paragraph. Page-layer middleware now lives as `use` on the route node.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @hono-preact/vite exec vitest run`
Expected: PASS. (A `.server.*` that still exports `pageUse` now fails `server-loader-validation` as an unrecognized export, which is intended; the site no longer does, having migrated in task 5.)

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-exports-contract.ts packages/vite/src/__tests__/server-loaders-parser.test.ts
git commit -m "refactor(vite): drop \`pageUse\` from the .server.* exports contract"
```

---

### Task 8: Documentation

**Files:**
- Modify: `apps/site/src/pages/docs/middleware.mdx`
- Modify (sweep): `apps/site/src/pages/docs/{structure,actions,active-links,hono-middleware}.mdx` and the routing/layouts docs

Read `.claude/skills/add-docs-page.md` first (local skill) and follow its template rules; the docs-template-check hook soft-warns on drift.

- [ ] **Step 1: Rewrite the page-layer sections of `middleware.mdx`**

- Replace the "Page" row of the three-layers table so it reads: declared as `use` on the route node in `src/routes.ts`; wraps the matched node's render and its loaders/actions.
- Delete the "Why two declarations for the page layer" section entirely (there is now one declaration).
- Rewrite "Nested routes compose down the tree" around node `use`: a `use` on any node gates that node and every descendant, composed outer-to-inner, with a `defineRoutes` example using a guarded grouping or layout node. Remove the `export const pageUse = ...` example.
- Update the page-layer code example to show `use` on the route node rather than `definePage({ use })` + `pageUse`.
- Per house style (`feedback_docs_no_migration_breadcrumbs`), describe what the API is; do not write "formerly `pageUse`" or "replaces the old two-declaration model".

- [ ] **Step 2: Sweep remaining `pageUse` references**

Run: `rg -n "pageUse|definePage\(.*use" apps/site/src/pages/docs`
Edit each hit so docs describe `use` on the route node. Document `RouteDef.use` (inheritance + opt-out-by-position) in the routing/layouts doc that introduces `defineRoutes`.

- [ ] **Step 3: Verify the docs build and templates**

Run: `pnpm --filter site build`
Expected: PASS. Manually confirm `rg -n "pageUse" apps/site/src/pages/docs` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs
git commit -m "docs(site): document single-source node \`use\` page guards"
```

---

### Task 9: Hole-closure regression test + full pre-push CI

**Files:**
- Test: `packages/iso/src/__tests__/define-routes-server.test.tsx` (add the structural regression)
- Test/verify: integration suite + the six-step CI mirror

- [ ] **Step 1: Add the hole-closure regression test**

This asserts the drift class is structurally gone: a route with a `server` module under a guarded ancestor gets the guard in `routeUse` with no `pageUse` export anywhere.

```tsx
it('a server-bearing leaf under a guarded grouping is gated with no pageUse export', () => {
  const gate = defineServerMiddleware(async (_c, next) => next());
  const m = defineRoutes([
    {
      path: '/admin',
      use: [gate],
      children: [{ path: 'data', view: noopView, server: noopServer }],
    },
  ]);
  const byPath = new Map(m.routeUse.map((r) => [r.path, r.use]));
  // The loader RPC for /admin/data resolves to the gate purely from the tree.
  expect(byPath.get('/admin/data')).toEqual([gate]);
});
```

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-routes-server.test.tsx`
Expected: PASS.

- [ ] **Step 2: Run the integration suite**

Run: `pnpm test:integration`
Expected: PASS. If a demo integration test asserted the old `pageUse` redirect path by name, update it to the node-`use` flow; the observable behavior (redirect on render and on direct loader/action RPC for `/demo/projects*`) is unchanged.

- [ ] **Step 3: Run the full six-step pre-push CI mirror (per CLAUDE.md)**

Run in order:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all PASS. If `format:check` fails, run `pnpm format` and commit. Do not proceed to PR until all six are green.

- [ ] **Step 4: Commit any format fixes**

```bash
git add -A
git commit -m "test: hole-closure regression + format for single-source page guards"
```

---

## Self-Review

**Spec coverage:**
- `RouteDef.use` single source — Task 1. ✓
- Inheritance via tree nesting (compose outer-to-inner) — Tasks 2 (server data) + 3 (render). ✓
- Render path: nested `PageMiddlewareHost`, reuse existing host — Task 3. ✓
- Server path: manifest `routeUse` + shared matcher; gate descendants from a guard on a non-server ancestor — Tasks 2, 4, 9. ✓
- Framework change: `use` on a bare grouping + recursion in `validate`/`buildInnerRoutes`/`flattenTree` — Tasks 1, 3. ✓
- Remove `definePage({ use })` — Task 6. ✓
- Remove `.server.ts` `pageUse` + contract + parser/validation paths — Tasks 5 (site), 7 (contract). ✓
- Site migration (guarded grouping, drop both old sites) — Task 5. ✓
- Considered/rejected (`defineApp.use`, passthrough layout) — design-only, no task needed. ✓
- Docs rewrite + sweep, no migration breadcrumbs — Task 8. ✓
- Testing strategy (render inheritance, server composition, hole-closure, vite, site) — Tasks 3, 4, 7, 9. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the assertion and the exact command.

**Type/name consistency:** `routeUse: ReadonlyArray<{ path: string; use: PageUse }>` defined in Task 2 and consumed by name in Tasks 4 and 9. `makePageUseResolver` named identically in `route-server-modules.ts`, `internal-runtime.ts`, and `server-entry.ts` (Task 4). `withLeafGuard`, `collectRouteUse`, `guardUse`, `pendingUse`, `ownUse` used consistently in Tasks 2-3. `makeLayoutGroupComponent`'s new `guardUse` parameter is supplied at every call site in both `flattenTree` and `buildInnerRoutes` (Task 3).

**Known intermediate state:** site RPC guards are inactive between Task 4 and Task 5 (documented in the Sequencing note); the full workspace typecheck/integration runs only in Task 9, which is intentional and gated before PR.
