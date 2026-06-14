# Content-glob Route Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public `contentRoutes(modules, options?)` helper that turns a Vite `import.meta.glob` module map into hydration-safe framework route nodes, and migrate `apps/site` docs off the hand-built `DocsRoute.tsx` onto it.

**Architecture:** A small pure function in `@hono-preact/iso` maps each glob key to a `{ path: slug, view }` `RouteDef`, wrapping each module's default export in a single-element root (the Fragment-root hydration fix). The site spreads the result under a normal `layout: DocsLayout` group, which gives in-place layout reconciliation for free and promotes each MDX page to a first-class route. No new Vite plugin; the helper is pure and unit-testable without Vite.

**Tech Stack:** TypeScript, Preact, preact-iso, Vite (`import.meta.glob`), Vitest + `@testing-library/preact` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-13-content-glob-route-helper-design.md`

---

## Background an implementer needs

- **`RouteDef`** (`packages/iso/src/define-routes.tsx:35-54`) is `{ path: string; view?: LazyImport<ComponentType<ViewProps>>; layout?; server?; children?: readonly RouteDef[]; use? }` where `LazyImport<T> = () => Promise<{ default: T }>` and `ViewProps = RouteHook` (preact-iso's route-hook props: `path`, `params`, etc.).
- The framework wraps each `view` thunk in preact-iso's `lazy()` itself (`getOrCreateLazyView`, server-less branch: `asViewComponent(lazy(view))`, `define-routes.tsx:280-281`). So a content `view` thunk only needs to resolve to `{ default: Component }`; the wrapper composition happens inside that resolved module.
- **Why a single-root wrapper:** MDX compiles to a Fragment root (multiple sibling nodes). A Fragment root inside preact-iso's `lazy` + `<Suspense>` double-renders during hydration (Preact appends instead of replacing). A single wrapping element prevents it. The wrapper is therefore load-bearing, not cosmetic.
- **Layout groups reconcile in place:** a `layout` node keeps its layout component mounted across child navigations (the framework registers the layout group under both `/path` and `/path/*` with one shared component reference). This is what makes the old "same-component-reference trick" unnecessary once docs pages are real children.
- **Typed-routes (primitive #4) is safe automatically:** `AbsolutePaths<T>` (`packages/iso/src/internal/typed-routes.ts:38-43`) only recurses into children when `T` matches a tuple pattern. `contentRoutes` returns a general `RouteDef[]`, and spreading it makes the `children` array a general array (not a tuple), so it resolves to `never` and contributes nothing to the typed registry. No engine change. `apps/site/src/typed-route-params.assert.ts` has no `/docs` references, so it is unaffected.
- **Test command:** from the repo root, run a specific iso test file with `pnpm exec vitest run packages/iso/src/__tests__/<file>` (running with no path from a subdir can report "No test files found").
- **Constraint:** no em-dashes in prose, comments, or commit messages (use a comma, colon, semicolon, parentheses, or two sentences).

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/iso/src/content-routes.tsx` | The `contentRoutes` helper + `ContentRoutesOptions` + internal slug/prefix helpers | Create |
| `packages/iso/src/index.ts` | iso public barrel | Modify (add export) |
| `packages/iso/src/__tests__/content-routes.test.tsx` | Unit tests: slug derivation, base/slug override, wrapper, props forwarding | Create |
| `packages/iso/src/__tests__/content-routes-render.test.tsx` | Integration: tree builds, path matching, 404 ranking, layout persistence | Create |
| `apps/site/src/components/MdxArticle.tsx` | The docs prose single-root wrapper (`<article class="mdx-content">`) | Create |
| `apps/site/src/components/DocsNotFound.tsx` | The docs-chrome 404 view (extracted from `DocsRoute`) | Create |
| `apps/site/src/routes.ts` | Site route table | Modify (docs layout group) |
| `apps/site/src/components/DocsRoute.tsx` | The hand-built glob router | Delete |
| `apps/site/src/pages/docs/__tests__/docs-slug.test.ts` | Tests `docsSlug` (function being deleted) | Delete |
| `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts` | nav-vs-disk parity (independent of routing impl) | Modify (comments only) |
| `apps/site/src/pages/docs/pages.mdx` | "MDX content pages" docs | Modify |
| `apps/site/src/pages/docs/routes.mdx` | same-component-reference example | Modify |
| `apps/site/src/pages/docs/structure.mdx` | repo-structure prose | Modify |
| `.claude/skills/add-docs-page.md` | local skill: how docs pages are discovered | Modify |

The umbrella `hono-preact` re-exports iso via `export * from '@hono-preact/iso'` (`packages/hono-preact/src/index.ts`) and `consolidate.mjs` copies the iso dist, so `contentRoutes` reaches `hono-preact` automatically once it is on the iso barrel. No umbrella source edit is required.

---

## Task 1: The `contentRoutes` helper (iso)

**Files:**
- Create: `packages/iso/src/content-routes.tsx`
- Create: `packages/iso/src/__tests__/content-routes.test.tsx`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `packages/iso/src/__tests__/content-routes.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import type { ComponentChildren } from 'preact';
import { render } from '@testing-library/preact';
import { contentRoutes } from '../content-routes.js';

// Build a fake glob map. Each value is a lazy importer whose `default` is a
// component rendering `label`, mirroring `import.meta.glob`'s shape.
const mod =
  (label: string) =>
  (): Promise<unknown> =>
    Promise.resolve({ default: () => h('p', null, label) });

async function renderView(route: {
  view?: () => Promise<{ default: unknown }>;
}) {
  const { default: View } = await route.view!();
  return render(h(View as never, {}));
}

describe('contentRoutes slug derivation', () => {
  it('strips the common dir + extension and collapses index', () => {
    const routes = contentRoutes({
      './pages/docs/index.mdx': mod('home'),
      './pages/docs/quick-start.mdx': mod('qs'),
      './pages/docs/components/index.mdx': mod('comp'),
      './pages/docs/components/dialog.mdx': mod('dialog'),
    });
    expect(routes.map((r) => r.path).sort()).toEqual(
      ['', 'components', 'components/dialog', 'quick-start'].sort()
    );
  });

  it('handles a single-key map (dir prefix from the one key)', () => {
    const routes = contentRoutes({ './pages/docs/index.mdx': mod('x') });
    expect(routes[0].path).toBe('');
  });

  it('honors an explicit base', () => {
    const routes = contentRoutes(
      { 'content/a.mdx': mod('a'), 'content/b.mdx': mod('b') },
      { base: 'content/' }
    );
    expect(routes.map((r) => r.path).sort()).toEqual(['a', 'b']);
  });

  it('honors a slug override (ignores base derivation)', () => {
    const routes = contentRoutes(
      { 'x/y.mdx': mod('y') },
      { slug: (k) => k.replace(/\.mdx$/, '').toUpperCase() }
    );
    expect(routes[0].path).toBe('X/Y');
  });
});

describe('contentRoutes view', () => {
  it('wraps the module default in a single-root default <div>', async () => {
    const [route] = contentRoutes({ './a/index.mdx': mod('hello') });
    const { container } = await renderView(route);
    expect(container.childNodes.length).toBe(1);
    expect((container.firstChild as HTMLElement).tagName).toBe('DIV');
    expect(container.textContent).toContain('hello');
  });

  it('honors a custom wrapper', async () => {
    const Wrapper = ({ children }: { children: ComponentChildren }) =>
      h('article', { class: 'mdx-content' }, children);
    const [route] = contentRoutes(
      { './a/index.mdx': mod('hi') },
      { wrapper: Wrapper }
    );
    const { container } = await renderView(route);
    const root = container.firstChild as HTMLElement;
    expect(root.tagName).toBe('ARTICLE');
    expect(root.className).toBe('mdx-content');
  });

  it('forwards route props to the content component', async () => {
    const Probe = (props: { path?: string }) =>
      h('span', null, props.path ?? 'no-path');
    const [route] = contentRoutes({
      './a/index.mdx': () => Promise.resolve({ default: Probe }),
    });
    const { default: View } = await route.view!();
    const { container } = render(h(View as never, { path: '/a' }));
    expect(container.textContent).toContain('/a');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/iso/src/__tests__/content-routes.test.tsx`
Expected: FAIL, cannot resolve `../content-routes.js` (module does not exist yet).

- [ ] **Step 3: Implement the helper**

Create `packages/iso/src/content-routes.tsx`:

```tsx
import { h } from 'preact';
import type { ComponentChildren, ComponentType } from 'preact';
import type { RouteDef, ViewProps } from './define-routes.js';

export interface ContentRoutesOptions {
  /**
   * Single-element wrapper around each content module's default export.
   * Load-bearing: it provides the single DOM root that keeps a Fragment-root
   * module (e.g. compiled MDX) from double-rendering during hydration inside
   * preact-iso's lazy + Suspense. It must render a single root element, so it
   * cannot be a Fragment. Defaults to a bare `<div>`.
   */
  wrapper?: ComponentType<{ children: ComponentChildren }>;
  /**
   * Map a glob key to a route slug (the child `path`). Overrides the default
   * rule entirely. Receives the raw glob key (relative to the file that called
   * `import.meta.glob`).
   */
  slug?: (key: string) => string;
  /**
   * Prefix stripped from each key before deriving the slug. Defaults to the
   * longest common directory prefix shared by all keys. Ignored when `slug`
   * is provided.
   */
  base?: string;
}

const DefaultWrapper: ComponentType<{ children: ComponentChildren }> = ({
  children,
}) => h('div', null, children);

// Longest common DIRECTORY prefix of the keys: the char-level common prefix
// truncated at its last '/', so only whole leading directory segments are
// stripped. A single-key map yields that key's directory. When every key
// shares a deeper directory, pass `base` explicitly to control the depth.
function commonDirPrefix(keys: readonly string[]): string {
  if (keys.length === 0) return '';
  let prefix = keys[0];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    let j = 0;
    while (j < prefix.length && j < k.length && prefix[j] === k[j]) j++;
    prefix = prefix.slice(0, j);
    if (prefix === '') break;
  }
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash === -1 ? '' : prefix.slice(0, lastSlash + 1);
}

// Default slug rule: strip the base prefix, the final extension, and a
// trailing `index` segment (so `index` -> '' and `dir/index` -> 'dir').
function defaultSlug(key: string, base: string): string {
  let s = key.startsWith(base) ? key.slice(base.length) : key;
  s = s.replace(/\.[^./]+$/, '');
  s = s.replace(/(^|\/)index$/, '');
  return s;
}

/**
 * Turn a Vite `import.meta.glob` module map into framework route nodes, one per
 * file. Each node's `view` loads the module and renders its default export
 * inside a single-element `wrapper` (the hydration-safe root). Spread the
 * result into a route tree, typically under a `layout` group:
 *
 * ```ts
 * {
 *   path: '/docs',
 *   layout: () => import('./DocsLayout.js'),
 *   children: [
 *     ...contentRoutes(import.meta.glob('./pages/docs/**\/*.mdx'), {
 *       wrapper: MdxArticle,
 *     }),
 *     { path: '*', view: () => import('./DocsNotFound.js') },
 *   ],
 * }
 * ```
 *
 * `import.meta.glob` must be written inline with a literal pattern (a Vite
 * requirement), so the caller passes the resolved map in.
 */
export function contentRoutes(
  modules: Record<string, () => Promise<unknown>>,
  options: ContentRoutesOptions = {}
): RouteDef[] {
  const Wrapper = options.wrapper ?? DefaultWrapper;
  const keys = Object.keys(modules);
  const base = options.base ?? commonDirPrefix(keys);
  const toSlug = options.slug ?? ((key: string) => defaultSlug(key, base));

  return keys.map((key) => {
    const load = modules[key];
    const view = () =>
      load().then((mod) => {
        // Structural read off a user-defined module export (acceptable cast
        // boundary): the glob value's `default` is the page component.
        const Content = (mod as { default: ComponentType<ViewProps> }).default;
        const WrappedView: ComponentType<ViewProps> = (props) =>
          h(Wrapper, null, h(Content, props));
        return { default: WrappedView };
      });
    return { path: toSlug(key), view };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/iso/src/__tests__/content-routes.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the public barrel export**

In `packages/iso/src/index.ts`, immediately after the existing route-tree export block (the `export { defineRoutes, Routes } ...` and its `export type { RouteDef, ... }` at lines 12-20), add:

```ts
// Content-glob route helper.
export { contentRoutes } from './content-routes.js';
export type { ContentRoutesOptions } from './content-routes.js';
```

- [ ] **Step 6: Build iso and confirm the export resolves**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: clean build. Then confirm the symbol is exported:
Run: `node -e "import('@hono-preact/iso').then(m => { if (typeof m.contentRoutes !== 'function') throw new Error('contentRoutes not exported'); console.log('ok'); })"`
Expected: prints `ok`.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/content-routes.tsx packages/iso/src/__tests__/content-routes.test.tsx packages/iso/src/index.ts
git commit -m "feat(iso): add contentRoutes glob route helper"
```

---

## Task 2: Integration / render test (iso)

Proves a `defineRoutes` tree using `contentRoutes` under a layout builds, matches each path, ranks the docs catch-all correctly, and keeps the layout mounted across docs-to-docs navigation (the behavior that replaces the old same-reference trick). These exercise existing framework wiring plus the Task 1 helper, so they should pass on first run; a failure reveals a real integration gap.

**Files:**
- Create: `packages/iso/src/__tests__/content-routes-render.test.tsx`

- [ ] **Step 1: Write the integration test**

Create `packages/iso/src/__tests__/content-routes-render.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Fragment, h } from 'preact';
import { useLocation } from 'preact-iso';
import { act, render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';
import { contentRoutes } from '../content-routes.js';

const page =
  (text: string) =>
  (): Promise<unknown> =>
    Promise.resolve({ default: () => h('p', null, text) });

const layout = () =>
  Promise.resolve({
    default: ({ children }: { children: unknown }) =>
      h('main', { 'data-docs': '' }, children as never),
  });

const modules = {
  './pages/docs/index.mdx': page('DOCS HOME'),
  './pages/docs/quick-start.mdx': page('QUICK START'),
  './pages/docs/components/dialog.mdx': page('DIALOG'),
};

const routes = defineRoutes([
  {
    path: '/docs',
    layout,
    children: [
      ...contentRoutes(modules),
      { path: '*', view: page('DOCS 404') },
    ],
  },
  { path: '*', view: page('SITE 404') },
]);

function renderAt(path: string) {
  history.replaceState(null, '', path);
  return render(h(LocationProvider, null, h(Routes, { routes })));
}

describe('contentRoutes integration', () => {
  it('builds without validator error and matches the index', async () => {
    const { findByText } = renderAt('/docs');
    expect(await findByText('DOCS HOME')).toBeTruthy();
  });

  it('matches a nested content path over the catch-all', async () => {
    const { findByText } = renderAt('/docs/components/dialog');
    expect(await findByText('DIALOG')).toBeTruthy();
  });

  it('renders the docs 404 for an unknown docs path, not the site 404', async () => {
    const { findByText, queryByText } = renderAt('/docs/nope');
    expect(await findByText('DOCS 404')).toBeTruthy();
    expect(queryByText('SITE 404')).toBeNull();
  });

  it('keeps the docs layout mounted across docs-to-docs navigation', async () => {
    let route!: (path: string) => void;
    const Grab = () => {
      route = useLocation().route;
      return null;
    };
    history.replaceState(null, '', '/docs');
    const { container, findByText } = render(
      h(
        LocationProvider,
        null,
        h(Fragment, null, h(Grab), h(Routes, { routes }))
      )
    );
    await findByText('DOCS HOME');
    const layoutEl = container.querySelector('[data-docs]');
    expect(layoutEl).toBeTruthy();
    await act(async () => {
      route('/docs/quick-start');
    });
    await findByText('QUICK START');
    // Same DOM node: the layout group reconciled in place, it did not remount.
    expect(container.querySelector('[data-docs]')).toBe(layoutEl);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run packages/iso/src/__tests__/content-routes-render.test.tsx`
Expected: PASS, 4 tests. (If the catch-all or layout-persistence test fails, that is a real wiring issue to resolve before proceeding, not a test to weaken.)

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/content-routes-render.test.tsx
git commit -m "test(iso): integration coverage for contentRoutes under a layout group"
```

---

## Task 3: Migrate apps/site docs onto `contentRoutes`

**Files:**
- Create: `apps/site/src/components/MdxArticle.tsx`
- Create: `apps/site/src/components/DocsNotFound.tsx`
- Modify: `apps/site/src/routes.ts`
- Delete: `apps/site/src/components/DocsRoute.tsx`
- Delete: `apps/site/src/pages/docs/__tests__/docs-slug.test.ts`
- Modify: `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts` (comments only)

- [ ] **Step 1: Create the prose wrapper**

Create `apps/site/src/components/MdxArticle.tsx`:

```tsx
import type { ComponentChildren } from 'preact';

// Single-root wrapper for MDX content. The single element is what keeps a
// Fragment-root MDX module from double-rendering during hydration, and it is
// the docs prose styling container.
export function MdxArticle({ children }: { children: ComponentChildren }) {
  return <article class="mdx-content">{children}</article>;
}
```

- [ ] **Step 2: Create the docs 404 view**

Create `apps/site/src/components/DocsNotFound.tsx`:

```tsx
import { MdxArticle } from './MdxArticle.js';

export default function DocsNotFound() {
  return (
    <MdxArticle>
      <p>Docs page not found.</p>
    </MdxArticle>
  );
}
```

- [ ] **Step 3: Rewrite the docs section of `routes.ts`**

In `apps/site/src/routes.ts`: update the top imports, delete the `docsView` const, and replace the two flat `/docs` entries with a layout group. The full file becomes:

```ts
import { defineRoutes, contentRoutes, type RoutePaths } from 'hono-preact';
// Registers the global `docs` view-transition type rule (enter/leave/within
// /docs). Side-effect import: the generated client entry imports this module,
// so the subscriber is installed once at startup.
import './docs-transition.js';
import { requireSession } from './demo/guard.js';
import { MdxArticle } from './components/MdxArticle.js';

// The tree is its own `as const` binding (not just inlined into defineRoutes)
// so the route registration below can reference `typeof routeTree`. Registering
// against the manifest (`typeof routes`) would form a type cycle: the manifest
// is built by `defineRoutes` (a hono-preact value) and the module augmentation
// is evaluated while resolving it. The tree is a plain literal, so it is safe.
const routeTree = [
  { path: '/', view: () => import('./pages/home.js') },
  {
    path: '/docs',
    layout: () => import('./components/DocsLayout.js'),
    children: [
      ...contentRoutes(import.meta.glob('./pages/docs/**/*.mdx'), {
        wrapper: MdxArticle,
      }),
      { path: '*', view: () => import('./components/DocsNotFound.js') },
    ],
  },
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
  {
    path: '*',
    view: () => import('./pages/not-found.js'),
  },
] as const;

export default defineRoutes(routeTree);

declare module 'hono-preact' {
  interface RegisteredRoutes {
    paths: RoutePaths<typeof routeTree>;
  }
}
```

- [ ] **Step 4: Delete the obsolete files**

```bash
git rm apps/site/src/components/DocsRoute.tsx apps/site/src/pages/docs/__tests__/docs-slug.test.ts
```

(The `docsSlug` cases that `docs-slug.test.ts` covered, top-level slug, root index to `''`, nested file, nested index, are now covered by Task 1's slug tests in `content-routes.test.tsx`, so no coverage is lost.)

- [ ] **Step 5: Update the stale comments in `mdx-routes.test.ts`**

This test walks the docs directory with `fs` and checks nav-vs-disk parity; its logic is independent of the routing implementation and stays. Only the comments reference the deleted component. In `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts`:

Replace the opening comment block:

```ts
// `apps/site/src/components/DocsRoute.tsx` auto-discovers MDX pages via
// `import.meta.glob('../pages/docs/**/*.mdx')` and registers one Route per
// file (recursively) under the outer `/docs` route. `apps/site/src/pages/docs/nav.ts`
// declares the user-facing sidebar manually. If those two lists drift,
// users see a "Docs page not found" fallback for an entry in the sidebar
// (or worse, navigate to a docs page that the sidebar doesn't show).
//
// Vitest can't easily execute `import.meta.glob` outside Vite's bundler,
// and importing MDX would require the @mdx-js/rollup plugin in
// `vitest.config.ts`. Instead we walk the docs directory with `fs` and
// derive the same route slugs DocsRoute would, then check both directions
// against `nav.ts`.
```

with:

```ts
// `apps/site/src/routes.ts` feeds `import.meta.glob('./pages/docs/**/*.mdx')`
// to `contentRoutes`, which registers one route per file (recursively) under
// the `/docs` layout group. `apps/site/src/pages/docs/nav.ts` declares the
// user-facing sidebar manually. If those two lists drift, users see a "Docs
// page not found" fallback for a sidebar entry (or navigate to a docs page the
// sidebar doesn't show).
//
// Vitest can't easily execute `import.meta.glob` outside Vite's bundler, and
// importing MDX would require the @mdx-js/rollup plugin in `vitest.config.ts`.
// Instead we walk the docs directory with `fs` and derive the same route slugs
// contentRoutes would, then check both directions against `nav.ts`.
```

Replace the third test's inner comment:

```ts
    // DocsRoute renders `<IsoRoute path="" component={...}>` for index.mdx
    // so the URL `/docs` matches it. The nav.ts entry for the overview is
    // therefore `/docs`, not `/docs/index`.
```

with:

```ts
    // contentRoutes maps index.mdx to the empty slug, so the URL `/docs`
    // matches it. The nav.ts entry for the overview is therefore `/docs`,
    // not `/docs/index`.
```

And update the same test's title from `'index.mdx becomes the /docs route (empty slug inside the inner Router)'` to `'index.mdx becomes the /docs route (empty slug)'`.

- [ ] **Step 6: Typecheck and run the affected site tests**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck`
Expected: clean (no references to the deleted `DocsRoute`/`docsSlug`; `routes.ts` typechecks, the `RegisteredRoutes` augmentation still resolves).

Run: `pnpm exec vitest run apps/site/src/pages/docs/__tests__/mdx-routes.test.ts`
Expected: PASS (nav-vs-disk parity unchanged).

- [ ] **Step 7: Build the site**

Run: `pnpm --filter site build`
Expected: clean build. This produces both the client and SSR bundles (the site builds via `@hono/vite-build`), so a successful build confirms the migrated `routes.ts`, the `import.meta.glob` MDX discovery, and per-page SSR all resolve. The Task 2 render tests cover the runtime matching/hydration behavior; a manual browser check of `/docs` and `/docs/components/<page>` is a good final confirmation but is not required by this step.

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/components/MdxArticle.tsx apps/site/src/components/DocsNotFound.tsx apps/site/src/routes.ts apps/site/src/pages/docs/__tests__/mdx-routes.test.ts
git commit -m "refactor(site): mount docs via contentRoutes layout group, drop DocsRoute"
```

(The `git rm` from Step 4 is already staged for this commit.)

---

## Task 4: Update docs and the local skill

**Files:**
- Modify: `apps/site/src/pages/docs/pages.mdx`
- Modify: `apps/site/src/pages/docs/routes.mdx`
- Modify: `apps/site/src/pages/docs/structure.mdx`
- Modify: `.claude/skills/add-docs-page.md`

Constraints: follow the local `add-docs-page` skill's "Page templates" section (the docs template source of truth); do NOT write migration breadcrumbs ("formerly DocsRoute", "replaces the old", "previously"); describe only what is. A soft-warn `PostToolUse` hook (`.claude/hooks/docs-template-check.sh`) may flag template drift; address its warnings.

- [ ] **Step 1: Read the local docs skill (mandate)**

Read `.claude/skills/add-docs-page.md` in full before editing any docs page, so the rewrites follow the Guide template (prose, examples, API reference) and conventions.

- [ ] **Step 2: Rewrite the "MDX content pages" section of `pages.mdx`**

In `apps/site/src/pages/docs/pages.mdx`, replace the entire `## MDX content pages` section (from the `## MDX content pages` heading through the end of the `**Note on `index.mdx`:**` paragraph, i.e. everything before `## View transitions`) with:

````md
## MDX content pages

MDX is supported via the `@mdx-js/rollup` Vite plugin (configured in `vite.config.ts`). To mount a whole folder of MDX as routes, pass `import.meta.glob` to `contentRoutes`, which turns each file into a framework route node. Spread those nodes under a layout group so the pages share chrome:

```ts
import { defineRoutes, contentRoutes } from 'hono-preact';
import { MdxArticle } from './components/MdxArticle.js';

export default defineRoutes([
  // ...
  {
    path: '/docs',
    layout: () => import('./components/DocsLayout.js'),
    children: [
      ...contentRoutes(import.meta.glob('./pages/docs/**/*.mdx'), {
        wrapper: MdxArticle,
      }),
      { path: '*', view: () => import('./components/DocsNotFound.js') },
    ],
  },
]);
```

`import.meta.glob` must be written inline with a literal pattern (a Vite requirement); `contentRoutes` receives the resulting module map. Each MDX file becomes its own route: server-rendered, navigable, and code-split. The `*` child renders a docs-styled "not found" inside the layout for unmatched `/docs/...` URLs.

### The wrapper

`contentRoutes` wraps every page in a single-element root, here `MdxArticle` (an `<article class="mdx-content">`). The wrapper is required: MDX compiles to a multiple-sibling Fragment root, which does not hydrate stably on its own; the single wrapping element is what makes hydration correct. It is also the natural home for prose styling. The default wrapper, if you pass none, is a bare `<div>`.

### `contentRoutes(modules, options?)`

| Param | Type | Description |
| --- | --- | --- |
| `modules` | `Record<string, () => Promise<unknown>>` | The map from `import.meta.glob`. Keys are file paths; each value is a lazy importer whose `default` export is the page component. |
| `options.wrapper` | `ComponentType<{ children }>` | Single-root wrapper around each page. Defaults to a bare `<div>`. |
| `options.slug` | `(key: string) => string` | Map a glob key to its route `path`, overriding the default rule. |
| `options.base` | `string` | Prefix stripped from each key before slug derivation. Defaults to the longest common directory of all keys. |

The default slug rule strips the common directory prefix and the file extension and collapses a trailing `index` to the empty path: `index.mdx` serves the directory root (`/docs`), `quick-start.mdx` serves `/docs/quick-start`, and `components/dialog.mdx` serves `/docs/components/dialog`.

**To add a new MDX page**, drop a file into `src/pages/docs/<slug>.mdx`; `contentRoutes` picks it up via the glob, with no `routes.ts` edit. (See `.claude/skills/add-docs-page.md` for the project-local skill.)
````

- [ ] **Step 3: Update the same-component-reference example in `routes.mdx`**

In `apps/site/src/pages/docs/routes.mdx`, the code block at lines 87-95 uses `DocsRoute` to illustrate `lazy()` identity sharing. Docs no longer uses that pattern (it is a layout group), so replace the example with a neutral one. Replace:

```ts
const docsView = () => import('./components/DocsRoute.js');

defineRoutes([
  // ...
  { path: '/docs', view: docsView },
  { path: '/docs/*', view: docsView },
]);
```

with:

```ts
const sharedView = () => import('./pages/shared.js');

defineRoutes([
  // ...
  { path: '/a', view: sharedView },
  { path: '/b', view: sharedView },
]);
```

Leave the surrounding prose (lines 85-86 and 97) unchanged; it already states that layout groups get identity sharing automatically.

- [ ] **Step 4: Update `structure.mdx`**

In `apps/site/src/pages/docs/structure.mdx`:

Line 12, replace `# Shared UI components (incl. DocsRoute for MDX)` with `# Shared UI components (incl. MdxArticle for MDX)`.

Line 53, replace:

```md
MDX content (`pages/docs/*.mdx`) is mounted via `apps/site/src/components/DocsRoute.tsx`, which is registered as the `view` for `/docs` and `/docs/*` in `routes.ts`. The DocsRoute component owns its own `import.meta.glob` and inner `<Router>` for sub-page discovery.
```

with:

```md
MDX content (`pages/docs/**/*.mdx`) is mounted by `contentRoutes(import.meta.glob('./pages/docs/**/*.mdx'))` in `routes.ts`, which turns each file into a route node under the `/docs` layout group.
```

- [ ] **Step 5: Update the `add-docs-page` skill**

In `.claude/skills/add-docs-page.md`, line 16, replace:

```md
The glob in `apps/site/src/components/DocsRoute.tsx` is recursive (`../pages/docs/**/*.mdx`), and `docsSlug` derives the route from the path (a nested `index.mdx` serves the directory root, e.g. `components/index.mdx` → `/docs/components`).
```

with:

```md
The glob in `apps/site/src/routes.ts` is recursive (`./pages/docs/**/*.mdx`) and feeds `contentRoutes`, which derives the route from each path (a nested `index.mdx` serves the directory root, e.g. `components/index.mdx` -> `/docs/components`).
```

- [ ] **Step 6: Format and verify**

Run: `pnpm format`
Then: `pnpm format:check`
Expected: pass. If the docs-template-check hook warned during edits, confirm the warnings are resolved (the `pages.mdx` section retains the three pillars: prose, an example, and the API reference table).

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/pages/docs/pages.mdx apps/site/src/pages/docs/routes.mdx apps/site/src/pages/docs/structure.mdx .claude/skills/add-docs-page.md
git commit -m "docs(site): document contentRoutes for MDX content pages"
```

---

## Task 5: Full pre-push CI verification

No code changes. Run the six CI steps in order (per `CLAUDE.md` "Pre-push verification"), from the repo root. This is the cross-package backstop: build + typecheck skip test files, so the full unit suite is what catches a broken consumer test.

**Files:** none.

- [ ] **Step 1: Build the framework dist**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: clean.

- [ ] **Step 2: Format check**

Run: `pnpm format:check`
Expected: pass. (If it fails, run `pnpm format`, then re-commit the result before continuing.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Unit suite with coverage**

Run: `pnpm test:coverage`
Expected: all pass, including the new `content-routes.test.tsx` and `content-routes-render.test.tsx`, the updated `mdx-routes.test.ts`, and (proving the cross-package public-API change is safe) the full iso/server/vite/site suites.

- [ ] **Step 5: Integration tests**

Run: `pnpm test:integration`
Expected: pass.

- [ ] **Step 6: Site build**

Run: `pnpm --filter site build`
Expected: clean build (the migrated `routes.ts` + `contentRoutes` + MDX glob all resolve and SSR).

- [ ] **Step 7: Report**

Report the result of each step. Do not push; opening the PR is handled after this plan completes, per the session workflow.

---

## Self-Review

**Spec coverage:**
- The `contentRoutes` API (signature, `wrapper`/`slug`/`base`, defaults) -> Task 1.
- Slug derivation rule (common-dir strip, extension strip, index collapse) -> Task 1 Step 3 + tests Step 1.
- Single-root wrapper as the hydration fix -> Task 1 (impl + single-root assertion); honestly scoped (no happy-dom "no double-render" test, which would be a false comfort per the usePresence lesson; real hydration confidence comes from the site build/SSR).
- Public on the iso barrel + reaches the umbrella -> Task 1 Steps 5-6.
- Integration: tree builds, path matching, docs-404 ranking, in-place layout (replaces same-ref trick) -> Task 2.
- Migration: delete `DocsRoute.tsx`, add `MdxArticle` + `DocsNotFound`, layout group, catch-all 404 -> Task 3.
- Handle `docs-slug.test.ts` (delete; coverage moved to Task 1) and `mdx-routes.test.ts` (keep, comments only) -> Task 3 Steps 4-5.
- `routes.ts` stays JSX-free by importing `MdxArticle` -> Task 3 Step 3.
- Docs (`pages.mdx`, `routes.mdx`, `structure.mdx`) + the `add-docs-page` skill -> Task 4.
- Verified non-issues (typed-routes degrades to `never`, assert file unaffected, validator permits the shape) -> covered by Task 3 typecheck (Step 6) and Task 2 (validator builds the tree).
- Full pre-push CI -> Task 5.

**Placeholder scan:** No TBD/TODO; every code and doc step shows the exact content. The only conditional is Task 3 Step 7's SSR smoke fallback, which names a concrete fallback (rely on `pnpm --filter site build` + Task 2 render tests), not a vague instruction.

**Type consistency:** `contentRoutes(modules, options?)`, `ContentRoutesOptions` with `wrapper`/`slug`/`base`, and the returned `RouteDef[]` are named identically across Tasks 1-4. The view thunk shape `() => Promise<{ default: ComponentType<ViewProps> }>` matches `RouteDef.view`'s `LazyImport`. `MdxArticle` (named export) and `DocsNotFound` (default export) are imported consistently in `routes.ts`, `DocsNotFound.tsx`, and the docs examples.
