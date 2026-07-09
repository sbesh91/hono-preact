# Route-scoped CSS delivery (framework)

Date: 2026-07-07
Status: Design approved (scope), pending written-spec review
Branch: `feat/route-scoped-css` (worktree off `worktree-home-scroll-experience`, i.e. PR #246)
Related: #249 (first-load waterfall), #252 (JS route-preload, the sibling this extends)

## 1. Problem

`apps/site/src/Layout.tsx` is the root layout for every route, and it links one
render-blocking stylesheet:

```tsx
import root from '@/styles/root.css?url';
// ...
<link rel="stylesheet" href={root} />
```

`root.css` is a 2730-line monolith that `@import`s the 1932-line `home.css` and
carries ~1900 lines of `.docs-*` / `.mdx-content` / `.demo-*` / `.sa-*` component
demo and app styles. Built and gzipped it is roughly 20KB, shipped
render-blocking on **every** route. The home page pays for every docs demo's CSS;
docs and demo pages pay for the entire home experience.

Source-side gzipped proxy of the split (measured 2026-07-07):

| Section | gz | Loads today | Loads after |
| --- | --- | --- | --- |
| Global head (tokens, `@theme`, utilities, shared view-transition rules) | ~6.8KB | every route | every route |
| `home.css` | ~12.1KB | every route | `/` only |
| docs/demo hand-written CSS | ~8.5KB | every route | `/docs`, `/demo` only |

(The always-loaded sheet also carries the Tailwind utility layer from
`@import 'tailwindcss'`, which is shared vocabulary and stays global.)

The root cause is structural: the framework has **no route-scoped CSS path**, so
the only way to ship any CSS is to link it globally. Everything landed in one
sheet because there was nowhere else to put it.

## 2. The insight

This is the CSS twin of the JS route-preload shipped in #252. That work already
built every seam we need:

- a `generateBundle` client artifact `PreloadArtifact { closure, routes }`,
- a memoized, platform-agnostic adapter reader (`resolvePreloadManifest`),
- a route matcher `selectRoutePreload(map, path)` (exact-key shortcut, then
  `findBestPattern`),
- a single head-injection owner, `document-shell.ts`.

Vite already code-splits CSS per chunk and records each chunk's CSS on
`chunk.viteMetadata.importedCss`. So the feature is: **at build time, resolve
each route chunk's CSS closure; at render time, inject the matched route's
`<link rel="stylesheet">` into the SSR head**, reusing the existing artifact,
reader, and matcher.

## 3. Goals / non-goals

**Goals**

- A framework primitive that maps a matched route to its own CSS assets and
  injects them, render-blocking, into the SSR document head. FOUC-free first
  paint for route-scoped styles.
- Reuse the #252 seams; no parallel artifact/reader/matcher.
- Convert `apps/site` to the new convention as the first consumer, shrinking the
  always-loaded sheet.
- First-class documentation for humans and LLMs so app authors follow the
  route-scoped convention (see Layer-1 docs deliverable, section 6).

**Non-goals (this spec)**

- No Lightning-CSS-powered monolith auto-split (Layer 3; documented as next work
  in section 7, not built here).
- No per-route splitting of the Tailwind utility layer (shared, low value, dedup
  risk). Tailwind stays one global layer.
- No change to client-side navigation CSS: Vite's runtime already injects a
  dynamically imported chunk's CSS (deduped by `href`). This spec only fills the
  SSR first-paint gap that runtime injection cannot cover.

## 4. Architecture (Layer 1: route to CSS delivery)

### 4.1 Build side (`packages/vite`)

Add a CSS resolver that is the structural sibling of `resolvePreloadMap` in
`route-preload.ts`. It reuses the same route-chain extraction
(`extractRouteChains`) and the same chunk-closure walk (`collectStaticChunks`);
it differs only in what it collects from each chunk:

```ts
export type RouteCssMap = Record<string, string[]>;

// For each route pattern, walk the chain's static chunk closure (same walk the
// JS map uses) and union each chunk's viteMetadata.importedCss, minus the client
// entry's CSS closure (already loaded on every route). Hrefs are root-relative,
// matching the JS map and Vite's own runtime injection.
export function resolveRouteCssMap(
  chains: readonly RouteModuleChain[],
  bundle: Record<string, RouteBundleChunkLike>,
): RouteCssMap;
```

- Extend `RouteBundleChunkLike` with `viteMetadata?: { importedCss?: Set<string> }`.
  Rollup's real `OutputChunk` carries this (Vite adds it), so the plugin passes
  the live bundle through unchanged; the field is only surfaced on the reader
  type. No cast: declare the optional field and read it.
- Entry-CSS subtraction is symmetric with the JS closure. When an app links its
  global CSS via `?url` in the Layout (as the site does today), that CSS is a
  standalone asset, not attached to the entry chunk's `importedCss`, so the
  subtraction is a no-op and route CSS resolves cleanly. When an app instead
  `import`s global CSS from its client entry, the subtraction prevents
  double-linking.

Extend the emitted artifact in `preload-manifest.ts`:

```ts
export interface PreloadArtifact {
  closure: string[];
  routes: RoutePreloadMap;
  routeCss: RouteCssMap; // new
}
```

`buildRouteMap` already reads `routes.ts` and resolves chains; compute
`routeCss` from the same chains in the same `generateBundle` pass. Same
best-effort degradation: any failure yields an empty map, never a build error.

### 4.2 Server side (`packages/server`)

- `preload-modules.ts`: extend `PreloadManifest` with `routeCss: RouteCssMap`;
  `normalizeManifest` normalizes it with the existing `normalizeRoutes` coercion
  (the shape is identical: `Record<string, string[]>`). Empty default.
- `render.tsx`: after selecting `routePreload`, select the route's CSS with the
  **same** matcher, `selectRoutePreload(routeCss, routePath)`. No new matcher.
  Pass the result to `assembleDocument` as `routeStyleSheets`.
- `document-shell.ts`: render each route stylesheet as
  `<link rel="stylesheet" href=...>` via the existing escaping (`toAttrs`).

### 4.3 Head ordering and the render-critical distinction

Two ordering rules, both load-bearing:

1. Route stylesheets are injected **after** the app's own head links
   (`userHeadTags`, which include the global `root.css`). Later rules win
   equal-specificity ties, which matches how the monolith already ordered docs
   rules after the base rules. This preserves the current cascade.
2. Route stylesheets are **render-critical**, unlike the `modulepreload` hints.
   The current missing-`</head>` warning deliberately excludes framework preload
   hints (dropping a hint is acceptable; the `Link` header still carries the
   closure). A dropped route stylesheet is a broken page (FOUC or unstyled
   route), so route stylesheets **must** count toward that warning, alongside
   `userHeadTags`. Concretely: fold `routeStyleSheets` into the render-critical
   set the warning guards, not the preload set it ignores.

`assembleDocument` head order becomes:
`[...preloadTags, ...userHeadTags, ...routeStyleTags]`.

### 4.4 `Link` header / Early Hints

Layer 1 injects only the in-document `<link rel="stylesheet">`. It sits high in
the head and is discovered immediately, so first paint is protected. A
`Link: <...>; rel=preload; as=style` header (promotable to 103 Early Hints)
would start the CSS fetch before body parse and is a natural enhancement, but it
shares the ~12KB `Link`-header budget with the JS closure and adds edge-cap
risk. Deferred; not in Layer 1. Noted so it is a conscious omission, not a miss.

### 4.5 Dev behavior

The artifact is a production build output. In dev there is no artifact and the
reader returns the empty manifest, so no route stylesheets are injected;
route-module CSS imports are served and injected by Vite's own dev pipeline (HMR
style injection) exactly as any Vite app. Route-scoped head injection is a
production optimization; dev correctness is unchanged.

## 5. Site migration (`apps/site`, first consumer)

Split `root.css` along the section boundaries measured above:

- `root.css` (global, still linked in `Layout.tsx` via `?url`): keeps
  `@import 'tailwindcss'`, `@font-face`, `@theme` blocks, `:root` token blocks
  (light/dark), `@utility` declarations, `:focus-visible`, and the **shared**
  view-transition rules that apply to cross-section navigation (the root
  slide/fade). Drops the `@import './home.css'`.
- `home.css` (route sheet): imported by `src/pages/home.tsx` (the `/` view
  module) via a side-effect `import '@/styles/home.css'`. All hero/wire/chapter
  styles and home-only tokens.
- `docs.css` (new route sheet): imported by `src/components/DocsLayout.tsx`. All
  `.mdx-content`, `.docs-*`, `.sa-*`, Shiki, and docs-only view-transition rules
  (`docs-zoom`, `docs-sidebar`/`docs-topbar`, `docs-within`).
- `demo.css` (new route sheet): imported by the demo layout module. All
  `.demo-*` styles and demo-only view-transition rules (`demo-sidebar`,
  `demo-activity-bar`, the `.task-card` morph).

Notes and risks:

- **View-transition rules that fire at a section boundary.** The global
  slide/fade rules stay global (they run on any nav, including home to docs). The
  `docs-within` / `demo-within` rules only fire while inside a section where the
  sheet is present, so they can move to the section sheet. The one area to verify
  under real navigation is a transition that leaves a section (docs to home): the
  outgoing snapshot is captured while `docs.css` is still applied, so the leave
  animation should be correct, but this must be tested (see 8), not assumed.
- **Tailwind stays one global layer.** Utilities used only in docs/demo are still
  emitted into the global sheet. That is intended: the prize is the hand-written
  component CSS, not the shared utility vocabulary.
- **Order within a route.** `root.css` (global) loads first via the Layout link;
  the route sheet loads after via framework injection, so route rules keep their
  current cascade position relative to base rules.

## 6. Documentation and LLM guidance (Layer 1 deliverable)

A route-scoped CSS convention only pays off if app authors and the LLMs
scaffolding their apps follow it. This is a first-class deliverable of Layer 1,
not an afterthought.

- **Docs page** under `apps/site/src/pages/docs/` (guides section): how CSS is
  delivered in hono-preact. Covers: the always-loaded global sheet (tokens,
  Tailwind, shared transitions) linked in the Layout; per-route CSS via a
  side-effect `import` in the route's view/layout module; that the framework
  injects the matched route's stylesheet into the SSR head automatically (no
  manual `<link>`); that client navigation loads route CSS via Vite; and the
  cascade/ordering guarantee (global first, route sheet after). Follow the local
  `add-docs-page.md` skill and the docs conventions (self-contained, no
  historical "replaces X" breadcrumbs, CSS/Tailwind tab parity where a snippet
  has both).
- **LLM / agent corpus.** The scaffolder ships an agents corpus
  (`pnpm gen:agents-corpus` into `templates/agents/llms-full.txt`) and the site
  serves `/llms.txt` + `/llms-full.txt`. The new docs page must flow into these
  so an LLM building on hono-preact is told the convention. Add a short, explicit
  rule to the agent guidance: put route-specific CSS in the route module's own
  stylesheet; keep the global sheet to tokens, Tailwind, and cross-route
  transitions; do not re-link route CSS manually.
- **Gotcha callout.** Document the known Lightning CSS behavior (standalone
  `translate`/`scale`/`rotate` next to `transform` is dropped by the prod
  minifier) where it is relevant, so authors keep centering in a single
  `transform`. This is already lived experience in the codebase; surface it.

## 7. Layer 3 (next work, documented not built): monolith auto-split

The chosen scope is "build Layer 1 now, document Layer 3 to do next." Layer 3 is
the ambitious generalization: a framework tool that takes a single stylesheet and
tree-shakes it into per-route sheets by the selectors each route actually uses,
so an author can keep authoring one CSS file and still ship route-scoped bytes.

- **Engine: Lightning CSS.** This is where Lightning CSS earns its place in the
  framework toolchain. Its Rust parser + `visitor` / `bundle` API can resolve
  `@import`, walk rules, and re-serialize per-route subsets fast; its `targets`
  option can additionally lower modern CSS to the framework's Baseline Widely
  Available browser floor (a direct fit with the browser-support policy). If
  Layer 3 is built, opting the `honoPreact` preset into
  `build.cssMinify: 'lightningcss'` with policy-derived `targets` is the
  companion move, making minification and lowering framework-owned and
  consistent.
- **Why it is hard (the reason it is next, not now).** Usage-based selector
  pruning on a dynamic SPA is fragile: classes added at runtime, `data-*` and
  state variants, and view-transition pseudo-elements that only apply mid-
  navigation are all invisible to static HTML scanning. A per-route selector
  allowlist risks pruning a rule the route needs under interaction. The
  author-driven split in Layer 1 gets the same byte win deterministically, which
  is why it ships first.
- **Known footgun to design around.** The Lightning CSS
  `translate`/`scale`/`rotate` drop (above) shows Lightning CSS transforms can
  change semantics; any Layer 3 tool must round-trip-test against the built site,
  not just diff selector counts.

Layer 3 stays a documented future direction here; its own spec and plan come
later.

## 8. Testing strategy

Unit (pure, no real build), mirroring the #252 test suite:

- `resolveRouteCssMap`: fixture bundles with `viteMetadata.importedCss` sets;
  assert per-pattern CSS closure, entry-CSS subtraction, dedup, empty-path to `/`
  keying, and collision union (reuse the `route-preload.test.ts` fixtures with
  CSS added).
- `normalizeManifest`: `routeCss` present / absent / malformed all degrade to a
  valid map.
- `selectRoutePreload` reused for CSS: covered by existing matcher tests; add a
  case asserting a route with CSS but no extra JS chunks still resolves its
  stylesheet.
- `document-shell`: route stylesheets render as `<link rel="stylesheet">` after
  `userHeadTags`; a missing `</head>` with route stylesheets present fires the
  render-critical warning (new assertion), while preload-only still does not.

Integration:

- A render test asserting the SSR head for `/` contains the home stylesheet link
  and does **not** contain the docs/demo stylesheet, and vice versa for a docs
  path.

Site-level:

- Extend `scripts/measure-site-chunks.mjs` (or add a CSS sibling) so the
  client-size PR job reports always-loaded CSS bytes, making the shrink visible
  and regressions caught. Verify the real built numbers against the source-side
  proxies in section 1.
- Manual view-transition verification of the docs-to-home and demo-to-home leave
  animations under `wrangler dev` (MCP cannot verify view transitions; see the
  known limitation).

## 9. CI-parity and rollout

All eight pre-push CI-parity steps apply (framework build, agents corpus,
format:check, typecheck, test:types, test:coverage, test:integration, site
build). The agents-corpus step matters here because the new docs page feeds it.

Rollout is a single PR off `feat/route-scoped-css` (branched from #246): the
framework primitive (vite + server), the site migration, and the docs/LLM
deliverable together, so the primitive ships with a working reference consumer
and its documentation in one reviewable unit.

## 10. Open questions

- Exact home/docs/demo section boundaries in `root.css` (the line ranges in
  section 1 are approximate; the migration nails them by selector, verified by a
  clean rebuild diff so no rule is dropped or duplicated).
- Whether `docs.css` and `demo.css` share enough to warrant a common
  `components-demo.css`, or stay separate per section (default: separate, matching
  the route boundary; revisit if duplication is material).
