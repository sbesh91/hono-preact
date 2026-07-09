# Font preload offer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let an app declare its critical fonts on `AppConfig.fonts`; the framework injects a correct `<link rel="preload" as="font" crossorigin>` into the SSR head and an equivalent `Link` header (103 Early Hints), flattening the font-fetch waterfall without the render-blocking-CSS cost of inlining.

**Architecture:** Reuses the `AppConfig -> document-shell` head path (where `speculationRulesTag` already injects) and the `render.tsx` `Link`-header path. Pure font logic (MIME inference, header entries) lives in a new `packages/server/src/font-preload.ts`; the head `<link>` tags render in `document-shell.ts` (which owns HTML escaping).

**Tech Stack:** TypeScript, Preact SSR, Hono, Vitest. Folds into PR #254 (branch `feat/route-scoped-css`).

## Global Constraints

- **No em-dashes** (`—`) in code, comments, or commit messages. Use commas/semicolons/colons/parentheses.
- **Commit trailer** on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **No inline `as` casts.**
- **Work in the worktree** `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/route-css` on branch `feat/route-scoped-css`; worktree-absolute paths; no Serena; ignore stale LSP diagnostics (they index the main checkout).
- **Do not push until Task 4.** Then push to the existing `feat/route-scoped-css` (updates PR #254); do not open a new PR.
- **`crossorigin` is mandatory on font preloads** (fonts fetch in CORS mode even same-origin; without it the preload double-fetches). Rendered as an empty attribute (`crossorigin=""`) in the head tag and as a bare `crossorigin` param in the `Link` header.
- **TDD:** failing test first, watch it fail, implement, watch it pass, commit.

Test runner: `pnpm test <path>` (vitest). Package build: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`.

---

### Task 1: Pure font-preload helpers

**Files:**
- Create: `packages/server/src/font-preload.ts`
- Test: `packages/server/src/__tests__/font-preload.test.ts`

**Interfaces:**
- Produces: `fontMimeType(href: string): string | undefined`; `fontPreloadLinkHeader(fonts: readonly string[]): string | undefined`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/font-preload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fontMimeType, fontPreloadLinkHeader } from '../font-preload.js';

describe('fontMimeType', () => {
  it('maps known font extensions, ignoring a query string', () => {
    expect(fontMimeType('/static/x-abc.woff2')).toBe('font/woff2');
    expect(fontMimeType('/static/x.woff')).toBe('font/woff');
    expect(fontMimeType('/static/x.ttf')).toBe('font/ttf');
    expect(fontMimeType('/static/x.otf')).toBe('font/otf');
    expect(fontMimeType('/static/x.woff2?v=1')).toBe('font/woff2');
  });
  it('returns undefined for an unrecognized extension', () => {
    expect(fontMimeType('/static/x.eot')).toBeUndefined();
    expect(fontMimeType('/static/noext')).toBeUndefined();
  });
});

describe('fontPreloadLinkHeader', () => {
  it('builds an RFC 8288 preload entry per font with as=font, type, and crossorigin', () => {
    expect(fontPreloadLinkHeader(['/static/a.woff2', '/static/b.woff2'])).toBe(
      '</static/a.woff2>; rel=preload; as=font; type=font/woff2; crossorigin, ' +
        '</static/b.woff2>; rel=preload; as=font; type=font/woff2; crossorigin'
    );
  });
  it('omits the type param when the extension is unrecognized', () => {
    expect(fontPreloadLinkHeader(['/static/x.eot'])).toBe(
      '</static/x.eot>; rel=preload; as=font; crossorigin'
    );
  });
  it('returns undefined for no fonts (so no empty header is set)', () => {
    expect(fontPreloadLinkHeader([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/server/src/__tests__/font-preload.test.ts`
Expected: FAIL (`fontMimeType is not a function`).

- [ ] **Step 3: Implement `packages/server/src/font-preload.ts`**

```ts
// Font preload helpers: infer a font URL's MIME type from its extension and
// build the `Link` response-header entries. The head `<link rel="preload">`
// tags render in document-shell.ts (which owns HTML escaping); this module is
// the pure type/header logic, unit-testable without the document shell.

/** The MIME type for a font URL by extension, or undefined if unrecognized. */
export function fontMimeType(href: string): string | undefined {
  const ext = href.split('?')[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'woff2':
      return 'font/woff2';
    case 'woff':
      return 'font/woff';
    case 'ttf':
      return 'font/ttf';
    case 'otf':
      return 'font/otf';
    default:
      return undefined;
  }
}

/**
 * An RFC 8288 `Link` header value preloading the given font URLs, or undefined
 * when there are none (so callers skip the header rather than emit an empty
 * one). Each entry is `rel=preload; as=font; crossorigin` (fonts are always
 * fetched in CORS mode, so crossorigin is required to reuse the preload) plus
 * `type=<mime>` when the extension is recognized. Promotable to 103 Early Hints.
 */
export function fontPreloadLinkHeader(
  fonts: readonly string[]
): string | undefined {
  const entries = fonts.map((href) => {
    const type = fontMimeType(href);
    const parts = [`<${href}>`, 'rel=preload', 'as=font'];
    if (type) parts.push(`type=${type}`);
    parts.push('crossorigin');
    return parts.join('; ');
  });
  return entries.length > 0 ? entries.join(', ') : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/server/src/__tests__/font-preload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/font-preload.ts packages/server/src/__tests__/font-preload.test.ts
git commit -m "feat(server): font MIME + Link-header helpers for preload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `AppConfig.fonts` + head `<link rel=preload>` injection

**Files:**
- Modify: `packages/iso/src/define-app.ts` (add the `fonts` field)
- Modify: `packages/server/src/document-shell.ts` (render font preload tags first in the head)
- Test: `packages/server/src/__tests__/document-shell-preload.test.ts` (add cases)

**Interfaces:**
- Consumes: `fontMimeType` from Task 1; the existing `toAttrs` in `document-shell.ts`; `assembleDocument`'s existing `appConfig` param.
- Produces: `AppConfig.fonts?: ReadonlyArray<string>`; font `<link rel="preload">` tags emitted first in the head.

- [ ] **Step 1: Add the `AppConfig.fonts` field**

In `packages/iso/src/define-app.ts`, add to the `AppConfig` type (after `speculation?`):

```ts
  /**
   * Font URLs (from `?url` imports) to preload as render-critical resources.
   * List only above-the-fold weights: preloading every font wastes early
   * bandwidth. Each URL is emitted as `<link rel="preload" as="font"
   * crossorigin>` in the head and in the `Link` response header.
   */
  fonts?: ReadonlyArray<string>;
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/server/src/__tests__/document-shell-preload.test.ts` a new describe block (the file already imports `assembleDocument` and defines `shell` / `noHeadShell`):

```ts
describe('assembleDocument: font preloads', () => {
  it('injects a crossorigin font <link rel=preload> with an inferred type for each AppConfig font', () => {
    const out = assembleDocument({
      html: shell,
      head: {},
      appConfig: { fonts: ['/static/regular-abc.woff2'] },
    });
    expect(out).toContain(
      '<link rel="preload" as="font" type="font/woff2" href="/static/regular-abc.woff2" crossorigin="" />'
    );
  });

  it('places font preloads before the low-priority modulepreload hints', () => {
    const out = assembleDocument({
      html: shell,
      head: {},
      preloadModules: ['/static/a.js'],
      appConfig: { fonts: ['/static/regular-abc.woff2'] },
    });
    expect(out.indexOf('/static/regular-abc.woff2')).toBeLessThan(
      out.indexOf('/static/a.js')
    );
  });

  it('injects nothing when there are no fonts', () => {
    const out = assembleDocument({ html: shell, head: {}, appConfig: {} });
    expect(out).not.toContain('as="font"');
  });

  it('does NOT warn about a missing </head> when only font preloads would be dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assembleDocument({
      html: noHeadShell,
      head: {},
      appConfig: { fonts: ['/static/regular-abc.woff2'] },
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test packages/server/src/__tests__/document-shell-preload.test.ts`
Expected: FAIL (no `as="font"` markup).

- [ ] **Step 4: Implement in `document-shell.ts`**

Add the import at the top:

```ts
import { fontMimeType } from './font-preload.js';
```

After the `preloadTags` block (and before `routeStyleTags` or wherever the tag arrays are assembled), add the font tags. `appConfig` is already destructured from `opts`:

```ts
  // Font preloads are render-critical resources (default High priority), so they
  // go FIRST in the head for earliest discovery, ahead of the fetchpriority=low
  // modulepreload hints. crossorigin is mandatory: fonts fetch in CORS mode even
  // same-origin, so a preload without it does not match the request and
  // double-fetches. type lets the browser skip a format it cannot use (omitted
  // for an unrecognized extension). Like the modulepreload hints these are
  // droppable (the Link header still carries them), so they are NOT counted in
  // the missing-</head> warning below.
  const fontPreloadTags = (appConfig?.fonts ?? []).map(
    (href) =>
      `<link ${toAttrs({ rel: 'preload', as: 'font', type: fontMimeType(href), href, crossorigin: '' })} />`
  );
```

Change the `headTags` assembly to put font tags first:

```ts
  const headTags = [
    ...fontPreloadTags,
    ...preloadTags,
    ...userHeadTags,
    ...routeStyleTags,
  ].join('\n        ');
```

Do NOT change the missing-`</head>` warning guard (font preloads are droppable hints and must not trigger it, same as the modulepreload hints).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test packages/server/src/__tests__/document-shell-preload.test.ts`
Expected: PASS (existing preload/stylesheet tests plus the four new font tests).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/define-app.ts packages/server/src/document-shell.ts packages/server/src/__tests__/document-shell-preload.test.ts
git commit -m "feat(server): inject AppConfig font preloads into the SSR head

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Font preloads in the `Link` header

**Files:**
- Modify: `packages/server/src/render.tsx` (combine font + closure Link header, fonts first)
- Test: `packages/server/src/__tests__/render-preload.test.tsx` (add a case)

**Interfaces:**
- Consumes: `fontPreloadLinkHeader` from Task 1; `AppConfig.fonts` from Task 2; the existing `preloadLinkHeader`.
- Produces: the `Link` response header carries font preload entries before the closure's modulepreload entries.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/__tests__/render-preload.test.tsx` inside the existing `describe` (the file already imports `renderPage`, `installPreloadModules`, defines `Page`):

```ts
  it("puts AppConfig font preloads in the Link header before the closure, and in the head", async () => {
    installPreloadModules(() => ({
      closure: ['/static/a.js'],
      routes: {},
      routeCss: {},
    }));
    const app = new Hono();
    app.get('*', (c) =>
      renderPage(c, <Page />, {
        appConfig: { fonts: ['/static/regular-abc.woff2'] },
      })
    );

    const res = await app.request('http://localhost/');
    const html = await res.text();

    expect(html).toContain(
      '<link rel="preload" as="font" type="font/woff2" href="/static/regular-abc.woff2" crossorigin="" />'
    );
    expect(res.headers.get('Link')).toBe(
      '</static/regular-abc.woff2>; rel=preload; as=font; type=font/woff2; crossorigin, ' +
        '</static/a.js>; rel=modulepreload'
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/server/src/__tests__/render-preload.test.tsx -t "font preloads in the Link header"`
Expected: FAIL (Link header lacks the font entry).

- [ ] **Step 3: Implement in `render.tsx`**

Add the import (next to the `preload-modules.js` import):

```ts
import { fontPreloadLinkHeader } from './font-preload.js';
```

Replace the existing single-line `Link` header construction (`const linkHeader = preloadLinkHeader(closure);`) with a combined value, fonts first:

```ts
  // Fonts first (render-critical, higher-priority hint), then the boot closure's
  // modulepreload entries. Font entries are few and small; the closure portion
  // keeps its own budget truncation.
  const linkHeader = [
    fontPreloadLinkHeader(options?.appConfig?.fonts ?? []),
    preloadLinkHeader(closure),
  ]
    .filter(Boolean)
    .join(', ');
```

(Leave the following `if (linkHeader) c.header('Link', linkHeader, { append: true });` as is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/server/src/__tests__/render-preload.test.tsx`
Expected: PASS (existing cases plus the new font case).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/render.tsx packages/server/src/__tests__/render-preload.test.tsx
git commit -m "feat(server): carry font preloads in the Link header (Early Hints)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Site consumer + docs, then CI-parity and push

**Files:**
- Modify: `apps/site/src/app-config.ts` (list the critical fonts)
- Modify: `apps/site/src/pages/docs/styling.mdx` (add a "Preload critical fonts" section)

**Interfaces:**
- Consumes: `AppConfig.fonts` (Task 2) and the framework injection (Tasks 2-3).

- [ ] **Step 1: Rebuild the framework dist (site resolves types through dist)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: clean build (so `apps/site` sees the new `AppConfig.fonts` type).

- [ ] **Step 2: Add the critical fonts to the site app config**

Edit `apps/site/src/app-config.ts` to import the above-the-fold weights via `?url` and list them. Preserve the existing `defineApp` import name and `speculation: true`:

```ts
import { defineApp } from 'hono-preact';
import regular from '@/styles/fonts/selawik-regular.woff2?url';
import semibold from '@/styles/fonts/selawik-semibold.woff2?url';

// Preload the two weights used above the fold (body + headings). font-display
// stays `optional` in root.css (no layout shift; the preload gives the brand
// font a real chance to win the optional window).
export default defineApp({
  speculation: true,
  fonts: [regular, semibold],
});
```

(If the existing file uses a different real symbol for `defineApp`, keep that symbol; only add the `?url` imports and the `fonts` field.)

- [ ] **Step 3: Add the docs section**

Append a `## Preload critical fonts` section to `apps/site/src/pages/docs/styling.mdx`. Cover: list critical fonts on `AppConfig.fonts` as `?url` imports; the framework emits `<link rel="preload" as="font" crossorigin>` in the head plus a `Link` header (Early Hints); `crossorigin` is mandatory (fonts fetch in CORS mode even same-origin); preload only above-the-fold weights (preloading every font is wasted bandwidth). Show a realistic `app-config.ts` snippet. Follow the repo docs conventions: no em-dashes, no historical breadcrumbs, real import paths, no `[← docs]` back-link.

- [ ] **Step 4: Regenerate the corpus and build the site**

Run: `pnpm gen:agents-corpus && pnpm --filter site build`
Expected: both succeed. Then confirm the fonts are preloaded in the built worker output: the emitted HTML for `/` should contain `<link rel="preload" as="font" ... crossorigin`. (A cheap check: `grep -R 'rel="preload" as="font"' apps/site/dist` will not work since HTML is rendered by the worker; instead verify in Task 4 Step 6's CI-parity site build, or on the PR preview deploy.)

- [ ] **Step 5: Commit the site + docs change**

```bash
git add apps/site/src/app-config.ts apps/site/src/pages/docs/styling.mdx
git commit -m "feat(site): preload the two above-the-fold Selawik weights

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Full CI-parity, then push to PR #254**

Run the eight CI-parity steps in order (from `CLAUDE.md`): framework build; `pnpm gen:agents-corpus`; `pnpm format:check` (if it fails, `pnpm format` and amend); `pnpm typecheck`; `pnpm test:types`; `pnpm test:coverage` (or `pnpm test`); `pnpm test:integration`; `pnpm --filter site build`. All must pass.

Then push to the existing branch (updates PR #254; do NOT open a new PR):

```bash
git push origin feat/route-scoped-css
```

Report the CI-parity results and confirm the push updated #254.

---

## Notes for the implementer

- **`toAttrs` filters `null`/`undefined` values**, so `type: fontMimeType(href)` yields no `type` attr when the extension is unrecognized, and `crossorigin: ''` renders `crossorigin=""` (a valid anonymous-CORS attribute). Do not special-case these.
- **Attribute order** in the emitted tag follows the object key order passed to `toAttrs` (`rel`, `as`, `type`, `href`, `crossorigin`); the tests above assert that exact order, so keep the key order.
- **Do not add fonts to the missing-`</head>` warning.** They are droppable hints like the modulepreload tags (the `Link` header still carries them); only the render-critical route stylesheets and the user's own head tags count toward that warning.
- **Font-display is out of scope** (a site stylesheet knob); this plan keeps `root.css` at `font-display: optional`.
