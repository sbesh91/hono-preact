# defineRoutes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `iso.tsx`'s manual `<Router>` + `<Route>` table and `server.tsx`'s `import.meta.glob` calls with a single code-defined route table (`defineRoutes`) that supports nested layouts, declares server-module references explicitly, and serves as the manifest for both client routing and server-side dispatch.

**Architecture:**
- `@hono-preact/iso` exports `defineRoutes(tree)` which validates the tree, stores it as a manifest, and returns a `<Routes>` component plus a `serverModules` accessor. Layouts compose via the DocsRoute pattern (each layout group registers a single shared component at the outer Router with both bare-path and wildcard variants; children dispatch via an inner Router) so layout identity is preserved across intra-group navigation.
- Server-side handlers (`loadersHandler`, `actionsHandler`) gain a tiny adapter (`routeServerModules`) that converts the manifest into the existing glob-shaped input. Handler signatures are unchanged.
- Validation is runtime-only at v0.1 (build-time AST plugin deferred). `defineRoutes` throws on rule violations with the offending path printed.
- Demo app migrates: new `routes.ts`; `Movies` splits into `movies-layout.tsx` + `movies-list.tsx`; `iso.tsx` shrinks to a `<Routes>` consumer; `server.tsx`'s two glob calls become one helper call.

**Tech Stack:** TypeScript, preact-iso (routing primitive), Vitest (tests), Vite + Hono (existing build/server).

**Out of scope for this plan (separate plans cover them):**
- Methods on loader/action refs (`loader.useData()`, `loader.invalidate()`).
- `defineApp()` for `vite.config.ts`.
- Framework-provided client entry (so `iso.tsx` stays as a thin user file).
- Streaming loaders, single guards list, package consolidation.
- Build-time AST validation plugin (runtime validation only here).
- Moving non-`/movies` pages into `views/` (only `/movies` splits; everything else stays put).

---

## File Map

**Create:**
- `packages/iso/src/define-routes.tsx` — `defineRoutes`, types, flatten + wrap algorithm, `<Routes>` component, `serverModules` accessor.
- `packages/iso/src/__tests__/define-routes.test.tsx` — unit tests for validation, flatten, composition, server-module extraction.
- `packages/server/src/route-server-modules.ts` — adapter from a `RoutesManifest` to a `LazyGlob` shape.
- `packages/server/src/__tests__/route-server-modules.test.ts` — adapter tests.
- `apps/app/src/routes.ts` — the new route table.
- `apps/app/src/pages/movies-layout.tsx` — extracted layout wrapper.
- `apps/app/src/pages/movies-list.tsx` — extracted list view (former `Movies` body without inner Router/header).
- `apps/app/src/pages/movies-list.server.ts` — renamed from `movies.server.ts` (so the loader's path-derived module key matches the new file name).

**Modify:**
- `packages/iso/src/index.ts` — export `defineRoutes`, `Routes`, `RouteDef`, `LayoutProps`, `ViewProps`, `RoutesManifest`.
- `packages/server/src/index.ts` — export `routeServerModules`.
- `apps/app/src/iso.tsx` — replace the `<Router>` + manual `<Route>` table with `<Routes routes={routes} />`.
- `apps/app/src/server.tsx` — replace the two `import.meta.glob` calls with `routeServerModules(routes)`.

**Delete:**
- `apps/app/src/pages/movies.tsx` — replaced by `movies-layout.tsx` + `movies-list.tsx`.
- `apps/app/src/pages/movies.server.ts` — renamed to `movies-list.server.ts`.

---

## Type Reference (used across multiple tasks)

```ts
import type { ComponentChildren, ComponentType, JSX } from 'preact';

export type LayoutProps = { children: ComponentChildren };

export type ViewProps<P = Record<string, string>> = {
  params: P;
};

type LazyImport<T> = () => Promise<{ default: T }>;
type LazyServerImport = () => Promise<unknown>;

export type RouteDef = {
  path: string;
  view?: LazyImport<ComponentType<ViewProps>>;
  layout?: LazyImport<ComponentType<LayoutProps>>;
  server?: LazyServerImport;
  children?: RouteDef[];
  fallback?: JSX.Element;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
};

export type RoutesManifest = {
  /** The original tree, retained for introspection / devtools. */
  tree: ReadonlyArray<RouteDef>;
  /** Flat list of `{ path, component }` pairs ready for `preact-iso`. */
  flat: ReadonlyArray<FlatRoute>;
  /** All `server` references in the tree, for handler dispatch. */
  serverImports: ReadonlyArray<LazyServerImport>;
};

export type FlatRoute = {
  path: string;
  component: ComponentType;
  fallback?: JSX.Element;
  errorFallback?: RouteDef['errorFallback'];
};
```

---

## Task 1: Define types and validation rules

**Files:**
- Create: `packages/iso/src/define-routes.tsx`
- Create: `packages/iso/src/__tests__/define-routes.test.tsx`

- [ ] **Step 1: Write failing tests for validation rules**

```tsx
// packages/iso/src/__tests__/define-routes.test.tsx
import { describe, it, expect } from 'vitest';
import { defineRoutes } from '../define-routes.js';

const noopView = () => Promise.resolve({ default: () => null });
const noopLayout = () => Promise.resolve({ default: ({ children }: { children: unknown }) => children as never });
const noopServer = () => Promise.resolve({});

describe('defineRoutes validation', () => {
  it('accepts a leaf route with view', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView }])
    ).not.toThrow();
  });

  it('accepts a leaf with view + server', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView, server: noopServer }])
    ).not.toThrow();
  });

  it('accepts a layout with children', () => {
    expect(() =>
      defineRoutes([
        { path: '/x', layout: noopLayout, children: [{ path: '', view: noopView }] },
      ])
    ).not.toThrow();
  });

  it('accepts a path-grouping route (children, no view, no layout)', () => {
    expect(() =>
      defineRoutes([
        { path: '/admin', children: [{ path: 'users', view: noopView }] },
      ])
    ).not.toThrow();
  });

  it('rejects view + layout', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView, layout: noopLayout, children: [] }])
    ).toThrow(/cannot declare both `view` and `layout`/);
  });

  it('rejects view + children', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView, children: [{ path: 'x', view: noopView }] }])
    ).toThrow(/`view` route cannot have `children`/);
  });

  it('rejects layout without children', () => {
    expect(() =>
      defineRoutes([{ path: '/', layout: noopLayout }])
    ).toThrow(/`layout` requires `children`/);
  });

  it('rejects layout + server', () => {
    expect(() =>
      defineRoutes([
        { path: '/', layout: noopLayout, server: noopServer, children: [{ path: '', view: noopView }] },
      ])
    ).toThrow(/`layout` cannot declare `server`/);
  });

  it('rejects child path starting with `/`', () => {
    expect(() =>
      defineRoutes([
        { path: '/x', layout: noopLayout, children: [{ path: '/y', view: noopView }] },
      ])
    ).toThrow(/child path must not start with `\/`/);
  });

  it('error messages include the offending path', () => {
    expect(() =>
      defineRoutes([{ path: '/broken', layout: noopLayout }])
    ).toThrow(/\/broken/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/iso/src/__tests__/define-routes.test.tsx`
Expected: FAIL with "Cannot find module '../define-routes.js'".

- [ ] **Step 3: Create the file with types + validation only**

```tsx
// packages/iso/src/define-routes.tsx
import type { ComponentChildren, ComponentType, JSX } from 'preact';

export type LayoutProps = { children: ComponentChildren };

export type ViewProps<P = Record<string, string>> = {
  params: P;
};

type LazyImport<T> = () => Promise<{ default: T }>;
type LazyServerImport = () => Promise<unknown>;

export type RouteDef = {
  path: string;
  view?: LazyImport<ComponentType<ViewProps>>;
  layout?: LazyImport<ComponentType<LayoutProps>>;
  server?: LazyServerImport;
  children?: RouteDef[];
  fallback?: JSX.Element;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
};

export type FlatRoute = {
  path: string;
  component: ComponentType;
  fallback?: JSX.Element;
  errorFallback?: RouteDef['errorFallback'];
};

export type RoutesManifest = {
  tree: ReadonlyArray<RouteDef>;
  flat: ReadonlyArray<FlatRoute>;
  serverImports: ReadonlyArray<LazyServerImport>;
};

function validate(routes: ReadonlyArray<RouteDef>, parentPath = ''): void {
  for (const r of routes) {
    const here = parentPath + (r.path.startsWith('/') ? r.path : '/' + r.path);
    const hasView = !!r.view;
    const hasLayout = !!r.layout;
    const hasChildren = !!(r.children && r.children.length > 0);
    const hasServer = !!r.server;

    if (hasView && hasLayout) {
      throw new Error(`Route ${here}: cannot declare both \`view\` and \`layout\`.`);
    }
    if (hasView && hasChildren) {
      throw new Error(`Route ${here}: \`view\` route cannot have \`children\`.`);
    }
    if (hasLayout && !hasChildren) {
      throw new Error(`Route ${here}: \`layout\` requires \`children\`.`);
    }
    if (hasLayout && hasServer) {
      throw new Error(`Route ${here}: \`layout\` cannot declare \`server\` (one loader per leaf).`);
    }
    if (!hasView && !hasLayout && !hasChildren) {
      throw new Error(`Route ${here}: must declare \`view\`, \`layout\`+\`children\`, or \`children\`.`);
    }

    if (parentPath !== '' && r.path.startsWith('/')) {
      throw new Error(`Route ${here}: child path must not start with \`/\`.`);
    }

    if (hasChildren) validate(r.children!, here === '/' ? '' : here);
  }
}

export function defineRoutes(tree: RouteDef[]): RoutesManifest {
  validate(tree);
  return {
    tree,
    flat: [],         // populated in Task 3
    serverImports: [], // populated in Task 3
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/iso/src/__tests__/define-routes.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes.test.tsx
git commit -m "feat(iso): defineRoutes types and runtime validation"
```

---

## Task 2: Collect server imports from the tree

**Files:**
- Modify: `packages/iso/src/define-routes.tsx`
- Modify: `packages/iso/src/__tests__/define-routes.test.tsx`

- [ ] **Step 1: Append failing tests**

Append to `packages/iso/src/__tests__/define-routes.test.tsx`:

```tsx
describe('serverImports collection', () => {
  it('collects server imports from leaves at any depth', () => {
    const s1 = () => Promise.resolve({ tag: 's1' });
    const s2 = () => Promise.resolve({ tag: 's2' });
    const m = defineRoutes([
      { path: '/', view: noopView, server: s1 },
      {
        path: '/x',
        layout: noopLayout,
        children: [{ path: 'y', view: noopView, server: s2 }],
      },
    ]);
    expect(m.serverImports).toHaveLength(2);
    expect(m.serverImports).toContain(s1);
    expect(m.serverImports).toContain(s2);
  });

  it('returns an empty list when no routes have server imports', () => {
    const m = defineRoutes([{ path: '/', view: noopView }]);
    expect(m.serverImports).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/iso/src/__tests__/define-routes.test.tsx`
Expected: FAIL — `serverImports` is empty array.

- [ ] **Step 3: Implement `collectServerImports`**

In `packages/iso/src/define-routes.tsx`, add before `defineRoutes`:

```tsx
function collectServerImports(routes: ReadonlyArray<RouteDef>): LazyServerImport[] {
  const out: LazyServerImport[] = [];
  const walk = (rs: ReadonlyArray<RouteDef>) => {
    for (const r of rs) {
      if (r.server) out.push(r.server);
      if (r.children) walk(r.children);
    }
  };
  walk(routes);
  return out;
}
```

Then update `defineRoutes` body:

```tsx
export function defineRoutes(tree: RouteDef[]): RoutesManifest {
  validate(tree);
  return {
    tree,
    flat: [],
    serverImports: collectServerImports(tree),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/iso/src/__tests__/define-routes.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes.test.tsx
git commit -m "feat(iso): collect serverImports from defineRoutes tree"
```

---

## Task 3: Flatten the route tree (no layouts yet)

**Files:**
- Modify: `packages/iso/src/define-routes.tsx`
- Modify: `packages/iso/src/__tests__/define-routes.test.tsx`

- [ ] **Step 1: Append failing tests**

```tsx
describe('flatten — flat (no layouts)', () => {
  it('emits one FlatRoute per leaf with full URL path', () => {
    const m = defineRoutes([
      { path: '/', view: noopView },
      { path: '/about', view: noopView },
      { path: '*', view: noopView },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/', '/about', '*']);
  });

  it('preserves source order in the flat list', () => {
    const m = defineRoutes([
      { path: '/b', view: noopView },
      { path: '/a', view: noopView },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/b', '/a']);
  });

  it('attaches fallback and errorFallback per leaf', () => {
    const fb = { type: 'p', props: {}, key: null } as unknown as JSX.Element;
    const m = defineRoutes([
      { path: '/', view: noopView, fallback: fb },
    ]);
    expect(m.flat[0].fallback).toBe(fb);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — `flat` is empty.

- [ ] **Step 3: Implement flat-only flattening**

Add helper before `defineRoutes`:

```tsx
import { lazy } from 'preact-iso';

function flattenFlat(routes: ReadonlyArray<RouteDef>, parentPath = ''): FlatRoute[] {
  const out: FlatRoute[] = [];
  for (const r of routes) {
    const here =
      parentPath === ''
        ? r.path
        : parentPath + (r.path === '' ? '' : '/' + r.path);
    if (r.view) {
      out.push({
        path: here,
        component: lazy(r.view),
        fallback: r.fallback,
        errorFallback: r.errorFallback,
      });
    }
    // Layouts handled in Task 4.
  }
  return out;
}
```

Update `defineRoutes`:

```tsx
export function defineRoutes(tree: RouteDef[]): RoutesManifest {
  validate(tree);
  return {
    tree,
    flat: flattenFlat(tree),
    serverImports: collectServerImports(tree),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run the test file again. Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes.test.tsx
git commit -m "feat(iso): flatten leaf-only routes for preact-iso registration"
```

---

## Task 4: Lower nested layouts using the inner-router pattern

**Files:**
- Modify: `packages/iso/src/define-routes.tsx`
- Modify: `packages/iso/src/__tests__/define-routes.test.tsx`

The lowering: for each layout group (a route with `layout` + `children`), create a single shared component that renders `<Layout><InnerRouter>{...children}</InnerRouter></Layout>`. Register that one component at the outer Router under both `/path` and `/path/*` so preact-iso treats intra-group nav as same-component (preserves layout identity). This mirrors the existing DocsRoute pattern in `apps/app`.

- [ ] **Step 1: Append failing tests**

```tsx
describe('flatten — layout groups', () => {
  it('registers a layout group at both bare path and wildcard path', () => {
    const m = defineRoutes([
      {
        path: '/movies',
        layout: noopLayout,
        children: [
          { path: '', view: noopView },
          { path: ':id', view: noopView },
        ],
      },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/movies', '/movies/*']);
    // Same component reference for both:
    expect(m.flat[0].component).toBe(m.flat[1].component);
  });

  it('mixes top-level leaves and layout groups in source order', () => {
    const m = defineRoutes([
      { path: '/', view: noopView },
      {
        path: '/x',
        layout: noopLayout,
        children: [{ path: '', view: noopView }],
      },
      { path: '*', view: noopView },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/', '/x', '/x/*', '*']);
  });

  it('flattens path-grouping routes (no layout) by inlining children', () => {
    const m = defineRoutes([
      {
        path: '/admin',
        children: [
          { path: 'users', view: noopView },
          { path: 'posts', view: noopView },
        ],
      },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/admin/users', '/admin/posts']);
  });

  it('handles nested layouts (layout inside layout)', () => {
    const m = defineRoutes([
      {
        path: '/a',
        layout: noopLayout,
        children: [
          {
            path: 'b',
            layout: noopLayout,
            children: [{ path: '', view: noopView }],
          },
        ],
      },
    ]);
    // Outer layout group exposes itself + wildcard; inner is collapsed
    // into the outer's child router (not at the outer Router).
    expect(m.flat.map((f) => f.path)).toEqual(['/a', '/a/*']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — layout-group lowering not implemented.

- [ ] **Step 3: Implement the layout-group lowering**

Replace the `flattenFlat` function with the full lowering. New imports + helpers:

```tsx
import { Fragment, h } from 'preact';
import { lazy, Route, Router } from 'preact-iso';

/**
 * Build the component for a layout group: <Layout><Router>{childRoutes}</Router></Layout>.
 * Returned via preact-iso's lazy so the layout module loads only when matched.
 * Children are themselves wrapped in preact-iso's lazy via their own `view`/`layout`,
 * so each child remains a separate code-split chunk.
 */
function makeLayoutGroupComponent(
  layoutImport: NonNullable<RouteDef['layout']>,
  children: ReadonlyArray<RouteDef>
): ComponentType {
  return lazy(async () => {
    const Layout = (await layoutImport()).default;
    // Build inner routes lazily — descend into each child.
    const inner = buildInnerRoutes(children);
    const Wrapper: ComponentType = () =>
      h(Layout, null, h(Router, null, ...inner));
    return { default: Wrapper };
  });
}

/**
 * Build the inner <Route> children for a layout group's <Router>. Each child
 * is either a leaf (registered under its relative path) or another layout
 * group (registered under bare + wildcard paths within the inner router).
 */
function buildInnerRoutes(children: ReadonlyArray<RouteDef>): unknown[] {
  const nodes: unknown[] = [];
  for (const child of children) {
    if (child.view) {
      nodes.push(h(Route, { path: child.path, component: lazy(child.view) }));
    } else if (child.layout && child.children) {
      const Group = makeLayoutGroupComponent(child.layout, child.children);
      // Same shared-component trick at this nesting level.
      nodes.push(h(Route, { path: child.path, component: Group }));
      nodes.push(h(Route, { path: child.path + '/*', component: Group }));
    } else if (child.children) {
      // Path-grouping inside a layout: inline child paths into this router.
      for (const grand of child.children) {
        const joined = child.path === '' ? grand.path : child.path + '/' + grand.path;
        if (grand.view) {
          nodes.push(h(Route, { path: joined, component: lazy(grand.view) }));
        }
        // Note: deep recursion of grouping/layouts inside a grouping is rare
        // enough at v0.1 that we keep this one-level. If needed, extend later.
      }
    }
  }
  return nodes;
}

function flattenTree(routes: ReadonlyArray<RouteDef>, parentPath = ''): FlatRoute[] {
  const out: FlatRoute[] = [];
  for (const r of routes) {
    const here =
      parentPath === ''
        ? r.path
        : parentPath + (r.path === '' ? '' : '/' + r.path);

    if (r.view) {
      out.push({
        path: here,
        component: lazy(r.view),
        fallback: r.fallback,
        errorFallback: r.errorFallback,
      });
    } else if (r.layout && r.children) {
      const Group = makeLayoutGroupComponent(r.layout, r.children);
      out.push({
        path: here,
        component: Group,
        fallback: r.fallback,
        errorFallback: r.errorFallback,
      });
      out.push({
        path: here + '/*',
        component: Group,
        fallback: r.fallback,
        errorFallback: r.errorFallback,
      });
    } else if (r.children) {
      // Path-grouping at top level: recurse with the prefix.
      const childParent = here === '/' ? '' : here;
      out.push(...flattenTree(r.children, childParent));
    }
  }
  return out;
}
```

Update `defineRoutes`:

```tsx
export function defineRoutes(tree: RouteDef[]): RoutesManifest {
  validate(tree);
  return {
    tree,
    flat: flattenTree(tree),
    serverImports: collectServerImports(tree),
  };
}
```

Remove the old `flattenFlat` function and `Fragment` import if unused.

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS, 18 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes.test.tsx
git commit -m "feat(iso): lower nested layouts via shared-component inner-router pattern"
```

---

## Task 5: Add the `<Routes>` component

**Files:**
- Modify: `packages/iso/src/define-routes.tsx`
- Modify: `packages/iso/src/__tests__/define-routes.test.tsx`

- [ ] **Step 1: Append failing test**

```tsx
import { render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { Routes } from '../define-routes.js';

describe('<Routes>', () => {
  it('renders a preact-iso Router with one Route per flat entry', () => {
    const Hi: ComponentType = () => h('p', null, 'hi') as unknown as VNode;
    const manifest = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: Hi }) },
    ]);
    const { container } = render(
      h(LocationProvider, null, h(Routes, { routes: manifest })) as VNode
    );
    // The lazy Hi resolves async; the smoke is just that <Routes> renders
    // without throwing and produces the LocationProvider tree.
    expect(container.innerHTML).toBeDefined();
  });
});
```

Add at top of test file if missing:
```tsx
import type { ComponentType, VNode } from 'preact';
import { h } from 'preact';
```

If `@testing-library/preact` is not installed, skip the render test and instead assert that `Routes` is a function and that `<Routes routes={manifest} />` returns a valid VNode (use `h(Routes, { routes: manifest })` and check `vnode.type`/`vnode.props.routes === manifest`).

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — `Routes` not exported.

- [ ] **Step 3: Implement `<Routes>`**

Append to `packages/iso/src/define-routes.tsx`:

```tsx
export const Routes: ComponentType<{ routes: RoutesManifest }> = ({ routes }) => {
  return h(
    Router,
    null,
    ...routes.flat.map((r) =>
      h(Route, { key: r.path, path: r.path, component: r.component })
    )
  );
};
```

(Per-route `fallback`/`errorFallback` are bound to each leaf via the existing `definePage` mechanism in views — Task 9 wires the demo. A standalone Suspense/error boundary wrap is not required at the `<Routes>` level for v0.1.)

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes.test.tsx
git commit -m "feat(iso): <Routes> component consuming a RoutesManifest"
```

---

## Task 6: Export the public surface

**Files:**
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Read current exports**

Run: `cat packages/iso/src/index.ts`
Note the existing `Page`, `definePage`, `Route`, `Router`, `lazy` exports.

- [ ] **Step 2: Add the new exports**

In `packages/iso/src/index.ts`, append (or place alongside other route exports):

```ts
export { defineRoutes, Routes } from './define-routes.js';
export type {
  RouteDef,
  RoutesManifest,
  FlatRoute,
  LayoutProps,
  ViewProps,
} from './define-routes.js';
```

- [ ] **Step 3: Build the package and verify**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/iso && npm run build`
Expected: clean tsc build.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/index.ts
git commit -m "feat(iso): export defineRoutes, Routes, and types"
```

---

## Task 7: Add `routeServerModules` adapter on the server side

**Files:**
- Create: `packages/server/src/route-server-modules.ts`
- Create: `packages/server/src/__tests__/route-server-modules.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/server/src/__tests__/route-server-modules.test.ts
import { describe, it, expect } from 'vitest';
import { defineRoutes } from '@hono-preact/iso';
import { routeServerModules } from '../route-server-modules.js';

describe('routeServerModules', () => {
  it('returns a LazyGlob-shaped record indexed by integer keys', async () => {
    const sA = () => Promise.resolve({ tag: 'A' });
    const sB = () => Promise.resolve({ tag: 'B' });
    const m = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: () => null }), server: sA },
      { path: '/x', view: () => Promise.resolve({ default: () => null }), server: sB },
    ]);
    const glob = routeServerModules(m);
    const keys = Object.keys(glob).sort();
    expect(keys).toEqual(['0', '1']);
    const values = await Promise.all(Object.values(glob).map((fn) => fn()));
    const tags = values.map((v) => (v as { tag: string }).tag).sort();
    expect(tags).toEqual(['A', 'B']);
  });

  it('returns an empty record when no server imports exist', () => {
    const m = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: () => null }) },
    ]);
    expect(routeServerModules(m)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/server/src/__tests__/route-server-modules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

```ts
// packages/server/src/route-server-modules.ts
import type { RoutesManifest } from '@hono-preact/iso';

/**
 * Convert a RoutesManifest into the lazy-glob-shaped record that
 * loadersHandler/actionsHandler accept. Keys are stringified integers and
 * unused at the call site; the handlers iterate over `Object.values(...)`.
 */
export function routeServerModules(
  manifest: RoutesManifest
): Record<string, () => Promise<unknown>> {
  const out: Record<string, () => Promise<unknown>> = {};
  manifest.serverImports.forEach((fn, i) => {
    out[String(i)] = fn;
  });
  return out;
}
```

- [ ] **Step 4: Export it**

In `packages/server/src/index.ts`, add:

```ts
export { routeServerModules } from './route-server-modules.js';
```

- [ ] **Step 5: Build and rerun tests**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/iso && npm run build && cd ../server && npm run build && cd ../.. && npx vitest run packages/server`
Expected: clean build + all server tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/route-server-modules.ts packages/server/src/__tests__/route-server-modules.test.ts packages/server/src/index.ts
git commit -m "feat(server): routeServerModules adapter for handler dispatch"
```

---

## Task 8: Demo — split `Movies` into layout + list

**Files:**
- Create: `apps/app/src/pages/movies-layout.tsx`
- Create: `apps/app/src/pages/movies-list.tsx`
- Create: `apps/app/src/pages/movies-list.server.ts`
- Delete: `apps/app/src/pages/movies.server.ts`

This task only creates the new demo files. Wiring happens in Task 9; the old `movies.tsx` deletion happens in Task 9 too so the build stays green between commits.

- [ ] **Step 1: Create the layout**

```tsx
// apps/app/src/pages/movies-layout.tsx
import type { LayoutProps } from '@hono-preact/iso';

export default function MoviesLayout({ children }: LayoutProps) {
  return (
    <section class="p-1">
      <header class="flex gap-2">
        <a href="/" class="bg-amber-200">home</a>
        <a href="/watched" class="bg-emerald-200">watched</a>
      </header>
      <div class="mt-2">{children}</div>
    </section>
  );
}
```

- [ ] **Step 2: Create the list view**

Copy the `Movies` body from `apps/app/src/pages/movies.tsx`, dropping the outer `<section class="p-1">`, the inline header anchors, and the inner `<Router>`. Result:

```tsx
// apps/app/src/pages/movies-list.tsx
import {
  cacheRegistry,
  definePage,
  useLoaderData,
  useOptimisticAction,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import type { MovieSummary } from '@/server/data/movies.js';
import { loader, cache, serverActions } from './movies-list.server.js';

const MoviesList: FunctionComponent = () => {
  const { movies, watchedIds } = useLoaderData<typeof loader>();

  const { mutate, value: optimisticWatchedIds } = useOptimisticAction(
    serverActions.toggleWatched,
    {
      base: watchedIds,
      apply: (current, payload) =>
        payload.watched
          ? [...current, payload.movieId]
          : current.filter((id) => id !== payload.movieId),
      invalidate: 'auto',
      onSuccess: () => cacheRegistry.invalidate('watched'),
    }
  );

  const watched = new Set(optimisticWatchedIds);

  return (
    <>
      <p>watched: {optimisticWatchedIds.length}</p>
      <ul class="mt-2">
        {movies.results.map((m: MovieSummary) => (
          <li key={m.id} class="border-2 m-1 p-1 flex items-center gap-2">
            <a href={`/movies/${m.id}`} class="flex-1">
              {m.title}{' '}
              {watched.has(m.id) && (
                <span class="text-emerald-600">✓ watched</span>
              )}
            </a>
            <button
              type="button"
              class="bg-blue-500 text-white px-2 py-1 text-sm"
              onClick={() =>
                mutate({ movieId: m.id, watched: !watched.has(m.id) })
              }
            >
              {watched.has(m.id) ? 'Unwatch' : 'Mark watched'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};
MoviesList.displayName = 'MoviesList';

export default definePage(MoviesList, { loader, cache });
```

- [ ] **Step 3: Create the renamed server module**

Copy `apps/app/src/pages/movies.server.ts` to `apps/app/src/pages/movies-list.server.ts` verbatim (the path-derived module key changes from `src/pages/movies` to `src/pages/movies-list`, which is fine since `movies-list` is the new wire identifier).

- [ ] **Step 4: Build the iso package types so the new file resolves**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/iso && npm run build`
Expected: clean.

- [ ] **Step 5: Commit (demo files only — wiring in Task 9)**

```bash
git add apps/app/src/pages/movies-layout.tsx apps/app/src/pages/movies-list.tsx apps/app/src/pages/movies-list.server.ts
git commit -m "feat(app): movies layout + list extracted from movies.tsx"
```

---

## Task 9: Demo — write `routes.ts` and migrate `iso.tsx` + `server.tsx`

**Files:**
- Create: `apps/app/src/routes.ts`
- Modify: `apps/app/src/iso.tsx`
- Modify: `apps/app/src/server.tsx`
- Delete: `apps/app/src/pages/movies.tsx`
- Delete: `apps/app/src/pages/movies.server.ts`

- [ ] **Step 1: Write `routes.ts`**

```ts
// apps/app/src/routes.ts
import { defineRoutes } from '@hono-preact/iso';

export default defineRoutes([
  { path: '/', view: () => import('./pages/home.js') },
  { path: '/test', view: () => import('./pages/test.js') },
  {
    path: '/movies',
    layout: () => import('./pages/movies-layout.js'),
    children: [
      {
        path: '',
        view: () => import('./pages/movies-list.js'),
        server: () => import('./pages/movies-list.server.js'),
      },
      {
        path: ':id',
        view: () => import('./pages/movie.js'),
        server: () => import('./pages/movie.server.js'),
      },
    ],
  },
  {
    path: '/watched',
    view: () => import('./pages/watched.js'),
    server: () => import('./pages/watched.server.js'),
  },
  {
    path: '/docs',
    view: () => import('./components/DocsRoute.js'),
  },
  {
    path: '/docs/*',
    view: () => import('./components/DocsRoute.js'),
  },
  {
    path: '*',
    view: () => import('./pages/not-found.js'),
  },
]);
```

(The `/docs` and `/docs/*` pair retains today's user-land MDX setup verbatim per the spec — collections stay out of v0.1 framework scope.)

- [ ] **Step 2: Replace `iso.tsx` with the `<Routes>` consumer**

```tsx
// apps/app/src/iso.tsx
import type { FunctionComponent } from 'preact';
import { flushSync } from 'preact/compat';
import { Routes } from '@hono-preact/iso';
import routes from './routes.js';

function onRouteChange() {
  document.startViewTransition(() => flushSync(() => {}));
}

export const Base: FunctionComponent = () => {
  // preact-iso's Router accepts onRouteChange via a parent prop; the
  // <Routes> wrapper instantiates that Router internally. To preserve the
  // view-transition behavior, accept a small inline pass-through.
  return <Routes routes={routes} onRouteChange={onRouteChange} />;
};
```

If `Routes` doesn't yet accept `onRouteChange`, add it now: in `packages/iso/src/define-routes.tsx`, change the component to accept and forward the prop:

```tsx
import type { ComponentType } from 'preact';

type RoutesProps = {
  routes: RoutesManifest;
  onRouteChange?: (url: string) => void;
};

export const Routes: ComponentType<RoutesProps> = ({ routes, onRouteChange }) => {
  return h(
    Router,
    onRouteChange ? { onRouteChange } : null,
    ...routes.flat.map((r) =>
      h(Route, { key: r.path, path: r.path, component: r.component })
    )
  );
};
```

Add a test in `packages/iso/src/__tests__/define-routes.test.tsx`:

```tsx
it('forwards onRouteChange to the underlying Router', () => {
  const cb = () => {};
  const m = defineRoutes([{ path: '/', view: noopView }]);
  const vnode = h(Routes, { routes: m, onRouteChange: cb });
  // Smoke: vnode renders a Router-typed element with the callback in props.
  expect(vnode.type).toBe(Routes);
  expect((vnode.props as { onRouteChange?: unknown }).onRouteChange).toBe(cb);
});
```

Rebuild iso: `cd packages/iso && npm run build`.

- [ ] **Step 3: Replace `server.tsx` glob calls with `routeServerModules`**

```tsx
// apps/app/src/server.tsx
import { Hono } from 'hono';
import { env } from '@hono-preact/iso';
import { Layout } from './server/layout.js';
import {
  actionsHandler,
  loadersHandler,
  location,
  renderPage,
  routeServerModules,
} from '@hono-preact/server';
import { getWatched } from './server/watched.js';
import routes from './routes.js';

const dev = process.env.NODE_ENV === 'development';
if (dev) {
  const { default: dot } = await import('dotenv');
  dot.config({ debug: true });
}
export const app = new Hono();

env.current = 'server';

const serverModules = routeServerModules(routes);

app
  .post('/__loaders', loadersHandler(serverModules))
  .post('/__actions', actionsHandler(serverModules))
  .get('/api/watched/:movieId/photo', async (c) => {
    const id = Number(c.req.param('movieId'));
    if (!Number.isFinite(id)) return c.notFound();
    const rec = await getWatched(id);
    if (!rec?.photo) return c.notFound();
    return new Response(new Blob([rec.photo.bytes], { type: rec.photo.contentType }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  })
  .use(location)
  .get('*', (c) =>
    renderPage(c, <Layout context={c} />, { defaultTitle: 'hono-preact' })
  );

export default app;
```

- [ ] **Step 4: Delete the now-unused old files**

Run:
```bash
rm /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app/src/pages/movies.tsx
rm /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app/src/pages/movies.server.ts
```

- [ ] **Step 5: Build the app end-to-end**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npm run build`
Expected: client and SSR bundles built cleanly. No type errors.

If the SSR bundler complains that the `() => import('./pages/movies-list.server.js')` calls inside `routes.ts` pull server modules into the client bundle, check that `serverOnlyPlugin` rewrites dynamic imports of `*.server.*` not just static ones. If it doesn't, that's a follow-up — for this plan, the existing `import.meta.glob` mechanism is replaced with explicit `() => import()`, and the plugin must treat both equivalently. Run `grep -r "movies-list.server" apps/app/dist/static/` — if matches appear in client chunks, file a follow-up note in the plan and use the eager-eval workaround (move the `serverModules` build to a `__server.ts` sibling that's never imported from the client side).

- [ ] **Step 6: Run the full test suite**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/routes.ts apps/app/src/iso.tsx apps/app/src/server.tsx packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes.test.tsx
git rm apps/app/src/pages/movies.tsx apps/app/src/pages/movies.server.ts
git commit -m "feat(app): migrate iso.tsx and server.tsx to defineRoutes manifest"
```

---

## Task 10: Manual smoke + final verification

**Files:** None modified.

- [ ] **Step 1: Type-check the whole repo**

Run from each package and the app:
```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/iso && npx tsc --noEmit
cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/server && npx tsc --noEmit
cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/vite && npx tsc --noEmit
cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 2: Run all tests**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run
```
Expected: all tests pass, plus the new ones from Tasks 1–7 and the `onRouteChange` test from Task 9.

- [ ] **Step 3: Build the app**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npm run build
```
Expected: clean client + SSR builds.

- [ ] **Step 4: Verify server modules don't leak into the client bundle**

```bash
grep -l "@hono-preact/server" /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app/dist/static/*.js || echo "no server-side imports in client bundle"
```
Expected: prints "no server-side imports in client bundle".

- [ ] **Step 5: Manual smoke (run dev server, exercise routes)**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npm run dev
```

Manually verify in a browser:
- `/` renders home.
- `/movies` renders the movies layout chrome + list, with watched count and per-row mark/unwatch actions.
- Clicking a movie navigates to `/movies/:id` — the layout chrome stays mounted (no flash, no remount of the header).
- Toggle watched on the detail page — optimistic update, then settle.
- `/watched` renders the watched list with bulk-import streaming.
- `/docs` and `/docs/quick-start` still work (MDX path unchanged).
- A 404 (`/nonsense`) renders the not-found page.

Stop the dev server.

- [ ] **Step 6: Final commit if any small fixes were needed**

If smoke testing surfaced fixes, commit them with a clear message. Otherwise no commit needed — the prior tasks already shipped working state.

---

## Self-Review (run mentally before declaring complete)

1. **Spec coverage.** This plan implements section 1 of the v0.1 spec (defineRoutes + nested routes + layouts + the route-table-as-manifest model). It does not touch sections 2–7 — those are separate plans.

2. **Placeholders.** None: every step has actual code, exact paths, exact commands, and expected outputs.

3. **Type consistency.** `RouteDef`, `RoutesManifest`, `FlatRoute`, `LayoutProps`, `ViewProps`, `Routes` are defined in Task 1, augmented in Tasks 2–4, exported in Task 6, and used in Task 7+. Names match throughout.

4. **Risk: `serverOnlyPlugin` and dynamic imports.** Task 9 step 5 includes the verification + fallback. If the existing plugin doesn't handle `() => import('./*.server.*')` (only static imports), the smallest-blast-radius fix is to extend it to also rewrite call expressions where the literal argument matches `*.server.*`. Worst case: a follow-up extends `packages/vite/src/server-only.ts` to handle the dynamic form. That extension is small and self-contained but should not block this plan — the validation in Task 10 step 4 catches the failure mode.

5. **Risk: layout identity preservation.** Task 4 tests assert `m.flat[0].component === m.flat[1].component` for layout groups, which is the structural guarantee that intra-layout-group navigation does not remount the layout. This mirrors the existing `DocsRoute` pattern in the demo, which is known to work with preact-iso.
