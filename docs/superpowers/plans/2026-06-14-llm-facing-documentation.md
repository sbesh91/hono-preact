# LLM-facing Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help any LLM (provider-agnostic) use hono-preact correctly via three independently-shippable surfaces: a generated `llms.txt`/`llms-full.txt` on the docs site, a scaffolder-shipped `AGENTS.md` (plus an `add-agents` CLI command and a CLI reference page), and an opportunistic pass to sharpen the framework's most LLM-confusing error messages.

**Architecture:** Generate every mechanical artifact from sources the repo already trusts (the docs MDX, `nav.ts`, the package `exports` map) and enforce no-drift with tests, matching the repo's existing anti-drift culture. The corpus generator is a pure, unit-tested module that a Vite plugin calls at build time; the scaffolder gains a single `templates/agents/` source consumed by both `create` and `add-agents`; two coverage tests fail CI when the artifacts fall behind the real API.

**Tech Stack:** TypeScript + Vite (apps/site), plain `.mjs` (the create-hono-preact CLI), Vitest, MDX.

**Phases ship as separate PRs (each is self-contained and valuable):**

- **Phase 1** - `llms.txt` + `llms-full.txt` (apps/site only).
- **Phase 2** - scaffolder `AGENTS.md` + `add-agents` command + CLI reference page + exports-coverage and appendix tests.
- **Phase 3** - framework-legibility pass (sharpen four generic error messages).

Phase 4 from the spec (the eval-harness capstone) is intentionally out of scope for this plan; it is optional, non-deterministic, and best run on a cron after Phases 1-3 land.

---

## File Structure

**Phase 1 (apps/site):**
- Create `apps/site/src/llms/generate-llms.ts` - pure corpus generator (`mdxToMarkdown`, `extractDescription`, `routeToFile`, `generateLlmsFiles`). One responsibility: turn the docs sources into the two output strings. No I/O target knowledge.
- Create `apps/site/src/llms/__tests__/generate-llms.test.ts` - unit tests for the extractor + a parity test (every nav route resolves, corpus is clean and non-empty).
- Modify `apps/site/vite.config.ts` - import the generator + `nav`, add a small `emit-llms-txt` plugin that writes the two files into the client build output.

**Phase 2 (packages/create-hono-preact + apps/site + root config):**
- Create `packages/create-hono-preact/templates/agents/AGENTS.md` - the canonical agent guidance (single source).
- Create `packages/create-hono-preact/templates/agents/CLAUDE.md` - one-line pointer to AGENTS.md.
- Modify `packages/create-hono-preact/lib/args.mjs` - parse the `add-agents` subcommand + `--force`.
- Modify `packages/create-hono-preact/lib/template.mjs` - add `fileExists` + `copyAgentsFiles` helpers.
- Modify `packages/create-hono-preact/lib/cli.mjs` - scaffold ships agents; dispatch `add-agents`; update `--help`.
- Modify `packages/create-hono-preact/__tests__/args.test.ts` - `add-agents` parse tests.
- Modify `packages/create-hono-preact/__tests__/cli.test.ts` - scaffold-ships-agents assertions + `add-agents` behavior tests.
- Create `packages/create-hono-preact/__tests__/agents-appendix.test.ts` - AGENTS.md entry-point appendix matches the public `exports` subpaths.
- Create `apps/site/src/pages/docs/cli.mdx` - CLI reference page.
- Modify `apps/site/src/pages/docs/nav.ts` - add the CLI nav entry (keeps route↔nav parity green).
- Modify root `vitest.config.ts` - add source aliases for the two adapter subpaths so the coverage test can import them.
- Create `apps/site/src/pages/docs/__tests__/exports-coverage.test.ts` - every public runtime export is documented or explicitly allowlisted.

**Phase 3 (framework packages):**
- Modify `packages/vite/src/server-loader-validation.ts` - fix the self-contradictory remediation sentence.
- Modify `packages/iso/src/internal/loader-fetch.ts` - add remediation to the generic loader-failure message.
- Modify `packages/iso/src/internal/safe-redirect.ts` and `packages/iso/src/action.ts` - cross-origin redirect messages name the fix.
- Modify `packages/iso/src/internal/loader.tsx` - clarify the "owns this server module" message.
- Update the corresponding tests.

---

# Phase 1 - `llms.txt` + `llms-full.txt`

**End state:** `pnpm --filter site build` writes `apps/site/dist/client/llms.txt` and `apps/site/dist/client/llms-full.txt` (served at `framework.sbesh.com/llms.txt` and `/llms-full.txt`). A unit-tested pure generator produces the strings; a parity test guarantees every link resolves and the corpus is clean.

**Reference facts (verified):**
- Docs MDX live under `apps/site/src/pages/docs/**/*.mdx` (42 files). No YAML frontmatter; page title is the first `#` heading.
- Route mapping: `/docs/<slug>` <- `pages/docs/<slug>.mdx`; `/docs` <- `index.mdx`; `/docs/components` <- `components/index.mdx`.
- The curated index is `apps/site/src/pages/docs/nav.ts` (`nav: NavArea[]`, areas -> sections -> `{title, route}`), kept in sync with the files by `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts`.
- Cloudflare assets root is `apps/site/dist/client` (per `apps/site/wrangler.jsonc` `assets.directory`), so files written there serve at the site root.
- The build already reads a file at config time (`apps/site/vite.config.ts` reads the framework `package.json` for the version badge), and `__dirname` is derived at the top of that file.
- `.txt` files are outside every `pnpm format:check` glob, and `dist` is in `.prettierignore`. New `.ts` under `apps/site/src` IS format-checked.

### Task 1: Markdown extractor (`mdxToMarkdown` + `extractDescription`)

**Files:**
- Create: `apps/site/src/llms/generate-llms.ts`
- Test: `apps/site/src/llms/__tests__/generate-llms.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/llms/__tests__/generate-llms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mdxToMarkdown, extractDescription } from '../generate-llms.js';

describe('mdxToMarkdown', () => {
  it('strips top-of-file import lines', () => {
    const out = mdxToMarkdown(`import { Foo } from './Foo.js';\n\n# Title\n\nBody.`);
    expect(out).not.toContain('import');
    expect(out).toContain('# Title');
    expect(out).toContain('Body.');
  });

  it('drops <Example> blocks (they wrap interactive demo components)', () => {
    const out = mdxToMarkdown(`# T\n\n<Example>\n  <DialogDemo />\n</Example>\n\nAfter.`);
    expect(out).not.toContain('<Example>');
    expect(out).not.toContain('DialogDemo');
    expect(out).toContain('After.');
  });

  it('unwraps <CodeTabs> but keeps the fenced code inside', () => {
    const src = `# T\n\n<CodeTabs labels={['CSS', 'Tailwind']}>\n\n\`\`\`css\na { color: red; }\n\`\`\`\n\n</CodeTabs>\n`;
    const out = mdxToMarkdown(src);
    expect(out).not.toContain('CodeTabs');
    expect(out).toContain('```css');
    expect(out).toContain('a { color: red; }');
  });

  it('preserves prose, headings, tables, and fenced code', () => {
    const src = `# T\n\nLead.\n\n## H2\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n`;
    const out = mdxToMarkdown(src);
    expect(out).toContain('## H2');
    expect(out).toContain('| a | b |');
    expect(out).toContain('const x = 1;');
  });
});

describe('extractDescription', () => {
  it('returns the first prose paragraph after the H1, flattened to one line', () => {
    const md = `# Server Loaders\n\nLoaders run on the server\nbefore render.\n\n## Next\n`;
    expect(extractDescription(md)).toBe('Loaders run on the server before render.');
  });

  it('returns empty string when there is no lead paragraph', () => {
    expect(extractDescription(`# Title\n\n## Straight to a heading\n`)).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/site/src/llms/__tests__/generate-llms.test.ts`
Expected: FAIL ("Cannot find module '../generate-llms.js'" / functions not defined).

- [ ] **Step 3: Implement the extractor**

Create `apps/site/src/llms/generate-llms.ts`:

```ts
/**
 * Pure generator for the docs-site LLM artifacts (llms.txt / llms-full.txt).
 *
 * It reads the docs MDX off disk and the curated index from nav.ts, and returns
 * two strings. It is deliberately free of any output-path knowledge so it can be
 * unit-tested; the Vite plugin in vite.config.ts owns where the files land.
 */

/**
 * Convert an MDX docs page into plain Markdown for the LLM corpus. Strips the
 * docs-site JSX wrappers while preserving prose, code fences, GFM tables, and
 * headings. <Example> blocks wrap interactive demo *components* (e.g.
 * <DialogDemo />), not instructive source, so they are dropped; the usable code
 * lives in the page's own fenced blocks and <CodeTabs>.
 */
export function mdxToMarkdown(source: string): string {
  let md = source;

  // 1. Drop top-of-file import lines (component pages import their demos).
  md = md.replace(/^import\s.*?;?\s*$/gm, '');

  // 2. Remove <Example>...</Example> blocks entirely.
  md = md.replace(/<Example>[\s\S]*?<\/Example>/g, '');

  // 3. Unwrap <CodeTabs ...> ... </CodeTabs>, keeping the fenced blocks inside
  //    (each already carries its language tag, e.g. ```css / ```tsx).
  md = md.replace(/<CodeTabs[^>]*>/g, '').replace(/<\/CodeTabs>/g, '');

  // 4. Drop any remaining standalone self-closing custom-component tags
  //    (capitalized component name), e.g. a bare <SafeAreaDiagram />.
  md = md.replace(/^\s*<[A-Z][A-Za-z0-9]*(\s[^>]*)?\/>\s*$/gm, '');

  // 5. Collapse the runs of blank lines the strips leave behind.
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim() + '\n';
}

/**
 * The one-line description for a page: its lead paragraph (the first prose block
 * after the H1). The docs template already requires this paragraph, so it is the
 * truest "next to the page" source and cannot drift.
 */
export function extractDescription(markdown: string): string {
  // Everything after the first H1 line.
  const afterH1 = markdown.replace(/^[\s\S]*?^#\s+.+$/m, '');
  for (const block of afterH1.split(/\n\s*\n/)) {
    const line = block.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue; // heading
    if (line.startsWith('```')) continue; // code fence
    if (line.startsWith('|')) continue; // table
    if (line.startsWith('<')) continue; // leftover JSX
    return line.replace(/\s+/g, ' ');
  }
  return '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run apps/site/src/llms/__tests__/generate-llms.test.ts`
Expected: PASS (both describe blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/llms/generate-llms.ts apps/site/src/llms/__tests__/generate-llms.test.ts
git commit -m "feat(site): MDX-to-markdown extractor for the LLM corpus"
```

### Task 2: `routeToFile` + `generateLlmsFiles`

**Files:**
- Modify: `apps/site/src/llms/generate-llms.ts`
- Test: `apps/site/src/llms/__tests__/generate-llms.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `apps/site/src/llms/__tests__/generate-llms.test.ts`:

```ts
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nav } from '../../pages/docs/nav.js';
import { routeToFile, generateLlmsFiles } from '../generate-llms.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../../pages/docs');

describe('routeToFile', () => {
  it('resolves a top-level guide route', () => {
    expect(routeToFile(docsDir, '/docs/loaders')).toMatch(/loaders\.mdx$/);
  });
  it('resolves an area-root route to its index.mdx', () => {
    expect(routeToFile(docsDir, '/docs/components')).toMatch(/components\/index\.mdx$/);
  });
  it('returns null for an unknown route', () => {
    expect(routeToFile(docsDir, '/docs/does-not-exist')).toBeNull();
  });
});

describe('generateLlmsFiles', () => {
  const { llmsTxt, llmsFullTxt } = generateLlmsFiles(nav, docsDir);

  it('every nav route resolves to a real MDX file', () => {
    const routes = nav.flatMap((a) => a.sections.flatMap((s) => s.entries.map((e) => e.route)));
    for (const route of routes) {
      expect(routeToFile(docsDir, route), `route ${route}`).not.toBeNull();
    }
  });

  it('llms.txt has the expected header and a known annotated link', () => {
    expect(llmsTxt.startsWith('# hono-preact')).toBe(true);
    expect(llmsTxt).toContain('> ');
    expect(llmsTxt).toContain('## ');
    expect(llmsTxt).toContain('](https://framework.sbesh.com/docs/loaders)');
  });

  it('llms-full.txt is non-empty, includes real page content, and has no leftover JSX', () => {
    expect(llmsFullTxt.length).toBeGreaterThan(1000);
    expect(llmsFullTxt).toContain('# Server Loaders');
    expect(llmsFullTxt).not.toContain('<Example>');
    expect(llmsFullTxt).not.toContain('<CodeTabs');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run apps/site/src/llms/__tests__/generate-llms.test.ts`
Expected: FAIL (`routeToFile`/`generateLlmsFiles` not exported).

- [ ] **Step 3: Implement**

Append to `apps/site/src/llms/generate-llms.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NavArea } from '../pages/docs/nav.js';

const SITE_ORIGIN = 'https://framework.sbesh.com';
const SUMMARY =
  'A small full-stack framework: Hono on the server, Preact in the browser, ' +
  'routes declared in code, typed loaders/actions/guards, streaming everywhere.';

export interface LlmsFiles {
  llmsTxt: string;
  llmsFullTxt: string;
}

/** Map a `/docs/...` route back to the MDX file that serves it, or null. */
export function routeToFile(docsDir: string, route: string): string | null {
  const slug = route === '/docs' ? '' : route.replace(/^\/docs\//, '');
  const direct = slug === '' ? join(docsDir, 'index.mdx') : join(docsDir, `${slug}.mdx`);
  if (existsSync(direct)) return direct;
  const indexed = join(docsDir, slug, 'index.mdx');
  if (existsSync(indexed)) return indexed;
  return null;
}

/** Build the llms.txt (curated index) and llms-full.txt (full corpus) strings. */
export function generateLlmsFiles(nav: NavArea[], docsDir: string): LlmsFiles {
  const indexLines: string[] = ['# hono-preact', '', `> ${SUMMARY}`, ''];
  const corpusParts: string[] = [];

  for (const area of nav) {
    for (const section of area.sections) {
      indexLines.push(`## ${section.heading}`, '');
      for (const entry of section.entries) {
        const file = routeToFile(docsDir, entry.route);
        if (!file) {
          throw new Error(
            `llms.txt: nav route ${entry.route} (${entry.title}) has no matching MDX file under ${docsDir}`
          );
        }
        const markdown = mdxToMarkdown(readFileSync(file, 'utf8'));
        const url = `${SITE_ORIGIN}${entry.route}`;
        const description = extractDescription(markdown);
        indexLines.push(
          description ? `- [${entry.title}](${url}): ${description}` : `- [${entry.title}](${url})`
        );
        corpusParts.push(`> Source: ${url}\n\n${markdown}`);
      }
      indexLines.push('');
    }
  }

  indexLines.push(
    '## Full corpus',
    '',
    `- [Complete documentation](${SITE_ORIGIN}/llms-full.txt): every page above concatenated as one file`,
    ''
  );

  return {
    llmsTxt: indexLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n',
    llmsFullTxt: corpusParts.join('\n\n---\n\n').trimEnd() + '\n',
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run apps/site/src/llms/__tests__/generate-llms.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Format + commit**

```bash
pnpm format
git add apps/site/src/llms/generate-llms.ts apps/site/src/llms/__tests__/generate-llms.test.ts
git commit -m "feat(site): generate llms.txt and llms-full.txt strings from docs + nav"
```

### Task 3: Wire the Vite plugin to emit the files

**Files:**
- Modify: `apps/site/vite.config.ts`

- [ ] **Step 1: Add the imports**

In `apps/site/vite.config.ts`, change the `node:fs` import to add `writeFileSync` and `mkdirSync`, and add the generator + nav imports near the other local imports:

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
// ...alongside the existing imports:
import { nav } from './src/pages/docs/nav.js';
import { generateLlmsFiles } from './src/llms/generate-llms.js';
```

- [ ] **Step 2: Add the plugin to the `plugins` array**

In the `plugins: [ ... ]` array (right after the `honoPreact(...)` entry), add:

```ts
{
  name: 'emit-llms-txt',
  closeBundle() {
    // Emit only during the client (static-assets) build. dist/client is the
    // Cloudflare assets directory, so files written here serve at the site
    // root (/llms.txt, /llms-full.txt). The worker build shares no asset root.
    if (this.environment && this.environment.name !== 'client') return;
    const docsDir = resolve(__dirname, 'src/pages/docs');
    const { llmsTxt, llmsFullTxt } = generateLlmsFiles(nav, docsDir);
    const outDir = resolve(__dirname, 'dist/client');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, 'llms.txt'), llmsTxt);
    writeFileSync(resolve(outDir, 'llms-full.txt'), llmsFullTxt);
  },
},
```

- [ ] **Step 3: Build the site and verify the files are emitted**

Run:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm --filter site build
ls -la apps/site/dist/client/llms.txt apps/site/dist/client/llms-full.txt
head -20 apps/site/dist/client/llms.txt
```
Expected: both files exist; `llms.txt` begins with `# hono-preact`, a `>` summary, and `##` sections with annotated links; `llms-full.txt` is large and contains real page prose with no `<Example>`/`<CodeTabs>` tags.

- [ ] **Step 4: Verify format + typecheck**

Run:
```bash
pnpm format:check
pnpm typecheck
```
Expected: both pass. (If `format:check` fails, run `pnpm format` and re-stage.)

- [ ] **Step 5: Commit**

```bash
git add apps/site/vite.config.ts
git commit -m "feat(site): emit llms.txt and llms-full.txt at build time"
```

### Task 4: Phase 1 verification

- [ ] **Step 1: Run the full pre-push sequence (Phase 1 surface)**

Run, in order:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm --filter site build
```
Expected: all pass; the new generator tests are included in the suite. Phase 1 is ready to open as its own PR.

---

# Phase 2 - Scaffolder `AGENTS.md` + `add-agents` + CLI page + coverage

**End state:** new apps scaffolded by `create-hono-preact` ship `AGENTS.md` + `CLAUDE.md`; existing projects can run `npx create-hono-preact add-agents`; a CLI reference page documents both commands; CI fails when a public export goes undocumented or the AGENTS.md entry-point appendix falls out of sync with the package `exports` map.

**Reference facts (verified):**
- The CLI has no subcommand layer today; `bin/index.mjs` calls `run({argv, cwd, env})` from `lib/cli.mjs`. `parseArgs` (`lib/args.mjs`) returns a discriminated union by `kind` (`help`/`version`/`error`/`scaffold`).
- `run()` accepts injected `spawnFn`/`prompt`; tests call `run()` directly in a `mkdtempSync` workdir and assert with `existsSync`/`readFileSync`.
- Templates are duplicated per adapter (`templates/cloudflare`, `templates/node`); there is no shared base dir. `_gitignore` -> `.gitignore` is the only special rename (`renameDotfiles`). `.md` files ship under their real names.
- `copyTemplate(source, target)` is a recursive `fs.cp` that overwrites silently. The empty-dir guard is scaffold-only.
- `templatesRoot = resolve(here, '..', 'templates')` in `cli.mjs`.
- Root `vitest.config.ts` aliases `hono-preact`, `hono-preact/page`, `hono-preact/server`, `hono-preact/vite`, `@hono-preact/ui` to source, but NOT the two adapter subpaths. It includes `packages/create-hono-preact/__tests__/**` and `apps/site/src/**/__tests__/**`.
- `.md` files are outside every `format:check` glob; new `.mjs`/`.ts`/`.mdx`/`.json` are not.
- Public subpaths in `packages/hono-preact/package.json` `exports`: `.`, `./page`, `./server`, `./vite`, `./adapter-cloudflare`, `./adapter-node` (the `./internal*` subpaths are not public).

### Task 5: The canonical `AGENTS.md` + `CLAUDE.md` template source

**Files:**
- Create: `packages/create-hono-preact/templates/agents/AGENTS.md`
- Create: `packages/create-hono-preact/templates/agents/CLAUDE.md`

- [ ] **Step 1: Create `AGENTS.md`**

Create `packages/create-hono-preact/templates/agents/AGENTS.md`:

```markdown
# Using hono-preact

This project uses **hono-preact**: a small full-stack framework. Hono runs on the
server (Cloudflare Workers or Node), Preact renders in the browser, routes are
declared in code, and loaders, actions, and guards are typed end to end.

Read this before generating code. The framework's shape differs from Next.js,
Remix, and plain React in ways that trip up assumptions.

## How this framework differs from what you may assume

| You might assume | Here it actually is |
| --- | --- |
| Routes come from a `pages/` or `app/` folder | Routes are declared in code in `src/routes.ts` with `defineRoutes(...)` (or `contentRoutes(...)` for content globs). There is no file-system routing. |
| This is React | This is **Preact**. Import hooks from `preact/hooks`, not `react`. JSX renders through Preact. |
| Server code can live in the page component | Loaders, actions, and guards live in a colocated `*.server.ts` file (e.g. `home.server.ts` next to `home.tsx`). Server code never ships to the client. |
| Data is fetched with `getServerSideProps`, route handlers, or `fetch` in `useEffect` | Data comes from `defineLoader` in a `.server.ts`; the page reads it through the loader (typed). |
| Mutations are ad-hoc POST handlers | Mutations are `defineAction`s; forms submit through them and results come back in a uniform `__outcome` envelope (`useActionResult`, `useFormStatus`). |
| You cast to get types | The route table is typed end to end: `useParams()` is typed per route and loader data is typed from the loader. Do not cast; let inference work. |
| Auth checks are sprinkled per handler | Page guards are a single `use: [...]` array on a route node; they gate render and the loader/action RPC together and inherit down the tree. |

## Where things go

A page is up to four files:

- `src/pages/home.tsx` - the Preact view (default export).
- `src/pages/home.server.ts` - loaders/actions for that page. Optional. Use
  `export const serverLoaders = { default: defineLoader(fn) }` and
  `export const serverActions = { ... }`. No default export; `serverLoaders` /
  `serverActions` are the only allowed named exports. Never import a `.server`
  symbol into client code.
- `src/routes.ts` - declares every URL and which view (and optional `.server`
  module) lives there.
- `src/Layout.tsx` - the HTML document shell. It must render `<ClientScript />`
  (hydration) and a `<Head />` (both from `hono-preact`).

## Public entry points

Import from these subpaths of the `hono-preact` package:

- `hono-preact` - routing, loaders, actions, hooks, and components
  (`defineRoutes`, `defineLoader`, `defineAction`, `useParams`, `Head`,
  `ClientScript`, `Form`, `useActionResult`, ...).
- `hono-preact/page` - page-level outcome helpers (`redirect`, `deny`, `render`).
- `hono-preact/server` - server handlers (`renderPage`, `loadersHandler`,
  `pageActionHandler`, `useHonoContext`).
- `hono-preact/vite` - the `honoPreact()` Vite plugin. It requires an `adapter`:
  `honoPreact({ adapter: cloudflareAdapter() })`.
- `hono-preact/adapter-cloudflare` - `cloudflareAdapter()` for Cloudflare Workers.
- `hono-preact/adapter-node` - `nodeAdapter()` for Node.

The UI component library is a separate package, `@hono-preact/ui` (Dialog,
Popover, Tooltip, Menu, Select, Combobox, plus headless hooks). It ships unstyled.

## Docs

- Full docs: https://framework.sbesh.com/docs
- LLM index: https://framework.sbesh.com/llms.txt
- LLM full corpus: https://framework.sbesh.com/llms-full.txt
```

- [ ] **Step 2: Create `CLAUDE.md`**

Create `packages/create-hono-preact/templates/agents/CLAUDE.md`:

```markdown
See @AGENTS.md for how to use the hono-preact framework correctly.
```

- [ ] **Step 3: Commit**

```bash
git add packages/create-hono-preact/templates/agents/
git commit -m "feat(create): canonical AGENTS.md + CLAUDE.md template source"
```

### Task 6: Parse the `add-agents` subcommand

**Files:**
- Modify: `packages/create-hono-preact/lib/args.mjs`
- Test: `packages/create-hono-preact/__tests__/args.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `packages/create-hono-preact/__tests__/args.test.ts`:

```ts
describe('parseArgs — add-agents', () => {
  it('parses add-agents with no flags', () => {
    expect(parseArgs(['add-agents'])).toEqual({ kind: 'add-agents', force: false });
  });
  it('parses add-agents --force', () => {
    expect(parseArgs(['add-agents', '--force'])).toEqual({ kind: 'add-agents', force: true });
  });
  it('rejects an unknown add-agents flag', () => {
    expect(parseArgs(['add-agents', '--bogus'])).toEqual({
      kind: 'error',
      message: 'unknown flag: --bogus',
    });
  });
});
```

(If `parseArgs` and `describe` are already imported at the top of the file, do not re-import.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/args.test.ts`
Expected: FAIL (`add-agents` parsed as a `targetDir` scaffold, not the new kind).

- [ ] **Step 3: Implement the subcommand branch**

In `packages/create-hono-preact/lib/args.mjs`, add a branch at the very top of the `parseArgs` function body (before `let targetDir;`):

```js
  if (argv[0] === 'add-agents') {
    let force = false;
    for (const arg of argv.slice(1)) {
      if (arg === '--force') force = true;
      else return { kind: 'error', message: `unknown flag: ${arg}` };
    }
    return { kind: 'add-agents', force };
  }
```

Then extend the return-type JSDoc union at the top of the file to add:

```js
 *   { kind: 'add-agents', force: boolean } |
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/args.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/create-hono-preact/lib/args.mjs packages/create-hono-preact/__tests__/args.test.ts
git commit -m "feat(create): parse the add-agents subcommand"
```

### Task 7: `copyAgentsFiles` helper

**Files:**
- Modify: `packages/create-hono-preact/lib/template.mjs`
- Test: `packages/create-hono-preact/__tests__/template.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `packages/create-hono-preact/__tests__/template.test.ts` (reuse the file's existing `mkdtempSync`/`rmSync` temp-dir lifecycle and imports; add `copyAgentsFiles` to the import from `../lib/template.mjs`, and `writeFileSync`/`readFileSync`/`existsSync` from `node:fs` if not already imported):

```ts
describe('copyAgentsFiles', () => {
  it('creates AGENTS.md and CLAUDE.md when absent', async () => {
    const agentsDir = resolve(here, '..', 'templates', 'agents');
    const results = await copyAgentsFiles(agentsDir, workDir, { force: false });
    expect(existsSync(join(workDir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(workDir, 'CLAUDE.md'))).toBe(true);
    expect(results).toEqual([
      { file: 'AGENTS.md', action: 'created' },
      { file: 'CLAUDE.md', action: 'created' },
    ]);
  });

  it('skips an existing file without force', async () => {
    const agentsDir = resolve(here, '..', 'templates', 'agents');
    writeFileSync(join(workDir, 'AGENTS.md'), 'KEEP');
    const results = await copyAgentsFiles(agentsDir, workDir, { force: false });
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).toBe('KEEP');
    expect(results[0]).toEqual({ file: 'AGENTS.md', action: 'skipped' });
  });

  it('overwrites an existing file with force', async () => {
    const agentsDir = resolve(here, '..', 'templates', 'agents');
    writeFileSync(join(workDir, 'AGENTS.md'), 'OLD');
    const results = await copyAgentsFiles(agentsDir, workDir, { force: true });
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).not.toBe('OLD');
    expect(results[0]).toEqual({ file: 'AGENTS.md', action: 'overwritten' });
  });
});
```

If the test file lacks a `here`/`workDir`, define `here` from `import.meta.url` (mirror the existing tests) and create `workDir` in `beforeEach` with `mkdtempSync(join(tmpdir(), 'chp-agents-'))`, removing it in `afterEach`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/template.test.ts`
Expected: FAIL (`copyAgentsFiles` not exported).

- [ ] **Step 3: Implement the helpers**

In `packages/create-hono-preact/lib/template.mjs`, append (the file already imports `cp`, `access`, and `join`):

```js
/** True if a path exists. */
export async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the agent-guidance files into a target directory. Per-file: created if
 * absent, overwritten when `force`, otherwise skipped.
 * @param {string} agentsDir
 * @param {string} targetDir
 * @param {{ force: boolean }} options
 * @returns {Promise<Array<{ file: string, action: 'created' | 'overwritten' | 'skipped' }>>}
 */
export async function copyAgentsFiles(agentsDir, targetDir, { force }) {
  const results = [];
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const dest = join(targetDir, file);
    const exists = await fileExists(dest);
    if (exists && !force) {
      results.push({ file, action: 'skipped' });
      continue;
    }
    await cp(join(agentsDir, file), dest);
    results.push({ file, action: exists ? 'overwritten' : 'created' });
  }
  return results;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/template.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/create-hono-preact/lib/template.mjs packages/create-hono-preact/__tests__/template.test.ts
git commit -m "feat(create): copyAgentsFiles helper for AGENTS.md/CLAUDE.md"
```

### Task 8: Scaffold ships agents + `add-agents` dispatch + help

**Files:**
- Modify: `packages/create-hono-preact/lib/cli.mjs`
- Test: `packages/create-hono-preact/__tests__/cli.test.ts`

- [ ] **Step 1: Add the failing tests**

In `packages/create-hono-preact/__tests__/cli.test.ts`, (a) add two assertions to an existing successful scaffold test (e.g. the node-adapter one), right after the existing `existsSync` asserts:

```ts
    expect(existsSync(join(target, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(target, 'CLAUDE.md'))).toBe(true);
```

and (b) add a new describe (ensure `writeFileSync`/`readFileSync` are imported from `node:fs`):

```ts
describe('run() — add-agents', () => {
  it('writes AGENTS.md and CLAUDE.md into the cwd', async () => {
    const code = await run({ argv: ['add-agents'], cwd: workDir, env: {} });
    expect(code).toBe(0);
    expect(existsSync(join(workDir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(workDir, 'CLAUDE.md'))).toBe(true);
  });

  it('does not overwrite an existing AGENTS.md without --force', async () => {
    writeFileSync(join(workDir, 'AGENTS.md'), 'KEEP');
    const code = await run({ argv: ['add-agents'], cwd: workDir, env: {} });
    expect(code).toBe(0); // CLAUDE.md still created, so not all skipped
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).toBe('KEEP');
    expect(existsSync(join(workDir, 'CLAUDE.md'))).toBe(true);
  });

  it('returns 1 when every target is skipped', async () => {
    writeFileSync(join(workDir, 'AGENTS.md'), 'KEEP');
    writeFileSync(join(workDir, 'CLAUDE.md'), 'KEEP');
    const code = await run({ argv: ['add-agents'], cwd: workDir, env: {} });
    expect(code).toBe(1);
  });

  it('overwrites with --force', async () => {
    writeFileSync(join(workDir, 'AGENTS.md'), 'OLD');
    const code = await run({ argv: ['add-agents', '--force'], cwd: workDir, env: {} });
    expect(code).toBe(0);
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).not.toBe('OLD');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/cli.test.ts`
Expected: FAIL (scaffold has no AGENTS.md; `add-agents` falls through to scaffold logic).

- [ ] **Step 3: Implement in `cli.mjs`**

In `packages/create-hono-preact/lib/cli.mjs`:

(a) Add `copyAgentsFiles` to the import from `./template.mjs`:

```js
import { copyTemplate, renameDotfiles, substituteName, copyAgentsFiles } from './template.mjs';
```

(b) Handle the new kind. Place this block right after the existing `version` handling and before the `scaffold` logic:

```js
  if (parsed.kind === 'add-agents') {
    const agentsDir = join(templatesRoot, 'agents');
    const results = await copyAgentsFiles(agentsDir, cwd, { force: parsed.force });
    for (const { file, action } of results) {
      if (action === 'skipped') {
        console.error(`skip: ${file} already exists (use --force to overwrite)`);
      } else {
        console.log(`${action === 'overwritten' ? 'overwrote' : 'created'} ${file}`);
      }
    }
    return results.every((r) => r.action === 'skipped') ? 1 : 0;
  }
```

(c) In the scaffold flow, after `await substituteName(targetPath, basename(targetPath));`, ship the agents files into the new app:

```js
  await copyTemplate(join(templatesRoot, 'agents'), targetPath);
```

(d) Update the `--help` output. Read the existing help block (`parsed.kind === 'help'`) and add these usage lines to it (keep the existing formatting/indentation style):

```
  create-hono-preact add-agents [--force]   Add AGENTS.md + CLAUDE.md to an existing project
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/cli.test.ts`
Expected: PASS (scaffold ships agents; all four add-agents cases pass).

- [ ] **Step 5: Format + commit**

```bash
pnpm format
git add packages/create-hono-preact/lib/cli.mjs packages/create-hono-preact/__tests__/cli.test.ts
git commit -m "feat(create): ship AGENTS.md on scaffold and add the add-agents command"
```

### Task 9: AGENTS.md appendix sync test

**Files:**
- Create: `packages/create-hono-preact/__tests__/agents-appendix.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/create-hono-preact/__tests__/agents-appendix.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const agentsMd = readFileSync(resolve(here, '..', 'templates', 'agents', 'AGENTS.md'), 'utf8');
const pkg = JSON.parse(
  readFileSync(resolve(repoRoot, 'packages/hono-preact/package.json'), 'utf8')
);

function publicSubpaths(): string[] {
  return Object.keys(pkg.exports)
    .filter((k) => !k.includes('/internal')) // excludes ./internal, ./internal/runtime, ./server/internal/runtime
    .map((k) => (k === '.' ? 'hono-preact' : `hono-preact/${k.slice('./'.length)}`));
}

describe('AGENTS.md public entry-point appendix', () => {
  it('lists every public subpath as a code span', () => {
    for (const subpath of publicSubpaths()) {
      expect(agentsMd, `missing \`${subpath}\``).toContain(`\`${subpath}\``);
    }
  });

  it('does not reference a non-existent subpath', () => {
    const allowed = new Set(publicSubpaths());
    const referenced = [...agentsMd.matchAll(/`(hono-preact(?:\/[a-z-]+)?)`/g)].map((m) => m[1]);
    for (const ref of referenced) {
      expect(allowed.has(ref), `unknown subpath \`${ref}\``).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/agents-appendix.test.ts`
Expected: PASS (Task 5's AGENTS.md lists exactly the six public subpaths). If it FAILS, the AGENTS.md appendix and the `exports` map disagree; fix the appendix.

- [ ] **Step 3: Commit**

```bash
git add packages/create-hono-preact/__tests__/agents-appendix.test.ts
git commit -m "test(create): AGENTS.md appendix must match the public exports map"
```

### Task 10: CLI reference page

**Files:**
- Create: `apps/site/src/pages/docs/cli.mdx`
- Modify: `apps/site/src/pages/docs/nav.ts`

- [ ] **Step 1: Create the page**

Create `apps/site/src/pages/docs/cli.mdx`:

````mdx
# CLI

`create-hono-preact` scaffolds a new hono-preact app and can add agent guidance
to an existing one. It is the same binary whether you run it through `npm`,
`pnpm`, or `yarn`.

## Create a new app

```bash
pnpm create hono-preact my-app
```

This scaffolds `my-app/`, installs dependencies, and initializes a git repo. Then:

```bash
cd my-app
pnpm dev
```

### Options

| Flag | Default | Description |
| --- | --- | --- |
| `--adapter=<cloudflare\|node>` | `cloudflare` | Target runtime. `cloudflare` for Workers, `node` for a Node server. |
| `--no-install` | install runs | Skip the dependency install step. |
| `--no-git` | git init runs | Skip initializing a git repository. |
| `--version`, `-v` | | Print the CLI version. |
| `--help`, `-h` | | Print usage. |

## Add agent guidance to an existing app

If you added hono-preact to a project you did not scaffold (for example with
`pnpm add hono-preact`), drop in the guidance an AI coding agent reads:

```bash
npx create-hono-preact add-agents
```

This writes `AGENTS.md` (framework conventions for any AI coding agent) and a
one-line `CLAUDE.md` pointer into the current directory. Existing files are left
untouched unless you pass `--force`.

| Flag | Default | Description |
| --- | --- | --- |
| `--force` | off | Overwrite `AGENTS.md` / `CLAUDE.md` if they already exist. |

See [Quick Start](./quick-start) for the full walkthrough.
````

- [ ] **Step 2: Add the nav entry**

In `apps/site/src/pages/docs/nav.ts`, in the `Infrastructure` section's `entries` array, add as the first entry:

```ts
          { title: 'CLI', route: '/docs/cli' },
```

- [ ] **Step 3: Run the route↔nav parity test**

Run: `pnpm exec vitest run apps/site/src/pages/docs/__tests__/mdx-routes.test.ts`
Expected: PASS (the new `cli.mdx` file and the new nav entry stay in bijection).

- [ ] **Step 4: Verify the page enters the corpus**

Run: `pnpm exec vitest run apps/site/src/llms/__tests__/generate-llms.test.ts`
Expected: PASS (the generator already iterates nav; `/docs/cli` now resolves and is included).

- [ ] **Step 5: Format + commit**

```bash
pnpm format
git add apps/site/src/pages/docs/cli.mdx apps/site/src/pages/docs/nav.ts
git commit -m "docs(site): CLI reference page (create + add-agents)"
```

### Task 11: Exports-coverage test (+ adapter aliases)

**Files:**
- Modify: `vitest.config.ts` (repo root)
- Create: `apps/site/src/pages/docs/__tests__/exports-coverage.test.ts`

- [ ] **Step 1: Add the adapter aliases**

In the repo-root `vitest.config.ts`, in the `resolve.alias` block, mirror the shape of the existing `hono-preact/...` alias entries and add two:

```ts
      // adapter subpaths -> source (so the coverage test can enumerate them)
      { find: 'hono-preact/adapter-cloudflare', replacement: resolve(__dirname, 'packages/vite/src/adapter-cloudflare.ts') },
      { find: 'hono-preact/adapter-node', replacement: resolve(__dirname, 'packages/vite/src/adapter-node.ts') },
```

(If the existing aliases use the object-map form `{ 'hono-preact': '...' }` instead of the `{ find, replacement }` array form, match that form for the two new entries.)

- [ ] **Step 2: Write the test**

Create `apps/site/src/pages/docs/__tests__/exports-coverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as root from 'hono-preact';
import * as page from 'hono-preact/page';
import * as server from 'hono-preact/server';
import * as viteApi from 'hono-preact/vite';
import * as cloudflare from 'hono-preact/adapter-cloudflare';
import * as node from 'hono-preact/adapter-node';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..');

// Public runtime exports that are intentionally undocumented. Each entry is a
// deliberate choice (advanced Vite plumbing, or a feature kept out of the docs);
// add to this set ONLY with a one-line reason.
const INTENTIONALLY_UNDOCUMENTED = new Set<string>([
  // Advanced Vite plugin internals (not part of the documented surface):
  'serverLoaderValidationPlugin',
  'serverOnlyPlugin',
  'VITE_ROOT_ACCESSOR',
  'moduleKeyPlugin',
  'GENERATED_CORE_APP_RELATIVE',
  'GENERATED_ENTRY_WRAPPER_RELATIVE',
  'generatedCoreAppAbsPath',
  'generatedEntryWrapperAbsPath',
  'serverEntryPlugin',
  'clientEntryPlugin',
  'VIRTUAL_CLIENT_ENTRY_ID',
  'guardStripPlugin',
  // Kept undemoed/undocumented by design (see Section F notes):
  'defineStreamObserver',
  'Persist',
  'PersistHost',
]);

function runtimeNames(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).filter((k) => k !== 'default');
}

function readCorpus(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(resolve(dir, entry.name));
      } else if (entry.name.endsWith('.mdx')) {
        parts.push(readFileSync(resolve(dir, entry.name), 'utf8'));
      }
    }
  };
  walk(docsDir);
  return parts.join('\n');
}

const corpus = readCorpus();
const allExports = [
  ...runtimeNames(root),
  ...runtimeNames(page),
  ...runtimeNames(server),
  ...runtimeNames(viteApi),
  ...runtimeNames(cloudflare),
  ...runtimeNames(node),
];

describe('public runtime exports are documented', () => {
  for (const name of [...new Set(allExports)].sort()) {
    if (INTENTIONALLY_UNDOCUMENTED.has(name)) continue;
    it(`documents ${name}`, () => {
      expect(new RegExp(`\\b${name}\\b`).test(corpus), `${name} not found in docs`).toBe(true);
    });
  }
});
```

Note: this gate covers the framework umbrella only. `@hono-preact/ui` is covered by its per-component pages plus the docs-template hook; its compound `Dialog.Trigger`-style names make flat identifier matching unreliable, so it is deliberately excluded here.

- [ ] **Step 3: Run and triage**

Run: `pnpm exec vitest run apps/site/src/pages/docs/__tests__/exports-coverage.test.ts`
Expected: this surfaces any public runtime export missing from the docs. For each failing name, do exactly one of:
- it should be documented -> add it to the right docs page (it then enters the corpus), or
- it is intentionally undocumented -> add it to `INTENTIONALLY_UNDOCUMENTED` with a one-line reason.

Re-run until green. The seed allowlist already covers the known Vite internals and the Section-F undemoed features; the remaining failures (if any) are genuine doc gaps or further advanced exports to triage.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add vitest.config.ts apps/site/src/pages/docs/__tests__/exports-coverage.test.ts
git commit -m "test(site): fail CI when a public export goes undocumented"
```

### Task 12: Phase 2 verification

- [ ] **Step 1: Run the full pre-push sequence**

Run, in order:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm --filter site build
```
Expected: all pass.

- [ ] **Step 2: Run the scaffold integration test (proves a real scaffold ships agents)**

Run: `pnpm test:integration`
Expected: PASS. (This is network-sensitive and slow; if it flakes offline, note that and rely on the fast `cli.test.ts` assertions, which already confirm the files are written.) Phase 2 is ready to open as its own PR.

---

# Phase 3 - Framework-legibility pass

**End state:** the four framework error messages that today state a problem without naming the fix now name the fix, matching the house style of the already-excellent messages (e.g. the `honoPreact()` "adapter required" message). This is a bounded polish phase: four messages, each with a test.

**Reference facts (verified):** the four generic messages are at `packages/vite/src/server-loader-validation.ts` (self-contradictory remediation sentence), `packages/iso/src/internal/loader-fetch.ts` (generic loader-failure fallback), `packages/iso/src/internal/safe-redirect.ts` + `packages/iso/src/action.ts` (cross-origin redirect), and `packages/iso/src/internal/loader.tsx` (abstract "owns this server module"). Most other framework messages already name the fix and are the template, not the work.

**For each task below, the TDD shape is:** find any existing test asserting the old message text (`grep -rn "<old fragment>" packages/<pkg>/src/__tests__`); update that assertion to the new text first (run -> it fails); then change the message in source (run -> it passes). If no test asserts the message, add a focused unit test that triggers the condition and asserts the new substring, in the package's existing test file for that module.

### Task 13: Fix the self-contradictory `.server` named-export message

**Files:**
- Modify: `packages/vite/src/server-loader-validation.ts`
- Test: the existing server-loader-validation test under `packages/vite/src/__tests__/`

- [ ] **Step 1: Update the test assertion first**

`grep -rn "as the default export only" packages/vite/src/__tests__` and change that expected substring to the new text below. If none exists, add a test that feeds a `.server` module with a disallowed named export and asserts the new substring.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__`
Expected: FAIL on the updated assertion.

- [ ] **Step 3: Change the message**

In `packages/vite/src/server-loader-validation.ts`, locate the message that ends with the sentence `Export the server loader as the default export only.` (it follows "may only export ... as named exports") and replace that trailing sentence with:

```
Export loaders via `serverLoaders` and actions via `serverActions`.
```

(The old sentence contradicted the sibling rule that bans default exports.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/vite/src/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/vite/src/server-loader-validation.ts packages/vite/src/__tests__
git commit -m "fix(vite): server-export error names the correct remediation"
```

### Task 14: Add remediation to the generic loader-failure message

**Files:**
- Modify: `packages/iso/src/internal/loader-fetch.ts`
- Test: the existing loader-fetch test under `packages/iso/src/**/__tests__/`

- [ ] **Step 1: Update/add the test assertion first**

`grep -rn "Loader failed with status" packages/iso/src` to find the message and any test asserting it. Update the expected substring to include the new remediation (Step 3). If no test asserts it, add one that mocks a non-OK loader response and asserts the new substring.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/iso/src`
Expected: FAIL on the updated/added assertion.

- [ ] **Step 3: Change the message**

In `packages/iso/src/internal/loader-fetch.ts`, find the generic fallback `Loader failed with status ${res.status}` and replace it with:

```
Loader failed with status ${res.status}. Check the loader's .server.ts for a thrown error, and the server logs for details.
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/iso/src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/iso/src/internal/loader-fetch.ts packages/iso/src
git commit -m "fix(iso): loader-failure error points at the .server.ts and logs"
```

### Task 15: Name the fix in cross-origin redirect messages

**Files:**
- Modify: `packages/iso/src/internal/safe-redirect.ts`
- Modify: `packages/iso/src/action.ts`
- Test: the existing tests asserting these messages

- [ ] **Step 1: Update/add the test assertions first**

`grep -rn "cross-origin redirect" packages/iso/src` to find both messages and any asserting tests. Update expected substrings to the new text (Step 3). Add focused tests if none exist (trigger a `redirect()` to an absolute cross-origin URL).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/iso/src`
Expected: FAIL on the updated assertions.

- [ ] **Step 3: Change the messages**

In `packages/iso/src/action.ts`, change `Refused cross-origin redirect to ${decoded.to}` to:

```
Refused cross-origin redirect to ${decoded.to}. redirect() must target a same-origin path (e.g. "/dashboard"), not an absolute URL to another origin.
```

In `packages/iso/src/internal/safe-redirect.ts`, change the `console.error` `[hono-preact] refusing to navigate to cross-origin redirect target: ${target}` to:

```
[hono-preact] refusing to navigate to cross-origin redirect target: ${target}. redirect() must return a same-origin path (e.g. "/dashboard").
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/iso/src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/iso/src/action.ts packages/iso/src/internal/safe-redirect.ts packages/iso/src
git commit -m "fix(iso): cross-origin redirect errors name the same-origin fix"
```

### Task 16: Clarify the loader "owns this server module" message

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx`
- Test: the existing loader test under `packages/iso/src/**/__tests__/`

- [ ] **Step 1: Update/add the test assertion first**

`grep -rn "owns this server module" packages/iso/src` to find the message and any asserting test. Update the expected substring to the new text (Step 3); add a test if none exists.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/iso/src`
Expected: FAIL on the updated/added assertion.

- [ ] **Step 3: Change the message**

In `packages/iso/src/internal/loader.tsx`, replace the phrase `wrap the page in a route that owns this server module` with:

```
wrap the page in a route whose server module includes this loader's .server.ts file
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/iso/src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/iso/src/internal/loader.tsx packages/iso/src
git commit -m "fix(iso): loader-location error names the route's server module"
```

### Task 17: Phase 3 verification

- [ ] **Step 1: Run the full pre-push sequence**

Run, in order:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all pass. Phase 3 is ready to open as its own PR.

---

## Notes for the implementer

- **Commit/PR policy:** do not push or open PRs until told. Each phase is its own PR; run the full CLAUDE.md pre-push sequence before each.
- **`pnpm format` is the most-missed step.** Run it before every commit that touches `.ts`/`.tsx`/`.mjs`/`.mdx`/`.json`. `.md` and `.txt` files are not format-checked.
- **Stale dist masks errors.** Always run the framework build (`pnpm --filter '@hono-preact/*' --filter hono-preact build`) before `typecheck` / `site build`; `apps/site` and `pnpm typecheck` resolve cross-package types through the published `dist/`.
- **Subagent worktree discipline:** verify the branch before each commit; the per-task commits in this plan are the intended granularity.
```
