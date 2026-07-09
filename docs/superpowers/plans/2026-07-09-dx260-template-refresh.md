# Plan: create-hono-preact template + scaffolder + recipes refresh (issue #260, batch "template-refresh")

> **For agentic workers:** Execute tasks in order (Task 1 through Task 9). Work inside the worktree at `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-template-refresh` on branch `dx/260-template-refresh`. All paths below are repo-relative and resolve against that worktree root. Each task is self-contained: write the failing test first, watch it fail, implement, watch it pass, commit. Do not read other tasks for context; everything you need is in your own task.

**Goal:** Bring the `create-hono-preact` template, scaffolder CLI, and bundled agent recipes up to the framework's v0.10 idioms (auto-discovery, typed routing, single-View pages) and close the DX gaps the #260 review found (no typecheck script, literal `{{name}}` on first render, missing hoofd peer, no Node preflight, silent install-failure dead end, stale README).

**Architecture:** `packages/create-hono-preact` is a zero-build ESM CLI (`bin/index.mjs` -> `lib/cli.mjs` -> `lib/scaffold.mjs`/`lib/template.mjs`) that composes a project from overlay directories under `templates/` (`base` + `adapter/<name>` + optional `feature/ui`) and copies agent guidance from `templates/agents/`. Unit tests live in `packages/create-hono-preact/__tests__/*.test.ts` (vitest, root config); the slow scaffold-install-build test is `__tests__/scaffold-integration.test.ts` (root `vitest.integration.config.ts`). Docs pages that describe the CLI live in `apps/site/src/pages/docs/`.

**Tech stack:** Node ESM (`.mjs` with JSDoc types), vitest, pnpm monorepo, TypeScript templates (tsx/ts), MDX docs.

## Global constraints (binding; violations get the PR rejected)

- **No em-dashes** in prose, code comments, commit messages, or docs copy. Use commas, colons, parentheses, or two sentences. (`--flag` syntax and Markdown table separators are fine.)
- **No inline type casts** (`as X`). Reshape types instead. `as const` assertions are allowed (they are const assertions, not type casts; `apps/site/src/routes.ts` uses one). Casts already present in test files at fake/mock boundaries (`as never`) may stay; do not add new ones outside test doubles.
- **Modularity over brevity**: single-responsibility helpers, match surrounding code style and comment density (this package comments the "why" heavily; keep that).
- **TDD**: every behavior task writes the failing test first and runs it to see it fail before implementing.
- **Prettier**: `pnpm format:check` covers `packages/**/*.{ts,tsx,js,mjs,json}` and `apps/**/src/**/*.{ts,tsx,mdx,css}`. Template `.ts`/`.tsx`/`.json` files ARE covered. After editing any covered file, run `pnpm format` before committing.
- **Corpus prerequisite**: the unit suite's corpus-presence test reads the gitignored `packages/create-hono-preact/templates/agents/llms-full.txt`. If any test run fails with "llms-full.txt missing", run `pnpm gen:agents-corpus` once and re-run. Any task that edits `apps/site/src/pages/docs/*.mdx` must re-run `pnpm gen:agents-corpus` before its test step.
- **Commits**: conventional-commit messages, each ending with the exact trailer line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Docs describe what IS**: never write "formerly X" or "replaces legacy Y" in docs, recipes, or READMEs.
- **Verification commands** run from the worktree root. Single unit file: `pnpm vitest run packages/create-hono-preact/__tests__/<file>`. Integration file: `pnpm vitest run --config vitest.integration.config.ts packages/create-hono-preact/__tests__/scaffold-integration.test.ts` (slow: packs and installs; ~5-8 min).
- The scaffolder ships no framework build dependency for unit tests, but the integration test builds the framework itself in `beforeAll`; no manual `pnpm --filter ... build` is needed for these tasks.

---

## Task 1: Typed routing in the template, drop the explicit `server:` field

Items 2 (template half) and 3 of the batch. `templates/base/src/routes.ts` still wires `server: () => import('./pages/home.server.js')` by hand (line 7), which #215 auto-discovery made unnecessary (`apps/site/src/routes.ts` has zero `server:` keys and its `.server.ts` siblings are discovered), and it has no `as const` tree or `RegisteredRoutes` registration, so `useParams`/`buildPath`/`NavLink` are untyped in a fresh scaffold.

**Files**
- Modify: `packages/create-hono-preact/templates/base/src/routes.ts` (whole file, currently 10 lines)
- Test: `packages/create-hono-preact/__tests__/scaffold.test.ts` (append a describe block)
- Modify (docs sync): `apps/site/src/pages/docs/quick-start.mdx` (the "Add it to `src/routes.ts`" snippet, lines 63-72)

**Interfaces**
- Consumes: `defineRoutes` (accepts a readonly `as const` tuple) and `type RoutePaths` from `hono-preact`; the `RegisteredRoutes` interface merge documented in `apps/site/src/pages/docs/layouts.mdx` lines 83-89.
- Produces: a template `src/routes.ts` whose scaffolded copy typechecks under the project's own `tsc` (Task 5 proves this end to end).

**Steps**

- [ ] **Step 1: Write the failing test.** Append to `packages/create-hono-preact/__tests__/scaffold.test.ts` (after the existing `feature/ui home.tsx parity with base` describe):

  ```ts
  describe('base routes.ts idioms', () => {
    const routes = readFileSync(
      join(templatesRoot, 'base', 'src', 'routes.ts'),
      'utf8'
    );

    it('relies on .server.ts auto-discovery (no explicit server: wiring)', () => {
      expect(routes).not.toContain('server:');
    });

    it('registers the route tree for typed params and paths', () => {
      expect(routes).toContain('as const');
      expect(routes).toContain('interface RegisteredRoutes');
      expect(routes).toContain('RoutePaths<typeof routeTree>');
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.** `pnpm vitest run packages/create-hono-preact/__tests__/scaffold.test.ts` fails: `expected '...' not to contain 'server:'` and the two registration assertions fail with `expected '...' to contain 'as const'`.

- [ ] **Step 3: Replace the template file.** Write `packages/create-hono-preact/templates/base/src/routes.ts` with exactly:

  ```ts
  import { defineRoutes, type RoutePaths } from 'hono-preact';

  // Each route's view is a deferred dynamic import (one code-split chunk per
  // page). A colocated `<view>.server.ts` sibling (loaders/actions) is
  // discovered and wired automatically; nothing extra to declare here.
  //
  // The tree is its own `as const` binding (not inlined into defineRoutes) so
  // the registration below can reference `typeof routeTree`.
  const routeTree = [
    { path: '/', view: () => import('./pages/home.js') },
    { path: '/about', view: () => import('./pages/about.js') },
  ] as const;

  export default defineRoutes(routeTree);

  // Registers this app's paths with the framework, so `useParams`,
  // `buildPath`, and `NavLink` are typed against the real route table.
  declare module 'hono-preact' {
    interface RegisteredRoutes {
      paths: RoutePaths<typeof routeTree>;
    }
  }
  ```

- [ ] **Step 4: Re-run.** `pnpm vitest run packages/create-hono-preact/__tests__/scaffold.test.ts` passes.

- [ ] **Step 5: Docs sync (quick-start walks through the scaffolded file).** In `apps/site/src/pages/docs/quick-start.mdx`, replace this block (currently lines 63-72):

  ```
  Add it to `src/routes.ts`:

  ```ts
  import { defineRoutes } from 'hono-preact';

  export default defineRoutes([
    // ... existing routes
    { path: '/movies', view: () => import('./pages/movies.js') },
  ]);
  ```
  ```

  with:

  ```
  Add it to the `routeTree` array in `src/routes.ts` (the scaffolded file
  declares the tree `as const` and registers it, so `useParams` and
  `buildPath` stay typed as the table grows):

  ```ts
  const routeTree = [
    // ... existing routes
    { path: '/movies', view: () => import('./pages/movies.js') },
  ] as const;
  ```
  ```

- [ ] **Step 6: Regenerate the corpus and verify.** Run `pnpm gen:agents-corpus`, then `pnpm format` and `pnpm vitest run packages/create-hono-preact/__tests__/scaffold.test.ts packages/create-hono-preact/__tests__/agents-recipes.test.ts` (all pass).

- [ ] **Step 7: Commit.**

  ```
  git add packages/create-hono-preact/templates/base/src/routes.ts packages/create-hono-preact/__tests__/scaffold.test.ts apps/site/src/pages/docs/quick-start.mdx
  git commit -m "feat(create): typed routing in the template, drop explicit server wiring

  The scaffolded routes.ts now declares the tree as const and registers it
  via RegisteredRoutes (matching apps/site), and relies on .server.ts
  auto-discovery instead of a hand-written server: thunk.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 2: Canonical single-View home page

Item 8. `templates/base/src/pages/home.tsx` (and the `feature/ui` overlay fork) render the loading fallback twice through two APIs: an inner `HomePage` component reading `useData()` with its own `if (!data)` guard, wrapped by a `.View()` that repeats the same fallback. It also passes a dead empty second argument to `definePage(HomeView, {})` (the parameter is optional: `packages/iso/src/define-page.tsx` line 14 declares `bindings?: PageBindings`). The docs teach a single `.View()` form with `definePage(View)` (`apps/site/src/pages/docs/loaders.mdx` lines 29-44).

**Files**
- Modify: `packages/create-hono-preact/templates/base/src/pages/home.tsx` (whole file)
- Modify: `packages/create-hono-preact/templates/feature/ui/src/pages/home.tsx` (whole file)
- Test: `packages/create-hono-preact/__tests__/scaffold.test.ts` (the `feature/ui home.tsx parity with base` describe, currently lines 74-96, markers at lines 87-91)

**Interfaces**
- Consumes: `serverLoaders.default.View(render)` where `render` receives the `LoaderState` union (cold arm has `data?: never`, so `data ? ... : ...` narrows); `definePage(Component)` with the optional second arg omitted.
- Produces: template pages in the exact shape `apps/site/src/pages/docs/loaders.mdx` teaches.

**Steps**

- [ ] **Step 1: Update the parity test to the canonical markers (failing first).** In `packages/create-hono-preact/__tests__/scaffold.test.ts`, inside the `keeps the base loader usage and welcome copy` test, replace the marker array:

  ```ts
      for (const marker of [
        'homeLoader.useData()',
        'definePage(HomeView',
        'Welcome to {',
      ]) {
  ```

  with:

  ```ts
      for (const marker of [
        'serverLoaders.default.View(',
        'definePage(HomeView)',
        "Welcome to {'{{name}}'}",
      ]) {
  ```

- [ ] **Step 2: Run it and see it fail.** `pnpm vitest run packages/create-hono-preact/__tests__/scaffold.test.ts` fails: `expected '...' to contain 'serverLoaders.default.View('` (both template files still use the two-step `homeLoader` form).

- [ ] **Step 3: Rewrite the base home page.** Write `packages/create-hono-preact/templates/base/src/pages/home.tsx` with exactly:

  ```tsx
  import { definePage } from 'hono-preact';
  import { serverLoaders } from './home.server.js';

  // `.View(render)` wraps the render in the loader's error boundary and data
  // context. `data` is absent only while the loader is cold, so the truthy
  // check doubles as the loading guard.
  const HomeView = serverLoaders.default.View(({ data }) =>
    data ? (
      <section>
        <h1>Welcome to {'{{name}}'}</h1>
        <p>{data.message}</p>
        <p>
          <small>Rendered at {data.renderedAt}</small>
        </p>
        <a href="/about">About</a>
      </section>
    ) : (
      <p>Loading...</p>
    )
  );

  export default definePage(HomeView);
  ```

- [ ] **Step 4: Rewrite the ui overlay home page.** Write `packages/create-hono-preact/templates/feature/ui/src/pages/home.tsx` with exactly:

  ```tsx
  // Overlay copy of base/src/pages/home.tsx that adds a hono-preact-ui Dialog.
  // Overlays are file-granular, so this forks the whole page; keep its loader
  // usage and welcome copy in sync with base/src/pages/home.tsx (a parity test
  // in __tests__/scaffold.test.ts guards the shared markers).
  import { definePage } from 'hono-preact';
  import {
    DialogRoot,
    DialogTrigger,
    DialogPopup,
    DialogTitle,
    DialogClose,
  } from 'hono-preact-ui';
  import { serverLoaders } from './home.server.js';

  // `.View(render)` wraps the render in the loader's error boundary and data
  // context. `data` is absent only while the loader is cold, so the truthy
  // check doubles as the loading guard.
  const HomeView = serverLoaders.default.View(({ data }) =>
    data ? (
      <section>
        <h1>Welcome to {'{{name}}'}</h1>
        <p>{data.message}</p>
        <p>
          <small>Rendered at {data.renderedAt}</small>
        </p>
        <DialogRoot>
          <DialogTrigger>Open dialog</DialogTrigger>
          <DialogPopup
            aria-label="Demo dialog"
            style={{
              padding: '1.25rem',
              border: '1px solid #ccc',
              borderRadius: '8px',
              background: 'white',
            }}
          >
            <DialogTitle>hono-preact-ui</DialogTitle>
            <p>This dialog is a headless component from hono-preact-ui.</p>
            <DialogClose>Close</DialogClose>
          </DialogPopup>
        </DialogRoot>
        <p>
          <a href="/about">About</a>
        </p>
      </section>
    ) : (
      <p>Loading...</p>
    )
  );

  export default definePage(HomeView);
  ```

- [ ] **Step 5: Re-run.** `pnpm format`, then `pnpm vitest run packages/create-hono-preact/__tests__/scaffold.test.ts` passes (including the ui-on/ui-off tests, which assert `DialogRoot` and the `hono-preact-ui` import; both survive).

- [ ] **Step 6: Commit.**

  ```
  git add packages/create-hono-preact/templates/base/src/pages/home.tsx packages/create-hono-preact/templates/feature/ui/src/pages/home.tsx packages/create-hono-preact/__tests__/scaffold.test.ts
  git commit -m "feat(create): canonical single-View home page in the template

  Drops the duplicated loading fallback (inner useData component plus a
  .View wrapper repeating it) for the single .View(render) form the docs
  teach, and removes the dead empty second argument to definePage.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 3: Substitute the project name into scaffolded source files

Item 4. `substituteName` (`packages/create-hono-preact/lib/template.mjs`, function at line 68) only touches `package.json`, `wrangler.jsonc`, and `README.md` at the target root, but `templates/base/src/Layout.tsx` line 7 has `<Head defaultTitle="{{name}}" />` and `src/pages/home.tsx` renders `Welcome to {'{{name}}'}`, so the first `pnpm dev` shows a literal `{{name}}`. The old behavior was a documented deliberate choice ("edit-me marker"); the #260 review reversed that call, so the comment, the `does not touch source files` unit test, and the two `expect(...).toContain('{{name}}')` assertions in `scaffold.test.ts`/`cli.test.ts` all flip with it.

**Files**
- Modify: `packages/create-hono-preact/lib/template.mjs` (replace `substituteName`, lines 59-85; add one helper; extend the `node:path` import with `extname`)
- Test: `packages/create-hono-preact/__tests__/template.test.ts` (the `does not touch source files` test)
- Test: `packages/create-hono-preact/__tests__/scaffold.test.ts` (the `substitutes the project name and copies agent guidance` test, assertions at lines 66-68)
- Test: `packages/create-hono-preact/__tests__/cli.test.ts` (assertions at lines 66-67)

**Interfaces**
- `substituteName(target: string, name: string): Promise<void>` keeps its signature; it now walks the scaffolded tree and rewrites `{{name}}` / `{{name_underscore}}` in every file whose extension is in a fixed allowlist.
- Safety: the name is already validated as a strict slug before any scaffolding (`lib/resolve.mjs` `PROJECT_NAME_RE`, line 11), so textual substitution cannot inject syntax; `scaffold.mjs` still sets `pkg.name` structurally as defense in depth.
- Ordering guarantee it relies on: `scaffold.mjs` calls `substituteName` BEFORE `copyAgentGuidance`, so the large `agents/llms-full.txt` is never scanned. Do not reorder `scaffold.mjs`.

**Steps**

- [ ] **Step 1: Invert the unit test.** In `packages/create-hono-preact/__tests__/template.test.ts`, replace the test:

  ```ts
    it('does not touch source files (only top-level manifests and README)', async () => {
      await copyTemplate(fixture, target);
      const before = readFileSync(join(target, 'src', 'index.ts'), 'utf8');
      await substituteName(target, 'my-app');
      const after = readFileSync(join(target, 'src', 'index.ts'), 'utf8');
      expect(after).toBe(before);
    });
  ```

  with:

  ```ts
    it('replaces {{name}} in nested source files', async () => {
      await copyTemplate(fixture, target);
      await substituteName(target, 'my-app');
      const src = readFileSync(join(target, 'src', 'index.ts'), 'utf8');
      expect(src).toContain('hello my-app');
      expect(src).not.toContain('{{name}}');
    });
  ```

  (The fixture `__tests__/fixtures/sample-template/src/index.ts` already contains `export const greeting = 'hello {{name}}';`.)

- [ ] **Step 2: Run it and see it fail.** `pnpm vitest run packages/create-hono-preact/__tests__/template.test.ts` fails: `expected "export const greeting = 'hello {{name}}';..." to contain 'hello my-app'`.

- [ ] **Step 3: Implement the tree walk.** In `packages/create-hono-preact/lib/template.mjs`:

  1. Change the path import (line 10) to:

     ```js
     import { join, dirname, basename, extname } from 'node:path';
     ```

  2. Replace the whole `substituteName` function (doc comment at lines 59-67 plus body through line 85) with:

     ```js
     // File types the name substitution rewrites. Everything the templates ship
     // is text in one of these; anything else (images, archives) must never be
     // string-replaced.
     const SUBSTITUTABLE_EXTENSIONS = new Set([
       '.json',
       '.jsonc',
       '.md',
       '.ts',
       '.tsx',
       '.html',
       '.yaml',
     ]);

     // Directories the substitution walk never descends into. Neither exists at
     // scaffold time today; this is a guard against a future reordering (an
     // install or git init before substitution) turning the walk expensive.
     const SUBSTITUTION_SKIP_DIRS = new Set(['node_modules', '.git']);

     /**
      * Collect every substitutable file under `dir`, recursively.
      *
      * @param {string} dir absolute directory to walk
      * @returns {Promise<string[]>} absolute file paths
      */
     async function collectSubstitutableFiles(dir) {
       const out = [];
       for (const entry of await readdir(dir, { withFileTypes: true })) {
         const path = join(dir, entry.name);
         if (entry.isDirectory()) {
           if (!SUBSTITUTION_SKIP_DIRS.has(entry.name)) {
             out.push(...(await collectSubstitutableFiles(path)));
           }
         } else if (SUBSTITUTABLE_EXTENSIONS.has(extname(entry.name))) {
           out.push(path);
         }
       }
       return out;
     }

     /**
      * Replace `{{name}}` and `{{name_underscore}}` across the scaffolded tree:
      * manifests, READMEs, and source files alike (the `<Head>` default title
      * and the home-page heading carry `{{name}}`, and must render as the real
      * project name on the first `pnpm dev`). The Cloudflare adapter writes its
      * bundle to `dist/<name_with_underscores>/`, so the underscored form is
      * needed in deploy scripts and READMEs.
      *
      * The name is validated as a strict slug before any scaffolding runs (see
      * resolve.mjs), so this textual substitution cannot inject syntax into any
      * of these sinks; package.json's `name` field is additionally set
      * structurally in scaffold.mjs.
      *
      * @param {string} target absolute path to the scaffolded dir
      * @param {string} name new project name
      */
     export async function substituteName(target, name) {
       const underscored = name.replaceAll('-', '_');
       for (const path of await collectSubstitutableFiles(target)) {
         const original = await readFile(path, 'utf8');
         const updated = original
           .replaceAll('{{name_underscore}}', underscored)
           .replaceAll('{{name}}', name);
         if (updated !== original) {
           await writeFile(path, updated);
         }
       }
     }
     ```

     (`readdir`, `readFile`, `writeFile` are already imported at the top of the file; `access` remains used by other helpers.)

- [ ] **Step 4: Flip the downstream assertions.** In `packages/create-hono-preact/__tests__/scaffold.test.ts`, in the `substitutes the project name and copies agent guidance` test, replace:

  ```ts
      expect(readFileSync(join(target, 'src', 'Layout.tsx'), 'utf8')).toContain(
        '{{name}}'
      );
  ```

  with:

  ```ts
      const layout = readFileSync(join(target, 'src', 'Layout.tsx'), 'utf8');
      expect(layout).toContain('defaultTitle="my-app"');
      expect(layout).not.toContain('{{name}}');
      const home = readFileSync(
        join(target, 'src', 'pages', 'home.tsx'),
        'utf8'
      );
      expect(home).not.toContain('{{name}}');
  ```

  In `packages/create-hono-preact/__tests__/cli.test.ts`, replace (lines 66-67):

  ```ts
      const layout = readFileSync(join(target, 'src', 'Layout.tsx'), 'utf8');
      expect(layout).toContain('{{name}}');
  ```

  with:

  ```ts
      const layout = readFileSync(join(target, 'src', 'Layout.tsx'), 'utf8');
      expect(layout).toContain('defaultTitle="my-test-app"');
      expect(layout).not.toContain('{{name}}');
  ```

- [ ] **Step 5: Re-run all three suites.** `pnpm format`, then `pnpm vitest run packages/create-hono-preact/__tests__/template.test.ts packages/create-hono-preact/__tests__/scaffold.test.ts packages/create-hono-preact/__tests__/cli.test.ts` passes.

- [ ] **Step 6: Commit.**

  ```
  git add packages/create-hono-preact/lib/template.mjs packages/create-hono-preact/__tests__/template.test.ts packages/create-hono-preact/__tests__/scaffold.test.ts packages/create-hono-preact/__tests__/cli.test.ts
  git commit -m "fix(create): substitute the project name into scaffolded source files

  substituteName now walks the whole scaffolded tree (allowlisted text
  extensions) instead of three root files, so the Head defaultTitle and
  the home-page heading render the real project name on first dev run
  instead of a literal {{name}}.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 4: Add `hoofd` to the template dependencies

Item 6. `hoofd` is a required (non-optional) peer of the framework (`packages/hono-preact/package.json` peerDependencies: `"hoofd": ">=1.0.0"`, not listed in `peerDependenciesMeta`), but `templates/base/package.json` does not declare it, which breaks package managers that do not auto-install peers (yarn classic). `apps/site` depends on `"hoofd": "^1.7.3"`; the template pins the same caret range (a bare `>=1.0.0` dependency would be unbounded).

**Files**
- Modify: `packages/create-hono-preact/templates/base/package.json` (dependencies block, lines 10-15)
- Test: `packages/create-hono-preact/__tests__/scaffold.test.ts` (extend the first `cloudflare:` test)

**Interfaces**
- Produces: `dependencies.hoofd === "^1.7.3"` in every scaffolded package.json (base overlay is always applied).

**Steps**

- [ ] **Step 1: Write the failing assertion.** In `packages/create-hono-preact/__tests__/scaffold.test.ts`, in the test `cloudflare: writes wrangler.jsonc and cloudflare devDeps, no node deps`, add after `expect(pkg.dependencies).not.toHaveProperty('hono-preact-ui');`:

  ```ts
      // hoofd is a required peer of hono-preact; it must be a direct dep so
      // package managers that do not auto-install peers still resolve it.
      expect(pkg.dependencies).toHaveProperty('hoofd');
  ```

- [ ] **Step 2: Run it and see it fail.** `pnpm vitest run packages/create-hono-preact/__tests__/scaffold.test.ts` fails: `expected {...} to have property "hoofd"`.

- [ ] **Step 3: Add the dependency.** In `packages/create-hono-preact/templates/base/package.json`, change the dependencies block to:

  ```json
    "dependencies": {
      "hono": "^4.12.14",
      "hono-preact": "^0.10.0",
      "hoofd": "^1.7.3",
      "preact": "^10.29.1",
      "preact-iso": "github:preactjs/preact-iso#v3"
    },
  ```

- [ ] **Step 4: Re-run.** `pnpm vitest run packages/create-hono-preact/__tests__/scaffold.test.ts` passes.

- [ ] **Step 5: Commit.**

  ```
  git add packages/create-hono-preact/templates/base/package.json packages/create-hono-preact/__tests__/scaffold.test.ts
  git commit -m "fix(create): add hoofd to the template dependencies

  hoofd is a required peer of hono-preact; without a direct dependency
  the scaffold breaks under package managers that do not auto-install
  peers (yarn classic). Pinned to ^1.7.3, matching apps/site.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 5: `typecheck` script in the template, integration test runs it

Item 1. All four agent recipes verify with `pnpm typecheck` (`templates/agents/skills/add-a-page.md:53`, `add-a-loader.md:80`, `add-an-action.md:71`, `add-a-guard.md:61`), but `templates/base/package.json` ships only `dev` and `build` scripts, so the recipes' verify step fails in a fresh scaffold. The template `tsconfig.json` already has `noEmit: true`, `strict: true`, and includes `src` + `vite.config.ts`; no tsconfig change is expected (the integration run below proves it). This task also hardens the integration test: assert the loader module was auto-discovered into the build (guards the Task 1 `server:` removal against a silent wiring loss).

**Files**
- Modify: `packages/create-hono-preact/templates/base/package.json` (scripts block)
- Test: `packages/create-hono-preact/__tests__/scaffold.test.ts` (extend the first `cloudflare:` test)
- Test: `packages/create-hono-preact/__tests__/scaffold-integration.test.ts` (both adapter tests)

**Interfaces**
- Produces: `scripts.typecheck === "tsc --noEmit"` in every scaffolded package.json; integration proof that `pnpm typecheck` exits 0 in a freshly installed scaffold (both adapters), and that the built server output contains the home loader's string (auto-discovery wired the sibling `.server.ts`).

**Steps**

- [ ] **Step 1: Write the failing unit assertion.** In `packages/create-hono-preact/__tests__/scaffold.test.ts`, in the test `cloudflare: writes wrangler.jsonc and cloudflare devDeps, no node deps`, add after `expect(pkg.scripts).toHaveProperty('deploy');`:

  ```ts
      // The bundled agent recipes verify with `pnpm typecheck`.
      expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
  ```

- [ ] **Step 2: Run it and see it fail.** `pnpm vitest run packages/create-hono-preact/__tests__/scaffold.test.ts` fails: `expected undefined to be 'tsc --noEmit'`.

- [ ] **Step 3: Add the script.** In `packages/create-hono-preact/templates/base/package.json`, change the scripts block to:

  ```json
    "scripts": {
      "dev": "vite",
      "build": "vite build",
      "typecheck": "tsc --noEmit"
    },
  ```

- [ ] **Step 4: Re-run the unit file.** `pnpm vitest run packages/create-hono-preact/__tests__/scaffold.test.ts` passes.

- [ ] **Step 5: Extend the integration test.** In `packages/create-hono-preact/__tests__/scaffold-integration.test.ts`:

  1. In the node-adapter test (`produces a buildable Node app`), insert between the `pnpm install` call and the `pnpm build` call:

     ```ts
         // The template ships a typecheck script (the agent recipes verify with
         // it); it must pass in a fresh scaffold.
         execFileSync('pnpm', ['typecheck'], { cwd: target, stdio: 'inherit' });
     ```

     and add after the two existing `expect(existsSync(...))` assertions:

     ```ts
         // The route table has no explicit server: field; the colocated
         // home.server.ts must still be auto-discovered into the server build.
         const serverEntry = readFileSync(
           join(target, 'dist', 'server', 'server-entry.js'),
           'utf8'
         );
         expect(serverEntry).toContain('Hello from your hono-preact app!');
     ```

     If that assertion fails because the loader landed in a split chunk rather than the entry, widen it: read every `.js` file under `join(target, 'dist', 'server')` (use `readdirSync` with `{ recursive: true }`) and assert at least one contains the string. Start with the entry-file form; only widen on observed failure.

  2. In the cloudflare-adapter test (`produces a buildable Cloudflare app`), insert the same typecheck line between install and build:

     ```ts
         execFileSync('pnpm', ['typecheck'], { cwd: target, stdio: 'inherit' });
     ```

     (This variant scaffolds with `--ui`, so it also typechecks the ui overlay page.)

- [ ] **Step 6: Run the integration suite.** `pnpm vitest run --config vitest.integration.config.ts packages/create-hono-preact/__tests__/scaffold-integration.test.ts` (5-8 min). Both tests pass. If `tsc` reports errors, fix the TEMPLATE (not the test): the likely causes are a type error in the Task 1/Task 2 template files or a missing lib entry in `templates/base/tsconfig.json`; resolve, re-run, and note the fix in the commit body.

- [ ] **Step 7: Commit.**

  ```
  git add packages/create-hono-preact/templates/base/package.json packages/create-hono-preact/__tests__/scaffold.test.ts packages/create-hono-preact/__tests__/scaffold-integration.test.ts
  git commit -m "feat(create): typecheck script in the template plus integration coverage

  The bundled agent recipes verify with pnpm typecheck, but the scaffold
  shipped no such script. The integration test now runs tsc in the fresh
  scaffold for both adapters and asserts the colocated home.server.ts is
  auto-discovered into the server build.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 6: Align Node engines and fail fast on unsupported Node

Item 5. `packages/create-hono-preact/package.json` declares `"engines": { "node": ">=20" }` (lines 22-24) while the framework requires `"^22.18.0 || >=24.11.0"` (`packages/hono-preact/package.json`). Scaffolding on Node 20 succeeds and then fails confusingly at the first `pnpm dev`. Align the engines field and add a fail-fast preflight in the CLI. The preflight runs after the `--help` / `--version` / `add-agents` early returns (those are harmless on any Node) and before any prompting or filesystem work.

**Files**
- Create: `packages/create-hono-preact/lib/node-version.mjs`
- Create: `packages/create-hono-preact/lib/node-version.d.mts` (this package typechecks its TS tests against hand-written `.d.mts` declarations; see `tsconfig.json` include of `lib/**/*.d.mts`)
- Create (test): `packages/create-hono-preact/__tests__/node-version.test.ts`
- Modify: `packages/create-hono-preact/lib/cli.mjs` (import; new `nodeVersion` option on `run`; preflight check after the `parsed.kind === 'error'` branch, before line 80 `const interactive = ...`)
- Modify: `packages/create-hono-preact/lib/cli.d.mts` (add `nodeVersion?: string;` to `RunOptions`, after `platform?: NodeJS.Platform;`)
- Modify: `packages/create-hono-preact/package.json` (engines, lines 22-24)
- Test: `packages/create-hono-preact/__tests__/cli.test.ts` (new describe)
- Modify (docs sync): `apps/site/src/pages/docs/cli.mdx` (requirements note under "Create a new app")

**Interfaces**
- New module `lib/node-version.mjs`:
  - `export const SUPPORTED_NODE_RANGE: string` (value `'^22.18.0 || >=24.11.0'`)
  - `export function nodeVersionError(version: string): string | undefined` (undefined = supported or unparseable; string = human-readable refusal)
- `run(opts)` in `lib/cli.mjs` gains `nodeVersion = process.version` in its destructured options (documented in the JSDoc `@param` block alongside `platform`).

**Steps**

- [ ] **Step 1: Write the failing unit tests.** Create `packages/create-hono-preact/__tests__/node-version.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    nodeVersionError,
    SUPPORTED_NODE_RANGE,
  } from '../lib/node-version.mjs';

  describe('nodeVersionError', () => {
    it.each(['v22.18.0', 'v22.19.3', 'v24.11.0', 'v24.12.1', 'v25.0.0'])(
      'accepts supported version %s',
      (v) => {
        expect(nodeVersionError(v)).toBeUndefined();
      }
    );

    it.each(['v20.11.1', 'v21.7.0', 'v22.17.9', 'v23.5.0', 'v24.10.9'])(
      'rejects unsupported version %s with the range and the running version',
      (v) => {
        const err = nodeVersionError(v);
        expect(err).toContain(SUPPORTED_NODE_RANGE);
        expect(err).toContain(v);
      }
    );

    it('fails open on an unparseable version string', () => {
      expect(nodeVersionError('weird-build')).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run it and see it fail.** `pnpm vitest run packages/create-hono-preact/__tests__/node-version.test.ts` fails at import time (`Cannot find module '../lib/node-version.mjs'`).

- [ ] **Step 3: Implement the module.** Create `packages/create-hono-preact/lib/node-version.mjs`:

  ```js
  // Fail-fast Node preflight. Scaffolding itself runs on older Node, but the
  // scaffolded app depends on hono-preact, whose supported range is stricter;
  // without this check the scaffold succeeds and the first `pnpm dev` fails
  // with an unrelated-looking error.

  /**
   * The Node range hono-preact supports. Keep in sync with the framework's
   * package.json `engines.node` and this package's own `engines.node`.
   */
  export const SUPPORTED_NODE_RANGE = '^22.18.0 || >=24.11.0';

  /**
   * Check a Node version string (e.g. `process.version`, "v22.18.0") against
   * the supported range. Returns an error message to print when the version is
   * outside the range, or undefined when it is fine. An unparseable version
   * fails open (returns undefined) rather than blocking unusual builds.
   *
   * @param {string} version
   * @returns {string | undefined}
   */
  export function nodeVersionError(version) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (!match) return undefined;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    // ^22.18.0 (>=22.18 within major 22) || >=24.11.0.
    const supported =
      (major === 22 && minor >= 18) ||
      (major === 24 && minor >= 11) ||
      major > 24;
    if (supported) return undefined;
    return (
      `Node ${SUPPORTED_NODE_RANGE} is required (the range hono-preact ` +
      `supports); you are running ${version}. Upgrade Node and re-run.`
    );
  }
  ```

- [ ] **Step 4: Add the declaration file and re-run.** Create `packages/create-hono-preact/lib/node-version.d.mts`:

  ```ts
  export const SUPPORTED_NODE_RANGE: string;
  export function nodeVersionError(version: string): string | undefined;
  ```

  Then `pnpm vitest run packages/create-hono-preact/__tests__/node-version.test.ts` passes.

- [ ] **Step 5: Write the failing CLI tests.** Append to `packages/create-hono-preact/__tests__/cli.test.ts`:

  ```ts
  describe('run(): Node version preflight', () => {
    it('refuses to scaffold on an unsupported Node and scaffolds nothing', async () => {
      const errs: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errs.push(args.join(' '));
      try {
        const code = await run({
          argv: ['old-node-app', '--no-install', '--no-git'],
          cwd: workDir,
          env: {},
          nodeVersion: 'v20.11.1',
        });
        expect(code).toBe(1);
        expect(errs.join('\n')).toContain('^22.18.0 || >=24.11.0');
        expect(errs.join('\n')).toContain('v20.11.1');
      } finally {
        console.error = originalError;
      }
      expect(existsSync(join(workDir, 'old-node-app'))).toBe(false);
    });

    it('scaffolds normally on a supported Node', async () => {
      const code = await run({
        argv: ['new-node-app', '--no-install', '--no-git'],
        cwd: workDir,
        env: {},
        nodeVersion: 'v24.11.0',
      });
      expect(code).toBe(0);
      expect(existsSync(join(workDir, 'new-node-app', 'package.json'))).toBe(
        true
      );
    });

    it('--help still works on an unsupported Node', async () => {
      const lines: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => lines.push(args.join(' '));
      try {
        const code = await run({
          argv: ['--help'],
          cwd: workDir,
          env: {},
          nodeVersion: 'v20.11.1',
        });
        expect(code).toBe(0);
        expect(lines.join('\n').toLowerCase()).toContain('usage');
      } finally {
        console.log = originalLog;
      }
    });
  });
  ```

- [ ] **Step 6: Run and see them fail.** `pnpm vitest run packages/create-hono-preact/__tests__/cli.test.ts` fails: the first preflight test gets exit code 0 and an existing `old-node-app` directory (no preflight exists yet; the unknown `nodeVersion` option is ignored by destructuring, so there is no type error masking the failure).

- [ ] **Step 7: Wire the preflight into `run`.** In `packages/create-hono-preact/lib/cli.mjs`:

  1. Add the import after the existing `./resolve.mjs` import block:

     ```js
     import { nodeVersionError } from './node-version.mjs';
     ```

  2. In the JSDoc for `run` (the `@param {{...}} opts` block), add a line after `platform?: NodeJS.Platform,`:

     ```
      *   nodeVersion?: string,
     ```

  3. In the destructured parameters, add after `platform = process.platform,`:

     ```js
       nodeVersion = process.version,
     ```

  4. Insert after the `if (parsed.kind === 'error') { ... }` block (line 78) and before `const interactive = ...` (line 80):

     ```js
       // Help, version, and add-agents work on any Node; scaffolding does not.
       // Refuse before prompting or touching the filesystem.
       const versionError = nodeVersionError(nodeVersion);
       if (versionError) {
         console.error(`error: ${versionError}`);
         return 1;
       }
     ```

- [ ] **Step 7b: Update the declaration for `run`.** In `packages/create-hono-preact/lib/cli.d.mts`, add to `RunOptions` after `platform?: NodeJS.Platform;`:

  ```ts
    nodeVersion?: string;
  ```

- [ ] **Step 8: Align engines.** In `packages/create-hono-preact/package.json`, change:

  ```json
    "engines": {
      "node": ">=20"
    },
  ```

  to:

  ```json
    "engines": {
      "node": "^22.18.0 || >=24.11.0"
    },
  ```

- [ ] **Step 9: Re-run.** `pnpm format`, then `pnpm vitest run packages/create-hono-preact/__tests__/cli.test.ts packages/create-hono-preact/__tests__/node-version.test.ts` passes (all pre-existing cli tests run with the default `nodeVersion = process.version`, which is supported on the dev machine and in CI). Also run `pnpm --filter create-hono-preact exec tsc --noEmit` to confirm the `.d.mts` additions typecheck against the tests.

- [ ] **Step 10: Docs sync.** In `apps/site/src/pages/docs/cli.mdx`, under the `## Create a new app` heading, add after the paragraph ending "nothing for npm to mis-parse.":

  ```

  The CLI requires Node `^22.18.0 || >=24.11.0` (the range hono-preact itself
  supports) and exits with a clear message on an older Node before anything is
  scaffolded. `--help`, `--version`, and `add-agents` work on any Node.
  ```

  Then run `pnpm gen:agents-corpus`.

- [ ] **Step 11: Commit.**

  ```
  git add packages/create-hono-preact/lib/node-version.mjs packages/create-hono-preact/lib/node-version.d.mts packages/create-hono-preact/lib/cli.mjs packages/create-hono-preact/lib/cli.d.mts packages/create-hono-preact/package.json packages/create-hono-preact/__tests__/node-version.test.ts packages/create-hono-preact/__tests__/cli.test.ts apps/site/src/pages/docs/cli.mdx
  git commit -m "fix(create): align Node engines and fail fast on unsupported Node

  create-hono-preact declared engines >=20 while the framework requires
  ^22.18.0 || >=24.11.0, so a Node 20 scaffold succeeded and then failed
  confusingly at first dev run. Engines now match the framework and the
  CLI refuses up front with a clear message (help/version/add-agents
  still work on any Node).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 7: Print recovery guidance when dependency install fails

Item 9. The install-failure branch in `packages/create-hono-preact/lib/cli.mjs` (lines 148-157; the issue's 138-147 anchor is stale) prints only `error: '<pm> install' failed in <dir>.` and returns 1, skipping the Next-steps note, so the user is left without the `cd` / install / dev commands even though the project was fully scaffolded. Extract the next-steps command list into one helper (it is currently duplicated between the interactive `prompts.note` block at lines 178-183 and `printNextSteps` at lines 284-296) and reuse it in the failure branch.

**Files**
- Modify: `packages/create-hono-preact/lib/cli.mjs` (failure branch at lines 148-157; skipHints block at lines 177-187; `printNextSteps` at lines 280-296; one new helper)
- Test: `packages/create-hono-preact/__tests__/cli.test.ts` (extend the `run(): install failure diagnostics` describe; add a non-interactive case)

**Interfaces**
- New module-private helper in `cli.mjs`:

  ```js
  /**
   * Shell commands that take the user from a fresh checkout of the scaffolded
   * directory to a running dev server: cd in, install (unless dependencies are
   * already installed), start dev.
   *
   * @param {string} targetDir
   * @param {string} pm
   * @param {boolean} installed
   * @returns {string[]}
   */
  function setupCommands(targetDir, pm, installed) {
    const lines = [`cd ${targetDir}`];
    if (!installed) {
      lines.push(pm === 'npm' ? 'npm install' : `${pm} install`);
    }
    lines.push(pm === 'npm' ? 'npm run dev' : `${pm} dev`);
    return lines;
  }
  ```

**Steps**

- [ ] **Step 1: Write the failing tests.** In `packages/create-hono-preact/__tests__/cli.test.ts`, append inside the existing `describe('run(): install failure diagnostics', ...)`:

  ```ts
    it('non-interactive: prints recovery steps after an install failure', async () => {
      const out: string[] = [];
      const errs: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;
      console.log = (...args) => out.push(args.join(' '));
      console.error = (...args) => errs.push(args.join(' '));
      try {
        const failingSpawn = () => ({
          on: (e: string, cb: (c: number) => void) => {
            if (e === 'close') queueMicrotask(() => cb(1));
          },
        });
        const code = await run({
          argv: ['rec-app', '--adapter=node', '--no-git'],
          cwd: workDir,
          env: { npm_config_user_agent: 'pnpm/10' },
          spawnFn: failingSpawn as never,
        });
        expect(code).toBe(1);
        expect(errs.join('\n')).toContain("'pnpm install' failed");
        const printed = out.join('\n');
        expect(printed).toContain('cd rec-app');
        expect(printed).toContain('pnpm install');
        expect(printed).toContain('pnpm dev');
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    });

    it('interactive: shows the recovery note after an install failure', async () => {
      const notes: Array<{ text: string; title?: string }> = [];
      const fake = fakePrompts({ dir: 'rec-int-app', adapter: 'node' });
      (fake.prompts as PromptAdapter).note = (text: string, title?: string) => {
        notes.push({ text, title });
      };
      const failingSpawn = (cmd: string) => ({
        on: (e: string, cb: (c: number) => void) => {
          if (e === 'close') queueMicrotask(() => cb(cmd === 'git' ? 0 : 1));
        },
      });
      const code = await run({
        argv: ['rec-int-app', '--no-git'],
        cwd: workDir,
        env: { npm_config_user_agent: 'pnpm/10' },
        isTTY: true,
        prompts: fake.prompts,
        spawnFn: failingSpawn as never,
      });
      expect(code).toBe(1);
      const recovery = notes.find((n) => /finish setup/i.test(n.title ?? ''));
      expect(recovery).toBeTruthy();
      expect(recovery?.text).toContain('cd rec-int-app');
      expect(recovery?.text).toContain('pnpm install');
    });
  ```

  If the `note` signature in `PromptAdapter` (see `lib/prompts.mjs`) differs from `(text, title)`, match the adapter's actual parameter order in both the test and Step 3.

- [ ] **Step 2: Run and see them fail.** `pnpm vitest run packages/create-hono-preact/__tests__/cli.test.ts` fails: `expected '' to contain 'cd rec-app'` (nothing is printed today) and `expected undefined to be truthy` for the note.

- [ ] **Step 3: Implement.** In `packages/create-hono-preact/lib/cli.mjs`:

  1. Add the `setupCommands` helper (exact code in Interfaces above) directly above `printNextSteps`.

  2. Replace the install-failure branch body (currently):

     ```js
         if (code !== 0) {
           if (interactive) {
             // clack status code 2 renders the error glyph (1 is the cancel glyph).
             spin?.stop('Dependency install failed', 2);
             const captured = output.trim();
             if (captured) console.error(captured);
           }
           console.error(`error: '${pm} install' failed in ${targetDir}.`);
           return 1;
         }
     ```

     with:

     ```js
         if (code !== 0) {
           if (interactive) {
             // clack status code 2 renders the error glyph (1 is the cancel glyph).
             spin?.stop('Dependency install failed', 2);
             const captured = output.trim();
             if (captured) console.error(captured);
           }
           console.error(`error: '${pm} install' failed in ${targetDir}.`);
           // The project itself scaffolded fine; leave the user with the
           // commands that finish setup instead of a dead end.
           const lines = setupCommands(targetDir, pm, false);
           if (interactive) {
             prompts.note(
               lines.map((l) => `  ${l}`).join('\n'),
               'To finish setup manually'
             );
           } else {
             console.log('');
             console.log('The project was scaffolded. To finish setup manually:');
             console.log('');
             for (const l of lines) console.log(`  ${l}`);
             console.log('');
           }
           return 1;
         }
     ```

  3. Simplify the interactive next-steps block (lines 177-187) to use the helper:

     ```js
       if (!skipHints) {
         if (interactive) {
           const lines = setupCommands(targetDir, pm, install);
           prompts.note(lines.map((l) => `  ${l}`).join('\n'), 'Next steps');
         } else {
           printNextSteps(targetDir, pm, install);
         }
       }
     ```

  4. Simplify `printNextSteps` to use the helper:

     ```js
     /**
      * @param {string} targetDir
      * @param {string} pm
      * @param {boolean} installed
      */
     function printNextSteps(targetDir, pm, installed) {
       console.log('');
       console.log(pc.green(pc.bold('Done!')) + ' Next steps:');
       console.log('');
       for (const line of setupCommands(targetDir, pm, installed)) {
         console.log(`  ${line}`);
       }
       console.log('');
     }
     ```

- [ ] **Step 4: Re-run.** `pnpm format`, then `pnpm vitest run packages/create-hono-preact/__tests__/cli.test.ts` passes (including the pre-existing next-steps and failure-diagnostics tests).

- [ ] **Step 5: Commit.**

  ```
  git add packages/create-hono-preact/lib/cli.mjs packages/create-hono-preact/__tests__/cli.test.ts
  git commit -m "fix(create): print recovery steps when dependency install fails

  The install-failure branch returned 1 without the next-steps commands,
  leaving a fully scaffolded project with no guidance. Both interactive
  and non-interactive paths now print cd/install/dev recovery commands
  from one shared setupCommands helper.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 8: Align agent recipes and AGENTS.md with auto-discovery and the real export surface

Items 2 (recipes half) and 10. Verified against the tree:

- `templates/agents/skills/add-a-loader.md` step 2 (lines 34-43) teaches wiring `server:` by hand, and its Common Mistakes (lines 88-89) claims "Forgetting the `server:` import in `routes.ts`. The loader never runs". Both are factually wrong since 0.10.0 auto-discovery (`apps/site/src/pages/docs/routes.mdx` lines 67-80: the sibling is auto-discovered; explicit `server:` is an advanced override). Its step 3 example also uses the two-component `useData` + `.View` duplication and `definePage(ProfileView, {})`.
- `add-an-action.md` step 2 (lines 36-37) says "Ensure the route has its `server:` import in `src/routes.ts`".
- `add-a-guard.md` example (line 53) shows a `server:` line in the route node.
- `add-a-page.md` step 2 says "adding an entry to the array passed to `defineRoutes(...)`" (the template now keeps entries in a `routeTree` binding); it has no `server:` idiom.
- `templates/agents/AGENTS.md`: the "Public entry points" list implies `redirect`/`deny` live only on `hono-preact/page` ("page-level outcome helpers (`redirect`, `deny`, `render`)") while every recipe imports them from `hono-preact` root. Verified reality (`packages/iso/src/index.ts` exports `redirect`, `deny`; `packages/iso/src/page-only.ts` adds `render` and re-exports the rest): the recipes are RIGHT, AGENTS.md is the misleading side. Its "Where things go" `src/routes.ts` bullet also still says "which view (and optional `.server` module) lives there".

**Files**
- Modify: `packages/create-hono-preact/templates/agents/skills/add-a-loader.md`
- Modify: `packages/create-hono-preact/templates/agents/skills/add-an-action.md`
- Modify: `packages/create-hono-preact/templates/agents/skills/add-a-guard.md`
- Modify: `packages/create-hono-preact/templates/agents/skills/add-a-page.md`
- Modify: `packages/create-hono-preact/templates/agents/AGENTS.md`
- Test: `packages/create-hono-preact/__tests__/agents-recipes.test.ts` (new describe)

**Interfaces**
- Produces: recipes that never show explicit `server:` wiring as the normal path, use the single-View page form, and an AGENTS.md whose export list matches `packages/iso/src/index.ts` / `page-only.ts`. Recipes must not contradict the generated `agents/llms-full.txt` corpus (built from `apps/site` docs, which already teach auto-discovery).

**Steps**

- [ ] **Step 1: Write the failing regression test.** Append to `packages/create-hono-preact/__tests__/agents-recipes.test.ts`:

  ```ts
  describe('recipes teach current idioms', () => {
    // Explicit `server:` wiring is an advanced override since auto-discovery;
    // recipes must not present it as the normal path.
    it('no recipe wires server: by hand', () => {
      for (const f of skillFiles) {
        const body = readFileSync(resolve(skillsDir, f), 'utf8');
        expect(body, `${f} still shows explicit server: wiring`).not.toMatch(
          /server:\s*\(\)\s*=>\s*import/
        );
      }
    });

    // redirect/deny are exported from the hono-preact root (the recipes import
    // them there); AGENTS.md must not imply they live only on hono-preact/page.
    it('AGENTS.md lists redirect and deny on the root entry point', () => {
      // The root bullet wraps across lines; slice from its start to the
      // hono-preact/page bullet and assert within that span.
      const start = agentsMd.indexOf('- `hono-preact` -');
      const end = agentsMd.indexOf('- `hono-preact/page`');
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const rootBullet = agentsMd.slice(start, end);
      expect(rootBullet).toContain('`redirect`');
      expect(rootBullet).toContain('`deny`');
    });
  });
  ```

- [ ] **Step 2: Run and see it fail.** `pnpm vitest run packages/create-hono-preact/__tests__/agents-recipes.test.ts` fails: `add-a-loader.md still shows explicit server: wiring` (also add-a-guard.md) and the AGENTS.md bullet assertions fail.

- [ ] **Step 3: Fix `add-a-loader.md`.** Apply these exact replacements:

  1. Replace step 2 (the block from `2. Wire the server module onto the route...` through the closing fence of its code block, lines 34-43) with:

     ```
     2. There is nothing to wire in `src/routes.ts`. A `.server.ts` file named after the
        route's view file (`profile.tsx` pairs with `profile.server.ts`) is discovered and
        wired to the route automatically. The explicit `server:` field on a route node is
        an advanced override (a non-sibling module, or `server: false` to opt out).
     ```

  2. Replace the step 3 example code block (lines 51-76) with:

     ```tsx
     import { definePage } from 'hono-preact';
     import { serverLoaders } from './profile.server.js';

     const ProfileView = serverLoaders.default.View(({ data }) =>
       data ? (
         <section>
           <p>{data.message}</p>
           <small>Rendered at {data.renderedAt}</small>
         </section>
       ) : (
         <p>Loading...</p>
       )
     );

     export default definePage(ProfileView);
     ```

     and adjust the step 3 lead-in sentence to match: replace

     ```
     3. Read the data in `src/pages/<name>.tsx`. Import `serverLoaders` from the sibling
        `.server.js`, call `.useData()` in the component (it returns a `LoaderState` union),
        and wrap it with `.View(...)`. `data` reads straight off the union (it is absent
        only in the cold `loading` arm, so a truthy check doubles as the loading guard);
        reach for `status` when you need to tell `revalidating` or `error` apart:
     ```

     with:

     ```
     3. Read the data in `src/pages/<name>.tsx`. Import `serverLoaders` from the sibling
        `.server.js` and render through `.View(render)`; the render function receives the
        `LoaderState` union. `data` reads straight off the union (it is absent only in the
        cold `loading` arm, so a truthy check doubles as the loading guard); reach for
        `status` when you need to tell `revalidating` or `error` apart. Descendants that
        need the same data inside the view can call `.useData()`:
     ```

  3. In Common Mistakes, replace (lines 88-89):

     ```
     - Forgetting the `server:` import in `routes.ts`. The loader never runs and `useData()`
       has no data.
     ```

     with:

     ```
     - Misnaming the server file. Discovery pairs `profile.tsx` with `profile.server.ts`;
       a mismatched basename (`profileServer.ts`, `profile-data.server.ts`) is never
       discovered, the loader never runs, and the view renders its loading arm forever.
     ```

- [ ] **Step 4: Fix `add-an-action.md`.** Replace step 2 (lines 36-37):

  ```
  2. Ensure the route has its `server:` import in `src/routes.ts` (see `add-a-loader.md`,
     step 2).
  ```

  with:

  ```
  2. Nothing to wire in `src/routes.ts`: the colocated `<name>.server.ts` is discovered
     automatically from the view file's name (see `add-a-loader.md`, step 2).
  ```

- [ ] **Step 5: Fix `add-a-guard.md`.** In the step 2 route-node example, delete the line:

  ```
       server: () => import('./pages/dashboard.server.js'),
  ```

  (leaving `path`, `view`, `use`, and the children comment).

- [ ] **Step 6: Fix `add-a-page.md`.** Replace the step 2 lead-in:

  ```
  2. Register the route in `src/routes.ts` by adding an entry to the array passed to
     `defineRoutes(...)`. The import specifier ends in `.js`, not `.tsx`:
  ```

  with:

  ```
  2. Register the route in `src/routes.ts` by adding an entry to the `routeTree` array
     (the scaffold declares it `as const` so route params and paths stay typed). The
     import specifier ends in `.js`, not `.tsx`:
  ```

- [ ] **Step 7: Fix `AGENTS.md`.** Two replacements:

  1. In "Where things go", replace:

     ```
     - `src/routes.ts` - declares every URL and which view (and optional `.server`
       module) lives there.
     ```

     with:

     ```
     - `src/routes.ts` - declares every URL and which view lives there. A colocated
       `.server.ts` sibling is discovered and wired automatically; the explicit
       `server:` field is an advanced override.
     ```

  2. In "Public entry points", replace:

     ```
     - `hono-preact` - routing, loaders, actions, hooks, and components
       (`defineRoutes`, `defineLoader`, `defineAction`, `useParams`, `Head`,
       `ClientScript`, `Form`, `useActionResult`, ...).
     - `hono-preact/page` - page-level outcome helpers (`redirect`, `deny`, `render`).
     ```

     with:

     ```
     - `hono-preact` - routing, loaders, actions, hooks, components, and outcome
       constructors (`defineRoutes`, `defineLoader`, `defineAction`, `useParams`,
       `Head`, `ClientScript`, `Form`, `useActionResult`, `redirect`, `deny`, ...).
     - `hono-preact/page` - page-scope outcome helpers: `render` (available only
       here) plus re-exports of `redirect` and `deny` for a single import line.
     ```

- [ ] **Step 8: Re-run.** `pnpm vitest run packages/create-hono-preact/__tests__/agents-recipes.test.ts` passes. Also re-run `pnpm vitest run packages/create-hono-preact/__tests__/cli.test.ts` (its scaffold tests copy these files; nothing asserts their content, but confirm no collateral).

- [ ] **Step 9: Commit.**

  ```
  git add packages/create-hono-preact/templates/agents
  git add packages/create-hono-preact/__tests__/agents-recipes.test.ts
  git commit -m "docs(create): align agent recipes and AGENTS.md with auto-discovery and real exports

  Recipes no longer teach hand-wiring server: on route nodes (colocated
  .server.ts siblings are discovered automatically), the loader recipe
  uses the single .View form, and AGENTS.md lists redirect/deny on the
  hono-preact root where the recipes import them; hono-preact/page is
  described as render plus re-exports.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 9: Refresh the repo root README

Item 7. Verified: `packages/create-hono-preact/README.md` is fine (no version, no `views/home`); the defects are in the repo root `README.md`: line 53 uses an extensionless `./views/home` import (the exact mistake the recipes list first), line 58 labels the file `src/views/home.tsx` (the scaffolder writes `src/pages/`), and line 95 says `v0.8.0` (current is 0.10.1 per `packages/hono-preact/package.json`). The root README is NOT covered by `format:check` (only `packages/**` and `apps/**/src/**`), and there is no test surface for it; this is a docs-only task with manual verification.

**Files**
- Modify: `README.md` (repo root; lines 49-62 and line 95)

**Interfaces**
- Produces: a README whose code snippets match the recipes' idioms (route imports end in `.js`, pages live under `src/pages/`) and whose status line matches the published version.

**Steps**

- [ ] **Step 1: Fix the routes snippet.** Replace (lines 49-55):

  ```
  ```ts
  // src/routes.ts
  import { defineRoutes } from 'hono-preact';
  export default defineRoutes([
    { path: '/', view: () => import('./views/home') },
  ]);
  ```
  ```

  with:

  ```
  ```ts
  // src/routes.ts
  import { defineRoutes } from 'hono-preact';
  export default defineRoutes([
    { path: '/', view: () => import('./pages/home.js') },
  ]);
  ```
  ```

- [ ] **Step 2: Fix the page-file path.** Replace (line 58):

  ```
  // src/views/home.tsx
  ```

  with:

  ```
  // src/pages/home.tsx
  ```

- [ ] **Step 3: Fix the status version.** Replace (line 95):

  ```
  `v0.8.0`. Pre-1.0; expect changes between minor versions.
  ```

  with:

  ```
  `v0.10.1`. Pre-1.0; expect changes between minor versions.
  ```

- [ ] **Step 4: Verify.** `grep -n "views/home\|v0.8.0" README.md` prints nothing; `grep -n "pages/home.js\|v0.10.1" README.md` shows the three edits.

- [ ] **Step 5: Commit.**

  ```
  git add README.md
  git commit -m "docs: refresh root README to current version and route idioms

  The quick-look snippets showed an extensionless ./views/home import
  (the exact mistake the bundled recipes warn against) and a v0.8.0
  status line; now .js route imports under src/pages/ and v0.10.1.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Final whole-branch verification (after Task 9)

Run the CI-parity sequence from the worktree root before handing the branch back:

1. `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
2. `pnpm gen:agents-corpus`
3. `pnpm format:check` (run `pnpm format` and commit if it fails)
4. `pnpm typecheck`
5. `pnpm test:types`
6. `pnpm test` (or `pnpm test:coverage`)
7. `pnpm test:integration`
8. `pnpm --filter site build`
