# Portable agent skills (recipes) for hono-preact projects

Date: 2026-06-22
Status: Design approved, pending spec review

## Problem

Everything we currently ship for AI agents is reference material:

- `/llms.txt` is a curated index of doc links (a table of contents).
- `/llms-full.txt` is the full docs corpus concatenated into one file.
- The scaffolder `AGENTS.md` is a static rules file (how the framework differs from
  Next/Remix/React, where things go, the public entry points).

None of it is procedural. An agent that wants to add a page, a loader, an action, or
a guard has to re-derive the canonical multi-step procedure every time from prose it
can skim past. The framework has strong opinions about these workflows (a page is up
to four coordinated files; an action is a `defineAction` + `__outcome` + `useActionResult`
triad; a guard is a `use: [...]` array that inherits down the route tree), and those
opinions live only in reference text. Agents freelance the wiring as a result.

## Goal

Ship a small set of **recipes**: plain-Markdown, step-by-step procedures that normalize
how these workflows are done, with a verification step and a banked list of the common
ways agents get them wrong. Recipes hold the procedure; the docs hold the reference.

## Hard constraint: any LLM, not just Claude Code

Recipes must be usable by any agent that can read a file and follow instructions
(Cursor, Codex, Copilot, Cline, Gemini, a bare model, etc.), not only Claude Code. This
drives the format and discovery decisions below. Claude Code is a first-class consumer
but never a required one.

## Decisions

1. **Delivery: ship into the project via the existing pipe.** Recipes are carried into
   new projects by the `create-hono-preact` scaffold and into existing/manual-install
   projects by `npx create-hono-preact add-agents`. No new distribution channel.

2. **Portability model: `AGENTS.md` index + plain Markdown, no per-tool wrappers.** The
   recipe body is tool-neutral, self-contained Markdown. `AGENTS.md` is the universal
   discovery surface (the cross-agent standard we already ship and gate). There are no
   `.claude/skills/` files, no `.cursor/rules`, no generated per-tool formats. An agent
   reads `AGENTS.md`, follows the link, and executes the procedure.

3. **Coverage (v1): four recipes.** Add a page, add a loader, add an action + form, add
   a guard. These are the workflows agents most reliably get wrong. Second-tier
   candidates (`contentRoutes`, wiring a `hono-preact-ui` component, adapter/`defineApp`
   config) are deferred, not in v1.

4. **Reference lives locally, not hosted.** Recipes and `AGENTS.md` point an agent at a
   copy of the corpus shipped into the project (`agents/llms-full.txt`), not at a
   `framework.sbesh.com` URL. An agent reads reference from disk, so the site gets no
   traffic from shipped files. Only the full concatenated corpus is bundled locally; the
   curated index is omitted (locally it is just a list of site URLs and useless). The
   hosted site keeps serving both files for human/site-visitor discovery, untouched.
   Version-pinning is a feature: the bundled corpus matches the installed framework
   version, so an agent is never told about APIs the installed version lacks.

5. **One human-facing URL retained.** `AGENTS.md`'s intro keeps a single "Full docs"
   URL for a human skimming the file. Every machine reference path is local.

## Layout

In the generated project (committed, exactly like the existing agent files; the scaffold
`.gitignore` covers only `node_modules`, `dist`, `.wrangler`, `.DS_Store`, `*.log`):

```
AGENTS.md              gains a "Recipes" section linking each recipe by path;
                       "Docs" section swaps the two hosted LLM links for
                       agents/llms-full.txt, keeps one human "Full docs" URL
CLAUDE.md              unchanged (one-line pointer to AGENTS.md)
agents/
  llms-full.txt        the docs corpus, bundled locally for offline reference
  skills/
    add-a-page.md
    add-a-loader.md
    add-an-action.md
    add-a-guard.md
```

Folder name is `agents/` (visible, pairs with `AGENTS.md`). The `AGENTS.md` section label
is "Recipes" (not "Skills"), to avoid implying a Claude-specific invocation mechanism.

Source of truth in the monorepo: recipes live at
`packages/create-hono-preact/templates/agents/skills/*.md`, alongside the existing
`templates/agents/AGENTS.md`. The bundled `llms-full.txt` is generated (see Corpus below),
not hand-committed in our repo.

## Recipe anatomy

Every recipe is pure Markdown, no frontmatter, tool-neutral language ("create this file",
"run this command"; never "use the X tool"). Fixed structure so any agent can predict
where to find what:

1. **Title (H1).**
2. **Use this when:** one-line trigger.
3. **Mental model (read first):** 2 to 4 bullets of the framework-specific assumptions
   that differ from Next/Remix/React, with links to the relevant local reference.
4. **Steps:** numbered; each step is an action plus the exact, minimal, copy-pasteable
   code and which file it goes in. Following top to bottom yields a working result.
5. **Verify:** the exact command(s) to run and what success looks like.
6. **Common mistakes:** the specific ways agents freelance this workflow, turned into
   explicit "don't".
7. **Reference:** link to `agents/llms-full.txt` (and section) for depth.

Governing principle: the recipe holds procedure + verification + pitfalls; the docs hold
reference. We link, we do not restate. The two load-bearing sections are **Verify** (the
agent self-checks instead of declaring victory blind) and **Common mistakes** (where the
freelancing knowledge is banked). Code fences use the framework's real exported API names
deliberately, which the drift gate then checks.

## The four recipes

API grounding (from `templates/cloudflare/src/routes.ts`, `Layout.tsx`, and `AGENTS.md`):
routes are declared in `src/routes.ts` via `defineRoutes([{ path, view: () => import('./pages/x.js'), server: () => import('./pages/x.server.js') }])`;
a page view is the default export of `src/pages/<name>.tsx`; server code is
`export const serverLoaders = { default: defineLoader(fn) }` /
`export const serverActions = { ... }` in `src/pages/<name>.server.ts` (only those two
named exports allowed, plus erased types); `Layout.tsx` must render `<ClientScript />` and
`<Head />` (both from `hono-preact`); outcome helpers `redirect` / `deny` / `render` come
from `hono-preact/page`.

### add-a-page.md
- **Steps:** create `src/pages/<name>.tsx` (default-export component); add
  `{ path, view: () => import('./pages/<name>.js') }` to `defineRoutes([...])` in
  `src/routes.ts`; confirm `Layout.tsx` renders `<ClientScript />` and `<Head />`.
- **Verify:** `pnpm typecheck`, then `pnpm dev` and open the route; renders and is
  interactive.
- **Common mistakes:** importing the view with `.tsx`/no extension instead of `.js`;
  creating the file but never registering it in `routes.ts` (no filesystem routing, so a
  404); a hand-built layout missing `<ClientScript />` (renders but dead in the browser);
  reaching for `react` / React hooks.

### add-a-loader.md
- **Steps:** add `export const serverLoaders = { default: defineLoader(async (ctx) => ...) }`
  to `src/pages/<name>.server.ts`; wire `server: () => import('./pages/<name>.server.js')`
  onto that route; read the data in the component through the typed loader hook.
- **Verify:** `pnpm typecheck` (types flow from the loader's return); `pnpm dev`, data
  renders; Network tab shows no server-only values leaked.
- **Common mistakes:** adding `serverLoaders` but forgetting the `server:` import in
  `routes.ts` (loader never runs); other named exports in the `.server.ts` (only
  `serverLoaders` / `serverActions` allowed); fetching in `useEffect` instead; casting
  loader data instead of letting inference flow; importing secrets at module top level
  where they inline into the client (keep them inside the loader body).

### add-an-action.md
- **Steps:** add `export const serverActions = { default: defineAction(async (ctx) => ...) }`
  returning an outcome (`render` / `redirect` / `deny` from `hono-preact/page`); ensure the
  route has its `server:` import; render `<Form>` wired to the action; read the result with
  `useActionResult()` and pending state with `useFormStatus()`.
- **Verify:** `pnpm typecheck`; `pnpm dev`, submit the form, and submit with JS disabled to
  confirm progressive enhancement; the `__outcome` result renders.
- **Common mistakes:** hand-rolling a POST handler instead of `defineAction`; reading a raw
  response instead of the `__outcome` envelope; relying on client JS for the form to work
  at all (breaks PE); not handling the deny/error branch.

### add-a-guard.md
- **Steps:** write a guard that denies/redirects when unauthorized; add `use: [guard]` to
  the route node (or a parent node to protect a subtree); place it at the right level since
  `use` inherits down the tree.
- **Verify:** `pnpm typecheck`; `pnpm dev`, hit the route unauthorized (redirect/deny) and
  authorized (renders); confirm the loader/action RPC is also gated, not just the render.
- **Common mistakes:** checking auth inside the loader/component instead of `use` (render
  gated but RPC reachable, or logic duplicated); repeating the guard on every child instead
  of once on the parent; assuming render-gating implies data-gating without verifying;
  treating the client-side gate as authoritative (the server guard is).

API note: the exact loader-data consumption hook and the precise `<Form>`/action props are
modeled on the real API above and will be locked against the source when the recipes are
written. Drift gate 2 enforces that every API name a recipe imports is a real export.

## Wiring

- The full scaffold copies the `agents/` payload (`skills/` recipes + `llms-full.txt`) into
  new projects automatically.
- `add-agents` (today copies `AGENTS.md` + `CLAUDE.md`) grows to also copy `agents/skills/*`
  and `agents/llms-full.txt`. Update its help text, its tests
  (`packages/create-hono-preact/__tests__/cli.test.ts`), and the CLI docs page
  (`apps/site/src/pages/docs/cli.mdx`).
- `AGENTS.md` gains the "Recipes" index section and swaps its two hosted LLM links for the
  local `agents/llms-full.txt`, keeping the one human "Full docs" URL.

## Corpus production

The corpus is produced by the existing `generateLlmsFiles` generator in
`apps/site/src/llms/generate-llms.ts`. The template copy is **generated as part of the
create-hono-preact package build, not hand-committed in our monorepo**: a root script runs
the generator and emits `llms-full.txt` into the create-hono-preact template whenever the
package is built. Building on every checkout means the file is present for local scaffolding,
integration tests, and publish alike, and CI's `build` step (which runs before
`test:coverage`) guarantees gate 3 below sees it. It still ships committed into the user's
scaffolded project,
because the scaffolder lays down a real file, so the "diffable on framework upgrade" benefit
is preserved for the user. The win for our repo: docs prose edits do not churn a ~400KB
committed blob in every PR, and freshness is automatic because the file is regenerated from
current docs at publish.

Because `hono-preact` and `create-hono-preact` release lockstep on minor/major, the corpus
bundled at publish time matches the published docs.

## Drift protection

Three Vitest gates, run by `pnpm test:coverage` in CI, using the same mechanism as the
existing `exports-coverage` / `appendix-sync` gates (no new CI surface):

1. **Index integrity.** Every `agents/skills/*.md` is linked from the `AGENTS.md` Recipes
   section, and every link there resolves to a real file. Bidirectional (mirrors
   `appendix-sync`): no orphan recipe, no dangling link.
2. **Recipe API validity.** Parse the `import ... from 'hono-preact...'` lines in each
   recipe's code fences and assert every imported name is a real public export of that
   subpath. Reuses the `exports-coverage` machinery (which already imports the runtime
   modules). Checking import lines, not every identifier, keeps it precise and
   false-positive-free. This is what catches a recipe that still names a renamed export.
3. **Corpus presence/sanity.** The bundled `llms-full.txt` exists after build, is
   non-trivial, and has the expected structure.

## Non-goals

- No `.claude/skills/` SKILL.md wrappers and no Claude-specific invocation. (Portability
  model decision 2.)
- No generated per-tool formats (`.cursor/rules`, copilot-instructions, `.windsurfrules`).
- No MCP server, no eval harness.
- Second-tier recipes (`contentRoutes`, `hono-preact-ui` wiring, adapter/`defineApp`
  config) are deferred to a later cut.
- No change to the hosted site's `/llms.txt` or `/llms-full.txt` behavior.

## Testing

- The three drift gates above.
- `add-agents` test coverage extended to assert the new files are copied (and skipped
  without `--force` when present).
- Integration: a scaffolded project contains `agents/skills/*.md` and `agents/llms-full.txt`,
  and `AGENTS.md` indexes every recipe.
- Standard pre-push sequence (build, `format:check`, `typecheck`, `test:types`,
  `test:coverage`, `test:integration`, site build).
