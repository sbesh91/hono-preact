# Route-scoped CSS delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a framework primitive that injects each matched route's own CSS as a render-blocking `<link rel="stylesheet">` into the SSR head, then split `apps/site`'s monolithic `root.css` into a small global sheet plus per-route sheets so no route ships CSS it never uses.

**Architecture:** This is the CSS twin of the #252 JS route-preload. The client build already emits a `PreloadArtifact { closure, routes }`; we add a `routeCss` map computed from each route chunk's `viteMetadata.importedCss`, carry it through the existing memoized adapter reader, match it with the existing `selectRoutePreload`, and inject `<link rel="stylesheet">` from `document-shell.ts`. The site then imports CSS per route module instead of `@import`ing everything into one globally linked sheet.

**Tech Stack:** TypeScript, Vite/Rollup build plugins, Preact SSR, Hono, Vitest, Tailwind v4 (utilities stay in the global sheet).

## Global Constraints

- **No em-dashes** (`—`) in prose, code comments, or commit messages. Use a comma, semicolon, colon, parentheses, or two sentences.
- **Commit message trailer** on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **No inline `as` casts.** Reshape types instead (declare the optional field, narrow, or type a predicate). See `CLAUDE.md` "Type casts".
- **Do not push or open a PR until told to**, and only after all eight CI-parity steps pass locally (Task 10). Work stays on branch `feat/route-scoped-css` in the worktree `.claude/worktrees/route-css`.
- **Absolute worktree paths.** All paths below are relative to `.claude/worktrees/route-css/`. Read/Edit/Write against that worktree, never the primary checkout.
- **Route CSS `href` form is root-relative `'/' + fileName`,** matching the JS route-preload map and Vite's own runtime CSS injection (dedup depends on the href matching). Known shared limitation with #250/#252: a configured Vite `base` other than `/` is ignored; out of scope here.
- **Tests are TDD:** write the failing test, watch it fail, implement minimally, watch it pass, commit.

Test runner note: this repo runs unit tests with `pnpm test` (vitest). To run a single file: `pnpm test <path>` ; a single test: `pnpm test <path> -t "<name>"`. Package builds: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`.

---

### Task 1: Build-side `resolveRouteCssMap` (vite)

**Files:**
- Modify: `packages/vite/src/route-preload.ts` (add `RouteCssMap` type, `viteMetadata` field on `RouteBundleChunkLike`, `cssOfChunks` helper, `resolveRouteCssMap`)
- Test: `packages/vite/src/__tests__/route-css.test.ts` (create)

**Interfaces:**
- Consumes: existing module-private helpers in `route-preload.ts` (`indexBySource`, `collectStaticChunks`, `entryClosure`, `stripExt`), and `RouteModuleChain { pattern: string; sources: string[] }`.
- Produces:
  - `export type RouteCssMap = Record<string, string[]>`
  - `export function resolveRouteCssMap(chains: readonly RouteModuleChain[], bundle: Record<string, RouteBundleChunkLike>): RouteCssMap`
  - `RouteBundleChunkLike` gains `viteMetadata?: { importedCss?: Set<string> }`

- [ ] **Step 1: Write the failing test**

Create `packages/vite/src/__tests__/route-css.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveRouteCssMap,
  type RouteModuleChain,
  type RouteBundleChunkLike,
} from '../route-preload.js';

// A tiny bundle: an entry that imports global.css, a home view chunk that
// imports home.css, and a docs layout + docs page that both import docs.css.
function bundle(): Record<string, RouteBundleChunkLike> {
  const css = (fileName: string): RouteBundleChunkLike => ({
    type: 'asset',
    fileName,
  });
  const chunk = (
    fileName: string,
    moduleIds: string[],
    importedCss: string[],
    opts: { isEntry?: boolean; imports?: string[] } = {}
  ): RouteBundleChunkLike => ({
    type: 'chunk',
    fileName,
    isEntry: opts.isEntry ?? false,
    imports: opts.imports ?? [],
    moduleIds,
    viteMetadata: { importedCss: new Set(importedCss) },
  });
  return {
    'client.js': chunk('client.js', ['/app/entry.ts'], ['global.css'], {
      isEntry: true,
    }),
    'home.js': chunk('home.js', ['/app/pages/home.tsx'], ['home.css']),
    'docs-layout.js': chunk(
      'docs-layout.js',
      ['/app/components/DocsLayout.tsx'],
      ['docs.css']
    ),
    'docs-page.js': chunk('docs-page.js', ['/app/pages/docs/x.mdx'], ['docs.css']),
    'global.css': css('global.css'),
    'home.css': css('home.css'),
    'docs.css': css('docs.css'),
  };
}

const chains: RouteModuleChain[] = [
  { pattern: '', sources: ['/app/pages/home.tsx'] },
  {
    pattern: '/docs/x',
    sources: ['/app/components/DocsLayout.tsx', '/app/pages/docs/x.mdx'],
  },
];

describe('resolveRouteCssMap', () => {
  it("maps a route to its chunk's CSS, keys the empty index pattern under '/', and subtracts the entry's global CSS", () => {
    expect(resolveRouteCssMap(chains, bundle())).toEqual({
      '/': ['/home.css'],
      '/docs/x': ['/docs.css'],
    });
  });

  it('dedupes a stylesheet shared across the chain (layout + page both import docs.css)', () => {
    const out = resolveRouteCssMap(chains, bundle());
    expect(out['/docs/x']).toEqual(['/docs.css']);
  });

  it('omits a route whose chunks import no CSS', () => {
    const b = bundle();
    b['home.js'] = {
      type: 'chunk',
      fileName: 'home.js',
      isEntry: false,
      imports: [],
      moduleIds: ['/app/pages/home.tsx'],
      viteMetadata: { importedCss: new Set() },
    };
    expect(resolveRouteCssMap(chains, b)['/']).toBeUndefined();
  });

  it('unions CSS when two chains resolve to the same pattern', () => {
    const b = bundle();
    b['home-alt.js'] = {
      type: 'chunk',
      fileName: 'home-alt.js',
      isEntry: false,
      imports: [],
      moduleIds: ['/app/pages/home-alt.tsx'],
      viteMetadata: { importedCss: new Set(['extra.css']) },
    };
    b['extra.css'] = { type: 'asset', fileName: 'extra.css' };
    const withCollision: RouteModuleChain[] = [
      ...chains,
      { pattern: '', sources: ['/app/pages/home-alt.tsx'] },
    ];
    expect(resolveRouteCssMap(withCollision, b)['/']).toEqual([
      '/home.css',
      '/extra.css',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/vite/src/__tests__/route-css.test.ts`
Expected: FAIL with `resolveRouteCssMap is not a function` (or an export/type error).

- [ ] **Step 3: Implement minimally in `route-preload.ts`**

Add the `viteMetadata` field to the existing `RouteBundleChunkLike` interface (after `imports?: string[];`):

```ts
  /** Vite's per-chunk CSS metadata: the CSS asset file names this chunk pulls in. */
  viteMetadata?: { importedCss?: Set<string> };
```

Then add, after `resolvePreloadMap` (reusing the module's existing private helpers):

```ts
/**
 * Build-generated map from route pattern to the CSS asset URLs that route needs,
 * the render-critical sibling of {@link RoutePreloadMap}. Serialized into the
 * client build artifact; the server injects the matched route's sheets as
 * `<link rel="stylesheet">` into the SSR head.
 */
export type RouteCssMap = Record<string, string[]>;

/** The distinct CSS asset file names a set of chunks import, in first-seen order. */
function cssOfChunks(
  files: Iterable<string>,
  bundle: Record<string, RouteBundleChunkLike>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const importedCss = bundle[file]?.viteMetadata?.importedCss;
    if (!importedCss) continue;
    for (const css of importedCss) {
      if (seen.has(css)) continue;
      seen.add(css);
      out.push(css);
    }
  }
  return out;
}

/**
 * Resolve route module chains to a pattern -> CSS-URL map against the Rollup
 * output bundle. For each chain, collect the CSS imported by the chain's static
 * chunk closure (layouts + view), minus the client entry's CSS (loaded eagerly
 * on every route via the entry). Mirrors `resolvePreloadMap`'s dedup, empty-path
 * -> '/' keying, and pattern-collision union, so the two maps stay consistent.
 */
export function resolveRouteCssMap(
  chains: readonly RouteModuleChain[],
  bundle: Record<string, RouteBundleChunkLike>
): RouteCssMap {
  const bySource = indexBySource(bundle);
  const eagerCss = new Set(cssOfChunks(entryClosure(bundle), bundle));
  const href = (file: string): string => '/' + file;

  const map: RouteCssMap = {};
  for (const chain of chains) {
    const files = new Set<string>();
    for (const src of chain.sources) {
      const fileName = bySource.get(stripExt(src));
      if (fileName) collectStaticChunks(fileName, bundle, files, new Set());
    }
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const css of cssOfChunks(files, bundle)) {
      if (eagerCss.has(css) || seen.has(css)) continue;
      seen.add(css);
      urls.push(href(css));
    }
    if (urls.length === 0) continue;
    const pattern = chain.pattern === '' ? '/' : chain.pattern;
    const prior = map[pattern];
    map[pattern] = prior
      ? [...prior, ...urls.filter((u) => !prior.includes(u))]
      : urls;
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/vite/src/__tests__/route-css.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/route-preload.ts packages/vite/src/__tests__/route-css.test.ts
git commit -m "feat(vite): resolve per-route CSS from chunk importedCss

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Emit `routeCss` in the client artifact (vite)

**Files:**
- Modify: `packages/vite/src/preload-manifest.ts` (extend `PreloadArtifact`, replace `buildRouteMap` with `buildRouteMaps`, emit `routeCss`)
- Test: `packages/vite/src/__tests__/preload-manifest.test.ts` (update existing `toEqual`s, add a `routeCss` assertion)

**Interfaces:**
- Consumes: `resolveRouteCssMap`, `RouteCssMap` from Task 1; existing `extractRouteChains`, `resolvePreloadMap`, `expandGlobFs`.
- Produces: `PreloadArtifact { closure: string[]; routes: RoutePreloadMap; routeCss: RouteCssMap }`.

- [ ] **Step 1: Update + add failing tests**

In `packages/vite/src/__tests__/preload-manifest.test.ts`, change the two existing `toEqual` assertions to include `routeCss`:

In the `'emits the { closure, routes } artifact ...'` test, replace the assertion object:

```ts
    expect(JSON.parse(emitted[0].source)).toEqual({
      closure: ['/static/a.js'],
      routes: {},
      routeCss: {},
    });
```

In the `'populates the route map from routes.ts ...'` test, give the home chunk CSS and assert `routeCss`. Change the `'static/home-XX.js'` chunk to add `viteMetadata`, add the CSS asset to `routeBundle`, and add a `routeCss` assertion:

```ts
      'static/home-XX.js': {
        type: 'chunk',
        fileName: 'static/home-XX.js',
        isEntry: false,
        imports: [],
        moduleIds: [path.join(dir, 'src', 'pages', 'home.tsx')],
        viteMetadata: { importedCss: new Set(['static/home-XX.css']) },
      },
      'static/home-XX.css': { type: 'asset', fileName: 'static/home-XX.css' },
```

and after the existing `routes` assertion:

```ts
    expect(JSON.parse(emitted[0].source).routeCss).toEqual({
      '/': ['/static/home-XX.css'],
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/vite/src/__tests__/preload-manifest.test.ts`
Expected: FAIL (artifact has no `routeCss` key yet; the two `toEqual`s mismatch).

- [ ] **Step 3: Implement in `preload-manifest.ts`**

Update the import from `./route-preload.js` to add `resolveRouteCssMap` and `type RouteCssMap`:

```ts
import {
  extractRouteChains,
  resolvePreloadMap,
  resolveRouteCssMap,
  expandGlobFs,
  type RoutePreloadMap,
  type RouteCssMap,
} from './route-preload.js';
```

Extend the artifact interface:

```ts
export interface PreloadArtifact {
  closure: string[];
  routes: RoutePreloadMap;
  routeCss: RouteCssMap;
}
```

In `generateBundle`, replace the `routes` line and artifact construction:

```ts
      const closure = collectEntryPreloadModules(bundle);
      const { routes, routeCss } = buildRouteMaps(routesAbsPath, bundle, (msg) =>
        this.warn(`[preload] ${msg}`)
      );
      const artifact: PreloadArtifact = { closure, routes, routeCss };
```

Replace the `buildRouteMap` function with `buildRouteMaps` (reads and parses `routes.ts` once, resolves both maps):

```ts
/**
 * Read `routes.ts` and resolve its per-pattern module chains to both the JS
 * preload map and the CSS map against the bundle, parsing the routes file once.
 * Any failure yields empty maps, so preload/route-CSS degrade rather than
 * failing the build.
 */
function buildRouteMaps(
  routesAbsPath: string,
  bundle: Parameters<typeof resolvePreloadMap>[1],
  warn: (msg: string) => void
): { routes: RoutePreloadMap; routeCss: RouteCssMap } {
  const empty = { routes: {}, routeCss: {} };
  if (!routesAbsPath) return empty;
  let source: string;
  try {
    source = fs.readFileSync(routesAbsPath, 'utf8');
  } catch {
    return empty;
  }
  try {
    const chains = extractRouteChains(source, routesAbsPath, expandGlobFs, warn);
    return {
      routes: resolvePreloadMap(chains, bundle),
      routeCss: resolveRouteCssMap(chains, bundle),
    };
  } catch (e) {
    warn(`route map generation failed: ${(e as Error).message}`);
    return empty;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/vite/src/__tests__/preload-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/preload-manifest.ts packages/vite/src/__tests__/preload-manifest.test.ts
git commit -m "feat(vite): carry routeCss in the client preload artifact

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Carry `routeCss` through the server manifest reader

**Files:**
- Modify: `packages/server/src/preload-modules.ts` (extend `PreloadManifest`, `EMPTY`, `normalizeManifest`)
- Test: `packages/server/src/__tests__/preload-modules.test.ts` (update existing `EMPTY`/`toEqual`s, add a `routeCss` case)

**Interfaces:**
- Consumes: existing `RoutePreloadMap` (the `routeCss` field reuses this identical `Record<string, string[]>` shape) and `normalizeRoutes`.
- Produces: `PreloadManifest { closure: string[]; routes: RoutePreloadMap; routeCss: RoutePreloadMap }`; `resolvePreloadManifest()` now returns all three, defaulting `routeCss` to `{}`.

- [ ] **Step 1: Update + add failing tests**

In `packages/server/src/__tests__/preload-modules.test.ts`:

Change the shared empty fixture:

```ts
const EMPTY = { closure: [], routes: {}, routeCss: {} };
```

Update every existing `resolvePreloadManifest()` `toEqual({...})` that lists `closure`/`routes` to also include `routeCss: {}` (the `sync reader`, `async reader`, `memoizes` result object, `defaults missing parts`, and `does not poison the memo` second assertion). For example the sync-reader test becomes:

```ts
    expect(await resolvePreloadManifest()).toEqual({
      closure: ['/static/a.js', '/static/b.js'],
      routes: { '/': ['/static/home.js'] },
      routeCss: {},
    });
```

Add a new test asserting `routeCss` is normalized like `routes`:

```ts
  it('normalizes routeCss and drops malformed entries, like routes', async () => {
    installPreloadModules(() => ({
      closure: [],
      routes: {},
      routeCss: {
        '/': ['/static/home.css', 9],
        '/empty': [],
        '/bad': null,
      },
    }));
    expect(await resolvePreloadManifest()).toEqual({
      closure: [],
      routes: {},
      routeCss: { '/': ['/static/home.css'] },
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/server/src/__tests__/preload-modules.test.ts`
Expected: FAIL (resolved manifest has no `routeCss`).

- [ ] **Step 3: Implement in `preload-modules.ts`**

Extend the interface:

```ts
export interface PreloadManifest {
  closure: string[];
  routes: RoutePreloadMap;
  /** Per-route render-critical stylesheet URLs (same shape/matching as routes). */
  routeCss: RoutePreloadMap;
}
```

Update the empty default:

```ts
const EMPTY: PreloadManifest = { closure: [], routes: {}, routeCss: {} };
```

Update `normalizeManifest` to read and normalize `routeCss`:

```ts
function normalizeManifest(raw: unknown): PreloadManifest {
  const obj =
    typeof raw === 'object' && raw !== null
      ? (raw as { closure?: unknown; routes?: unknown; routeCss?: unknown })
      : {};
  const closure = Array.isArray(obj.closure)
    ? obj.closure.filter(isString)
    : [];
  return {
    closure,
    routes: normalizeRoutes(obj.routes),
    routeCss: normalizeRoutes(obj.routeCss),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/server/src/__tests__/preload-modules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/preload-modules.ts packages/server/src/__tests__/preload-modules.test.ts
git commit -m "feat(server): normalize routeCss in the preload manifest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Inject route stylesheets in `document-shell`

**Files:**
- Modify: `packages/server/src/document-shell.ts` (add `routeStyleSheets` param, `<link rel="stylesheet">` tags after user head tags, fold into the render-critical missing-`</head>` warning)
- Test: `packages/server/src/__tests__/document-shell-preload.test.ts` (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `assembleDocument` accepts `routeStyleSheets?: string[]`, rendered as `<link rel="stylesheet" href="...">` after `userHeadTags`, and counted as render-critical for the missing-`</head>` warning.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/__tests__/document-shell-preload.test.ts` a new describe block:

```ts
describe('assembleDocument: route stylesheets', () => {
  it('injects a <link rel="stylesheet"> for each route sheet, after the user head tags', () => {
    const out = assembleDocument({
      html: '<html><head><link rel="stylesheet" href="/global.css" /></head><body>x</body></html>',
      head: {},
      routeStyleSheets: ['/static/home.css'],
    });
    expect(out).toContain('<link rel="stylesheet" href="/static/home.css" />');
    // Route sheet lands inside <head> and AFTER the global sheet (cascade order).
    expect(out.indexOf('/static/home.css')).toBeLessThan(out.indexOf('</head>'));
    expect(out.indexOf('/global.css')).toBeLessThan(
      out.indexOf('/static/home.css')
    );
  });

  it('injects nothing when routeStyleSheets is empty or omitted', () => {
    const out = assembleDocument({ html: shell, head: {}, routeStyleSheets: [] });
    expect(out).not.toContain('rel="stylesheet"');
    const out2 = assembleDocument({ html: shell, head: {} });
    expect(out2).not.toContain('rel="stylesheet"');
  });

  it('WARNS about a missing </head> when route stylesheets would be dropped (render-critical, unlike preload hints)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assembleDocument({
      html: noHeadShell,
      head: {},
      routeStyleSheets: ['/static/home.css'],
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/server/src/__tests__/document-shell-preload.test.ts`
Expected: FAIL (no stylesheet markup; the warn case does not fire).

- [ ] **Step 3: Implement in `document-shell.ts`**

Add the option to the `assembleDocument` signature and destructure it. In the options type, after `routePreloadModules?: string[];`:

```ts
  /**
   * The matched route's own stylesheet URLs (`selectRoutePreload` over the CSS
   * map). Injected as `<link rel="stylesheet">` after the app's own head tags so
   * route rules keep their cascade position over the global sheet. Unlike the
   * modulepreload hints these are render-critical: a dropped route sheet is a
   * broken page, so they count toward the missing-</head> warning below.
   */
  routeStyleSheets?: string[];
```

In the destructure, add `routeStyleSheets = [],`.

After the `preloadTags` block, add the stylesheet tags:

```ts
  // Route stylesheets are render-critical (not hints): emit as real stylesheet
  // links, after the user's head tags so route rules win equal-specificity ties
  // against the global sheet (matching the pre-split monolith order).
  const styleTag = (href: string): string =>
    `<link ${toAttrs({ rel: 'stylesheet', href })} />`;
  const routeStyleTags = routeStyleSheets.map(styleTag);
```

Change the `headTags` assembly to place route sheets last:

```ts
  const headTags = [...preloadTags, ...userHeadTags, ...routeStyleTags].join(
    '\n        '
  );
```

Change the warning guard to include route stylesheets (render-critical), and update its comment:

```ts
  // Warn when the Layout would drop render-critical head content: the user's own
  // head tags OR the route stylesheets. Framework preload hints still don't count
  // (dropping a hint is acceptable; the Link header carries the closure).
  if (
    startsWithHtml &&
    (userHeadTags.length > 0 || routeStyleTags.length > 0) &&
    !html.includes('</head>')
  ) {
    warnMissingMarker(
      '</head>',
      'the Layout owns the document (<html>…) but emitted no </head>; ' +
        'injected <title>/<meta>/<link> tags were dropped'
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/server/src/__tests__/document-shell-preload.test.ts`
Expected: PASS (existing preload tests plus the three new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/document-shell.ts packages/server/src/__tests__/document-shell-preload.test.ts
git commit -m "feat(server): inject route stylesheets into the SSR head

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire `routeCss` through `renderPage`

**Files:**
- Modify: `packages/server/src/render.tsx` (destructure `routeCss`, select route sheets, pass `routeStyleSheets`)
- Test: `packages/server/src/__tests__/render-preload.test.tsx` (add a case; the `<Page>` fixture already renders `<head></head>`)

**Interfaces:**
- Consumes: `resolvePreloadManifest()` now returning `{ closure, routes, routeCss }`; `selectRoutePreload(map, path)` (reused for CSS); `assembleDocument`'s `routeStyleSheets`.
- Produces: SSR head contains the matched route's `<link rel="stylesheet">`; route sheets are NOT added to the `Link` header (render-critical stylesheet links belong in the document, and the header can't express them the same way; keep the header closure-only as today).

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/__tests__/render-preload.test.tsx` inside the existing `describe`:

```ts
  it("injects the matched route's stylesheet into <head> and not another route's", async () => {
    installPreloadModules(() => ({
      closure: [],
      routes: {},
      routeCss: {
        '/': ['/static/home.css'],
        '/other': ['/static/other.css'],
      },
    }));
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Page />));

    const res = await app.request('http://localhost/');
    const html = await res.text();

    expect(html).toContain('<link rel="stylesheet" href="/static/home.css" />');
    expect(html).not.toContain('/static/other.css');
    // Route stylesheets are document-only, never in the Link header.
    expect(res.headers.get('Link')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/server/src/__tests__/render-preload.test.tsx -t "matched route's stylesheet"`
Expected: FAIL (no stylesheet link in output).

- [ ] **Step 3: Implement in `render.tsx`**

Change the manifest destructure:

```ts
  const { closure, routes, routeCss } = await resolvePreloadManifest();
```

After the `routePreload` line, select the route stylesheets with the same matcher:

```ts
  const routePreload = selectRoutePreload(routes, routePath) ?? [];
  // The matched route's own render-critical stylesheets, injected into the head
  // (not the Link header). Reuses the exact-key-then-findBestPattern matcher.
  const routeStyleSheets = selectRoutePreload(routeCss, routePath) ?? [];
```

Add `routeStyleSheets` to the `assembleDocument` call:

```ts
  const fullHtml = assembleDocument({
    html,
    head: dispatcher.toStatic(),
    defaultTitle: options?.defaultTitle,
    appConfig: options?.appConfig,
    preloadModules: closure,
    routePreloadModules: routePreload,
    routeStyleSheets,
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/server/src/__tests__/render-preload.test.tsx`
Expected: PASS (existing preload tests plus the new stylesheet case).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/render.tsx packages/server/src/__tests__/render-preload.test.tsx
git commit -m "feat(server): render the matched route's stylesheet from renderPage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rebuild framework dist and run the full framework suite

**Files:** none (build + verification checkpoint).

This task has no code; it makes the framework primitive real for the site build (`apps/site` resolves `hono-preact` through the published `dist/`, so the site build in later tasks needs current dist) and confirms nothing regressed across packages.

- [ ] **Step 1: Build the framework packages**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: all package builds succeed.

- [ ] **Step 2: Typecheck + full unit suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. If `typecheck` flags the `routeCss` field anywhere it flows (reader adapters, internal-runtime re-exports), fix the type there (declare the field; no casts) and re-run.

- [ ] **Step 3: Commit (only if dist or a type fix changed tracked files)**

```bash
git add -A
git commit -m "chore: rebuild framework dist for route-scoped CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

If `git status` is clean (dist is gitignored, no type fix needed), skip the commit.

---

### Task 7: Split `apps/site` CSS into global + per-route sheets

**Files:**
- Modify: `apps/site/src/styles/root.css` (remove `@import './home.css';`; move docs/demo rules out)
- Create: `apps/site/src/styles/docs.css` (mdx prose + Shiki + `.docs-*` + `.sa-*` + docs view-transition rules)
- Create: `apps/site/src/styles/demo.css` (`.demo-*` + demo view-transition rules)
- Modify: `apps/site/src/pages/home.tsx` (add `import '@/styles/home.css';`)
- Modify: `apps/site/src/components/DocsLayout.tsx` (add `import '@/styles/docs.css';`)
- Modify: `apps/site/src/pages/demo/demo-layout.tsx` (add `import '@/styles/demo.css';`)

**Interfaces:**
- Consumes: the framework route-CSS injection from Tasks 1-6 (each route module's CSS import becomes that route's `viteMetadata.importedCss`, resolved into `routeCss`, injected in the head).
- Produces: `root.css` keeps `@import 'tailwindcss'`, `@font-face`, `@theme`, `:root` token blocks, `@utility` blocks, `:focus-visible`, and the SHARED view-transition rules (root fade + `nav-*` slides + the reduced-motion VT safety block + the slide keyframes). Route sheets carry the rest.

Note on Tailwind: verified there is no `@apply`/`theme()` in any of this CSS, so the moved sheets are plain `var(--token)` CSS with no Tailwind-processing dependency (no `@reference` needed). Utilities used only in docs/demo TSX are still emitted into the global sheet by `@import 'tailwindcss'`, which stays in `root.css`.

Section mapping (by selector, from the current `root.css`):

- **Stay global (`root.css`):** `@import 'tailwindcss'`; `@font-face` (Selawik); `@theme` + `@theme inline`; `@utility` (shadow-card, orangenta, badges); `:root` light + dark `@media` + `[data-theme='dark']` token blocks; `prefers-reduced-motion` spring block; `:focus-visible`; `@view-transition` + `::view-transition-old/new(root)` fade; the `nav-push/back/forward/up/initial` root slide rules; the `slide-in/out-*` keyframes; the trailing reduced-motion `::view-transition` safety block. (Remove the `@import './home.css';` line.)
- **Move to `docs.css`:** everything `.mdx-content *`; the Shiki `.shiki` dark-swap rules and `.mdx-content pre` / `.docs-tabs__panel pre` code-surface rule; the `docs` zoom view-transition rules + `docs-zoom-in/out` keyframes; `.docs-sidebar` / `.docs-topbar` names + the `docs-within` freeze rules; every `.docs-*` block and every `.sa-*` block through the end of the file.
- **Move to `demo.css`:** `.demo-sidebar` / `.demo-activity-bar` names + the `demo-within` freeze rules; `demo-activity-pulse` keyframes + `.demo-activity-pulse`; `::view-transition-group(.task-card)` timing + its reduced-motion duration override; every `.demo-*` block.

Verification below guarantees no rule is dropped or duplicated, so treat the mapping as a guide and let the diff be the gate.

- [ ] **Step 1: Snapshot the original for the diff gate**

Run:
```bash
cd apps/site/src/styles
git show HEAD:apps/site/src/styles/root.css | grep -vE "^@import '\./home\.css';$" > /tmp/root.orig.stripped.css
```
Expected: `/tmp/root.orig.stripped.css` is the original `root.css` minus only the `home.css` import line.

- [ ] **Step 2: Create `docs.css` and `demo.css` by moving rules verbatim**

Create `apps/site/src/styles/docs.css` and `apps/site/src/styles/demo.css`. Move (cut, do not copy) the mapped blocks out of `root.css` into them **verbatim**, including their existing section comments. Remove the `@import './home.css';` line from `root.css`. Do not add, reword, or reformat any rule in this step (the diff gate depends on byte-for-byte line preservation).

- [ ] **Step 3: Run the diff gate (no rule dropped or duplicated)**

Run:
```bash
cd apps/site/src/styles
diff <(grep -vE '^[[:space:]]*$' /tmp/root.orig.stripped.css | sort) \
     <(cat root.css docs.css demo.css | grep -vE '^[[:space:]]*$' | sort)
```
Expected: **no output.** Every non-blank line of the original (minus the home import) appears exactly once across the three files. If lines show as `<` (dropped) or `>` (added/duplicated), fix the move until the diff is empty.

- [ ] **Step 4: Add the per-route CSS imports**

In `apps/site/src/pages/home.tsx`, add near the top imports:
```ts
import '@/styles/home.css';
```
In `apps/site/src/components/DocsLayout.tsx`:
```ts
import '@/styles/docs.css';
```
In `apps/site/src/pages/demo/demo-layout.tsx`:
```ts
import '@/styles/demo.css';
```

- [ ] **Step 5: Build the site and verify head injection per route**

Run: `pnpm --filter site build`
Expected: build succeeds; `apps/site/dist/client/static/` now contains separate hashed CSS assets for root (global), home, docs, and demo.

Then verify the built worker injects the right sheet per route. Run:
```bash
cd apps/site && pnpm exec wrangler dev --port 8788 &
# wait for "Ready", then:
curl -s http://localhost:8788/ | grep -oE '<link rel="stylesheet"[^>]+>'
curl -s http://localhost:8788/docs/quick-start | grep -oE '<link rel="stylesheet"[^>]+>'
```
Expected: `/` shows the global sheet plus a `home-*.css` stylesheet and NO `docs-*`/`demo-*` sheet; `/docs/quick-start` shows the global sheet plus a `docs-*.css` sheet and NO `home-*`/`demo-*` sheet. Stop wrangler when done (`kill %1`).

Confirm each injected sheet exists as a built asset (build-time reachability proxy):
```bash
ls apps/site/dist/client/static/*.css
```
Expected: separate global, `home-*`, `docs-*`, `demo-*` hashed CSS files are present. Note: `wrangler dev` does not reliably serve `dist/client` assets (known gotcha), so live 200/`content-type: text/css` reachability of each href is verified on the PR **preview deploy** (curl the emitted hrefs against the preview URL once the PR is up), not in local dev.

- [ ] **Step 6: Visual spot check (dev)**

Run `pnpm --filter site dev`, open `/`, `/docs/quick-start`, and `/demo`, in light and dark. Confirm the home hero, docs prose/demos, and demo app render styled and unchanged. (Dev has no artifact; Vite injects the route CSS from the module imports, so dev exercises the same per-route CSS, just via Vite's pipeline.) View transitions leaving a section (docs -> home, demo -> home) must still animate; MCP cannot verify view transitions, so check by hand in the browser.

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/styles/root.css apps/site/src/styles/docs.css apps/site/src/styles/demo.css \
        apps/site/src/pages/home.tsx apps/site/src/components/DocsLayout.tsx \
        apps/site/src/pages/demo/demo-layout.tsx
git commit -m "perf(site): split root.css into global + per-route sheets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Author the styling docs page and flow it into the LLM corpus

**Files:**
- Create: `apps/site/src/pages/docs/styling.mdx` (route `/docs/styling`)
- Modify: `apps/site/src/pages/docs/nav.ts` (add the nav entry)

**Interfaces:**
- Consumes: the route-scoped CSS behavior shipped in Tasks 1-7.
- Produces: a docs page and a nav entry; regenerating the agents corpus picks the page up automatically (`pnpm gen:agents-corpus` reads the docs tree), and the site serves it at `/llms.txt` / `/llms-full.txt`.

Read the local skill `.claude/skills/add-docs-page.md` first and follow it (it is the canonical two-file procedure). Follow the docs conventions in `MEMORY.md`: self-contained, no historical "replaces X" breadcrumbs, and CSS/Tailwind tab parity if any snippet ships both flavors.

- [ ] **Step 1: Write the docs page**

Create `apps/site/src/pages/docs/styling.mdx`. Cover, in reading order:
- The always-loaded global sheet: link one stylesheet in your root Layout for tokens, Tailwind, fonts, and cross-route view-transition rules. Show the `<link rel="stylesheet" href={root} />` pattern from `Layout.tsx`.
- Route-scoped CSS: put a route's own styles in its own CSS file and `import` it from that route's view or layout module (side-effect import). Show `import '@/styles/home.css';` in a view module.
- What the framework does: it injects the matched route's stylesheet into the SSR `<head>` automatically (render-blocking, after the global sheet so route rules win equal-specificity ties). You do not link route CSS by hand. On client navigation the route's CSS loads with its chunk.
- The rule of thumb: global sheet stays small (tokens, Tailwind, shared transitions); everything a single route owns lives in that route's sheet.
- Gotcha callout: keep centering in a single `transform` (not a standalone `translate`/`scale`/`rotate` next to `transform`), because the production CSS minifier (Lightning CSS, via Tailwind v4) drops the standalone property. Show the one-`transform` form.

Match the voice and structure of an existing guide (read `apps/site/src/pages/docs/vite-config.mdx` and `layouts.mdx` for tone). Title with `#`, sections with `##`, no `[← docs]` back-link.

- [ ] **Step 2: Register the nav entry**

In `apps/site/src/pages/docs/nav.ts`, add `{ title: 'Styling', route: '/docs/styling' }` to the section that holds structural/config guides (the one containing `structure` / `layouts` / `vite-config`), in reading order. Match the existing `NavArea`/section/entry shape exactly.

- [ ] **Step 3: Regenerate the agents corpus and verify the page is included**

Run:
```bash
pnpm gen:agents-corpus
grep -c "Styling" templates/agents/llms-full.txt
```
Expected: the corpus regenerates; the grep count is `>= 1` (the new page is bundled). The corpus is gitignored, so nothing to commit there.

- [ ] **Step 4: Build the site to confirm the route and nav compile**

Run: `pnpm --filter site build`
Expected: build succeeds; `/docs/styling` is a generated route.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/docs/styling.mdx apps/site/src/pages/docs/nav.ts
git commit -m "docs(site): add the route-scoped styling guide

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Report always-loaded CSS bytes in the size job

**Files:**
- Modify: `scripts/measure-site-chunks.mjs` (measure global + per-route CSS bytes alongside the JS baseline)
- Test: `scripts/__tests__/measure-site-chunks.test.mjs` (add a CSS-measurement case)

**Interfaces:**
- Consumes: the built `apps/site/dist/client` assets (the CSS assets emitted in Task 7) and the `routeCss`/manifest already emitted there.
- Produces: the size script's result object gains a CSS section (global always-loaded CSS bytes, and per-route CSS bytes), so the `client-size` PR comment shows the CSS shrink and catches regressions.

First read `scripts/measure-site-chunks.mjs` and its test to match the existing result shape and gzip helper; extend, do not restructure.

- [ ] **Step 1: Write the failing test**

In `scripts/__tests__/measure-site-chunks.test.mjs`, add a case that feeds a fixture dist (or the existing fixture harness the test already uses) containing a global CSS asset and a per-route CSS asset, and asserts the measured result includes gzipped byte counts for the global sheet and for at least one route sheet. Mirror the existing test's fixture-construction and assertion style (reuse its helpers; do not invent a new harness).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test scripts/__tests__/measure-site-chunks.test.mjs`
Expected: FAIL (no CSS field on the result yet).

- [ ] **Step 3: Implement the CSS measurement**

Extend `measure-site-chunks.mjs` to locate the global stylesheet (the one linked by the Layout / the entry's CSS) and the per-route CSS assets, gzip-measure each with the script's existing gzip helper, and add them to the returned result object under a `css` key (global bytes + a per-route breakdown). Keep the JS measurement untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test scripts/__tests__/measure-site-chunks.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/measure-site-chunks.mjs scripts/__tests__/measure-site-chunks.test.mjs
git commit -m "chore(ci): report always-loaded CSS bytes in the size job

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Full CI-parity pass, then hand off for PR

**Files:** none (verification gate).

Run the eight CI-parity steps in order (from `CLAUDE.md` "Pre-push verification"). Do not push or open a PR; report results and wait for the user's go-ahead.

- [ ] **Step 1: Framework build**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: PASS.

- [ ] **Step 2: Agents corpus**

Run: `pnpm gen:agents-corpus`
Expected: PASS (regenerates `templates/agents/llms-full.txt`).

- [ ] **Step 3: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format`, then `git add -A && git commit -m "style: pnpm format" ` (with the co-author trailer) and re-run.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Type-level tests**

Run: `pnpm test:types`
Expected: PASS.

- [ ] **Step 6: Unit tests (with coverage)**

Run: `pnpm test:coverage`
Expected: PASS.

- [ ] **Step 7: Integration tests**

Run: `pnpm test:integration`
Expected: PASS.

- [ ] **Step 8: Site build**

Run: `pnpm --filter site build`
Expected: PASS.

- [ ] **Step 9: Report and wait**

Summarize the eight results. Do NOT `git push` or `gh pr create` until the user explicitly says to. When they do, push the branch and open the PR (a PR-open triggers the mandatory deep review per `REVIEW.md`; the `client-size` job will show the CSS shrink from Task 9).

---

## Notes for the implementer

- **Reuse, do not duplicate, the matcher.** `selectRoutePreload` is generic over `Record<string, string[]>`; call it once for `routes` (JS) and once for `routeCss` (CSS). Do not write a second matcher.
- **`RouteCssMap` vs `RoutePreloadMap`.** They are the same shape. The vite package names its resolver return `RouteCssMap` for clarity; the server reuses `RoutePreloadMap` for the `routeCss` field (identical `Record<string, string[]>`). That is intentional, not an oversight.
- **Ordering is load-bearing** in two places: the head order `[preload, userHead, routeStyles]` (route sheets after the global sheet) and the render-critical warning now counting route sheets. Both are asserted by tests (Tasks 4 and 5).
- **Dev vs prod.** The artifact is a production build output. In dev the manifest reader returns empty and Vite injects route CSS from the module imports; both paths are exercised in Task 7 Step 6.
- **Layer 3 is out of scope.** The Lightning-CSS-powered monolith auto-split is documented as next work in the spec (`docs/superpowers/specs/2026-07-07-route-scoped-css-design.md`), not built here.
