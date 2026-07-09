# CSS auto-split (Layer 3): Lightning-CSS-powered monolith splitting

Date: 2026-07-09
Status: approved design, pre-plan
Prior art: `2026-07-07-route-scoped-css-design.md` section 7 (Layer 3, documented
not built), issue #249 (the waterfall program this belongs to), PR #252 (route
JS preload), PR #254 (route-scoped CSS delivery, Layer 1).

## 1. Problem and goal

Layer 1 (shipped in #254) delivers a route's own stylesheet render-blocking in
the SSR head, but requires the author to hand-split CSS into per-route files.
Layer 3 removes that requirement: an author keeps writing one global
stylesheet, and the framework tree-shakes it at build time into a residual
global sheet plus per-chunk sheets, delivered through the existing route-CSS
machinery. The engine is Lightning CSS (parse, visitor, serialize), which also
becomes the framework's CSS minifier with browser targets derived from the
Baseline Widely Available support floor.

**Safety invariant (governs every decision below):** splitting is an
optimization, never a correctness risk. A rule that cannot be *proven*
route-exclusive stays in the global sheet. No rule is ever dropped; this tool
does not purge "unused" CSS.

## 2. Decisions made during brainstorming

- **Consumer:** framework feature; the docs site dogfoods it by re-merging its
  hand-split sheets into one monolith.
- **Attribution:** built-chunk string scan (see section 4), not prerendered-HTML
  scanning (blind to runtime-toggled classes) and not author annotations
  (that's Layer 1 with extra steps).
- **Minifier:** the preset opts all users into `cssMinify: 'lightningcss'` with
  Baseline-derived `targets`, unless the user configured either themselves.
- **Default:** auto-split is on by default *for apps that hand the framework
  their global stylesheet* (`css.global` set); `autoSplit: false` opts out
  while keeping framework delivery. Apps using a manual `?url` link are outside
  the feature and unchanged.
- **Cascade semantics:** route-sheet tie semantics, identical to Layer 1's
  documented contract (route sheets load after the global sheet and win
  equal-specificity ties). The tool's promise is "the same result as
  hand-splitting, automated." Order-preserving `@layer` encoding was considered
  and rejected: it makes unlayered CSS outside the pipeline beat the entire
  output unconditionally, a worse semantic change than the tie flips it
  prevents, and it inverts `!important` resolution.

## 3. Delivery contract: framework-owned global CSS

Today the framework never delivers global CSS. The site imports
`root.css?url` and renders its own `<link>` in `Layout.tsx`; scaffolded apps
ship no CSS. A hand-authored link is a hard blocker for splitting: the
monolith's hashed URL is baked into built JS as a string, so a build-stage
split cannot repoint it, and rewriting the asset's bytes in place under its
original content-derived filename would poison immutable CDN caches whenever
chunk evidence shifts between builds.

New preset surface:

```ts
honoPreact({
  adapter: ...,
  css: {
    global: 'src/styles/root.css', // path relative to project root
    autoSplit: true,               // default true when `global` is set
    minSize: 1024,                 // bytes; smaller exclusive CSS stays global
  },
})
```

Mechanics:

- The plugin adds `css.global` as an import of the generated client entry, so
  Vite's normal CSS pipeline (PostCSS, Tailwind v4) processes it and it
  surfaces as the entry chunk's `viteMetadata.importedCss`.
- The splitter (section 4) runs at `generateBundle` in the client build, emits
  split sheets as fresh content-hashed assets via `emitFile`, and drops the
  original monolith asset from the bundle (nothing references it once the
  framework owns injection).
- The `__hp-preload.json` artifact gains a `globalCss` field beside
  `closure` / `routes` / `routeCss`, listing the residual global sheet(s).
  Per-chunk scoped sheets fold into `routeCss` through the existing
  `resolveRouteCssMap` union.
- `renderPage` injects head links in order: font preloads, modulepreloads,
  user head, global sheet(s), route sheets. Global and route CSS are
  render-critical (they participate in the missing-`</head>` warning like
  Layer 1 route sheets). No `Link` header entries for CSS in v1.
- **Dev:** the framework injects a link to the dev-served source URL of
  `css.global`, byte-for-byte what the site's manual link does today, so dev
  is at parity. Splitting is prod-only. The dev route-CSS FOUC remains issue
  #258, unchanged by this work.

This contract change is independently valuable: frameworks that own
`index.html` get entry-CSS injection from Vite for free, and our self-generated
head is exactly why the site needed the `?url` workaround (see the #254 review
note that removed the eagerCss subtraction because "nothing SSR-injects" entry
CSS).

## 4. The splitter engine

A `generateBundle`-stage module in `packages/vite` beside `route-preload.ts`,
client environment only.

**Attribution unit: the chunk, not the route pattern.** Judging exclusivity
per route pattern would demote all layout CSS to global (a `DocsLayout` class
appears in every `/docs/*` pattern's chain and looks shared). Instead a rule is
scoped to a single JS chunk; the splitter effectively synthesizes an extra
`importedCss` entry for that chunk, and the existing per-chunk-to-pattern union
in `resolveRouteCssMap` delivers it to every route whose chain contains the
chunk. Layout CSS rides the layout chunk to all child routes; a lazy component
shared by two routes rides to exactly those two. Per-chunk sheets preserve
cross-navigation cache reuse (navigating `/docs/a` to `/docs/b` does not
refetch the layout's CSS), mirroring the JS chunking philosophy.

**Evidence index.** Over *every* JS chunk in the client bundle (entry closure,
mapped route chunks, and unmapped or lazy chunks alike), record which chunks'
code contain each candidate class name as a plain substring. Class names come
unescaped from the Lightning CSS selector AST, so Tailwind arbitrary-value
forms (`lg:hover:bg-red-500/50`) scan correctly. Substring matching is
deliberately crude: it catches JSX literals, `clsx` arguments, and classes
inside embedded HTML strings (Shiki-highlighted MDX output), and its false
positives only widen a class's apparent usage, which pushes rules toward
global, the safe direction. Covering unmapped chunks is load-bearing: a route
whose chunk resolution fell back (#252's exotic-shape fallback) must still
count as evidence, or its classes could look exclusive to another chunk.

**Scoping rule.** A rule is scoped iff:

1. every selector in its selector list contains at least one class, and
2. the union of all class names across the rule is exclusive to one single
   chunk (present in that chunk's code, absent from every other chunk in the
   bundle).

Everything else stays global: zero-evidence classes (runtime-constructed
names, classes appearing only in server-side data), multi-chunk classes,
selectors with no class (`:root`, element, attribute, and pseudo-element
selectors including `::view-transition-*`, which are cross-route by nature).
`@keyframes`, `@font-face`, `@property`, and custom-property-only rules stay
global in v1. Selector lists are atomic in v1 (no per-selector splitting).

**At-rule wrapping.** `@media`, `@supports`, and `@layer` wrappers are
reproduced around scoped rules in the emitted sheet. The layer-order
declaration (Tailwind's `@layer theme, base, components, utilities;`) stays in
the residual global sheet, which loads first and establishes order, so a route
sheet's `@layer utilities { ... }` merges into the established order. The
residual keeps the order declaration even if a layer empties.

**minSize threshold.** A chunk whose exclusive CSS totals fewer than
`css.minSize` bytes (default 1024) keeps its rules global rather than costing a
link tag and a request.

**Conservation self-check.** At build time the splitter verifies every input
rule landed in exactly one output sheet and fails the build loudly otherwise.

## 5. Lightning CSS minification and Baseline targets

The preset sets `build.cssMinify: 'lightningcss'` and
`css.lightningcss.targets` from a framework-owned constant encoding the
Baseline Widely Available browser floor, for all users regardless of
`css.global`. User-configured values for either always win. The splitter
serializes its emitted sheets through the same engine with the same targets,
so one parser/serializer owns all CSS semantics end to end. `packages/vite`
takes `lightningcss` as a real dependency (already in the tree at 1.32.0 via
Tailwind v4). The known translate/scale/rotate drop (standalone `translate` /
`scale` / `rotate` in the same rule as a `transform` is removed by the
minifier) already bites via Tailwind's internal Lightning CSS and is documented
in `/docs/styling`; it must be re-verified under the new minifier path since it
now applies to all framework CSS.

## 6. Site dogfood

- Re-merge `home.css`, `docs.css`, and `demo.css` into `root.css` (restoring
  the pre-#254 monolith shape) and drop the route modules' CSS imports.
- Remove the manual `?url` link from `Layout.tsx`; set
  `css: { global: 'src/styles/root.css' }` in `vite.config.ts`.
- Success bar: per-route shipped CSS within roughly 10% of the hand-split
  baseline, read from the existing `measure-site-chunks` CSS section, plus
  visual verification of home, a docs page, and a demo page against the built
  site.
- Hand-split route sheets remain fully supported and compose with auto-split
  (Layer 1 sheets pass through untouched). `/docs/styling` is rewritten to
  present auto-split as the default path and hand-split as the explicit-control
  path; the agents corpus (`pnpm gen:agents-corpus`) picks up the change.

## 7. Documented limitations

Breakage requires a double failure: a class constructed dynamically at runtime
by one route *and* appearing as a string literal in exactly one other chunk.
Either condition alone degrades safely to global (zero-evidence and
multi-chunk classes both stay global). This limitation goes in `/docs/styling`
and the agents corpus verbatim, alongside the existing guidance. The base-path
limitation from Layer 1 (`base` other than `/` would 404 render-critical
sheets) is inherited unchanged.

## 8. Testing

Mirrors the #252/#254 suites:

- **Unit (fixture bundles, no real build):** evidence index construction
  (escaped class names, embedded-HTML strings, unmapped-chunk coverage);
  attribution (exclusive class scopes, multi-chunk demotes, zero-evidence
  demotes, selector-list atomicity, classless selectors stay global); at-rule
  wrapping and layer preservation; minSize; conservation failure raises.
- **Round-trip:** the union of emitted sheets is rule-equivalent to the input
  monolith under real Lightning CSS serialization (not selector counts), per
  the Layer 3 footgun note in the prior spec.
- **Artifact/server:** `globalCss` flows through `PreloadManifest`
  normalization and both adapter readers; `renderPage` injects global before
  route sheets in the specified head order; missing-`</head>` warning covers
  global sheets.
- **Integration:** built-site check that `/` ships home-scoped CSS and not
  docs-scoped CSS, and the conservation invariant holds on the real monolith.
- Standing gates: all 8 CI-parity steps; translate/scale/rotate gotcha
  re-verified under `cssMinify: 'lightningcss'`.

## 9. Out of scope for v1

- Scoping `@keyframes` / `@font-face` referenced only by scoped rules.
- Splitting multi-selector rule lists per selector.
- Scoping to chunk *sets* (classes shared by exactly two chunks).
- Annotation escape hatches (force-global or force-route directives).
- Dev-mode route-CSS FOUC (#258) and dev-mode splitting.
- `Link` header / Early Hints treatment for CSS.
- Non-`/` `base` support (inherited Layer 1 limitation).
