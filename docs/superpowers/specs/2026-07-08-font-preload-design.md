# Font preload offer (framework)

Date: 2026-07-08
Status: Design approved; folds into PR #254 (branch `feat/route-scoped-css`)
Related: the route-scoped CSS work in the same PR (shares the `document-shell` head-injection and `render.tsx` `Link`-header seams); #249 (first-load waterfall)

## Problem

Web fonts are discovered late: the browser fetches the CSS, parses it, finds the
`@font-face src: url(...)`, and only then fetches the font. That is a waterfall
hop. The site ships 4 Selawik weights (~14KB each, ~58KB total) declared in the
global sheet at `font-display: optional`.

Inlining the fonts as data URIs would remove the fetch but is the wrong tool
here: woff2 is already Brotli-compressed (base64 adds ~33% that does not gzip
back), so inlining all four dumps ~58-77KB onto the render-blocking global CSS
that loads on every route, delaying first paint to accelerate fonts the page has
declared optional. The mechanism that flattens the waterfall without that cost is
**preload**: start the font fetch in parallel with the CSS, keep the font
separately cacheable, and add nothing to the render-blocking CSS.

## Decision

Offer font preloading as a framework capability. The app lists the critical
weights explicitly; the framework emits a correct `<link rel="preload">` into the
SSR head and an equivalent `Link` header (promotable to 103 Early Hints). This
reuses the `AppConfig -> document-shell` head path (where `speculationRulesTag`
already injects) and the `render.tsx` `Link`-header path.

Explicit over auto-discovery: preloading every `@font-face` is a known
anti-pattern (Lighthouse flags wasted preloads); only the 1-2 above-the-fold
weights are worth the early bandwidth, and only the app knows which those are.

## Design

### 1. `AppConfig.fonts` (`packages/iso/src/define-app.ts`)

```ts
export type AppConfig = {
  use?: ...;
  speculation?: boolean;
  /**
   * Font URLs (from `?url` imports) to preload as render-critical resources.
   * List only above-the-fold weights: preloading every font wastes early
   * bandwidth. Each URL is emitted as `<link rel="preload" as="font" ...>` in
   * the head and in the `Link` response header.
   */
  fonts?: ReadonlyArray<string>;
};
```

The app imports each critical font with `?url` so it hands over the already
content-hashed build URL:

```ts
import regular from '@/styles/fonts/selawik-regular.woff2?url';
import semibold from '@/styles/fonts/selawik-semibold.woff2?url';
export default defineApp({ speculation: true, fonts: [regular, semibold] });
```

Vite content-hashes assets, so the `?url` href is byte-identical to the URL the
CSS `url()` reference resolves to; the preload is reused, not double-fetched.

### 2. Head injection (`packages/server/src/document-shell.ts`)

`fontPreloadTags(config: AppConfig): string[]`, mirroring `speculationRulesTag`,
returns one tag per font:

```html
<link rel="preload" as="font" type="font/woff2" crossorigin href="/static/selawik-regular-….woff2" />
```

- `type` is inferred from the extension (`fontMimeType`: `.woff2` -> `font/woff2`,
  `.woff` -> `font/woff`, `.ttf` -> `font/ttf`, `.otf` -> `font/otf`; unknown -> omit).
  `type` lets the browser skip a format it cannot use.
- `crossorigin` is always present (empty = anonymous). Fonts are fetched in CORS
  mode even same-origin; a preload without `crossorigin` does not match the
  actual request and double-fetches. This is the footgun the framework removes.
- Placed **first** in the head, ahead of the `fetchpriority="low"` modulepreload
  hints, since fonts are render-critical (default High priority) and want the
  earliest discovery.
- Treated as a **droppable hint** for the missing-`</head>` warning, like the
  modulepreload hints (not like the render-critical route stylesheets): the
  `Link` header still carries them, so dropping the head tag is not a broken page.

New head order: `[...fontPreloadTags, ...preloadTags, ...userHeadTags, ...routeStyleTags]`.

### 3. `Link` header / Early Hints (`packages/server/src/render.tsx` + a helper)

Add `fontPreloadLinkHeader(fonts: readonly string[]): string | undefined`
(sibling of `preloadLinkHeader`) producing entries:

```
</static/selawik-regular-….woff2>; rel=preload; as=font; type=font/woff2; crossorigin
```

`render.tsx` builds the combined `Link` value with **fonts first** (render-
critical, higher-priority hint), then the closure's `modulepreload` entries:

```ts
const linkHeader = [
  fontPreloadLinkHeader(options?.appConfig?.fonts ?? []),
  preloadLinkHeader(closure),
].filter(Boolean).join(', ');
if (linkHeader) c.header('Link', linkHeader, { append: true });
```

Font entries are few and tiny, so they always fit under the existing
`LINK_HEADER_BUDGET`; the closure portion keeps its own truncation.

### 4. Site consumer (`apps/site/src/app-config.ts`)

Add the above-the-fold weights (regular + one heading weight) via `?url`.
Font-display stays a site knob: keep `font-display: optional` (preload now gives
the brand font a real chance to win the no-CLS optional window), or switch to
`swap` if a guaranteed swap-in is preferred. Default: keep `optional` (minimal
change, no layout shift).

### 5. Docs

Extend `/docs/styling` with a "Preload critical fonts" section: the `AppConfig`
`fonts` option, `?url` imports, the correct `as`/`type`/`crossorigin` (and why
`crossorigin` is mandatory), and the "preload only above-the-fold weights"
guidance.

## Testing

- `fontPreloadTags` / `fontMimeType` (unit, document-shell): one correct tag per
  font; type inference per extension and omission for unknown; `crossorigin`
  present; empty/omitted `fonts` -> no tags; font tags do NOT trip the
  missing-`</head>` warning; head order (fonts before modulepreload).
- `fontPreloadLinkHeader` (unit): correct `rel=preload; as=font; type; crossorigin`
  entry format; empty -> undefined.
- `render.tsx` (integration): with `appConfig.fonts` set, the `Link` header
  contains the font preload entries before the closure's modulepreload entries,
  and the head contains the font `<link rel=preload>`; with no fonts, unchanged.
- `AppConfig.fonts` type (test-d if a type-level assertion fits the existing
  `*.test-d.ts`).

## Non-goals

- No auto-discovery of `@font-face` (explicit is the correct, anti-pattern-
  avoiding choice).
- No general `<link rel=preload>` API for arbitrary `as` values (fonts-specific
  keeps `as`/`type`/`crossorigin` correct by construction; YAGNI).
- No change to `font-display` in the framework (a site-side stylesheet knob).
- No font subsetting (a build-tool concern outside this offer).

## Public-API / breaking surface

Additive only: `AppConfig` gains an optional `fonts` field; `assembleDocument`
consumes it via the existing `appConfig` param. No breaking change.
