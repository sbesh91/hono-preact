# hono-preact

## Tooling notes for AI agents

**Serena MCP is configured** (see `.mcp.json`). It is an optional aid, not a mandate. `rg`/`grep` + Read + Edit is the default for code navigation and edits, and is fine for definitions, call-site spot checks, prose, config, and one-offs on a codebase this size.

Reach for Serena in the one place it clearly beats grep: **renaming or changing the signature of an exported symbol**, where missing a call site is a real bug. `find_referencing_symbols` enumerates the actual call sites and skips the textual noise (re-exports, doc strings, same-named locals) a grep would make you hand-filter; `rename_symbol` rewrites them on the symbol graph. `find_symbol` / `get_symbols_overview`, and the `replace_symbol_body` / `insert_before_symbol` / `insert_after_symbol` edits, are there when you want them. Serena's tools are deferred: load them once per session with `ToolSearch` (`select:mcp__serena__find_referencing_symbols,mcp__serena__rename_symbol`), then call them.

A `PreToolUse` hook (`.claude/hooks/prefer-serena.py`) nudges toward Serena only when a search looks like the front half of a textual refactor (an `rg`/`grep` feeding a shell mutator like `sed -i`); ordinary read/measure searches pass silently.

Serena binds to the primary checkout (`--project .`), so it is unavailable in worktrees (see Worktree setup below) and when the MCP server is down (run `/mcp` to check). Fall back to native tools in both cases.

## Site brand

[`apps/site/BRAND.md`](apps/site/BRAND.md) is the source of truth for the docs site's brand: ideology, voice, visual doctrine, and the mapping to the tokens in `apps/site/src/styles/root.css`. Read it before any work that changes what a site visitor sees or reads (page design, components, CSS, copy), and verify against its checklist before shipping.

## Worktree setup

When feature work runs in a fresh `git worktree`, the worktree shares tracked files but starts without the gitignored local state and build artifacts this monorepo needs. Run `pnpm wt:setup` (i.e. `bash scripts/worktree-setup.sh`) from inside the new worktree to bring it up: it copies `.env` and `.claude/settings.local.json` from the primary checkout, runs `pnpm install`, builds the framework `dist/`, and runs `pnpm typecheck`. Add `-- --test` to also run the unit suite (`pnpm wt:setup -- --test`).

Two caveats the script cannot fix for you:

- **Serena stays on the main checkout.** `.mcp.json` launches Serena with `--project .`, which binds to the primary checkout, so Serena keeps indexing main even while you work in the worktree. There is no in-session re-point tool. In a worktree, use `rg`/Read/Edit and do **not** use Serena's symbol/edit tools (they resolve paths against main, so an edit would land in the wrong tree). Re-pointing Serena needs an MCP restart against the worktree path, only worth it for large structural refactors.
- **It is not auto-run.** Creating a worktree (e.g. via `EnterWorktree`) does not trigger setup; run `pnpm wt:setup` as the explicit next step.

`.wrangler/` is intentionally not copied: it is local Cloudflare emulation state that regenerates on `wrangler dev`, and a stale copy is worse than a cold start.

## Pre-push verification

Before `git push` (especially before opening a PR), run the same checks CI runs, in the same order CI runs them. Skipping any of these means CI catches a failure you should have caught locally, which wastes a round-trip.

The CI pipeline lives in `.github/workflows/ci.yml`. Mirror it locally:

1. `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build` (framework dist must be current; `pnpm typecheck` and `apps/site` resolve cross-package types through the published `dist/`, so stale dist surfaces as fake "missing export" errors).
2. `pnpm gen:agents-corpus` (regenerates the bundled docs corpus the scaffolder ships into `templates/agents/llms-full.txt`; the corpus-presence gate and the scaffold copy test read it. It is gitignored, so a stale or missing file is a local-only failure that CI would also catch).
3. `pnpm format:check`
4. `pnpm typecheck`
5. `pnpm test:types` (vitest typecheck mode; runs the `*.test-d.ts` type-level assertions that the package `tsconfig`s exclude from `pnpm typecheck`).
6. `pnpm test:coverage` (or `pnpm test` if coverage isn't needed locally).
7. `pnpm test:integration`
8. `pnpm --filter site build`

If `format:check` fails, run `pnpm format` to fix and commit the result. Do not push commits that you have not personally seen pass these eight steps. The single biggest miss is `format:check`, which is fast to run and trivially fixable, but reliably forgotten.

Lighthouse runs in **CI only** and is deliberately **not** part of the eight steps above (it builds, serves the worker with `wrangler dev`, and drives Chrome, far too slow for a pre-push gate). The PR-only `lighthouse` job posts a soft sticky comment, reading its baseline from the `metrics` branch; the `main` push job pushes the `lighthouse-report.json` / `lighthouse-history.jsonl` / `lighthouse-badge.json` baselines to the dedicated orphan `metrics` branch (never to `main`), and the README badge reads `lighthouse-badge.json` from that branch. This keeps `main` history free of automated metric commits. Tooling: `@lhci/cli` (root devDependency); config in `.lighthouserc.json`; extraction and rendering in `scripts/measure-lighthouse.mjs` and `scripts/render-lighthouse-comment.mjs` (unit-tested under `scripts/__tests__/`). The LHCI flow needs two uploads: `temporary-public-storage` (hosted report links) and `filesystem` (writes the `.lighthouseci/manifest.json` the extractor parses). Client JS size (framework runtime per feature plus UI components) is tracked by the PR-only `client-size` job. It builds the framework on the PR head and on the base ref (in a `git worktree`), measures each with `scripts/measure-framework-size.mjs` (isolated esbuild bundles, peers external, gzip, marginal over core / ui-core), and posts a curated sticky comment via `scripts/render-framework-size-comment.mjs`. The same job also builds `apps/site` on both refs and measures the real always-loaded baseline (the entry chunk plus its static-import closure: what every route ships) via `scripts/measure-site-chunks.mjs`, rendered as a "Docs-site shipped JS" section, this is the shipped-reality number the isolated probe cannot show. There is no committed size baseline: the job diffs head versus base live, so nothing is committed on `main`.

## Deploying the docs site

The docs site (`framework.sbesh.com`, a Cloudflare Worker) deploys **only on release-tag pushes**, never on a push to `main`. The live site is meant to match the latest *published* version, not unreleased `main`. The single deploy path is `.github/workflows/deploy-docs.yml`, which triggers on:

- `v*.*.*` tags (pushed by `pnpm release` for `hono-preact` / `create-hono-preact`),
- `hono-preact-ui@*` tags (pushed by `pnpm release:ui`),
- manual `workflow_dispatch` (urgent docs/infra fix between releases; deploys current `main` HEAD).

So a normal merge to `main` does **not** update the live site; the docs ship with the next version cut. Two prerequisites are operator-managed outside the repo: the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets, and Cloudflare Workers Builds auto-deploy being **disabled** (if it is ever re-enabled, every `main` push deploys again and defeats the gate).

Pull requests get a **preview deploy** via the `preview` job in `.github/workflows/ci.yml`. It runs a real `wrangler deploy` to a **dedicated per-PR `hono-preact-preview-pr-<N>` worker** (keyed by PR number, not the production `hono-preact` script), served at that worker's stable `*.workers.dev` URL and posted as a sticky `preview-docs` PR comment that updates on every push. Previews never touch the live `framework.sbesh.com` deployment or its route, and reuse the existing `CLOUDFLARE_API_TOKEN` (the deploy needs only Workers Scripts: Edit, not the zone Workers Routes permission the production deploy needs).

Two Cloudflare constraints shape this design, both caused by the realtime **Durable Object** (`HonoPreactRealtimeDO`):

- **No `wrangler versions upload` + `--preview-alias`.** Cloudflare does not generate preview URLs for Workers that use Durable Objects, so the per-branch non-active-version model produces no URL at all. The job therefore does a real (active) deploy and reads the worker's `*.workers.dev` URL.
- **The deploy must strip the custom_domain route.** The generated `dist/hono_preact/wrangler.json` carries the `framework.sbesh.com` route; the job writes a routes-stripped copy (`jq 'del(.routes)'`, alongside the original so wrangler still resolves `main`/`assets`) and deploys that, so the preview can never claim the production domain.

A real deploy applies the DO migration itself, so **no manual seeding is needed** (the first push on a new PR creates that PR's worker and applies the migration). Each PR gets its **own** worker (`hono-preact-preview-pr-<N>`), so concurrent PRs no longer share a URL. Teardown lives in **`.github/workflows/preview-cleanup.yml`**, a separate workflow triggered on `pull_request: [closed]` (merge and plain close both fire `closed`) that runs `wrangler delete` on the PR's worker; it is intentionally not in `ci.yml` so the full test matrix does not run on close. GitHub Actions sets `CI=true`, so the `wrangler delete` runs non-interactively (auto-confirms, no TTY to hang on), and a `|| echo` swallows the "worker not found" case for PRs that never deployed a preview. If a close-time teardown is ever missed (transient error, skipped run, or a straggler deploy that recreated the worker just after close), the orphaned worker counts against the account's worker cap. **`.github/workflows/preview-sweeper.yml`** is the backstop: a weekly (plus `workflow_dispatch`) reconciler that lists every `hono-preact-preview-pr-*` worker, checks the owning PR via the GitHub API, and deletes any whose PR is closed. Because it only ever reaps workers for closed PRs (which are not deploying), it is race-safe and needs no coordination with the teardown or deploy jobs. The three wrangler pins (deploy in `ci.yml`, teardown in `preview-cleanup.yml`, sweep in `preview-sweeper.yml`) move in lockstep with the `apps/site` wrangler dep.

## PR workflow

Any time a PR is opened, immediately run a deep PR review as the first follow-up step (before any other post-open work). A `PostToolUse` hook (`.claude/hooks/pr-review-reminder.sh`) injects this reminder after a successful `gh pr create`.

The review checklist is canonical in [`REVIEW.md`](REVIEW.md) at the repo root. It reviews from a seasoned framework-developer stance across six lenses (performance, maintainability, effective testing, modularity, bundle size, effective use of web platform features) plus the repo-specific must-checks: replacement parity, cross-cutting concerns end-to-end (a silently dropped auth/permission middleware layer is a P0 that blocks merge), the public-API/breaking-change surface (including breaking changes invisible in the export-surface diff), and docs sync. Follow `REVIEW.md` for every review, and edit it (not this section) when the criteria change.

## Type casts

When the code needs a cast, the cast is usually the smell. Prefer reshaping the type. Apply this when writing plans too, not just when writing code; a cast prescribed in a plan ships as a cast unless someone notices. Common reshapes that come up here:

- **`as Record<symbol, unknown>` to read a symbol-keyed property**: declare the symbol key on the value's type and use `in` narrowing or a type predicate.
- **`as <StatusCode>` to widen a literal**: type the source field as the wider type from the start (e.g. `SerializedEnvelope.status: ContentfulStatusCode`).
- **`as T` after a runtime check**: write the check as a type predicate (`function isT(x): x is T`) so narrowing carries through.

Acceptable cast boundaries (where reshape doesn't help): parsing untrusted JSON, reading FormData entries, structural reads off user-defined module exports. Don't fight these.
