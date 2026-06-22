# Curated framework-size PR comment

## Problem / context

PR #149 replaced the home-rolled client-size tooling with `preactjs/compressed-size-action`. The action works, but its PR comment is a generic flat table of every emitted file (127 rows: ~110 hashed site-page chunks plus 17 framework/component probes, `| Filename | Size |`). The framework and component module sizes (the thing we actually want to track) are buried among the site chunks, shown with full-path filenames, ungrouped, and as per-feature totals rather than marginal-over-core. The action has no formatting levers beyond which files to include, so it structurally cannot produce a grouped, curated view.

The rethink: stop trying to make a generic file-size differ produce a framework-module report. Restore a curated comment that we own, scoped to exactly the framework + component module sizes, with a delta mechanism that does not reintroduce the committed-baseline merge conflicts that bit PR #149 repeatedly.

## Decisions (locked during brainstorming)

- **Scope: framework + component modules only.** Report the framework runtime per feature (old Section A) and per UI component (old Section C). Drop the site-page chunk view (old Section B) entirely.
- **Presentation: a curated sticky comment we own.** Two grouped tables ("Framework runtime (gzip)" and "Components (gzip)"), clean names, `core`/`ui-core` shown as totals and each feature/component shown as marginal-over-core / marginal-over-ui-core, with a `Δ vs base` column. Remove `compressed-size-action`.
- **Delta: build both refs in the PR job.** Build the framework and measure on the PR head, then on the base ref (`origin/<base>`), and diff live. No committed baseline file, no main-push bookkeeping commit, no history file. This avoids the recurring modify/delete merge conflicts.
- **Reuse the probe manifests.** `scripts/size-probe-config.mjs` stays as the single source of which modules form each row. Measurement is in-memory (gzip in the script); the probe-*file* emitter (`emit-size-probes.mjs`) and the action both go away.
- gzip only (brotli stays dropped). The committed-baseline and history files stay deleted.

## Components

### `scripts/size-probe-config.mjs` (kept as-is)

Exports the manifests already present from PR #149: `CORE_MODULES`, `FEATURE_MODULES`, `EXTERNAL`, `UI_CORE_MODULES`, `COMPONENT_MODULES`. Unchanged.

### `scripts/measure-framework-size.mjs` (new; recover A/C from the deleted `measure-client-size.mjs`)

In-memory measurement of Sections A and C. The relevant logic exists in git history at `2587733:scripts/measure-client-size.mjs` (recover and trim, dropping Section B, brotli, history, and the committed-report shape).

Interfaces:

- `bundleSize(entryContents: string, resolveDir: string): Promise<{ raw: number, gzip: number }>` — esbuild stdin bundle (`bundle:true, minify:true, format:'esm', platform:'browser', write:false, external: EXTERNAL, legalComments:'none', logLevel:'silent'`), gzip via `node:zlib` `gzipSync`. (Same options as the deleted script, so numbers stay comparable.)
- `entryFor(modules: string[], distBase: string): string` — namespace re-exports (`export * as mN from '<distBase>/<module>'`) so `sideEffects:false` cannot tree-shake. `distBase` is an absolute path, so the entry can point at any ref's dist.
- `measureSectionA(isoDist: string): Promise<Record<string, { total: number, marginal: number }>>` — `core` plus each `FEATURE_MODULES` bucket. `total` = gzip of the bucket's isolated bundle; `marginal` = `max(0, gzip(core+feature) − gzip(core))`. `core.marginal === core.total`.
- `measureSectionC(uiDist: string): Promise<Record<string, { total: number, marginal: number }>>` — `ui-core` plus each `COMPONENT_MODULES` entry, `marginal` over `ui-core`. Returns `{}` when `uiDist` does not exist (partial-build safe).
- `buildReport({ isoDist, uiDist }): Promise<{ sectionA, sectionC }>`.
- CLI: `node scripts/measure-framework-size.mjs [--iso-dist <dir>] [--ui-dist <dir>] [--out <file>]`. Defaults: absolute paths to local `packages/iso/dist` and `packages/ui/dist`; writes JSON to `--out` (or stdout). The `--iso-dist`/`--ui-dist` args are what let the same HEAD script measure a base worktree's dist.

Report shape (gzip bytes):

```json
{
  "sectionA": { "core": { "total": 4063, "marginal": 4063 }, "loaders": { "total": 6789, "marginal": 1331 }, "...": {} },
  "sectionC": { "ui-core": { "total": 1454, "marginal": 1454 }, "dialog": { "total": 947, "marginal": 947 }, "...": {} }
}
```

### `scripts/render-framework-size-comment.mjs` (new; recover A/C from the deleted `render-size-comment.mjs`)

Pure renderer. Logic exists at `2587733:scripts/render-size-comment.mjs` (recover and trim to Sections A and C; drop Section B).

- `renderComment(fresh, base, meta?): string` — markdown with a hidden `<!-- framework-size -->` header marker, title `## Framework JS size`, then:
  - `### Framework runtime (gzip)` table `| Feature | Size | Δ vs base |`. `core` row shows `total`; every other feature shows `marginal`. Δ = `fresh − base` for the displayed number.
  - `### Components (gzip)` table `| Component | Size | Δ vs base |`, same total/marginal rule over `ui-core`.
- `fmtBytes(n)` (1000-based KB, raw bytes under 1000), `fmtDelta(fresh, base)` rendering `+1.2 KB` / `-340 B` / `—` (unchanged) / `(new)` (absent from base) / `(removed)`.
- Optional freshness footer (sha / generatedAt / run URL) from env, mirroring the old renderer.
- CLI: `node scripts/render-framework-size-comment.mjs <fresh.json> <base.json>`.

### `.github/workflows/ci.yml` — `client-size` job (rewritten, build-both)

PR-only job (`if: github.event_name == 'pull_request'`, `needs: test`, `permissions: contents: read` + `pull-requests: write`):

1. `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` (`cache: pnpm`), `pnpm install --frozen-lockfile`.
2. Build framework on HEAD: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`.
3. Measure HEAD: `node scripts/measure-framework-size.mjs --out /tmp/head.json`.
4. Base ref (build both): `git fetch origin "$BASE"` then `git worktree add /tmp/base "origin/$BASE"`; in `/tmp/base` run `pnpm install --frozen-lockfile` and the framework build; then, from the HEAD checkout, measure the base dist with HEAD's script: `node scripts/measure-framework-size.mjs --iso-dist /tmp/base/packages/iso/dist --ui-dist /tmp/base/packages/ui/dist --out /tmp/base.json`. `$BASE` = `github.event.pull_request.base.ref` (e.g. `main`). The measure script is always HEAD's, so there is no "base lacks the script" bootstrap failure (the bug that sank the compressed-size-action approach).
5. Render: `node scripts/render-framework-size-comment.mjs /tmp/head.json /tmp/base.json > /tmp/comment.md` (with `SIZE_COMMENT_SHA` / run-URL env for the footer).
6. Post sticky comment: `marocchino/sticky-pull-request-comment@v2`, `header: framework-size`.

### `.github/workflows/ci.yml` — `main` / `build-and-tag` job

No change. PR #149 already removed the client-size baseline step; build-both adds no main-push work, so the main job stays lighthouse-only.

## Net branch changes (vs current PR #149 HEAD)

Rework PR #149 on the same branch (`worktree-oss-bundle-size`); do not open a new PR.

- **Remove:** the `compressed-size-action` job; `scripts/emit-size-probes.mjs` + its test; the `package.json` `build`-script probe-emit append (restore `build` to framework + site only, as on `main`); the strip-hash / no-strip-hash / build-script doc comments in `ci.yml`.
- **Add:** `scripts/measure-framework-size.mjs` + test; `scripts/render-framework-size-comment.mjs` + test; the build-both `client-size` job.
- **Keep:** `scripts/size-probe-config.mjs`; the standing deletions of `client-size-report.json`, `client-size-history.jsonl`, and the old `measure-client-size.mjs` / `render-size-comment.mjs` / `client-size-config.mjs`.
- **Update:** `CLAUDE.md` to describe the build-both curated comment (replacing the compressed-size-action description).

## Testing

- **`measure-framework-size`:** smoke tests requiring built dist (CI builds the framework before the test job): `bundleSize` returns positive gzip for a real iso module and a tiny shim for an external peer (peers genuinely excluded); `measureSectionA` returns `core` plus every feature with non-negative `marginal`; `measureSectionC` returns `ui-core` plus components when `packages/ui/dist` exists, and `{}` (guarded) when it does not.
- **`render-framework-size-comment`:** pure-function fixture tests over report pairs: unchanged → `—`, increase → `+X`, decrease → `-X`, new bucket → `(new)`, removed bucket → `(removed)`; assert the rendered markdown for both sections.
- The build-both CI flow is validated by the live run on the reworked PR (the first run will show real head-vs-base deltas, since base `main` will be measured by HEAD's script).

## Out of scope (YAGNI)

- Site-page chunk tracking (old Section B) — dropped.
- Committed baseline and history file — dropped (build-both makes them unnecessary).
- brotli in the comment — gzip only.
- `compressed-size-action` and the on-disk probe files — removed.
