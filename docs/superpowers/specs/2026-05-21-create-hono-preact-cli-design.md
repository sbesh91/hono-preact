# `create-hono-preact` scaffold CLI

**Date:** 2026-05-21
**Status:** design, approved
**Issue:** [#47](https://github.com/sbesh91/hono-preact/issues/47)
**Ancestry:** `docs/superpowers/plans/2026-05-14-v0.1-launch.md` (Task 27)

---

## Problem

The framework ships a published umbrella package (`hono-preact@0.1.0`) and a
docs site with a copy-paste quick-start, but no `npm create` / `pnpm create`
entry point. A new user must clone an example or hand-assemble seven-plus files
before `pnpm dev` runs. Once the four-file shape settled across v0.1, a scaffold
became the obvious first impression for npm-create users.

## Decision

Ship a new package `packages/create-hono-preact`, published as
`create-hono-preact`, that copies a minimal working app into a target
directory, installs dependencies, and prints next steps.

The CLI is plain Node ESM (no build step), supports both shipped adapters via
a single `--adapter` flag, and mirrors `apps/example-node`'s minimal-demo
shape so the first `pnpm dev` exercises the framework's loader pattern.

## Scope

In scope (v1):

- One CLI binary, one positional arg (target dir), four flags.
- Two adapter-specific template trees on disk.
- Detect package manager from `npm_config_user_agent`; install + `git init`
  by default, opt-out flags for each.
- Integration test that scaffolds + builds each adapter at PR time.

Explicit out of scope (v1), all deliberate:

- Multiple non-adapter template variants (auth starter, db starter, styling
  presets, etc.).
- Interactive prompts beyond the target directory name.
- Updating an existing directory in place / `--force` overwrite.
- Telemetry, analytics, or version-check pings.
- Auto-syncing templates from `apps/example-node`; templates are checked-in
  duplicates and CI catches drift.

## CLI surface

```
npm create hono-preact <target-dir> [--adapter=<cloudflare|node>] [--no-install] [--no-git]
pnpm create hono-preact <target-dir> [--adapter=...] ...
```

| Arg / flag         | Default       | Behavior                                              |
| ------------------ | ------------- | ----------------------------------------------------- |
| `<target-dir>`     | (prompted)    | Positional. Prompted via `node:readline` if omitted.  |
| `--adapter=<id>`   | `cloudflare`  | Picks the template tree. `cloudflare` or `node`.      |
| `--no-install`     | install       | Skip the package-manager install step.                |
| `--no-git`         | `git init`    | Skip `git init` in the new directory.                 |
| `--help`           | n/a           | Print usage and exit 0.                               |
| `--version`        | n/a           | Print version and exit 0.                             |

Unknown flags: print usage and exit 2. The CLI is intentionally tiny; no
sub-commands.

## Runtime flow

1. Parse argv. Prompt for target dir if absent.
2. Validate target: refuse if path exists and is non-empty (clear error,
   exit 1). Empty existing directories are accepted.
3. `fs.cp` from `templates/<adapter>/` into the target directory.
4. Rename `_gitignore` → `.gitignore`. (Standard create-* trick: npm and
   pnpm filter dotfiles from the published tarball, so the template ships
   with the underscore-prefixed name.)
5. Substitute the `{{name}}` placeholder in `package.json` (and
   `wrangler.jsonc` for Cloudflare) with the target directory's basename.
   Plain string replace, no template engine.
6. Detect the package manager from `npm_config_user_agent`
   (`npm`/`pnpm`/`yarn`/`bun`). Default to `pnpm` if undetectable.
7. Unless `--no-install`: spawn `<pm> install` in the target dir with
   `stdio: 'inherit'`. Non-zero exit aborts the rest of the flow.
8. Unless `--no-git`: spawn `git init` in the target dir. Non-zero exit
   prints a warning but does not abort (git may be absent).
9. Print colorized "Next steps:" with the dev command for the detected PM
   (e.g. `cd my-app && pnpm dev`).

## Template content

Both adapter trees mirror `apps/example-node`'s minimal demo: a Layout, a
home page with a `defineLoader` example, and an about page. This gives the
first `pnpm dev` a working loader pattern rather than a blank screen.

### Shared (both adapters)

| File                          | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `package.json`                | `name: "{{name}}"`, `type: module`, scripts, deps.       |
| `tsconfig.json`               | Preact JSX, ESNext module, moduleResolution bundler.     |
| `vite.config.ts`              | Adapter-specific import + `honoPreact({ adapter })`.     |
| `_gitignore`                  | `node_modules`, `dist`, `.DS_Store` (CF adds `.wrangler/`). |
| `README.md`                   | 15 lines: dev/build/deploy + link to framework docs.     |
| `src/api.ts`                  | Empty `Hono()` + `GET /healthz` + comment → `/docs/hono-middleware`. |
| `src/Layout.tsx`              | `<Head defaultTitle="{{name}}" />` + `<ClientScript />`. |
| `src/routes.ts`               | `/` (with `home.server`) and `/about`.                   |
| `src/pages/home.tsx`          | `serverLoaders.default.View(...)` + `definePage`.        |
| `src/pages/home.server.ts`    | One `defineLoader` returning a greeting + timestamp.     |
| `src/pages/about.tsx`         | Plain page with a link back to home.                     |

### Cloudflare-specific

- `wrangler.jsonc` with `name: "{{name}}"`,
  `main: "node_modules/.vite/hono-preact/server-entry.tsx"`,
  `compatibility_date`, `compatibility_flags: ["nodejs_compat"]`,
  `assets.directory: "./dist/client"`.
- `package.json` devDeps add `@cloudflare/vite-plugin`, `wrangler`.
- `package.json` scripts add `deploy`, `preview`.
- `_gitignore` includes `.wrangler/`.

### Node-specific

- No `wrangler.jsonc`.
- `package.json` devDeps add `@hono/node-server`.
- `package.json` scripts add `start: "node dist/server/server-entry.js"`.
- No `@hono/node-ws` in v1 (WebSocket support is documented; users add the
  dep themselves when they need it).

### Version pinning

The template's `package.json` uses caret ranges on the framework and the
npm-registry peers (`hono-preact: "^0.1.0"`, `hono: "^4.12.14"`,
`preact: "^10.29.1"`). Standard npm convention; matches `create-vite`,
`create-next-app`. Pre-1.0 risk that a minor with a behavior change
auto-rolls forward on `pnpm install` is accepted; docs and CI will catch
real breakage.

One special case: `preact-iso` is not published to npm at the version the
framework targets (v3). The working examples and the root `package.json`
pin it to `github:preactjs/preact-iso#v3`. The template carries the same
github URL. When preact-iso v3 publishes to npm, switch the template to
a caret range in a follow-up. (Background: issue #32, memory file
`project_pnpm11_preact_iso_v3.md`.)

The exhaustive devDep set per adapter is derived by mirroring
`apps/example-node` (Node) and minimizing `apps/site` to its
adapter-essential set (Cloudflare). The implementation plan locks the
list with the integration test: scaffold + install + build must pass
with no missing peers.

## Package layout

```
packages/create-hono-preact/
  bin/
    index.mjs                  # plain Node ESM CLI, shebanged
  templates/
    cloudflare/
      _gitignore
      package.json
      tsconfig.json
      vite.config.ts
      wrangler.jsonc
      README.md
      src/
        api.ts
        Layout.tsx
        routes.ts
        pages/
          home.tsx
          home.server.ts
          about.tsx
    node/
      _gitignore
      package.json
      tsconfig.json
      vite.config.ts
      README.md
      src/
        api.ts
        Layout.tsx
        routes.ts
        pages/
          home.tsx
          home.server.ts
          about.tsx
  package.json
  README.md
```

### `packages/create-hono-preact/package.json`

- `name: "create-hono-preact"`, `version: "0.1.0"`, `type: "module"`.
- `bin: { "create-hono-preact": "./bin/index.mjs" }`.
- `files: ["bin", "templates"]` — only those ship to npm.
- `engines.node: ">=20"` (matches the umbrella).
- `dependencies: { "picocolors": "^1.1.1" }` — only runtime dep.

## Implementation shape

Plain JS ESM in `bin/index.mjs`. No TypeScript, no bundler, no build step.
Uses `node:fs`, `node:child_process`, `node:readline`, `node:path`, and
`picocolors` for terminal styling. Total source under ~200 LoC.

Trade-off accepted: doesn't match the TypeScript convention of the other
framework packages. The package's payload is mostly static template files,
not code; types pay little dividend on `fs.cp` + `spawn` + `readline`.

## Maintenance and CI

Two layers, gated on existing pool boundaries:

1. **Default pool (every PR).** A unit-level vitest file under
   `packages/create-hono-preact/src/__tests__/scaffold.test.ts` (or
   sibling location consistent with repo conventions) that, for each
   adapter:
   - Runs the CLI into a fresh `os.tmpdir()` subdirectory with
     `--no-install --no-git`.
   - Asserts the expected file tree (presence + dotfile rename).
   - Asserts `{{name}}` substitution happened in `package.json` and (CF)
     `wrangler.jsonc`.

2. **Integration pool (`pnpm test:integration`).** A scaffold + install +
   build test under `vitest.integration.config.ts`. For each adapter:
   - Scaffold without install, then `pnpm install --prefer-offline`
     against the workspace's local `hono-preact`.
   - Run `pnpm build` and assert exit 0.
   - Assert expected output: `dist/client/` for both. For Cloudflare,
     the Worker bundle dir is derived from `wrangler.jsonc`'s `name`
     with hyphens converted to underscores, so for a target dir
     `my-test-app` expect `dist/my_test_app/`. For Node, expect
     `dist/server/server-entry.js`.

Drift between the templates and the framework's actual API surfaces
fails the integration suite at PR time.

## Publishing

Add `create-hono-preact` to the publish surface. The umbrella's current
publish flow does not include this package; the v1 plan is a manual
`pnpm publish --filter create-hono-preact` step. Folding it into a release
workflow is deferred (no internal deps means no `workspace:*` rewriting,
so the publish is trivially clean).

## Open questions

None remaining at design time. Implementation plan can proceed.
