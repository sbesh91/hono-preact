# Client JS size tracking in PRs

**Status:** Approved (design) — 2026-06-01

## Problem

We have no automated visibility into how the client JavaScript we ship changes
PR-to-PR. We want two things:

1. **Framework runtime cost per feature** — what does a consumer pay, in client
   bytes, to opt into loaders vs. actions vs. view transitions vs. each other
   feature? This should be independent of the demo site's content.
2. **Site bundle size** — the real-world `apps/site` client bundle, broken down
   into logical buckets, as a proxy for a real app.

Both should surface on every PR so size regressions are caught in review, with
soft (non-blocking) budgets so the numbers inform rather than gate.

## Decisions (locked during brainstorming)

- Measure **both** sections, reported separately in one PR comment.
- Surface as a **sticky PR comment** with **soft budgets** (overages flagged
  with `⚠️`, never fail CI).
- Derive per-feature numbers from **isolated per-feature entry bundles**
  (esbuild, peers external), not chunk-name mapping or fixture apps.
- Reporting machinery is a **custom script we own** + a sticky-comment action
  (Approach A), not `size-limit`.
- Base-branch comparison uses a **committed baseline snapshot**
  (`client-size-report.json` at repo root), diffed against the fresh build. No
  second (base-ref) build in CI.
- `middleware` and `head` are tracked as **their own buckets**, not folded into
  `core`, so each opt-in cost is visible.

## Section A — Framework runtime cost per feature

A manifest defines one measurement entry per feature. Each entry imports the
public surface of that feature from `packages/iso/dist/*` (the published,
tree-shaken output — `sideEffects: false` is already set on iso, so this
reflects what a consumer actually pulls in).

| Bucket        | Imports from `packages/iso/dist`                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `core`        | `define-app`, `define-routes`, `define-page`, `page`, `client-script`, `route-change`, `is-browser`                               |
| `loaders`     | `define-loader`, `cache`                                                                                                           |
| `actions`     | `action`, `form`, `optimistic`, `optimistic-action`, `outcomes`, `action-result-context`, `use-action-result`, `use-form-status` |
| `transitions` | `view-transition-lifecycle`, `view-transition-name`, `view-transition-types`                                                      |
| `prefetch`    | `prefetch`                                                                                                                         |
| `streaming`   | `define-stream-observer`                                                                                                           |
| `head`        | `head`                                                                                                                             |
| `persist`     | `persist`                                                                                                                          |
| `middleware`  | `define-middleware`, `reload-context`                                                                                             |

Each entry is bundled in isolation with esbuild:

- `bundle: true`, `minify: true`, `format: "esm"`, `platform: "browser"`.
- `external`: `preact`, `preact/*`, `preact-iso`, `hono`, `hono-preact`,
  `hono-preact/*`. Peers are excluded so the number reflects the framework's own
  code for that feature on top of a preact runtime the consumer already has.
- Output sized with `node:zlib` `gzipSync` and `brotliCompressSync`.

For each entry we record:

- **total** — gzip + brotli of the isolated bundle.
- **marginalOverCore** — total minus the bytes the entry shares with the `core`
  entry, so "actions costs X _on top of core_" is explicit. Computed as
  `entry.total - core.total` when the entry includes core, clamped at 0; the
  exact subtraction strategy is finalized in the plan (candidate: build each
  feature entry both with and without a core import and diff). The table shows
  marginal; the JSON keeps both.

## Section B — Site bundle

Read every `apps/site/dist/client/static/*.js`, gzip-size each, and group into
named buckets via a `chunkBuckets` config (ordered glob → bucket name):

- `optimistic-ui-*`, `use-form-status-*` → `actions`
- `loader-stub-*` → `loaders`
- `view-transition*`, `view-transitions-*` → `transitions`
- `prefetch-*`, `link-prefetch-*` → `prefetch`
- `sse-decoder-*`, `streaming-*` → `streaming`
- `guard-*` → `guards`
- `router-*`, `routes-*`, `route-change-*`, `render-page-*`, `client.js` → `core`
- vendor (`hoofd*`, `jsxRuntime*`, preact, etc.) → `vendor`
- everything unmatched → `app`

Report per-bucket gzip totals plus a grand total. Bucket order and glob list
live in config so adding a chunk doesn't silently fall into `app` unnoticed; an
unmatched chunk is allowed (lands in `app`) but the count of unmatched chunks is
logged so drift is visible.

## Components

- `scripts/client-size-config.mjs` — the feature manifest (Section A), the
  `chunkBuckets` globs (Section B), and per-bucket soft budgets (`{ gzip:
  bytes }`). Pure data + glob matchers, no I/O.
- `scripts/measure-client-size.mjs` — builds Section A entries (esbuild) and
  reads Section B chunks, writes `client-size-report.json`. Pure measurement; no
  git or PR logic. Resolves `esbuild` from the workspace (added as a root
  devDependency, since it is currently only transitive).
- `client-size-report.json` — committed baseline snapshot at repo root. Schema:
  `{ version, sectionA: { [bucket]: { total: {gzip,brotli}, marginalOverCore:
  {gzip,brotli} } }, sectionB: { buckets: { [bucket]: gzip }, total: gzip } }`.
- `client-size-history.jsonl` — committed append-only time-series at repo root
  (Tier 1; see "Historical data" below). One JSON object per line, appended on
  each `main` push: `{ sha, date, sectionA: { [bucket]: gzip }, sectionB: {
  buckets: { [bucket]: gzip }, total: gzip } }`. Gzip-only (the per-point detail
  the snapshot keeps brotli for is not needed for trend lines). The append is a
  helper in `measure-client-size.mjs` (e.g. `--append-history` flag) so the
  history schema lives next to the measurement code.
- `scripts/render-size-comment.mjs` — pure function: takes
  `(freshReport, baselineReport, config)` and returns the two-section markdown
  string with deltas and `⚠️` budget flags. Prints to stdout when run as a CLI.
- `.github/workflows/ci.yml` — new `client-size` job.

## Data flow in CI

A new `client-size` job, `needs: test`, runs only on `pull_request`:

1. Checkout, install (`--frozen-lockfile`), build framework packages + site
   (reuses the existing build commands from the `test` job).
2. `node scripts/measure-client-size.mjs` → fresh `client-size-report.json`.
3. `node scripts/render-size-comment.mjs` reads the fresh report and the
   committed baseline. The baseline is read from the checked-out working tree
   (`client-size-report.json` as committed on the PR branch); the script renders
   markdown comparing fresh vs. committed.
4. `marocchino/sticky-pull-request-comment` posts/updates a keyed comment
   (`header: client-size`) so there is exactly one comment per PR.
5. The job always exits 0; budget overages render `⚠️` only.

On `push` to `main`, a step (in a `main`-only job, mirroring the existing
`build-and-tag` pattern) regenerates `client-size-report.json`, appends one row
to `client-size-history.jsonl` (`measure-client-size.mjs --append-history`,
stamping the row with the commit `sha` and `date` passed in from the workflow,
not read from a clock in the script), and commits both if changed, so the
baseline tracks `main` and the history grows one point per main commit. PR
authors may also run the script locally and commit the updated snapshot; the
snapshot diff is reviewable in the PR. (The history file is appended only on the
`main` push, never in the PR job, so PRs never churn it.)

## Soft-budget & delta semantics

- Baseline = committed `client-size-report.json`. Delta = `fresh - baseline` per
  bucket, rendered `+1.2 KB` / `-340 B` / `—` (unchanged).
- Budgets in config; a bucket over budget renders `⚠️ 18.1 KB / 16 KB`. Never
  fails the job.
- New bucket (absent from baseline) renders `(new)`; removed bucket renders
  `(removed)`.
- Sizes shown in the table are gzip; brotli is kept in the JSON for later use.

## Testing

- `render-size-comment.mjs` unit tests with fixture report pairs covering:
  unchanged, increase, decrease, new bucket, removed bucket, over-budget. Assert
  the rendered markdown. Pure function, no CI dependency.
- Chunk-bucket grouping unit test: a fixture file list → expected bucket
  assignment, including an unmatched chunk landing in `app`.
- `measure-client-size.mjs` smoke test: bundle one tiny entry and assert a
  positive gzip size, keeping the test fast (does not build the whole site).
- `--append-history` unit/smoke test: appending a row to a fixture history file
  produces a valid extra JSONL line with the passed-in `sha`/`date` and is a pure
  append (existing lines untouched).

## Historical data (Tier 1, in scope)

The committed baseline already gives a git-native time-series for free (the git
history of `client-size-report.json` is one data point per main commit). Tier 1
makes that series cheap to read without walking git log, by appending a flat row
to `client-size-history.jsonl` on each main push (see "Components" and the
main-push step above). That is the entire Tier 1 commitment: capture the data in
a read-ready form.

Visualization is deliberately deferred but unblocked by this:

- **Tier 2 (deferred):** a CI step renders a checked-in SVG line chart from the
  history file (no chart library; hand-rolled SVG paths).
- **Tier 3 (deferred):** a live `/internal/bundle-size` route on `apps/site`
  reading the history file.

Capturing the data now is what makes Tier 2/3 a pure read later; the history
file can also be backfilled once from `git log` of the snapshot, so deferring the
chart loses no data.

## Out of scope (YAGNI)

- No hard CI gate / merge block.
- No size **dashboard or chart** (Tier 2/3 above) in this iteration; the Tier 1
  history data is captured so a chart is a later, additive read.
- No per-PR flamegraph (the existing `stats.html` from `rollup-plugin-visualizer`
  covers deep dives).
- No gzip/brotli toggle in the comment (compute both, show gzip, keep brotli in
  JSON).

## Open items for the plan

- Finalize the exact `marginalOverCore` computation strategy.
- Confirm the `chunkBuckets` glob list against a fresh site build and decide the
  vendor/app split precisely.
