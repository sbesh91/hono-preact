# `create-hono-preact` interactive CLI redesign

**Date:** 2026-06-26
**Status:** design, approved
**Inspiration:** [`preactjs/create-preact`](https://github.com/preactjs/create-preact) (v0.5.3)
**Supersedes:** PR #190 (`fix(create-hono-preact): recover npm-stripped flags from npm_config_*`)
**Ancestry:** `docs/superpowers/specs/2026-05-21-create-hono-preact-cli-design.md` (the original flag-driven CLI)

---

## Problem

The current `create-hono-preact` is flag-driven: the adapter is chosen with
`--adapter=<cloudflare|node>` and there is no interactive flow. That design has
two problems.

1. **npm mangles bare flags.** `npm create` (an alias for `npm exec`) parses any
   long flag it does not recognize as its own config: it prints
   `npm warn Unknown cli config "--adapter"` and strips the flag before our
   binary runs. So `npm create hono-preact app --adapter=node` (no `--`
   separator) silently scaffolds the default cloudflare adapter. PR #190 added a
   `npm_config_*` env recovery so the bare flag still selects the right adapter,
   but that does not silence npm's warning (npm in fact emits a second
   `Unknown env config "adapter"` warning). The recovery fixes correctness, not
   the noise, and the `--` ritual is still required to avoid the warning. A
   published initializer has no hook to make npm forward a bare custom flag; the
   `--` requirement is universal to `npm create`/`npm exec` (create-vite and
   create-next-app document it too).

2. **The first impression is a flag, not a conversation.** Every comparable
   scaffolder (create-preact, create-vite, create-next-app) leads with an
   interactive wizard. A flag-only CLI is a worse new-user experience and is the
   only reason the npm `--` problem is ever hit.

The fix for both is the same: stop making a flag the primary way to choose the
adapter. An interactive wizard means the everyday command is flag-free, so npm
never sees a `--`, never warns, and the `--` annoyance disappears. Flags remain
for scripted and CI use, where `--` on npm is a deliberate, acceptable cost
(and pnpm, yarn, and bun never needed `--` at all; the issue is npm-only).

## Decision

Rebuild `create-hono-preact` as an interactive-first wizard modeled on
create-preact, using `@clack/prompts`. The wizard is the default experience;
command-line flags become a complete, documented scripted/CI path that also
keeps the CLI unit- and integration-testable. PR #190 is superseded: its intent
(never silently scaffold the wrong adapter) is satisfied because the adapter now
comes from a prompt or an explicit flag, and the `npm_config_*` recovery hack is
removed.

To make the new "UI components" option orthogonal to the adapter choice, the
on-disk templates move from two full per-adapter trees to create-preact's
**base + overlays** model.

## Scope

In scope:

- Interactive `@clack/prompts` wizard with five prompts (project directory,
  adapter, add UI components, install, git), each skipped when its value is
  supplied by a flag.
- A complete flag interface mirroring every prompt, plus `--yes` and
  non-interactive (no-TTY) behavior, so the CLI is scriptable, CI-safe, and
  testable.
- Template restructure to `base/`, `adapter/<cloudflare|node>/`, and
  `feature/ui/` overlays, with `package.json` fragments deep-merged.
- A `feature/ui` overlay that adds `hono-preact-ui` and a working `Dialog`
  sample in the home page.
- Rewritten CLI docs (`cli.mdx`, `quick-start.mdx`, root and package READMEs)
  around the interactive flow.
- Removal of the PR #190 `recoverNpmStrippedFlags` code path.

Out of scope (deliberate, may be revisited later):

- Additional non-adapter starters (auth, database, styling presets) beyond the
  single UI overlay.
- A JavaScript (non-TypeScript) template variant. The framework is TS-only;
  there is no language prompt.
- Routing/prerender/ESLint prompts (routing is core to the framework;
  SSG/ESLint are not part of the framework's offering).
- Installing dependencies at "latest" resolved versions. Template fragments stay
  version-pinned (see Template architecture).

## The wizard

Default invocation (`npm`/`pnpm`/`yarn`/`bun create hono-preact`), with an
optional positional directory:

```
◆  create-hono-preact
│
◇  Project directory ……………… my-app          (skipped if passed as an arg)
◇  Adapter ………………………………………… ❯ Cloudflare Workers
│                                  Node server
◇  Add hono-preact-ui components? … No
◇  Install dependencies now? ……… Yes
◇  Initialize a git repository? … Yes
│
◐  Scaffolding project…
◐  Installing dependencies…
│
▲  Next steps:   cd my-app   ·   pnpm dev
■  You're all set!
```

Prompt details:

| Prompt | clack control | Default | Skipped when |
| --- | --- | --- | --- |
| Project directory | `text` | (none, required) | a positional dir arg is present |
| Adapter | `select` | Cloudflare Workers | `--adapter` present |
| Add UI components | `confirm` | No | `--ui` or `--no-ui` present |
| Install dependencies | `confirm` | Yes | `--no-install` present |
| Initialize git | `confirm` | Yes | `--no-git` present |

- The directory prompt validates that the target does not already exist as a
  non-empty directory (current behavior; the existing-empty-dir case stays
  allowed).
- `intro`/`outro` use a hono-preact brand color via the existing `picocolors`
  dependency. Scaffolding and install run inside clack `spinner`s. A
  "Next steps" `note` prints unless `--skip-hints` is passed (so a wrapping
  initializer can suppress it, matching create-preact's `--skip-hints`).
- Cancelling any prompt (Ctrl-C) exits 0 with a "Cancelled" message.

## Flags and non-interactive behavior

```
create-hono-preact [dir] [options]
create-hono-preact add-agents [--force]      (unchanged)

Options:
  --adapter <cloudflare|node>   choose the deployment target
  --ui / --no-ui                include or exclude hono-preact-ui components
  --no-install                  skip dependency install
  --no-git                      skip git init
  -y, --yes                     accept defaults for anything not specified
  --skip-hints                  suppress the "Next steps" note
  -h, --help                    show usage
  -v, --version                 show version
```

Resolution rules:

- A flag value always wins over a prompt; its prompt is skipped.
- **TTY + missing value** -> prompt for it.
- **`--yes`, or no TTY (CI/piped)** -> never prompt; take flag values and these
  defaults: adapter `cloudflare`, ui off, install on, git on. A missing
  directory in non-interactive mode is a sharp error (`a project directory is
  required`), not a hang.
- `--adapter` accepts only `cloudflare` or `node`; anything else is a sharp
  error, as today.
- The `add-agents` subcommand and its `--force` flag are unchanged.

The `npm_config_*` recovery from PR #190 is **removed**. Scripted npm users pass
flags after `--` (`npm create hono-preact app -- --adapter node --yes`), which
is standard and documented; pnpm/yarn/bun do not need `--`.

## Template architecture

Today's `templates/cloudflare/` and `templates/node/` are about 90 percent
identical (shared `src/Layout.tsx`, `src/api.ts`, `src/pages/*`, `src/routes.ts`,
`tsconfig.json`). To make "UI" orthogonal to "adapter" without duplicating the UI
sample into both adapters, move to create-preact's base + overlays layout:

```
templates/
  base/                  shared app + base package.json
    _gitignore
    tsconfig.json
    package.json         common deps only (see below)
    src/Layout.tsx, src/api.ts, src/routes.ts
    src/pages/home.tsx, src/pages/home.server.ts, src/pages/about.tsx
  adapter/
    cloudflare/
      package.json       fragment: scripts.deploy, CF devDeps
      vite.config.ts     cloudflareAdapter()
      wrangler.jsonc
    node/
      package.json       fragment: scripts.start, node devDeps
      vite.config.ts     nodeAdapter()
  feature/
    ui/
      package.json       fragment: { dependencies: { "hono-preact-ui": "^0.2.0" } }
      src/pages/home.tsx demo home page that renders a Dialog (overwrites base)
  agents/                unchanged; copied into every project as today
```

Composition algorithm (`scaffold(targetDir, options)`):

In every copy step, `package.json` is treated as a fragment, not a plain file:
it is never copied or overwritten directly, only deep-merged in step 4. Every
other file copies normally, last-write-wins.

1. Copy `base/` into the target (every file except `package.json`).
2. Copy `adapter/<adapter>/` over it (every file except `package.json`; files
   win on collision).
3. If `options.ui`, copy `feature/ui/` over it (every file except
   `package.json`; its `home.tsx` overwrites the base one).
4. Build the final `package.json` by deep-merging the base `package.json` with
   each selected overlay's `package.json` fragment (nested objects merged,
   arrays/scalars replaced), then write it.
5. Rename `_gitignore` -> `.gitignore`, substitute `{{name}}` /
   `{{name_underscore}}` across the tree (existing `substituteName`).
6. Copy `agents/` guidance (existing `copyAgentGuidance`).

Notes:

- **Versions stay pinned in the template fragments**, co-located with the files
  that need them. This matches the "template pins track minor" release policy and
  avoids the "install latest -> drift/break" failure mode. No version map in code.
- Overlays never edit base files in place; they overwrite whole files
  (last-write-wins). No AST surgery. The only files an overlay overwrites are
  ones it fully owns (adapter: `vite.config.ts`; ui: `src/pages/home.tsx`), so
  there are no overlay-vs-overlay conflicts.
- `package.json` deep-merge is the one place fragments combine rather than
  replace; it is a small pure function with its own unit tests.

### Base vs overlay package.json split

- **base** `dependencies`: `hono`, `hono-preact`, `preact`, `preact-iso`.
  **base** `devDependencies`: `@preact/preset-vite`, `preact-render-to-string`,
  `typescript`, `vite`. **base** `scripts`: `dev`, `build`.
- **adapter/cloudflare** fragment: `scripts.preview`, `scripts.deploy`, devDeps
  `@cloudflare/vite-plugin`, `wrangler`.
- **adapter/node** fragment: `scripts.start`, devDeps `@hono/node-server`,
  `@hono/node-ws`.
- **feature/ui** fragment: dependency `hono-preact-ui`.

(Exact pinned versions are carried over from the current per-adapter
`package.json` files at implementation time and bumped to whatever the framework
ships at that release.)

## The UI overlay

`hono-preact-ui` (v0.2.0) is a single-barrel, headless primitives library with a
compositional `Dialog`. The overlay keeps the sample minimal and real:

- Adds `hono-preact-ui` to dependencies (peer `preact` is already present).
- Overwrites `src/pages/home.tsx` with a version that imports
  `Dialog, DialogTrigger, DialogPopup, DialogTitle, DialogClose` from
  `hono-preact-ui` and renders a working "Open dialog" button plus a small amount
  of CSS so the headless primitive looks intentional.

No routes change (the demo lives in the existing home route), so the overlay is a
single file overwrite plus a one-line dependency fragment. When UI is off, the
base `home.tsx` (no UI import) is used unchanged.

## Code structure

A thin `@clack/prompts` shell at the edge over a pure, injectable core, preserving
the current testing approach (`run()` already accepts an injectable `prompt`).

- `lib/args.mjs`, `parseArgs(argv)` -> a partial-intent object plus flag
  booleans. New flags (`--ui`/`--no-ui`, `--yes`, `--skip-hints`). This branch
  is off pre-#190 `main`, so there is no recovery code to remove; PR #190 is
  simply superseded and never merged.
- `lib/prompts.mjs`, `@clack/prompts` wizard: `resolveOptions(partial, { isTTY,
  prompt })` returns fully-resolved options, prompting only for fields not
  supplied by flags and only when interactive; plus `intro`/`outro`/`spinner`
  helpers. The prompt surface is injectable so unit tests pass stubs and never
  touch a real TTY.
- `lib/scaffold.mjs`, `scaffold(targetDir, options)`: base + overlay copy,
  `package.json` deep-merge, dotfile rename, name substitution. Pure file IO,
  no prompts.
- `lib/template.mjs`, existing copy/rename/substitute/agent-guidance helpers,
  extended with the deep-merge and overlay-copy primitives.
- `lib/detect-pm.mjs`, unchanged.
- `lib/cli.mjs`, orchestrator: `parseArgs` -> `resolveOptions` (prompt if TTY)
  -> `scaffold` -> install -> git init -> next-steps note/outro. Install and git
  keep using `node:child_process` `spawn` (the existing injectable `spawnFn`).
- `lib/*.d.mts`, hand-authored declarations updated for the new/changed exports.

## Dependencies

- **Add** `@clack/prompts` (the prompt toolkit; same one create-preact uses).
- **Keep** `picocolors` for color (no `kolorist`).
- **Keep** `node:child_process` `spawn` for install/git (no `tinyexec`).

So the net new runtime dependency is `@clack/prompts` only. `create-hono-preact`
is a standalone CLI package and is not part of the `@hono-preact/*` framework
umbrella, so no umbrella/`--filter` wiring is required.

## Testing strategy

TDD throughout, mirroring the current `__tests__/` layout:

- `args.test.ts`, `parseArgs`: new flags, `--yes`, `--ui`/`--no-ui`, the
  unchanged `add-agents` path, and error cases (unknown adapter, unknown flag).
- `resolve.test.ts` (new), `resolveOptions` with stubbed prompts and an `isTTY`
  toggle: prompts fire only for missing fields; `--yes` and non-TTY skip all
  prompts and apply defaults; flag values override; missing dir in non-TTY
  errors.
- `merge.test.ts` (new), the `package.json` deep-merge: nested objects merge,
  scalars/arrays replace, base untouched when no fragment.
- `cli.test.ts`, `run()`/`scaffold()` integration across the adapter x ui
  matrix: cloudflare vs node files (e.g. `wrangler.jsonc` presence), ui on adds
  `hono-preact-ui` to the written `package.json` and a `Dialog` import in
  `home.tsx`, ui off does neither; install/git spawn behavior via the injected
  `spawnFn`.
- `scaffold-integration.test.ts`, the existing PR-time "scaffold then build each
  adapter" test, extended to also build a `--ui` variant so a UI scaffold is
  proven to typecheck and build.
- A manual real `npm create` smoke check confirming the flag-free path prompts
  and the no-`--` warning is gone.

All eight pre-push CI steps (build, gen:agents-corpus, format:check, typecheck,
test:types, test:coverage, test:integration, site build) must pass, per
`CLAUDE.md`.

## Rollout

- Build this on the `worktree-create-cli-interactive` branch (off `main`),
  separate from the PR #190 branch.
- Close PR #190 as superseded once this lands (keep its branch for reference).
- The package stays published as `create-hono-preact`, lockstep-versioned with
  `hono-preact` on minor/major per the release policy; this redesign ships with
  the next minor.
- Docs (`apps/site/src/pages/docs/cli.mdx`, `quick-start.mdx`, root `README.md`,
  `packages/create-hono-preact/README.md`) are rewritten around the wizard, with
  the flag table kept for the scripted/CI path. Regenerate the bundled agents
  corpus (`pnpm gen:agents-corpus`).

## Risks and mitigations

- **clack non-TTY behavior.** clack prompts assume a TTY. Mitigation: gate all
  prompting on `process.stdout.isTTY` (and `--yes`) in `resolveOptions`, so CI
  and piped invocations resolve from flags/defaults and never block. Covered by
  `resolve.test.ts`.
- **package.json deep-merge correctness.** A bad merge could drop deps or scripts.
  Mitigation: isolate it as a small pure function with dedicated unit tests, and
  prove the result builds via the extended integration test.
- **Template restructure regressions.** Moving to base + overlays touches every
  template file path. Mitigation: the adapter x ui integration matrix asserts the
  exact file set and a real build per combination, which the current single
  per-adapter test already does for two of those combinations.
