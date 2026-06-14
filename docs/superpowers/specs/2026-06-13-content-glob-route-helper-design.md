# Content-glob route helper

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan
**Source:** Section C primitive #6 of the primitives DX review (`docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`, item 6 under "What apps/site reveals"). The last of the six site-discovered primitives. Subsumes the hand-built `apps/site/src/components/DocsRoute.tsx` glob router, its slug deriver, the per-MDX Fragment-root hydration workaround, and the same-component-reference layout trick.

## Background

`apps/site` mounts its docs section through a hand-built component, `DocsRoute.tsx`, that tangles three separate concerns:

1. **A glob router with a slug deriver.** `import.meta.glob('../pages/docs/**/*.mdx')` is mapped over: each key is turned into a route slug (`docsSlug`: strip the `../pages/docs/` prefix, strip `.mdx`, collapse `index` to `''`), and each module is `lazy`-loaded into an inner preact-iso `<Router>`.
2. **A Fragment-root hydration workaround.** MDX compiles to a Fragment root (multiple sibling nodes). A Fragment root inside preact-iso's `lazy` + `<Suspense>` double-renders on hydration (Preact appends instead of replacing, so the content appears twice). The workaround wraps every MDX module in a single `<article class="mdx-content">` root.
3. **A same-component-reference trick.** Both `/docs` and `/docs/*` point at the same `docsView` thunk so preact-iso treats docs to docs navigation as a non-route-change (the incoming `component` identity matches), keeping `DocsLayout` mounted in place rather than remounting it.

The review's verdict: "Deep preact-iso internals knowledge living in app code." Concerns 2 and 3 are framework internals that an app author should never have to know; concern 1 is ordinary routing glue.

## Goals

- Delete `DocsRoute.tsx` and the three encoded workarounds from app code.
- Provide one small, public framework helper that turns a module map into hydration-safe framework route nodes.
- Promote each content page to a first-class framework route: server-rendered directly as a route, navigable, and future-ready for per-page loaders/guards/typed params, instead of being hidden behind an inner client-only router.

## Non-goals (the light touch)

This helper does exactly one thing. It does NOT provide:

- Frontmatter parsing, schema validation, or typed frontmatter (the Astro content-collections surface).
- `getCollection`-style content queries, ordering, sorting, or eager metadata extraction.
- File-based routing (hono-preact stays an explicit, code-based route manifest framework).
- A not-found policy (the app owns its 404 via an ordinary catch-all child).

These are deliberately out of scope. They are a large surface to freeze before v1, they are YAGNI for a single docs site, and the broader Vite ecosystem (SvelteKit, TanStack Router, Next dynamic routes) leaves exactly this glue to `import.meta.glob` plus a few lines. If a second consumer ever needs collection features, that is a separate increment (the "extract on the second copy" rule). Today there is one consumer.

## Why this design (the two-concerns split)

`DocsRoute.tsx` tangles a framework concern (hydration correctness, concern 2; in-place layout reconciliation, concern 3) with an app concern (glob-to-slug mapping, concern 1). The framework's real obligation is the part users cannot get right without internals knowledge. The chosen mechanism resolves all three:

- **Concern 2 (hydration)** is owned by the helper: every content view is wrapped in a single-element root, which is what prevents the Fragment-root double-render. The wrapper is load-bearing, not cosmetic.
- **Concern 3 (in-place layout)** disappears for free: a normal framework **layout group already keeps its layout component mounted** across child navigations (that is what layout groups do; the demo `/demo` layout already behaves this way). Pointing the content pages at a real `layout: DocsLayout` node makes the same-reference trick unnecessary.
- **Concern 1 (glob mapping)** stays light and overridable: the helper does the obvious key-to-slug mapping, with both the slug rule and the wrapper configurable.

The alternative postures considered and rejected: a blessed `<ContentRouter>` component that merely relocates the inner-router smell into the framework (content pages would stay hidden behind an inner client router, with no per-page SSR-as-route); and full Astro-style content collections (large surface, YAGNI). The chosen posture promotes content pages to real routes with the minimum new public surface.

## The API

A single public function, exported from the iso main barrel.

```ts
// packages/iso/src/content-routes.tsx
import type { ComponentChildren, ComponentType } from 'preact';
import type { RouteDef } from './define-routes.js';

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
   * Prefix to strip from each key before deriving the slug. Defaults to the
   * longest common directory prefix shared by all keys. Ignored when `slug`
   * is provided.
   */
  base?: string;
}

export function contentRoutes(
  modules: Record<string, () => Promise<unknown>>,
  options?: ContentRoutesOptions,
): RouteDef[];
```

The caller invokes `import.meta.glob` themselves (a hard Vite constraint: the glob argument must be a literal Vite can statically analyze, so it cannot be abstracted into the library) and passes the resolved lazy-importer map in. The helper treats it as a plain `Record<string, () => Promise<unknown>>`, which also makes it unit-testable without Vite.

### Slug derivation (default rule)

Generalizes today's `docsSlug`:

1. Strip the `base` prefix. Default `base` = the longest common **directory** prefix of all keys (the common prefix truncated at the last `/`, so a single-file glob still yields its directory). For `./pages/docs/index.mdx` and `./pages/docs/components/dialog.mdx`, that is `./pages/docs/`.
2. Strip the file extension (the final `.<ext>`), not just `.mdx`.
3. Collapse a trailing `index` segment to `''` (`index` to `''`; `components/index` to `components`).

Results: `./pages/docs/index.mdx` to `''`, `./pages/docs/quick-start.mdx` to `quick-start`, `./pages/docs/components/index.mdx` to `components`, `./pages/docs/components/dialog.mdx` to `components/dialog`. The common case needs no options: `contentRoutes(import.meta.glob('./pages/docs/**/*.mdx'))`.

### The wrapper and the hydration fix

For each key, the helper produces a `RouteDef` whose `view` is a thunk that loads the module, reads its `default` export (the structural read off a user-defined module export is an acceptable cast boundary), and composes it inside the wrapper:

```ts
const Wrapper = options?.wrapper ?? DefaultWrapper; // ({ children }) => h('div', null, children)

const view = () =>
  modules[key]().then((mod) => {
    const Content = (mod as { default: ComponentType }).default;
    const WrappedView: ComponentType<ViewProps> = (props) =>
      h(Wrapper, null, h(Content, props));
    return { default: WrappedView };
  });

return { path: slug(key), view };
```

The framework then wraps this `view` thunk in preact-iso's `lazy()` itself (`getOrCreateLazyView` in `define-routes.tsx`, the server-less branch: `asViewComponent(lazy(view))`). The wrapper's single root element is the boundary that hydrates correctly. Route props (`ViewProps` / `RouteHook`) are passed through to the content component to match today's behavior; MDX components ignore them harmlessly.

## The migration

`apps/site/src/routes.ts` replaces the two flat `docsView` entries with one layout group:

```ts
{
  path: '/docs',
  layout: () => import('./components/DocsLayout.js'),
  children: [
    ...contentRoutes(import.meta.glob('./pages/docs/**/*.mdx'), {
      wrapper: ({ children }) => <article class="mdx-content">{children}</article>,
    }),
    { path: '*', view: () => import('./components/DocsNotFound.js') },
  ],
}
```

`DocsRoute.tsx` is deleted in full: the `docsSlug` deriver, the `<article>` wrapper, the inner `<Router>`, the `DocsNotFound` inline component, and the same-reference trick all go away. `DocsLayout` already accepts `children` and is reused unchanged as the layout component. The previous inline `DocsNotFound` moves to its own `components/DocsNotFound.tsx` (so it can be a `view` thunk) and keeps the docs chrome via the layout group.

`routes.ts` is currently a pure `.ts` data module with no JSX. Rather than rename it to `.tsx`, the docs prose wrapper is extracted to a tiny `components/MdxArticle.tsx` (`({ children }) => <article class="mdx-content">{children}</article>`) and imported, keeping `routes.ts` a JSX-free data module (and keeping the `declare module` typed-route registration that references `typeof routeTree` untouched). The migration snippet above is illustrative; the actual `wrapper` value is the imported `MdxArticle`.

### Behavior parity to verify

- **In-place layout.** The layout group keeps `DocsLayout` mounted across docs-to-docs navigation (replaces concern 3). Verify a docs-to-docs nav does not remount `DocsLayout`.
- **Docs-styled 404.** `/docs/<unknown>` matches the catch-all child `/docs/*` (which outranks the global `/*` by specificity in preact-iso's segment ranking) and renders `DocsNotFound` inside the docs layout. Verify `/docs/bogus` shows the docs-chrome 404, not the site-wide 404, and that a real page like `/docs/components/dialog` (more static segments) still outranks `/docs/*`.
- **Hydration.** A content page hydrates without double-rendering its body (the wrapper's single root is present).
- **SSR.** Each content page server-renders as its own route (the prerender awaits the lazy view's Suspense).
- **View transitions.** The existing `docs` view-transition type rule (`docs-transition.ts`, keyed on enter/leave/within `/docs`) still applies; the `/docs` prefix is unchanged.

## Verified non-issues

- **Typed-routes registry (primitive #4) degrades gracefully, no engine change.** `AbsolutePaths<T>` only recurses into `children` when `T` matches a tuple pattern `readonly [Head, ...Tail]`. `contentRoutes(...)` returns a general `RouteDef[]`, and spreading it into the `children` array makes that array a general `RouteDef[]` (a variadic spread of a non-tuple cannot stay a fixed tuple). A general array does not match the tuple pattern, so `AbsolutePaths` resolves to `never` and the content children contribute nothing to the registry. The `/docs` node itself still contributes `/docs` via its `layout` branch, and the sibling top-level nodes (`/`, the `/demo` subtree, `*`) are unaffected. Net: content pages are not individually typed (correct, they have no params), and no meaningful typed path is lost. The only path dropped from the union is `/docs/*`, which is not a useful typed-params target. The `apps/site/src/typed-route-params.assert.ts` oracle must be checked for any assertion on `/docs/*` and updated if present.
- **The framework's internal view-dedup cache stays useful.** `getOrCreateLazyView` memoizes `lazy(view)` per thunk identity. The app-level same-reference trick goes away, but the internal cache is general and unaffected.
- **The validator already permits this shape.** A `layout` node with `children` containing `path: ''` and other view leaves is exactly the demo `/demo` pattern. The generated nodes are ordinary `view` leaves; multi-segment relative paths (`components/dialog`) are valid preact-iso patterns. The plan verifies the validator accepts a `*` catch-all sibling leaf.

## Architecture and components

- **New:** `packages/iso/src/content-routes.tsx` (one exported function plus a default wrapper and the slug helpers). Public on the iso barrel and re-exported from the `hono-preact` umbrella.
- **New:** `apps/site/src/components/DocsNotFound.tsx` (extracted from the deleted inline component).
- **Modified:** `apps/site/src/routes.ts` (the docs layout group), the iso barrel (`packages/iso/src/index.ts`) and the umbrella consolidation if applicable.
- **Deleted:** `apps/site/src/components/DocsRoute.tsx`.
- **Docs:** the docs page that explains content/MDX sub-routing (currently describes the hand-built approach) is updated to document `contentRoutes`. A new API-reference entry for `contentRoutes` per the docs template standard.

## Testing strategy

Unit tests for the helper (no Vite needed; pass a plain module map):

- Default slug derivation: index-to-`''`, nested `index`-to-dir, nested file-to-`dir/file`, extension stripping, longest-common-directory-prefix stripping (including a single-key map).
- `base` override and `slug` override.
- Returned nodes have the right `path` and a `view` thunk that resolves to a `{ default }` whose render wraps the module's default in the wrapper (assert the single wrapper root; assert the default wrapper is a `div` and a custom wrapper is honored).
- Route props are forwarded to the content component.

Integration / render tests:

- A `defineRoutes` tree using `contentRoutes` under a `layout` builds without validator error and matches each generated path to its content (drive via `history.replaceState`, the existing `define-routes.test.tsx` precedent).
- The docs-styled 404 child wins for an unknown `/docs/...` path; a real content path wins over the catch-all.

Site-level: the existing `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts` (which currently asserts over the glob) is updated or replaced to reflect the new wiring. Full six-step pre-push CI, including `pnpm --filter site build`, confirms the migrated site builds and SSRs.

## Naming and placement

- **`contentRoutes`** (not `globRoutes` / `mdxRoutes` / `fileRoutes`): content-agnostic (any module map, not only MDX) and matches the review's "content-glob route helper" language.
- Lives in iso (`@hono-preact/iso`) because route definition lives there; public on the main barrel alongside `defineRoutes`.

## Ecosystem context

The posture matches how non-content-first frameworks handle this. SvelteKit's standard idiom is `import.meta.glob` plus hand-rolled slug extraction with no dedicated helper; TanStack Router (code-based) and Next dynamic routes similarly leave the mapping to user space or Vite's glob. Only content-first frameworks (Astro content collections, VitePress, Nextra, Docusaurus) elevate it to a typed-collection primitive, because content is their product. hono-preact is a code-based-manifest app framework, so the right increment is a thin adapter that owns only the part users cannot re-derive (hydration-safe wrapping and clean participation in the manifest), not a content-collection system.
