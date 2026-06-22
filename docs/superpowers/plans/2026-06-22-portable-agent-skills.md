# Portable agent skills (recipes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four plain-Markdown, tool-neutral "recipe" procedures (add a page, a loader, an action+form, a guard) into scaffolded projects, indexed from `AGENTS.md`, with the docs corpus bundled locally for offline reference, guarded by drift gates.

**Architecture:** Recipes are authored under `packages/create-hono-preact/templates/agents/skills/*.md` and reach projects through the existing scaffold + `add-agents` pipe. The full docs corpus is generated (not committed) into `templates/agents/llms-full.txt` by a Node script that reuses the site's existing `generateLlmsFiles`. `AGENTS.md` gains a "Recipes" index and points its machine reference at the local corpus. Three Vitest gates (index integrity, recipe API validity, corpus presence) keep everything honest, reusing the existing `exports-coverage` / `appendix-sync` machinery.

**Tech Stack:** Node (native TypeScript type-stripping for the generation script, per the repo's existing `apps/site/scripts/*.ts` convention), Vitest, the `create-hono-preact` `.mjs` CLI, plain Markdown.

## Global Constraints

- No em-dashes in prose, comments, or commit messages (use commas, semicolons, colons, parentheses, or two sentences). Em-dashes are fine only in literal code/CLI/Markdown-table contexts.
- Recipe bodies are tool-neutral, self-contained Markdown: numbered steps, exact copy-pasteable code, a verification command, and a "Common mistakes" list. Never reference a specific harness ("use the X tool"); say "create this file", "run this command".
- The Node generation script is plain `.ts` run via native type-stripping; it lives under `apps/site/scripts/` (outside the browser app's composite tsconfig, so it is vitest-checked not tsc-checked) and is invoked with `node --disable-warning=ExperimentalWarning <file>.ts`. Import sibling source with the real `.ts` extension.
- The bundled `templates/agents/llms-full.txt` is generated, gitignored, and never hand-committed (avoids ~400KB churn per docs PR). It must still ship in the published `create-hono-preact` tarball.
- Public hono-preact API names used in recipe code fences are the real top-level `hono-preact` exports: `defineRoutes`, `defineLoader`, `defineAction`, `definePage`, `Form`, `useActionResult`, `useFormStatus`, `redirect`, `deny`, `defineServerMiddleware`, `defineClientMiddleware`, `ClientScript`, `Head`. There is no `useLoaderData`; loader data is read via `serverLoaders.<key>.useData()` inside a `serverLoaders.<key>.View(...)` wrapper. `render` is NOT a top-level export (only `hono-preact/page`); recipes do not use it.
- Before pushing, run the seven-step pre-push sequence in CLAUDE.md, plus `pnpm gen:agents-corpus` after the build step. `pnpm format:check` is the most-missed step; run `pnpm format` to fix.

---

## File Structure

**Created:**
- `apps/site/scripts/generate-bundled-corpus.ts` - Node script: reuses `generateLlmsFiles(nav, docsDir)` to write `llms-full.txt` into the create-hono-preact template.
- `packages/create-hono-preact/templates/agents/skills/add-a-page.md`
- `packages/create-hono-preact/templates/agents/skills/add-a-loader.md`
- `packages/create-hono-preact/templates/agents/skills/add-an-action.md`
- `packages/create-hono-preact/templates/agents/skills/add-a-guard.md`
- `packages/create-hono-preact/.npmignore` - so npm does not fall back to the repo `.gitignore` (which hides the generated corpus) when packing the `files` allowlist.
- `packages/create-hono-preact/__tests__/agents-recipes.test.ts` - gate 1 (AGENTS.md recipe-index integrity) + gate 3 (bundled corpus presence).
- `apps/site/src/pages/docs/__tests__/recipe-api-coverage.test.ts` - gate 2 (recipe hono-preact imports are real exports).

**Modified:**
- `package.json` (root) - add `gen:agents-corpus` script.
- `.gitignore` (root) - ignore the generated corpus.
- `packages/create-hono-preact/package.json` - add `prepack` script (regenerate corpus into the tarball).
- `packages/create-hono-preact/lib/template.mjs` - replace `copyAgentsFiles` with `copyAgentGuidance` that maps `AGENTS.md`/`CLAUDE.md` to project root and `skills/*` + `llms-full.txt` to a project `agents/` subdir.
- `packages/create-hono-preact/lib/cli.mjs` - full scaffold + `add-agents` call the new copy fn; refresh help text.
- `packages/create-hono-preact/__tests__/cli.test.ts` - assert the new files land in the right places.
- `packages/create-hono-preact/templates/agents/AGENTS.md` - add `## Recipes`, swap the `## Docs` hosted LLM links for the local corpus.
- `apps/site/src/pages/docs/cli.mdx` - document that `add-agents` now also writes the recipes + corpus.
- `.github/workflows/ci.yml` - run `pnpm gen:agents-corpus` after the framework build.
- `CLAUDE.md` (root) - add the corpus-generation step to the pre-push sequence.

**Project layout produced in a scaffolded app:**
```
AGENTS.md
CLAUDE.md
agents/
  skills/
    add-a-page.md
    add-a-loader.md
    add-an-action.md
    add-a-guard.md
  llms-full.txt
```

---

## Task 1: Corpus generation pipeline + presence gate

**Files:**
- Create: `apps/site/scripts/generate-bundled-corpus.ts`
- Create: `packages/create-hono-preact/.npmignore`
- Create: `packages/create-hono-preact/__tests__/agents-recipes.test.ts` (corpus-presence portion; the index portion is added in Task 3)
- Modify: `package.json` (root) scripts
- Modify: `.gitignore` (root)
- Modify: `packages/create-hono-preact/package.json` (add `prepack`)

**Interfaces:**
- Consumes: `generateLlmsFiles(nav: NavArea[], docsDir: string): { llmsTxt, llmsFullTxt }` from `apps/site/src/llms/generate-llms.ts`; `nav` from `apps/site/src/pages/docs/nav.ts`.
- Produces: the file `packages/create-hono-preact/templates/agents/llms-full.txt` and the npm script `gen:agents-corpus`. Later tasks (4, 5) and gate 3 rely on this file existing after `pnpm gen:agents-corpus`.

- [ ] **Step 1: Write the failing gate-3 test.**

Create `packages/create-hono-preact/__tests__/agents-recipes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = resolve(here, '..', 'templates', 'agents');

describe('bundled docs corpus', () => {
  it('is present and non-trivial (run `pnpm gen:agents-corpus`)', () => {
    const corpus = resolve(agentsDir, 'llms-full.txt');
    expect(existsSync(corpus), `${corpus} missing`).toBe(true);
    expect(readFileSync(corpus, 'utf8').length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `pnpm test -- agents-recipes`
Expected: FAIL (`llms-full.txt missing`), because the file does not exist yet.

- [ ] **Step 3: Write the generation script.**

Create `apps/site/scripts/generate-bundled-corpus.ts`:

```ts
// apps/site/scripts/generate-bundled-corpus.ts
// Generates the docs corpus bundled into scaffolded projects
// (packages/create-hono-preact/templates/agents/llms-full.txt). Reuses the
// site's pure generateLlmsFiles. Run from the repo root via:
//   pnpm gen:agents-corpus
// Node runs this .ts directly via native type-stripping.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLlmsFiles } from '../src/llms/generate-llms.ts';
import { nav } from '../src/pages/docs/nav.ts';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../src/pages/docs');
const outFile = resolve(
  here,
  '../../../packages/create-hono-preact/templates/agents/llms-full.txt'
);

const { llmsFullTxt } = generateLlmsFiles(nav, docsDir);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, llmsFullTxt);
console.log(`wrote ${outFile} (${llmsFullTxt.length} bytes)`);
```

- [ ] **Step 4: Add the root npm script.**

In `package.json` (root), add to `scripts` (after `"build"`):

```json
    "gen:agents-corpus": "node --disable-warning=ExperimentalWarning apps/site/scripts/generate-bundled-corpus.ts",
```

- [ ] **Step 5: Gitignore the generated corpus.**

Append to `.gitignore` (root), under a new comment block:

```
# generated bundled docs corpus shipped by the scaffolder (regenerated by
# `pnpm gen:agents-corpus`; kept out of git to avoid docs-PR churn)
packages/create-hono-preact/templates/agents/llms-full.txt
```

- [ ] **Step 6: Add the prepack + .npmignore so the corpus publishes.**

In `packages/create-hono-preact/package.json`, add a `scripts` block (the package currently has none), before `"dependencies"`:

```json
  "scripts": {
    "prepack": "node --disable-warning=ExperimentalWarning ../../apps/site/scripts/generate-bundled-corpus.ts"
  },
```

Create `packages/create-hono-preact/.npmignore`:

```
# This file exists so npm uses the package.json "files" allowlist for packing
# and does NOT fall back to the repo .gitignore (which ignores the generated
# templates/agents/llms-full.txt). prepack regenerates that corpus; it must
# ship in the tarball. Intentionally ignores nothing.
```

- [ ] **Step 7: Generate the corpus and verify the gate passes.**

Run: `pnpm gen:agents-corpus`
Expected: prints `wrote .../templates/agents/llms-full.txt (NNNNNN bytes)` with a six-figure byte count.

Run: `pnpm test -- agents-recipes`
Expected: PASS.

- [ ] **Step 8: Verify the corpus will publish despite being gitignored.**

Run: `cd packages/create-hono-preact && npm pack --dry-run 2>&1 | grep -F 'templates/agents/llms-full.txt'; cd -`
Expected: the grep prints a matching line (the file is in the tarball). If it prints nothing, the `.npmignore` is not taking effect; confirm the file exists and `.npmignore` is in the package root.

- [ ] **Step 9: Commit.**

```bash
git add apps/site/scripts/generate-bundled-corpus.ts package.json .gitignore \
  packages/create-hono-preact/.npmignore packages/create-hono-preact/package.json \
  packages/create-hono-preact/__tests__/agents-recipes.test.ts
git commit -m "feat(scaffold): generate bundled docs corpus for agent recipes"
```

---

## Task 2: Author the four recipes + API-validity gate

**Files:**
- Create: `packages/create-hono-preact/templates/agents/skills/add-a-page.md`
- Create: `packages/create-hono-preact/templates/agents/skills/add-a-loader.md`
- Create: `packages/create-hono-preact/templates/agents/skills/add-an-action.md`
- Create: `packages/create-hono-preact/templates/agents/skills/add-a-guard.md`
- Create: `apps/site/src/pages/docs/__tests__/recipe-api-coverage.test.ts`

**Interfaces:**
- Consumes: real `hono-preact` exports (see Global Constraints).
- Produces: the four recipe files (linked by Task 3's AGENTS.md index; copied by Task 4) and gate 2.

- [ ] **Step 1: Write `add-a-page.md`.**

Create `packages/create-hono-preact/templates/agents/skills/add-a-page.md`:

````markdown
# Add a page

**Use this when:** you need a new URL that renders a Preact component.

## Mental model (read first)

- Routes are declared in code in `src/routes.ts`, not by file location. There is no
  filesystem routing; a file under `src/pages/` does nothing until you register it.
- This is Preact, not React. Import hooks from `preact/hooks` and types from `preact`.
- A page that needs no server data is just a component with a `default` export. Adding
  data is a separate step (see `add-a-loader.md`); adding a mutation is another (see
  `add-an-action.md`).

## Steps

1. Create the component at `src/pages/<name>.tsx` (replace `<name>`):

   ```tsx
   import type { FunctionComponent } from 'preact';

   const About: FunctionComponent = () => (
     <section>
       <h1>About</h1>
       <p>This page is rendered by hono-preact.</p>
       <a href="/">Home</a>
     </section>
   );
   About.displayName = 'About';

   export default About;
   ```

2. Register the route in `src/routes.ts` by adding an entry to the array passed to
   `defineRoutes(...)`. The import specifier ends in `.js`, not `.tsx`:

   ```ts
   { path: '/about', view: () => import('./pages/about.js') },
   ```

3. Confirm `src/Layout.tsx` renders both `<ClientScript />` and `<Head />` (both from
   `hono-preact`). The scaffold's layout already does; a hand-written one must:

   ```tsx
   import { ClientScript, Head } from 'hono-preact';
   // ...inside the returned document...
   <Head defaultTitle="My app" />
   // ...near the end of <body>...
   <ClientScript />
   ```

## Verify

- Run `pnpm typecheck`. It must pass.
- Run `pnpm dev` and open the new path (for example `http://localhost:5173/about`). The
  page renders, and links work (which proves hydration ran).

## Common mistakes

- Importing the view with the wrong extension. Route imports use `.js`
  (`import('./pages/about.js')`) even though the file is `about.tsx`. A `.tsx` or
  extensionless specifier will not resolve.
- Creating the file but never registering it. There is no filesystem routing, so an
  unregistered page is a 404.
- A layout missing `<ClientScript />`. The page renders on the server but is dead in the
  browser. `<Head />` must be present too.
- Reaching for React. Import from `preact` / `preact/hooks`, never `react`.

## Reference

- Routing in depth: see "Adding Pages" and "The Route Table" in `../llms-full.txt`.
- Framework conventions: `../../AGENTS.md`.
````

- [ ] **Step 2: Write `add-a-loader.md`.**

Create `packages/create-hono-preact/templates/agents/skills/add-a-loader.md`:

````markdown
# Add a loader

**Use this when:** a page needs data fetched on the server before it renders.

## Mental model (read first)

- Data comes from a `defineLoader` in a colocated `*.server.ts` file, not from
  `getServerSideProps`, a route handler, or `fetch` in `useEffect`.
- A `.server.ts` file may export only `serverLoaders` and `serverActions` (plus erased
  `export type`s). The Vite plugin rewrites the client's import of `serverLoaders` into a
  client-safe data handle, so secrets and server-only helpers must stay inside the loader
  body, never at module top level where they would be inlined into the client bundle.
- The component reads the data with `<loader>.useData()` inside a `<loader>.View(...)`
  wrapper. There is no `useLoaderData` hook.

## Steps

1. Create or extend `src/pages/<name>.server.ts`:

   ```ts
   import { defineLoader } from 'hono-preact';

   export const serverLoaders = {
     default: defineLoader(async () => ({
       message: 'Hello from the server',
       renderedAt: new Date().toISOString(),
     })),
   };
   ```

   The loader function receives `{ c, location, signal }` (the Hono context, the route
   location, and an abort signal) and returns the data. Read request-scoped values off `c`.

2. Wire the server module onto the route in `src/routes.ts` by adding `server:` beside
   `view:`:

   ```ts
   {
     path: '/profile',
     view: () => import('./pages/profile.js'),
     server: () => import('./pages/profile.server.js'),
   },
   ```

3. Read the data in `src/pages/<name>.tsx`. Import `serverLoaders` from the sibling
   `.server.js`, call `.useData()` in the component, and wrap it with `.View(...)` so it
   suspends until the data is ready:

   ```tsx
   import { definePage } from 'hono-preact';
   import type { FunctionComponent } from 'preact';
   import { serverLoaders } from './profile.server.js';

   const loader = serverLoaders.default;

   const ProfilePage: FunctionComponent = () => {
     const { message, renderedAt } = loader.useData();
     return (
       <section>
         <p>{message}</p>
         <small>Rendered at {renderedAt}</small>
       </section>
     );
   };
   ProfilePage.displayName = 'ProfilePage';

   const ProfileView = loader.View(() => <ProfilePage />, {
     fallback: <p>Loading...</p>,
   });

   export default definePage(ProfileView, {});
   ```

## Verify

- Run `pnpm typecheck`. The shape from `useData()` is inferred from the loader's return;
  destructuring a field the loader does not return fails here.
- Run `pnpm dev`, open the page, and confirm the data renders.
- In devtools Network, confirm no server-only value (a secret, a DB handle) appears in the
  client payload.

## Common mistakes

- Forgetting the `server:` import in `routes.ts`. The loader never runs and `useData()`
  has no data.
- Adding other named exports to `.server.ts`. Only `serverLoaders` and `serverActions` are
  allowed; anything else is a build error.
- Fetching in `useEffect` instead. Loaders run on the server, are typed, and are SSR'd;
  client fetches are none of those.
- Casting the loader data. Let inference flow from the loader's return; do not annotate or
  cast `useData()`.
- Top-level secrets. A secret imported at the top of `.server.ts` can be inlined into the
  client. Keep it inside the loader body.

## Reference

- Loaders in depth: see "Server Loaders" and "Loading States" in `../llms-full.txt`.
- Framework conventions: `../../AGENTS.md`.
````

- [ ] **Step 3: Write `add-an-action.md`.**

Create `packages/create-hono-preact/templates/agents/skills/add-an-action.md`:

````markdown
# Add an action and form

**Use this when:** the page submits a form or performs a mutation (create, update, delete).

## Mental model (read first)

- Mutations are `defineAction`s in the colocated `*.server.ts`, not ad-hoc POST handlers.
- A `<Form>` submits to the action and works without JavaScript (progressive enhancement);
  client JS enhances it but is not required for it to function.
- The action returns a value on success and throws `redirect(...)` or `deny(...)` to end
  the request otherwise. The result reaches the component through a uniform envelope you
  read with `useActionResult()`; pending state comes from `useFormStatus()`.

## Steps

1. Add the action to `src/pages/<name>.server.ts` alongside any loaders:

   ```ts
   import { defineAction, redirect } from 'hono-preact';

   export const serverActions = {
     default: defineAction<{ email: string }, { ok: true }>(async (ctx, input) => {
       const email = (input.email ?? '').trim().toLowerCase();
       if (!email.includes('@')) throw new Error('a valid email is required');
       // ...persist using ctx.c...
       return { ok: true };
       // or end the request instead: throw redirect('/thanks');
     }),
   };
   ```

   The action receives `(ctx, payload)`: `ctx` is `{ c, signal }` and `payload` is the
   parsed form body. To refuse, throw `deny(403, 'message')` (import `deny` from
   `hono-preact`).

2. Ensure the route has its `server:` import in `src/routes.ts` (see `add-a-loader.md`,
   step 2).

3. Render a `<Form>` wired to the action, reading its status and result, in
   `src/pages/<name>.tsx`:

   ```tsx
   import { Form, useActionResult, useFormStatus } from 'hono-preact';
   import { serverActions } from './signup.server.js';

   const action = serverActions.default;

   export function SignupForm() {
     const { pending } = useFormStatus(action);
     const result = useActionResult(action);
     const error =
       result?.kind === 'deny' || result?.kind === 'error' ? result.message : null;

     return (
       <Form action={action}>
         <input name="email" type="email" required />
         {error && <p role="alert">{error}</p>}
         <button type="submit" disabled={pending}>
           {pending ? 'Submitting...' : 'Submit'}
         </button>
       </Form>
     );
   }
   ```

   To refetch a loader after a successful mutation, pass
   `invalidate={[serverLoaders.default]}` to `<Form>`.

## Verify

- Run `pnpm typecheck`.
- Run `pnpm dev`, submit the form, and confirm both the success path and an invalid
  submission (the `error` branch) behave.
- Disable JavaScript and submit again: the form still works. This proves progressive
  enhancement.

## Common mistakes

- Hand-rolling a POST route instead of `defineAction`. You lose the typed payload, the
  envelope, and progressive enhancement.
- Reading a raw `Response`. Read the outcome via `useActionResult()`; its `kind` is
  `'success' | 'deny' | 'error'`.
- Relying on client JS for the form to work at all. It must function without JS; only the
  enhancements (pending state, no full reload) need JS.
- Ignoring the deny/error branch. Handle `result.kind === 'deny'` / `'error'` and show
  `result.message`.

## Reference

- Actions in depth: see "Server Actions" and "Optimistic UI" in `../llms-full.txt`.
- Framework conventions: `../../AGENTS.md`.
````

- [ ] **Step 4: Write `add-a-guard.md`.**

Create `packages/create-hono-preact/templates/agents/skills/add-a-guard.md`:

````markdown
# Add a guard

**Use this when:** a route (and its data and actions) must be restricted, for example to a
signed-in user.

## Mental model (read first)

- A guard is a `use: [...]` array on a route node in `src/routes.ts`. It gates the page
  render and the loader/action RPC together, and it inherits down the tree: put it on a
  parent node and every descendant is protected.
- A guard is built from `defineServerMiddleware` and/or `defineClientMiddleware`. The
  server guard is authoritative; the client guard is a UX shortcut (it can redirect before
  a flash, but never trust it for security).
- A guard allows the request by calling `await next()` and blocks it by throwing
  `redirect(...)` or `deny(...)`.

## Steps

1. Write the guard (for example `src/guards.ts`):

   ```ts
   import {
     defineServerMiddleware,
     defineClientMiddleware,
     redirect,
   } from 'hono-preact';

   const requireUserServer = defineServerMiddleware(async (ctx, next) => {
     const user = await getUser(ctx.c); // your server-side session lookup
     if (!user) throw redirect('/login');
     await next();
   });

   const requireUserClient = defineClientMiddleware(async (_ctx, next) => {
     if (typeof window === 'undefined') {
       await next();
       return;
     }
     if (!localStorage.getItem('authed')) throw redirect('/login');
     await next();
   });

   export const requireUser = [requireUserServer, requireUserClient];
   ```

2. Attach it to the route node in `src/routes.ts` with `use:`. Put it on the node you want
   to protect, or on a parent to protect a whole subtree:

   ```ts
   {
     path: '/dashboard',
     view: () => import('./pages/dashboard.js'),
     server: () => import('./pages/dashboard.server.js'),
     use: requireUser,
     // any children here inherit requireUser automatically
   },
   ```

## Verify

- Run `pnpm typecheck`.
- Run `pnpm dev`. Hit the route while unauthorized: you are redirected or denied.
  Authorize, then hit it again: it renders.
- Confirm the data is gated too, not just the render: while unauthorized, the loader and
  any action for that route must also be refused (the server guard runs before them).

## Common mistakes

- Checking auth inside the loader or component. That gates one thing and duplicates logic.
  Use `use:` so render and RPC are gated from one place.
- Repeating the guard on every child. `use:` inherits; put it once on the parent.
- Assuming a render gate covers data. It does here, but verify the loader/action is refused
  while unauthorized.
- Trusting the client guard. It is UX only; security lives in the server middleware.

## Reference

- Access control in depth: see "Middleware" and "CSRF Protection" in `../llms-full.txt`.
- Framework conventions: `../../AGENTS.md`.
````

- [ ] **Step 5: Write the gate-2 test (recipe API validity).**

Create `apps/site/src/pages/docs/__tests__/recipe-api-coverage.test.ts`:

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
const repoRoot = resolve(here, '../../../../../..');
const skillsDir = resolve(
  repoRoot,
  'packages/create-hono-preact/templates/agents/skills'
);

const names = (m: Record<string, unknown>) =>
  Object.keys(m).filter((k) => k !== 'default');
const allExports = new Set<string>([
  ...names(root),
  ...names(page),
  ...names(server),
  ...names(viteApi),
  ...names(cloudflare),
  ...names(node),
]);

// Value (non-type) named imports from `hono-preact*` specifiers inside fenced
// code blocks. Type-only imports and non-hono-preact modules are ignored: the
// `import * as` namespaces above expose runtime exports only.
function honoValueImports(md: string): string[] {
  const found: string[] = [];
  const fences = md.match(/```[\s\S]*?```/g) ?? [];
  const importRe =
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(hono-preact(?:\/[a-z-]+)?)'/g;
  for (const block of fences) {
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(block))) {
      if (m[1]) continue; // whole `import type { ... }`
      for (const raw of m[2].split(',')) {
        const part = raw.trim();
        if (!part || part.startsWith('type ')) continue; // inline `type X`
        found.push(part.split(/\s+as\s+/)[0].trim());
      }
    }
  }
  return found;
}

const recipes = readdirSync(skillsDir).filter((f) => f.endsWith('.md'));

describe('recipe hono-preact imports are real exports', () => {
  expect(recipes.length).toBeGreaterThan(0);
  for (const file of recipes) {
    const md = readFileSync(resolve(skillsDir, file), 'utf8');
    for (const name of honoValueImports(md)) {
      it(`${file}: ${name} is a public hono-preact export`, () => {
        expect(allExports.has(name), `${name} (in ${file}) is not exported`).toBe(
          true
        );
      });
    }
  }
});
```

- [ ] **Step 6: Run gate 2, expect pass.**

Run: `pnpm test -- recipe-api-coverage`
Expected: PASS, with one passing case per imported symbol (`definePage`, `defineLoader`, `defineAction`, `redirect`, `Form`, `useActionResult`, `useFormStatus`, `defineServerMiddleware`, `defineClientMiddleware`, `ClientScript`, `Head`).

- [ ] **Step 7: Mutation-check the gate (prove it catches drift).**

Temporarily edit `add-a-page.md` to import a fake export, e.g. change `import { ClientScript, Head } from 'hono-preact';` to `import { ClientScript, Head, totallyNotReal } from 'hono-preact';`.
Run: `pnpm test -- recipe-api-coverage`
Expected: FAIL on `totallyNotReal`.
Then revert the edit and re-run; expected PASS. (A gate that passes only against unmodified input proves nothing; this confirms it bites.)

- [ ] **Step 8: Format and commit.**

```bash
pnpm format
git add packages/create-hono-preact/templates/agents/skills \
  apps/site/src/pages/docs/__tests__/recipe-api-coverage.test.ts
git commit -m "feat(scaffold): add four agent recipes + API-validity gate"
```

---

## Task 3: AGENTS.md recipe index + local-corpus reference + index gate

**Files:**
- Modify: `packages/create-hono-preact/templates/agents/AGENTS.md`
- Modify: `packages/create-hono-preact/__tests__/agents-recipes.test.ts` (add the index-integrity portion)

**Interfaces:**
- Consumes: the four recipe filenames from Task 2.
- Produces: the `## Recipes` index any agent reads to discover the recipes, and gate 1 enforcing it stays in sync with the `skills/` directory.

- [ ] **Step 1: Add the index gate (failing) to `agents-recipes.test.ts`.**

Append to `packages/create-hono-preact/__tests__/agents-recipes.test.ts` (it already imports `readFileSync`, `existsSync`, `resolve`, `agentsDir`; add `readdirSync` to the `node:fs` import):

```ts
import { readdirSync } from 'node:fs';

const skillsDir = resolve(agentsDir, 'skills');
const agentsMd = readFileSync(resolve(agentsDir, 'AGENTS.md'), 'utf8');
const skillFiles = readdirSync(skillsDir).filter((f) => f.endsWith('.md'));
const linked = [
  ...agentsMd.matchAll(/agents\/skills\/([a-z0-9-]+\.md)/g),
].map((m) => m[1]);

describe('AGENTS.md recipe index', () => {
  it('links every recipe file', () => {
    for (const f of skillFiles) {
      expect(linked, `recipe ${f} is not linked from AGENTS.md`).toContain(f);
    }
  });
  it('every recipe link resolves to a real file', () => {
    expect(linked.length).toBeGreaterThan(0);
    for (const name of linked) {
      expect(
        existsSync(resolve(skillsDir, name)),
        `dangling recipe link ${name}`
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `pnpm test -- agents-recipes`
Expected: FAIL (`recipe add-a-page.md is not linked from AGENTS.md`), because AGENTS.md has no Recipes section yet.

- [ ] **Step 3: Add the `## Recipes` section to AGENTS.md.**

In `packages/create-hono-preact/templates/agents/AGENTS.md`, insert this block immediately before the `## Docs` heading:

```markdown
## Recipes

Step-by-step procedures for the most common tasks. Open the file and follow it top to
bottom; each one ends with a command to verify your work.

- Add a page (a new URL): `agents/skills/add-a-page.md`
- Add a loader (server data for a page): `agents/skills/add-a-loader.md`
- Add an action and form (a mutation): `agents/skills/add-an-action.md`
- Add a guard (restrict a route): `agents/skills/add-a-guard.md`

```

- [ ] **Step 4: Swap the `## Docs` section to the local corpus.**

Replace the entire current `## Docs` body:

```markdown
## Docs

- Full docs: https://framework.sbesh.com/docs
- LLM index: https://framework.sbesh.com/llms.txt
- LLM full corpus: https://framework.sbesh.com/llms-full.txt
```

with:

```markdown
## Docs

- Full docs (online): https://framework.sbesh.com/docs
- Full documentation corpus, bundled offline in this project: `agents/llms-full.txt`
```

- [ ] **Step 5: Run gate 1 and the existing appendix gate, expect pass.**

Run: `pnpm test -- agents-recipes agents-appendix`
Expected: PASS. (The appendix-sync gate matches only `` `hono-preact[/...]` `` code spans, so the new `` `agents/skills/...` `` and `` `agents/llms-full.txt` `` spans do not affect it. Confirm it still passes.)

- [ ] **Step 6: Mutation-check gate 1.**

Temporarily delete the `add-a-guard.md` bullet from the Recipes section.
Run: `pnpm test -- agents-recipes`
Expected: FAIL (`recipe add-a-guard.md is not linked`). Restore the bullet; re-run; expected PASS.

- [ ] **Step 7: Format and commit.**

```bash
pnpm format
git add packages/create-hono-preact/templates/agents/AGENTS.md \
  packages/create-hono-preact/__tests__/agents-recipes.test.ts
git commit -m "feat(scaffold): index recipes in AGENTS.md, point reference at local corpus"
```

---

## Task 4: Scaffold + add-agents copy wiring + CLI docs

**Files:**
- Modify: `packages/create-hono-preact/lib/template.mjs`
- Modify: `packages/create-hono-preact/lib/cli.mjs`
- Modify: `packages/create-hono-preact/__tests__/cli.test.ts`
- Modify: `apps/site/src/pages/docs/cli.mdx`

**Interfaces:**
- Consumes: the recipe files (Task 2), the generated `llms-full.txt` (Task 1, present after `pnpm gen:agents-corpus`).
- Produces: `copyAgentGuidance(agentsDir, targetDir, { force }): Promise<Array<{ file, action }>>` (replaces `copyAgentsFiles`), where `file` is the project-relative destination path (`AGENTS.md`, `CLAUDE.md`, `agents/skills/<name>.md`, `agents/llms-full.txt`) and `action` is `'created' | 'overwritten' | 'skipped'`.

- [ ] **Step 1: Ensure the corpus exists for the test run.**

Run: `pnpm gen:agents-corpus`
Expected: writes `templates/agents/llms-full.txt` (the scaffold copy needs a real file to copy).

- [ ] **Step 2: Write failing assertions in `cli.test.ts`.**

In `packages/create-hono-preact/__tests__/cli.test.ts`, in the node-adapter scaffold test (after the existing `AGENTS.md` / `CLAUDE.md` assertions, around line 44), add:

```ts
    expect(existsSync(join(target, 'agents', 'skills', 'add-a-page.md'))).toBe(
      true
    );
    expect(existsSync(join(target, 'agents', 'skills', 'add-a-loader.md'))).toBe(
      true
    );
    expect(existsSync(join(target, 'agents', 'skills', 'add-an-action.md'))).toBe(
      true
    );
    expect(existsSync(join(target, 'agents', 'skills', 'add-a-guard.md'))).toBe(
      true
    );
    expect(existsSync(join(target, 'agents', 'llms-full.txt'))).toBe(true);
    // recipes are NOT dumped at the project root
    expect(existsSync(join(target, 'skills'))).toBe(false);
```

In the `run() - add-agents` describe block, add a new test:

```ts
  it('writes the recipes and corpus under agents/', async () => {
    const code = await run({ argv: ['add-agents'], cwd: workDir, env: {} });
    expect(code).toBe(0);
    expect(existsSync(join(workDir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(workDir, 'CLAUDE.md'))).toBe(true);
    expect(
      existsSync(join(workDir, 'agents', 'skills', 'add-a-page.md'))
    ).toBe(true);
    expect(existsSync(join(workDir, 'agents', 'llms-full.txt'))).toBe(true);
  });
```

- [ ] **Step 3: Run, verify failure.**

Run: `pnpm test -- cli.test`
Expected: FAIL (the new `agents/skills/...` paths do not exist; the current copy puts recipe files at the project root, so `skills/` would also be wrong).

- [ ] **Step 4: Replace `copyAgentsFiles` with `copyAgentGuidance` in `template.mjs`.**

In `packages/create-hono-preact/lib/template.mjs`, change the imports at the top to include `mkdir` and `readdir`:

```js
import { cp, rename, readFile, writeFile, access, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
```

Replace the entire `copyAgentsFiles` function with:

```js
/**
 * Copy the agent-guidance payload into a target project. Root files (AGENTS.md,
 * CLAUDE.md) land at the project root; recipes and the bundled docs corpus land
 * under the project's `agents/` directory. Per-file: created if absent,
 * overwritten when `force`, otherwise skipped.
 *
 * @param {string} agentsDir absolute path to templates/agents
 * @param {string} targetDir absolute path to the destination project
 * @param {{ force: boolean }} options
 * @returns {Promise<Array<{ file: string, action: 'created' | 'overwritten' | 'skipped' }>>}
 */
export async function copyAgentGuidance(agentsDir, targetDir, { force }) {
  /** @type {Array<{ from: string, to: string }>} */
  const plan = [
    { from: 'AGENTS.md', to: 'AGENTS.md' },
    { from: 'CLAUDE.md', to: 'CLAUDE.md' },
    { from: 'llms-full.txt', to: join('agents', 'llms-full.txt') },
  ];
  const skills = (await readdir(join(agentsDir, 'skills'))).filter((f) =>
    f.endsWith('.md')
  );
  for (const name of skills) {
    plan.push({
      from: join('skills', name),
      to: join('agents', 'skills', name),
    });
  }

  const results = [];
  for (const { from, to } of plan) {
    const dest = join(targetDir, to);
    const exists = await fileExists(dest);
    if (exists && !force) {
      results.push({ file: to, action: 'skipped' });
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await cp(join(agentsDir, from), dest);
    results.push({ file: to, action: exists ? 'overwritten' : 'created' });
  }
  return results;
}
```

- [ ] **Step 5: Update `cli.mjs` to use it.**

In `packages/create-hono-preact/lib/cli.mjs`:

Change the import from `./template.mjs` to use `copyAgentGuidance` instead of `copyAgentsFiles`:

```js
import {
  copyTemplate,
  renameDotfiles,
  substituteName,
  copyAgentGuidance,
} from './template.mjs';
```

In the `add-agents` branch, change the call:

```js
    const results = await copyAgentGuidance(agentsDir, cwd, {
      force: parsed.force,
    });
```

Replace the full-scaffold agents copy (the line `await copyTemplate(join(templatesRoot, 'agents'), targetPath);`) with:

```js
  await copyAgentGuidance(join(templatesRoot, 'agents'), targetPath, {
    force: true,
  });
```

Update the help text line for `add-agents` in `printHelp()`:

```js
  add-agents [--force]          Add AGENTS.md, CLAUDE.md, and agent recipes to an existing project
```

- [ ] **Step 6: Run the CLI tests, expect pass.**

Run: `pnpm test -- cli.test`
Expected: PASS, including the new scaffold and add-agents assertions and the existing skip/force behavior (the AGENTS.md skip test still returns 0 because CLAUDE.md and the recipes are still created).

- [ ] **Step 7: Update the CLI docs page.**

In `apps/site/src/pages/docs/cli.mdx`, in the "Add agent guidance to an existing app" section, update the description of what `add-agents` writes so it reads (keep the surrounding prose and the `--force` table row intact):

> It writes `AGENTS.md` (framework conventions for any AI coding agent), a one-line `CLAUDE.md` pointer, an `agents/skills/` directory of step-by-step recipes (add a page, a loader, an action, a guard), and `agents/llms-full.txt` (the full documentation bundled for offline reference).

- [ ] **Step 8: Verify the docs page still passes the structure gate and prettier.**

Run: `node --disable-warning=ExperimentalWarning apps/site/scripts/docs-structure.ts apps/site/src/pages/docs/cli.mdx`
Expected: prints nothing, exits 0.
Run: `pnpm format`
Then `pnpm format:check` to confirm clean.

- [ ] **Step 9: Commit.**

```bash
git add packages/create-hono-preact/lib/template.mjs \
  packages/create-hono-preact/lib/cli.mjs \
  packages/create-hono-preact/__tests__/cli.test.ts \
  apps/site/src/pages/docs/cli.mdx
git commit -m "feat(scaffold): scaffold + add-agents ship recipes and bundled corpus"
```

---

## Task 5: CI + pre-push + release wiring

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md` (root)

**Interfaces:**
- Consumes: the `gen:agents-corpus` script (Task 1) and `prepack` (Task 1).
- Produces: CI that regenerates the corpus before tests, and documentation of the step.

- [ ] **Step 1: Add the generation step to CI.**

In `.github/workflows/ci.yml`, in the `test` job, insert a step between "Build framework packages" and "Format check":

```yaml
      # The scaffolder ships a bundled docs corpus (templates/agents/llms-full.txt)
      # that is generated, not committed. Regenerate it before tests so the
      # corpus-presence gate and the scaffold copy test see a fresh file.
      - name: Generate bundled agents corpus
        run: pnpm gen:agents-corpus
```

- [ ] **Step 2: Add the step to the CLAUDE.md pre-push sequence.**

In `CLAUDE.md`, under "Pre-push verification", insert a step immediately after step 1 (the framework build) and renumber the rest:

```markdown
2. `pnpm gen:agents-corpus` (regenerates the bundled docs corpus the scaffolder ships into `templates/agents/llms-full.txt`; the corpus-presence gate and the scaffold copy test read it. It is gitignored, so a stale or missing file is a local-only failure that CI would also catch).
```

- [ ] **Step 3: Verify the full pre-push sequence locally.**

Run, in order, from the repo root:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: every command exits 0. If `format:check` fails, run `pnpm format`, re-stage, and amend.

- [ ] **Step 4: Commit.**

```bash
git add .github/workflows/ci.yml CLAUDE.md
git commit -m "ci: regenerate bundled agents corpus before tests"
```

---

## Task 6: End-to-end scaffold smoke + final verification

**Files:** none (verification only).

- [ ] **Step 1: Scaffold a throwaway app and inspect the layout.**

```bash
TMP="$(mktemp -d)"
node packages/create-hono-preact/bin/index.mjs smoke-app --adapter=node --no-install --no-git --version >/dev/null 2>&1 || true
node packages/create-hono-preact/bin/index.mjs smoke-app --adapter=node --no-install --no-git
```

(Run the scaffold from inside `$TMP`: `cd "$TMP" && node <repo>/packages/create-hono-preact/bin/index.mjs smoke-app --adapter=node --no-install --no-git`.)
Expected files in `smoke-app/`: `AGENTS.md`, `CLAUDE.md`, `agents/skills/add-a-page.md` (and the other three), `agents/llms-full.txt`. There must be no top-level `skills/` directory and no top-level `llms-full.txt`.

- [ ] **Step 2: Confirm AGENTS.md points at the local corpus and links every recipe.**

Open `smoke-app/AGENTS.md`; confirm the `## Recipes` bullets link `agents/skills/*.md`, and `## Docs` references `agents/llms-full.txt` (no `llms.txt` / `llms-full.txt` hosted URLs remain). Clean up: `rm -rf "$TMP"`.

- [ ] **Step 3: Run the full unit + types suite once more.**

Run: `pnpm test:coverage`
Expected: PASS, including `agents-recipes` (gates 1 + 3), `recipe-api-coverage` (gate 2), `agents-appendix`, and `cli.test`.

- [ ] **Step 4: Finalize.**

Use the superpowers:finishing-a-development-branch skill to decide merge/PR. Per the PR workflow in CLAUDE.md, the first follow-up after opening the PR is a deep PR review (replacement parity for the `copyAgentsFiles` -> `copyAgentGuidance` change; confirm the add-agents skip/force semantics and the full-scaffold copy both still behave).

---

## Self-Review

**Spec coverage:**
- Four recipes (page/loader/action/guard) - Task 2. ✓
- Tool-neutral Markdown, AGENTS.md index, no per-tool wrappers - Tasks 2, 3. ✓
- Local bundled corpus, only `llms-full.txt`, one human URL retained - Tasks 1, 3. ✓
- Ship via scaffold + add-agents - Task 4. ✓
- Folder `agents/`, label "Recipes" - Tasks 3, 4. ✓
- Recipe anatomy (Use-when / Mental model / Steps / Verify / Common mistakes / Reference) - Task 2 (all four follow it). ✓
- Corpus generated, not committed in our repo; committed in user project - Tasks 1 (gitignore + gen) and 4 (scaffold copies a real file). ✓
- Three drift gates (index integrity, API validity, corpus presence) - gate 1 + 3 (Tasks 1, 3), gate 2 (Task 2). ✓
- CI / pre-push wiring; publish safety - Tasks 5, 1 (prepack + .npmignore). ✓
- CLI docs updated - Task 4. ✓
- Non-goals (no `.claude/skills`, no per-tool generation, no `render`/`hono-preact/page` in recipes) - honored throughout. ✓

**Placeholder scan:** No TBD/TODO; every code and content step is complete. The only `<name>`/`<repo>` tokens are deliberate user-substitution placeholders inside recipe instructions and the smoke test, not plan gaps.

**Type/name consistency:** `copyAgentGuidance` signature is defined once (Task 4 Interfaces + implementation) and consumed consistently in `cli.mjs`. Gate file names (`agents-recipes.test.ts`, `recipe-api-coverage.test.ts`) are consistent across tasks. Real export names match the verified list in Global Constraints. The `agents/skills/<name>.md` link form in AGENTS.md matches the regex in gate 1.
