# Docs PR A: In-page navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every docs page anchored, deep-linkable headings, an "On this page" table of contents, and a Cmd+K command palette that searches page titles and section headings across all docs and jumps to `route#anchor`.

**Architecture:** Headings get stable `id`s from `rehype-slug` in the MDX pipeline. A build-time generator parses the same MDX into a heading index (page title + `##`/`###` headings with matching slugs), exposed to the client as a Vite virtual module. A right-rail TOC and a Cmd+K palette (dogfooding `hono-preact-ui` Dialog + Combobox) both read that index. Slug parity between the runtime anchors and the index is guaranteed by using `github-slugger` (what `rehype-slug` uses) on both sides and locking it with a test.

**Tech Stack:** Preact, `@mdx-js/rollup`, `rehype-slug`, `rehype-autolink-headings`, `github-slugger`, `hono-preact-ui` (Dialog, Combobox), `preact-iso` / `useNavigate`, Vitest + `@testing-library/preact` + happy-dom, Tailwind v4.

## Global Constraints

- This is `apps/site` only. The repo is a pnpm workspace; run all commands from the repo root `/Users/stevenbeshensky/Documents/repos/hono-preact`.
- Work on a dedicated branch (e.g. `docs-pr-a-in-page-nav`), never on `main`. If using a worktree, run `pnpm wt:setup` first.
- No em-dashes in prose, comments, commit messages, or user-facing UI copy. Use `·`, `›`, a colon, or parentheses.
- Every commit message ends with the trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- New runtime/library dependencies are avoided. `rehype-slug`, `rehype-autolink-headings`, `github-slugger`, `@mdx-js/mdx` are added as **devDependencies** of `apps/site` (they run only at build/test). The fuzzy matcher is hand-written (no dependency).
- Primitives must rely only on Baseline Widely Available platform features. `IntersectionObserver`, native `<dialog>`, and `requestAnimationFrame` qualify and are the only platform APIs used here.
- Test command is `pnpm test <path-substring>` (maps to `vitest run`). Typecheck is `pnpm typecheck`. Format check is `pnpm format:check` (also lints `.mdx`).
- Reuse existing styling. The combobox demo classes already exist in `apps/site/src/styles/root.css`: `.docs-cb-input`, `.docs-cb` (the listbox popup), `.docs-cb__option`, `.docs-cb__option[data-highlighted]`, `.docs-cb__option[data-selected]`, `.docs-cb__empty`. The palette reuses these and adds only a `.docs-cmdk*` shell.

## Shared data types (defined in Task 2, used by Tasks 4, 5, 8)

```ts
export type DocHeading = { text: string; id: string; depth: 2 | 3 };
export type DocPage = { title: string; route: string; headings: DocHeading[] };
```

---

### Task 1: Anchored headings in the MDX pipeline

Factor the remark/rehype plugin arrays into a testable module, add `rehype-slug` + `rehype-autolink-headings`, and style the permalink anchor.

**Files:**
- Create: `apps/site/src/mdx-plugins.ts`
- Create: `apps/site/src/__tests__/mdx-plugins.test.ts`
- Modify: `apps/site/vite.config.ts` (replace the inline `mdxOptions` remark/rehype arrays with imports)
- Modify: `apps/site/src/styles/root.css` (append `.heading-anchor` styles)
- Modify: `apps/site/package.json` (add devDeps)

**Interfaces:**
- Produces: `remarkPlugins` and `rehypePlugins` (typed `PluggableList` from `unified`) exported from `apps/site/src/mdx-plugins.ts`.

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
pnpm --filter site add -D rehype-slug rehype-autolink-headings github-slugger @mdx-js/mdx
```
Expected: `apps/site/package.json` devDependencies gains the four packages; lockfile updates.

- [ ] **Step 2: Write the failing test**

Create `apps/site/src/__tests__/mdx-plugins.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { compile } from '@mdx-js/mdx';
import { remarkPlugins, rehypePlugins } from '../mdx-plugins.js';

describe('mdx-plugins', () => {
  it('assigns slug ids to headings and appends a permalink anchor', async () => {
    const out = String(
      await compile('## Live Loaders Options\n', {
        jsxImportSource: 'preact',
        remarkPlugins,
        rehypePlugins,
      })
    );
    // rehype-slug -> id; rehype-autolink-headings -> an href="#slug" anchor.
    expect(out).toContain('live-loaders-options');
    expect(out).toContain('heading-anchor');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test mdx-plugins`
Expected: FAIL (cannot find module `../mdx-plugins.js`).

- [ ] **Step 4: Create the plugins module**

Create `apps/site/src/mdx-plugins.ts`:
```ts
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeShiki from '@shikijs/rehype';
import { rehypeShikiOptions } from './shiki/shiki-config.js';

// Remark/rehype plugin arrays for the docs MDX pipeline. Extracted from
// vite.config.ts so they can be unit-tested with @mdx-js/mdx's `compile`.
export const remarkPlugins: PluggableList = [remarkGfm];

export const rehypePlugins: PluggableList = [
  // Slug first: it assigns each heading an `id`. The autolink anchor and the
  // build-time heading index both depend on those ids (both use github-slugger
  // so the anchors and the index agree).
  rehypeSlug,
  [
    rehypeAutolinkHeadings,
    {
      behavior: 'append',
      properties: {
        class: 'heading-anchor',
        'aria-label': 'Permalink to this section',
      },
      content: { type: 'text', value: '#' },
    },
  ],
  // Shiki touches code blocks, independent of the heading plugins above.
  [rehypeShiki, rehypeShikiOptions],
];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test mdx-plugins`
Expected: PASS.

- [ ] **Step 6: Wire the arrays into vite.config.ts**

In `apps/site/vite.config.ts`, remove the local `remark-gfm` / `@shikijs/rehype` / `rehypeShikiOptions` imports that now live in `mdx-plugins.ts`, import the arrays, and rebuild `mdxOptions` from them:
```ts
import { remarkPlugins, rehypePlugins } from './src/mdx-plugins.js';
// ...
const mdxOptions = {
  jsxImportSource: 'preact',
  remarkPlugins,
  rehypePlugins,
} satisfies MdxOptions;
```
Delete the now-unused `import remarkGfm`, `import rehypeShiki`, and `import { rehypeShikiOptions }` lines from `vite.config.ts`.

- [ ] **Step 7: Add the permalink anchor styles**

Append to `apps/site/src/styles/root.css`:
```css
/* rehype-autolink-headings appends this anchor to every heading. Hidden until
   the heading is hovered/focused, so it does not clutter the prose. */
.mdx-content :is(h2, h3, h4) {
  position: relative;
}
.mdx-content .heading-anchor {
  margin-left: 0.4rem;
  color: var(--muted);
  text-decoration: none;
  opacity: 0;
  transition: opacity 120ms ease;
}
.mdx-content :is(h2, h3, h4):hover .heading-anchor,
.mdx-content .heading-anchor:focus-visible {
  opacity: 1;
}
```

- [ ] **Step 8: Verify typecheck and build**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm --filter site build`
Expected: build succeeds. Optionally confirm anchors landed: `grep -o 'id="[a-z0-9-]*"' apps/site/dist/client/docs/loaders/index.html | head` shows heading ids (path may vary; the point is ids exist in built HTML).

- [ ] **Step 9: Commit**

```bash
git add apps/site/src/mdx-plugins.ts apps/site/src/__tests__/mdx-plugins.test.ts apps/site/vite.config.ts apps/site/src/styles/root.css apps/site/package.json pnpm-lock.yaml
git commit -m "feat(site): anchored docs headings (rehype-slug + autolink)"
```

---

### Task 2: Build-time heading index generator

A pure module that parses docs MDX into the heading index, with slugs that match `rehype-slug`.

**Files:**
- Create: `apps/site/src/llms/generate-docs-index.ts`
- Create: `apps/site/src/llms/__tests__/generate-docs-index.test.ts`

**Interfaces:**
- Consumes: `routeToFile` from `apps/site/src/llms/generate-llms.js`; `nav` / `NavArea` from `apps/site/src/pages/docs/nav.js`.
- Produces:
  - `type DocHeading = { text: string; id: string; depth: 2 | 3 }`
  - `type DocPage = { title: string; route: string; headings: DocHeading[] }`
  - `headingText(raw: string): string`
  - `parseHeadings(source: string): { depth: number; text: string }[]`
  - `headingsForPage(source: string): DocHeading[]`
  - `generateDocsIndex(nav: NavArea[], docsDir: string): DocPage[]`
  - `headingsForRoute(pages: DocPage[], route: string): DocHeading[]`

- [ ] **Step 1: Write the failing tests**

Create `apps/site/src/llms/__tests__/generate-docs-index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';
import {
  headingText,
  parseHeadings,
  headingsForPage,
  generateDocsIndex,
  headingsForRoute,
} from '../generate-docs-index.js';
import { nav } from '../../pages/docs/nav.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../../pages/docs');

describe('headingText', () => {
  it('strips inline code backticks, links, and emphasis to visible text', () => {
    expect(headingText('`loader.View()` (form)')).toBe('loader.View() (form)');
    expect(headingText('See [Streaming](/docs/streaming)')).toBe('See Streaming');
    expect(headingText('**Bold** and _italic_')).toBe('Bold and italic');
  });
});

describe('parseHeadings', () => {
  it('collects ## and ### headings but ignores # inside fenced code', () => {
    const src = [
      '# Title',
      '',
      '## First',
      '',
      '```sh',
      '# not a heading',
      '```',
      '',
      '### Second',
    ].join('\n');
    expect(parseHeadings(src)).toEqual([
      { depth: 1, text: 'Title' },
      { depth: 2, text: 'First' },
      { depth: 3, text: 'Second' },
    ]);
  });
});

describe('headingsForPage', () => {
  it('keeps only h2/h3 and assigns github-slugger ids', () => {
    const src = '# T\n\n## Alpha\n\n### Beta\n';
    expect(headingsForPage(src)).toEqual([
      { text: 'Alpha', id: 'alpha', depth: 2 },
      { text: 'Beta', id: 'beta', depth: 3 },
    ]);
  });

  it('dedupes repeated heading text the way rehype-slug does', () => {
    const src = '# T\n\n## Options\n\n## Options\n';
    expect(headingsForPage(src).map((h) => h.id)).toEqual([
      'options',
      'options-1',
    ]);
  });

  it('matches github-slugger on a real heading with code and punctuation', () => {
    const src =
      '# T\n\n### `loader.View(render, { initial, reduce })` (accumulating form)\n';
    const expected = new GithubSlugger().slug(
      'loader.View(render, { initial, reduce }) (accumulating form)'
    );
    expect(headingsForPage(src)[0].id).toBe(expected);
  });
});

describe('generateDocsIndex', () => {
  const pages = generateDocsIndex(nav, docsDir);

  it('produces one page per nav entry', () => {
    const routeCount = nav.flatMap((a) =>
      a.sections.flatMap((s) => s.entries)
    ).length;
    expect(pages).toHaveLength(routeCount);
  });

  it('captures the .View() options heading on live-loaders with a parity slug', () => {
    const page = pages.find((p) => p.route === '/docs/live-loaders')!;
    const h = page.headings.find((x) => x.text.includes('loader.View'))!;
    expect(h).toBeTruthy();
    expect(h.id).toBe(new GithubSlugger().slug(h.text));
  });
});

describe('headingsForRoute', () => {
  it('returns a known route headings and empty for unknown', () => {
    const pages = generateDocsIndex(nav, docsDir);
    expect(headingsForRoute(pages, '/docs/loaders').length).toBeGreaterThan(0);
    expect(headingsForRoute(pages, '/docs/nope')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test generate-docs-index`
Expected: FAIL (cannot find module `../generate-docs-index.js`).

- [ ] **Step 3: Implement the generator**

Create `apps/site/src/llms/generate-docs-index.ts`:
```ts
/**
 * Build-time generator for the docs heading index that powers the on-this-page
 * TOC and the Cmd+K palette. It reads the same MDX off disk as generate-llms,
 * and assigns slug ids with github-slugger so they match the ids rehype-slug
 * stamps onto the rendered headings (see src/mdx-plugins.ts). Kept free of any
 * Vite/output knowledge so it is unit-testable; the virtual-module plugin owns
 * how it reaches the client.
 */
import { readFileSync } from 'node:fs';
import GithubSlugger from 'github-slugger';
import type { NavArea } from '../pages/docs/nav.js';
import { routeToFile } from './generate-llms.js';

export type DocHeading = { text: string; id: string; depth: 2 | 3 };
export type DocPage = { title: string; route: string; headings: DocHeading[] };

/** Reduce a markdown heading to the visible text rehype-slug would slug. */
export function headingText(raw: string): string {
  return raw
    .replace(/`([^`]+)`/g, '$1') // inline code -> its text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/[*_~]+/g, '') // emphasis markers
    .replace(/<[^>]+>/g, '') // stray inline HTML
    .replace(/\s+/g, ' ')
    .trim();
}

/** All `#`..`######` headings in document order, skipping fenced code blocks. */
export function parseHeadings(
  source: string
): { depth: number; text: string }[] {
  const out: { depth: number; text: string }[] = [];
  let inFence = false;
  for (const line of source.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) out.push({ depth: m[1].length, text: headingText(m[2]) });
  }
  return out;
}

/**
 * The h2/h3 headings of one page with rehype-slug-compatible ids. Every heading
 * (including the h1) is fed through one github-slugger instance in document
 * order so the duplicate-suffix counter matches rehype-slug's per-document pass.
 */
export function headingsForPage(source: string): DocHeading[] {
  const slugger = new GithubSlugger();
  const out: DocHeading[] = [];
  for (const h of parseHeadings(source)) {
    const id = slugger.slug(h.text);
    if (h.depth === 2 || h.depth === 3) {
      out.push({ text: h.text, id, depth: h.depth });
    }
  }
  return out;
}

/** Build the heading index for every nav entry. */
export function generateDocsIndex(nav: NavArea[], docsDir: string): DocPage[] {
  const pages: DocPage[] = [];
  for (const area of nav) {
    for (const section of area.sections) {
      for (const entry of section.entries) {
        const file = routeToFile(docsDir, entry.route);
        if (!file) {
          throw new Error(
            `docs-index: nav route ${entry.route} (${entry.title}) has no matching MDX file under ${docsDir}`
          );
        }
        pages.push({
          title: entry.title,
          route: entry.route,
          headings: headingsForPage(readFileSync(file, 'utf8')),
        });
      }
    }
  }
  return pages;
}

/** The headings for the page at `route`, or `[]` if none. */
export function headingsForRoute(
  pages: DocPage[],
  route: string
): DocHeading[] {
  return pages.find((p) => p.route === route)?.headings ?? [];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test generate-docs-index`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/llms/generate-docs-index.ts apps/site/src/llms/__tests__/generate-docs-index.test.ts
git commit -m "feat(site): build-time docs heading index generator"
```

---

### Task 3: Expose the index as a Vite virtual module

**Files:**
- Create: `apps/site/src/llms/vite-plugin-docs-index.ts`
- Create: `apps/site/src/llms/__tests__/vite-plugin-docs-index.test.ts`
- Create: `apps/site/src/virtual-docs-index.d.ts`
- Modify: `apps/site/vite.config.ts` (register the plugin; hoist `docsDir`)

**Interfaces:**
- Consumes: `generateDocsIndex` (Task 2); `nav` / `NavArea`.
- Produces: `docsIndexPlugin(nav: NavArea[], docsDir: string): Plugin`; the module `virtual:docs-index` whose default export is `DocPage[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/llms/__tests__/vite-plugin-docs-index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsIndexPlugin } from '../vite-plugin-docs-index.js';
import { nav } from '../../pages/docs/nav.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../../pages/docs');

describe('docsIndexPlugin', () => {
  const plugin = docsIndexPlugin(nav, docsDir);

  it('resolves the virtual id', () => {
    const resolved = (plugin.resolveId as Function).call(
      {},
      'virtual:docs-index'
    );
    expect(resolved).toBe('\0virtual:docs-index');
    expect((plugin.resolveId as Function).call({}, 'other')).toBeUndefined();
  });

  it('loads an es module exporting the page index', () => {
    const code = (plugin.load as Function).call({}, '\0virtual:docs-index') as string;
    expect(code.startsWith('export default ')).toBe(true);
    expect(code).toContain('/docs/loaders');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test vite-plugin-docs-index`
Expected: FAIL (cannot find module `../vite-plugin-docs-index.js`).

- [ ] **Step 3: Implement the plugin**

Create `apps/site/src/llms/vite-plugin-docs-index.ts`:
```ts
import type { Plugin } from 'vite';
import type { NavArea } from '../pages/docs/nav.js';
import { generateDocsIndex } from './generate-docs-index.js';

const VIRTUAL_ID = 'virtual:docs-index';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/**
 * Serves the docs heading index (Task 2) to the client as `virtual:docs-index`.
 * The TOC and the Cmd+K palette import it. On a docs MDX edit in dev it
 * invalidates the module and full-reloads so headings stay current.
 */
export function docsIndexPlugin(nav: NavArea[], docsDir: string): Plugin {
  return {
    name: 'docs-index',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return undefined;
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export default ${JSON.stringify(generateDocsIndex(nav, docsDir))};`;
      }
      return undefined;
    },
    handleHotUpdate(ctx) {
      if (ctx.file.includes('/pages/docs/') && ctx.file.endsWith('.mdx')) {
        const mod = ctx.server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
        ctx.server.ws.send({ type: 'full-reload' });
      }
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test vite-plugin-docs-index`
Expected: PASS.

- [ ] **Step 5: Add the virtual-module type declaration**

Create `apps/site/src/virtual-docs-index.d.ts`:
```ts
declare module 'virtual:docs-index' {
  import type { DocPage } from './llms/generate-docs-index.js';
  const pages: DocPage[];
  export default pages;
}
```

- [ ] **Step 6: Register the plugin in vite.config.ts**

In `apps/site/vite.config.ts`: import the plugin, hoist a shared `docsDir`, and add the plugin to the `plugins` array (before the `mdx()` plugin is fine).
```ts
import { docsIndexPlugin } from './src/llms/vite-plugin-docs-index.js';
// ...near the other module-scope consts:
const docsDir = resolve(__dirname, 'src/pages/docs');
```
Replace the `const docsDir = resolve(__dirname, 'src/pages/docs');` line inside the `emit-llms-txt` `closeBundle` with use of the hoisted const (remove the inner declaration). Then add to `plugins`:
```ts
    highlightPlugin(),
    honoPreact({ adapter: cloudflareAdapter() }),
    docsIndexPlugin(nav, docsDir),
    { name: 'emit-llms-txt', /* ...unchanged... */ },
```

- [ ] **Step 7: Verify typecheck and build**

Run: `pnpm typecheck`
Expected: PASS (the `.d.ts` makes `virtual:docs-index` importable).
Run: `pnpm --filter site build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/llms/vite-plugin-docs-index.ts apps/site/src/llms/__tests__/vite-plugin-docs-index.test.ts apps/site/src/virtual-docs-index.d.ts apps/site/vite.config.ts
git commit -m "feat(site): expose docs heading index as a virtual module"
```

---

### Task 4: Search util (dep-free fuzzy matcher)

**Files:**
- Create: `apps/site/src/components/docs/search.ts`
- Create: `apps/site/src/components/docs/__tests__/search.test.ts`

**Interfaces:**
- Consumes: `DocPage` (Task 2).
- Produces:
  - `type SearchResult = { href: string; title: string; section?: string }`
  - `fuzzyScore(text: string, query: string): number | null` (inputs already lowercased by caller)
  - `searchDocs(pages: DocPage[], query: string, limit?: number): SearchResult[]`

- [ ] **Step 1: Write the failing tests**

Create `apps/site/src/components/docs/__tests__/search.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fuzzyScore, searchDocs } from '../search.js';
import type { DocPage } from '../../../llms/generate-docs-index.js';

const pages: DocPage[] = [
  {
    title: 'Server Loaders',
    route: '/docs/loaders',
    headings: [
      { text: 'How it works', id: 'how-it-works', depth: 2 },
      { text: 'Options', id: 'options', depth: 2 },
    ],
  },
  {
    title: 'Streaming',
    route: '/docs/streaming',
    headings: [{ text: 'Errors', id: 'errors', depth: 2 }],
  },
];

describe('fuzzyScore', () => {
  it('returns null when query is not a subsequence', () => {
    expect(fuzzyScore('loaders', 'xyz')).toBeNull();
  });
  it('scores a contiguous prefix higher than a scattered match', () => {
    const contiguous = fuzzyScore('options', 'opt')!;
    const scattered = fuzzyScore('open pretty things', 'opt')!;
    expect(contiguous).toBeGreaterThan(scattered);
  });
});

describe('searchDocs', () => {
  it('returns one result per page (title only) for an empty query', () => {
    const r = searchDocs(pages, '');
    expect(r).toEqual([
      { href: '/docs/loaders', title: 'Server Loaders' },
      { href: '/docs/streaming', title: 'Streaming' },
    ]);
  });

  it('matches page titles and ranks them above heading matches', () => {
    const r = searchDocs(pages, 'options');
    // "Options" heading on loaders should appear, linking to the anchor.
    const opt = r.find((x) => x.section === 'Options')!;
    expect(opt.href).toBe('/docs/loaders#options');
    expect(opt.title).toBe('Server Loaders');
  });

  it('matches headings across pages', () => {
    const r = searchDocs(pages, 'errors');
    expect(r[0]).toEqual({
      href: '/docs/streaming#errors',
      title: 'Streaming',
      section: 'Errors',
    });
  });

  it('returns nothing for an unmatched query', () => {
    expect(searchDocs(pages, 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test components/docs/__tests__/search`
Expected: FAIL (cannot find module `../search.js`).

- [ ] **Step 3: Implement the search util**

Create `apps/site/src/components/docs/search.ts`:
```ts
import type { DocPage } from '../../llms/generate-docs-index.js';

export type SearchResult = { href: string; title: string; section?: string };

/**
 * Subsequence fuzzy score. Returns null when `query` is not a subsequence of
 * `text`; otherwise a higher number for tighter, earlier matches. Both args are
 * expected lowercased.
 */
export function fuzzyScore(text: string, query: string): number | null {
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const qc of query) {
    let found = -1;
    for (let i = ti; i < text.length; i++) {
      if (text[i] === qc) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    if (found === 0) score += 10; // start-of-string bonus
    if (found === ti) {
      streak += 1;
      score += 5 + streak; // contiguous run
    } else {
      streak = 0;
      score += 1;
    }
    ti = found + 1;
  }
  return score;
}

/**
 * Search page titles and section headings. Empty query lists every page (title
 * only) so the palette doubles as a page browser. Results are ranked by fuzzy
 * match quality; a page (title) result wins over a section (heading) result only
 * on an equal score, so an incidental title subsequence cannot bury a strong
 * heading match. Capped at `limit`.
 */
export function searchDocs(
  pages: DocPage[],
  query: string,
  limit = 50
): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return pages.slice(0, limit).map((p) => ({ href: p.route, title: p.title }));
  }
  const scored: { r: SearchResult; score: number; isTitle: boolean }[] = [];
  for (const p of pages) {
    const ts = fuzzyScore(p.title.toLowerCase(), q);
    if (ts != null) {
      scored.push({
        r: { href: p.route, title: p.title },
        score: ts,
        isTitle: true,
      });
    }
    for (const h of p.headings) {
      const hs = fuzzyScore(h.text.toLowerCase(), q);
      if (hs != null) {
        scored.push({
          r: { href: `${p.route}#${h.id}`, title: p.title, section: h.text },
          score: hs,
          isTitle: false,
        });
      }
    }
  }
  // Best fuzzy match first; on a tie, prefer the page (title) over a section.
  scored.sort(
    (a, b) => b.score - a.score || Number(b.isTitle) - Number(a.isTitle)
  );
  return scored.slice(0, limit).map((s) => s.r);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test components/docs/__tests__/search`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/docs/search.ts apps/site/src/components/docs/__tests__/search.test.ts
git commit -m "feat(site): dep-free docs search matcher"
```

---

### Task 5: "On this page" TableOfContents component

**Files:**
- Create: `apps/site/src/components/docs/TableOfContents.tsx`
- Create: `apps/site/src/components/docs/__tests__/TableOfContents.test.tsx`

**Interfaces:**
- Consumes: `DocHeading` (Task 2).
- Produces: `TableOfContents({ headings }: { headings: DocHeading[] })`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/components/docs/__tests__/TableOfContents.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { TableOfContents } from '../TableOfContents.js';
import type { DocHeading } from '../../../llms/generate-docs-index.js';

beforeAll(() => {
  // happy-dom lacks IntersectionObserver; stub a no-op.
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    class {
      observe() {}
      disconnect() {}
    };
});
afterEach(cleanup);

const headings: DocHeading[] = [
  { text: 'How it works', id: 'how-it-works', depth: 2 },
  { text: 'Options', id: 'options', depth: 3 },
];

describe('TableOfContents', () => {
  it('renders a link per heading with hash hrefs', () => {
    const { getByRole } = render(<TableOfContents headings={headings} />);
    const link = getByRole('link', { name: 'Options' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#options');
  });

  it('renders nothing when there are fewer than two headings', () => {
    const { container } = render(
      <TableOfContents headings={[headings[0]]} />
    );
    expect(container.querySelector('nav')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test TableOfContents`
Expected: FAIL (cannot find module `../TableOfContents.js`).

- [ ] **Step 3: Implement the component**

Create `apps/site/src/components/docs/TableOfContents.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks';
import type { DocHeading } from '../../llms/generate-docs-index.js';

// Right-rail "On this page" nav. Reads the current route's headings (passed in
// from the build-time index) and scroll-spies the active section.
export function TableOfContents({ headings }: { headings: DocHeading[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el != null);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
        );
        setActiveId(visible[0].target.id);
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" class="text-sm">
      <div class="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-muted mb-2">
        On this page
      </div>
      <ul class="flex flex-col gap-1.5 list-none m-0 p-0">
        {headings.map((h) => (
          <li key={h.id} class={h.depth === 3 ? 'pl-3' : ''}>
            <a
              href={`#${h.id}`}
              aria-current={activeId === h.id ? 'true' : undefined}
              class={`no-underline block ${
                activeId === h.id
                  ? 'text-accent font-medium'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default TableOfContents;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test TableOfContents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/docs/TableOfContents.tsx apps/site/src/components/docs/__tests__/TableOfContents.test.tsx
git commit -m "feat(site): on-this-page table of contents"
```

---

### Task 6: useHashScroll hook (scroll to anchor after soft navigation)

`preact-iso`'s `route()` updates the URL but does not scroll to a hash, so cross-page palette jumps to `route#id` need a manual scroll. Native browser scroll already handles same-page TOC clicks and fresh deep-link loads (the SSR'd headings carry ids).

**Files:**
- Create: `apps/site/src/hooks/use-hash-scroll.ts`
- Create: `apps/site/src/hooks/__tests__/use-hash-scroll.test.tsx`

**Interfaces:**
- Produces: `useHashScroll(path: string): void`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/hooks/__tests__/use-hash-scroll.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useHashScroll } from '../use-hash-scroll.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

function Harness({ path }: { path: string }) {
  useHashScroll(path);
  return null;
}

describe('useHashScroll', () => {
  it('scrolls the hash target into view on path change', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const target = document.createElement('h2');
    target.id = 'options';
    document.body.appendChild(target);
    const spy = vi.fn();
    target.scrollIntoView = spy;
    window.location.hash = '#options';

    render(<Harness path="/docs/loaders" />);
    expect(spy).toHaveBeenCalled();
    target.remove();
  });

  it('does nothing without a hash', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    expect(() => render(<Harness path="/docs/loaders" />)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test use-hash-scroll`
Expected: FAIL (cannot find module `../use-hash-scroll.js`).

- [ ] **Step 3: Implement the hook**

Create `apps/site/src/hooks/use-hash-scroll.ts`:
```ts
import { useEffect } from 'preact/hooks';

// Scroll to the URL hash target after a soft (preact-iso) navigation, which
// does not scroll on its own. Re-runs on path change and on hashchange.
export function useHashScroll(path: string): void {
  useEffect(() => {
    scrollToHash();
    function onHashChange() {
      scrollToHash();
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [path]);
}

function scrollToHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const el = document.getElementById(decodeURIComponent(hash));
  if (!el) return;
  // Defer one frame so the destination page's content has committed.
  requestAnimationFrame(() =>
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test use-hash-scroll`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/hooks/use-hash-scroll.ts apps/site/src/hooks/__tests__/use-hash-scroll.test.tsx
git commit -m "feat(site): scroll to hash after soft navigation"
```

---

### Task 7: Cmd+K CommandPalette component

Dogfoods `hono-preact-ui` Dialog (controlled) + Combobox. The Combobox commits the highlighted option on Enter by synthesizing a click on it, so navigation lives in each option's `onClick` and serves both mouse and keyboard.

**Files:**
- Create: `apps/site/src/components/CommandPalette.tsx`
- Create: `apps/site/src/components/__tests__/CommandPalette.test.tsx`
- Modify: `apps/site/src/styles/root.css` (append `.docs-cmdk*` styles)

**Interfaces:**
- Consumes: `DocPage` (Task 2); `searchDocs` (Task 4); `useNavigate` from `hono-preact`; `Dialog`, `Combobox` from `hono-preact-ui`.
- Produces: `CommandPalette({ pages }: { pages: DocPage[] })`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/components/__tests__/CommandPalette.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { CommandPalette } from '../CommandPalette.js';
import type { DocPage } from '../../llms/generate-docs-index.js';

afterEach(cleanup);

const pages: DocPage[] = [
  {
    title: 'Server Loaders',
    route: '/docs/loaders',
    headings: [{ text: 'Options', id: 'options', depth: 2 }],
  },
  { title: 'Streaming', route: '/docs/streaming', headings: [] },
];

function setup() {
  return render(
    <LocationProvider>
      <CommandPalette pages={pages} />
    </LocationProvider>
  );
}

describe('CommandPalette', () => {
  it('opens on Cmd+K and shows the search input', async () => {
    const { getByLabelText } = setup();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await waitFor(() =>
      expect(getByLabelText('Search documentation')).toBeTruthy()
    );
  });

  it('opens from the trigger button and filters by query', async () => {
    const { getByRole, getByLabelText, findByText } = setup();
    fireEvent.click(getByRole('button', { name: /search/i }));
    const input = getByLabelText('Search documentation') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'stream' } });
    expect(await findByText('Streaming')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test CommandPalette`
Expected: FAIL (cannot find module `../CommandPalette.js`).

- [ ] **Step 3: Implement the component**

Create `apps/site/src/components/CommandPalette.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Dialog, Combobox } from 'hono-preact-ui';
import { useNavigate } from 'hono-preact';
import { Search } from 'lucide-preact';
import type { DocPage } from '../llms/generate-docs-index.js';
import { searchDocs } from './docs/search.js';

// Cmd+K command palette over the docs heading index. Built on hono-preact-ui's
// Dialog (controlled) + Combobox. The Combobox clicks the highlighted option on
// Enter, so navigation lives in each option's onClick (mouse + keyboard share
// the path).
export function CommandPalette({ pages }: { pages: DocPage[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => searchDocs(pages, query), [pages, query]);

  function go(href: string) {
    setOpen(false);
    setQuery('');
    navigate(href);
  }

  return (
    <>
      <button
        type="button"
        class="docs-cmdk-trigger"
        onClick={() => setOpen(true)}
      >
        <Search size={15} class="shrink-0 opacity-70" />
        <span>Search</span>
        <kbd class="docs-cmdk-kbd">⌘K</kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Popup class="docs-cmdk" aria-label="Search documentation">
          <Combobox.Root onInputChange={setQuery} openOnFocus>
            <Combobox.Input
              class="docs-cb-input docs-cmdk-input"
              placeholder="Search docs…"
              aria-label="Search documentation"
            />
            <Combobox.Status />
            <Combobox.Popup class="docs-cb docs-cmdk-list" aria-label="Search results">
              {results.map((r) => (
                <Combobox.Option
                  class="docs-cb__option docs-cmdk-option"
                  key={r.href}
                  value={r.href}
                  onClick={() => go(r.href)}
                >
                  <span class="docs-cmdk-option__title">{r.title}</span>
                  {r.section && (
                    <span class="docs-cmdk-option__section">{r.section}</span>
                  )}
                </Combobox.Option>
              ))}
              <Combobox.Empty class="docs-cb__empty">No results</Combobox.Empty>
            </Combobox.Popup>
          </Combobox.Root>
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}

export default CommandPalette;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test CommandPalette`
Expected: PASS. (If the native `<dialog>.showModal` is not implemented in the happy-dom version, the Dialog package's own tests would already be failing; they are not, so it is available.)

- [ ] **Step 5: Add palette styles**

Append to `apps/site/src/styles/root.css` (reuses `.docs-cb*` from the combobox demo for the input/list/option/empty; adds only the shell, trigger, and result rows):
```css
/* Cmd+K command palette. Reuses the combobox demo styles for the field and
   listbox; this block is the dialog shell, the topbar trigger, and result rows. */
.docs-cmdk-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 2rem;
  padding: 0 0.6rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: transparent;
  color: var(--muted);
  font-size: 0.85rem;
  cursor: pointer;
}
.docs-cmdk-trigger:hover {
  color: var(--foreground);
  background: color-mix(in oklab, var(--foreground) 8%, transparent);
}
.docs-cmdk-kbd {
  font: inherit;
  font-size: 0.7rem;
  padding: 0.05rem 0.3rem;
  border: 1px solid var(--border);
  border-radius: 0.3rem;
  color: var(--muted);
}
.docs-cmdk {
  width: min(40rem, calc(100vw - 2rem));
  max-width: 40rem;
  margin: 12vh auto auto;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--surface-subtle, var(--background));
}
.docs-cmdk-input {
  width: 100%;
  margin-bottom: 0.5rem;
}
.docs-cmdk-list {
  position: static;
  max-height: 60vh;
  overflow-y: auto;
  box-shadow: none;
}
.docs-cmdk-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
}
.docs-cmdk-option__title {
  font-weight: 500;
}
.docs-cmdk-option__section {
  font-size: 0.8rem;
  color: var(--muted);
}
```

- [ ] **Step 6: Verify typecheck and the full test file**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm test CommandPalette`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/components/CommandPalette.tsx apps/site/src/components/__tests__/CommandPalette.test.tsx apps/site/src/styles/root.css
git commit -m "feat(site): Cmd+K docs command palette"
```

---

### Task 8: Wire TOC, palette, and hash-scroll into DocsLayout

**Files:**
- Modify: `apps/site/src/components/DocsLayout.tsx`

**Interfaces:**
- Consumes: `docsPages` (default export of `virtual:docs-index`); `headingsForRoute` (Task 2); `TableOfContents` (Task 5); `CommandPalette` (Task 7); `useHashScroll` (Task 6).

This task is layout glue (its data selection is already unit-tested via `headingsForRoute`); verify by typecheck, build, and a manual browser pass.

- [ ] **Step 1: Add imports**

At the top of `apps/site/src/components/DocsLayout.tsx`, add:
```ts
import docsPages from 'virtual:docs-index';
import { headingsForRoute } from '../llms/generate-docs-index.js';
import { TableOfContents } from './docs/TableOfContents.js';
import { CommandPalette } from './CommandPalette.js';
import { useHashScroll } from '../hooks/use-hash-scroll.js';
```

- [ ] **Step 2: Compute headings and call the hash-scroll hook**

Inside `DocsLayout`, after `const { path } = useLocation();`:
```ts
  useHashScroll(path);
  const headings = headingsForRoute(docsPages, path);
```

- [ ] **Step 3: Add the palette trigger to the topbar**

In the topbar `<header>`, replace the `<span class="flex-1" />` spacer region so the palette trigger sits between the area tabs and the version badge. Put the trigger right after the `<nav ... aria-label="Docs areas">...</nav>` block:
```tsx
        <span class="flex-1" />
        <CommandPalette pages={docsPages} />
        <span class="hidden sm:inline text-xs text-muted whitespace-nowrap">
          v{__HONO_PREACT_VERSION__}
        </span>
```
(The existing `<span class="flex-1" />` currently precedes the version badge; move the palette trigger in just after it, keeping the GitHub link and ThemeToggle after the badge as they are.)

- [ ] **Step 4: Add the third grid column and the TOC rail**

Change the content grid wrapper from the inline 2-column style to a responsive 3-column class, and add the TOC `<aside>` as the last in-flow child. Replace:
```tsx
      <div
        class="flex-1 grid"
        style={{ gridTemplateColumns: `${SIDEBAR_W}px 1fr` }}
      >
```
with:
```tsx
      <div class="flex-1 grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_15rem]">
```
Keep the existing desktop sidebar `<aside>` (it lands in column 1), the fixed mobile backdrop/drawer (fixed-position, unaffected), and the `<main>` (column 2). Then, immediately after the closing `</main>`, add the TOC rail as the third column:
```tsx
        {/* On-this-page rail (wide screens only) */}
        <aside
          aria-label="On this page"
          class="hidden xl:block xl:sticky xl:top-12 xl:h-[calc(100vh-3rem)] overflow-y-auto py-8 px-4"
        >
          <TableOfContents headings={headings} />
        </aside>
```
Note: `main` keeps its `col-span-full md:col-auto max-w-[65ch]` classes so it occupies column 2 and the TOC occupies column 3 on `xl`. The `SIDEBAR_W` constant (240) still drives the sidebar; the literal `240px` in the grid classes mirrors it (Tailwind needs a literal in the arbitrary value).

- [ ] **Step 5: Verify typecheck and build**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm --filter site build`
Expected: build succeeds.

- [ ] **Step 6: Manual browser check**

Run: `pnpm dev`, open `http://localhost:5173/docs/live-loaders`.
Confirm:
- A right-rail "On this page" lists the page sections; clicking "loader.View..." scrolls to it and the rail highlights the active section as you scroll.
- Hovering a heading shows the `#` permalink; clicking it puts `#slug` in the URL.
- Cmd/Ctrl+K (and the topbar Search button) opens the palette; typing "view" surfaces the `.View()` section; Enter navigates to `/docs/live-loaders#...` and scrolls there.
- The layout is unbroken at narrow widths (TOC hidden below `xl`, sidebar drawer still works on mobile).

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/components/DocsLayout.tsx
git commit -m "feat(site): wire TOC, Cmd+K palette, and hash-scroll into docs layout"
```

---

### Task 9: Full verification and pre-push gate

**Files:** none (verification only).

- [ ] **Step 1: Build framework dist then site (CI step order)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: all package builds succeed.

- [ ] **Step 2: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format`, then `git add -A && git commit -m "chore(site): format"`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Type-level tests**

Run: `pnpm test:types`
Expected: PASS.

- [ ] **Step 5: Unit tests with coverage**

Run: `pnpm test:coverage`
Expected: PASS, including all five new test files (`mdx-plugins`, `generate-docs-index`, `vite-plugin-docs-index`, `search`, `TableOfContents`, `use-hash-scroll`, `CommandPalette`).

- [ ] **Step 6: Integration tests**

Run: `pnpm test:integration`
Expected: PASS.

- [ ] **Step 7: Site build**

Run: `pnpm --filter site build`
Expected: PASS.

- [ ] **Step 8: Final working-tree review (format trap guard)**

Run: `git status` and `git diff --stat`.
Expected: clean working tree, every intended file committed, no format-dirty files left behind.

---

## Self-Review

**Spec coverage (PR A scope of the umbrella spec):**
- A1 anchored headings -> Task 1. ✅
- A2 auto-derived heading index + slug parity (github-slugger) -> Task 2 (+ parity test). ✅
- Virtual module exposure -> Task 3. ✅
- A3 TOC + scroll-spy + 3-col layout -> Task 5 + Task 8. ✅
- A4 Cmd+K palette (Dialog + Combobox dogfood, dep-free matcher, Baseline APIs) -> Task 4 (search) + Task 7 (palette). ✅
- Cross-page hash scroll for `route#id` jumps -> Task 6. ✅
- A5 enforcement: index parity test (Task 2), TOC + palette smoke tests (Tasks 5, 7). ✅
- Pre-push seven-step CI mirror -> Task 9. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; every run step shows the command and expected result. ✅

**Type consistency:** `DocHeading` / `DocPage` defined in Task 2 and consumed unchanged in Tasks 4, 5, 7, 8. `SearchResult` defined in Task 4 and consumed in Task 7. `headingsForRoute` (Task 2) consumed in Task 8. `docsPages` is the default export of `virtual:docs-index` (Task 3 plugin + Task 3 `.d.ts`), consumed in Task 8. ✅

**Notes / out of scope (later PRs):** page-structure rewrite + template/hook/gate is PR B; surfacing `llms.txt` in the UI is PR C. Client bundle size will grow slightly (palette usage; Dialog/Combobox already ship via the component demos); the committed size baseline updates on the main push job per CLAUDE.md, so no pre-merge action is required beyond noting it in the PR.
```
