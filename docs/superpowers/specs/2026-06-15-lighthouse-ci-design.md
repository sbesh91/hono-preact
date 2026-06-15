# Lighthouse in CI — design

Date: 2026-06-15

## Goal

Give the framework a continuous, low-noise Lighthouse signal:

1. **On every PR** — a sticky comment showing Lighthouse category scores for a
   representative set of pages, with deltas versus the `main` baseline. Soft and
   informational; it never fails the build.
2. **On `main`** — a committed baseline (`lighthouse-report.json`) plus an
   appended history line (`lighthouse-history.jsonl`), exactly like the existing
   client-size baseline/history.
3. **A README badge** — a single shields.io badge showing the home page's
   Performance score, sourced from a committed `lighthouse-badge.json`.

This rides the rails the client-size tracking already lays down: measure on PR →
sticky comment; measure on `main` → committed baseline + history; render a badge
from a committed JSON file.

## Locked decisions (from brainstorming)

These were settled with the user before this spec; they are not open questions.

| Decision | Choice | Why |
|---|---|---|
| What to measure against | **Hermetic build served locally in CI** (option A) | Reproducible, no network variance, no Cloudflare token; isolates the framework's contribution rather than crediting Cloudflare's CDN. Mirrors size-tracking (measure the artifact, not the deploy). |
| CI assertiveness | **Soft / informational** | Lighthouse is noisier than a byte count; a hard gate flakes until enough history exists to set a defensible threshold. Matches the soft-budget philosophy of client-size. |
| Pages | **Three:** `/`, `/docs/quick-start`, `/demo` | Covers the static, content-heavy (MDX + Shiki), and interactive (RPC/guards) rendering paths. Badge sources from `/` only. |
| Badge | **Single Performance badge**, sourced from the hermetic `main` run | One clean number; reproducible lab score is the honest "framework speed" signal. |
| Tool | **Lighthouse CI (`@lhci/cli`)** | Turnkey collection: handles Chrome, multiple runs, and median (representative) selection. We add a thin extraction/render layer on top for our committed-JSON conventions. |

### Non-goals / explicitly deferred

- **No hard gate.** Can be added later (warn → error) once `lighthouse-history.jsonl`
  shows real run-to-run variance. Out of scope here.
- **No production / scheduled run against `framework.sbesh.com`.** The badge is
  hermetic. A live-URL badge was considered and rejected (lags the last manual
  deploy, network-flaky, credits the CDN not the framework).
- **No per-PR Cloudflare preview deploy.** Considered (option C) and rejected for
  moving parts.
- **No desktop preset.** Lighthouse defaults (mobile emulation + simulated
  throttling) are the conventional, honest preset.
- **Not added to the 6-step pre-push sequence.** Lighthouse is too slow to run
  before every push; it stays CI-only.

## Architecture

The PR path and the `main` path share the same first four stages (build → serve →
collect → extract) and diverge only at the end (PR renders a comment; `main`
commits the baseline + history + badge).

```
build site ──► serve (wrangler dev --local, backgrounded) ──► lhci collect (3 URLs × 3 runs) ──► lhr-*.json
                                                                      │
                              lhci upload (temporary-public-storage → links.json) +
                              lhci upload (filesystem → manifest.json)
                                                                      │
                                                   measure-lighthouse.mjs (extract median)
                                                                      │
                              ┌───────────────────────────────────────┴───────────────────────────┐
                         PR path                                                              main path
              render-lighthouse-comment.mjs                              write lighthouse-report.json
              (fresh vs committed baseline)                              + append lighthouse-history.jsonl
                         │                                               + write lighthouse-badge.json
              sticky comment (header: lighthouse)                        fold into the [skip ci] baseline commit
```

### 1. Serving the build

The site is an SSR Cloudflare Worker, not a static bundle, so we serve the real
built worker, not `dist/client`. The built output `dist/hono_preact/wrangler.json`
declares **zero external bindings** (KV/D1/R2/DO arrays all empty) and the demo
uses signed cookies rather than a backing store, so the worker boots locally with
no Cloudflare account or network.

The CI job manages the server as a discrete step (not via LHCI's
`startServerCommand`) so a flaky start is easy to debug in isolation:

```
pnpm --filter site exec wrangler dev -c dist/hono_preact/wrangler.json \
  --local --port 8788 &
# health-check: poll http://localhost:8788/ until it returns 200 (timeout ~30s)
```

All three target URLs (`/`, `/docs/quick-start`, `/demo`) are unguarded and render
without a session.

> **Risk — wrangler ready signal.** The health-check polls the HTTP endpoint
> rather than grepping wrangler's stdout, so it does not depend on wrangler's exact
> "Ready on …" wording (which can change between wrangler versions). The poll has a
> bounded timeout and prints wrangler logs on failure.

### 2. Collecting (LHCI)

A checked-in `.lighthouserc.json` configures collection only (no assertions, no
LHCI server):

```jsonc
{
  "ci": {
    "collect": {
      "url": [
        "http://localhost:8788/",
        "http://localhost:8788/docs/quick-start",
        "http://localhost:8788/demo"
      ],
      "numberOfRuns": 3,
      "settings": {
        // CI containers need --no-sandbox; headless is LHCI's default.
        "chromeFlags": "--no-sandbox"
        // formFactor/throttling left at Lighthouse defaults (mobile + simulated).
      }
    },
    "upload": {
      // Uploads each run to Google-hosted temp storage (~7-day retention) and
      // prints shareable report URLs we surface in the PR comment. Optional;
      // the job tolerates upload failure (continue-on-error) so a storage
      // outage never blocks the comment.
      "target": "temporary-public-storage"
    }
  }
}
```

`lhci collect` writes only the raw `.lighthouseci/lhr-*.json` reports; it does
**not** produce a manifest. The `manifest.json` that extraction parses (one entry
per run, each with `url`, `isRepresentativeRun`, a `summary` of category scores
0–1, and `jsonPath` to the full LHR) is written by the **filesystem** upload
target, so we run two uploads after collect: `lhci upload` (config target =
`temporary-public-storage`, writes `.lighthouseci/links.json` with hosted report
URLs, non-blocking) and `lhci upload --upload.target=filesystem
--upload.outputDir=.lighthouseci` (writes `.lighthouseci/manifest.json`,
required). `.lighthouseci/` is gitignored.

### 3. Extraction — `scripts/measure-lighthouse.mjs`

Mirrors `measure-client-size.mjs`: pure exported functions + a CLI block guarded
by `if (import.meta.url === \`file://${process.argv[1]}\`)`, the same `arg(name)`
flag helper, and `JSON.stringify(report, null, 2) + '\n'` output.

Reads `.lighthouseci/manifest.json`, keeps `isRepresentativeRun === true` (the
median run LHCI selects per URL), and for each URL records the four category
scores (0–100, rounded) plus the headline metrics read from the referenced LHR
(`largest-contentful-paint`, `total-blocking-time`, `cumulative-layout-shift`
numeric values). When `upload` ran, it also captures the per-URL hosted report
link from `.lighthouseci/links.json`.

Exported (for unit tests): `extractReport(manifestDir)`, `historyRow(report, sha,
date)`, `badgePayload(report)`.

CLI flags (mirroring the size script):

- `--in <dir>` — manifest dir (default `.lighthouseci`).
- `--out <path>` — report path (default `lighthouse-report.json`).
- `--append-history` — append a flattened row to `lighthouse-history.jsonl`
  (requires `--sha` and `--date`, same guard as the size script).
- `--badge` — write `lighthouse-badge.json`.

### 4a. PR path — `scripts/render-lighthouse-comment.mjs`

Mirrors `render-size-comment.mjs`: pure `renderComment(fresh, baseline, meta)` +
CLI block, a `<!-- lighthouse -->` header marker, and a freshness footer pinned to
the measured SHA via env vars (`LH_COMMENT_SHA`, `LH_COMMENT_RUN_URL`,
`generatedAt`). One table per page: columns `Category | Score | Δ vs base`, scores
formatted `NN/100`, deltas `+N` / `-N` / `—`, plus a metrics sub-row (LCP/TBT/CLS).
When hosted report links exist, each page header links to its full report.

### 4b. main path — committed baseline + history + badge

Folded into the existing `build-and-tag` job's `[skip ci]` baseline commit, right
beside the client-size update:

```
node scripts/measure-lighthouse.mjs \
  --append-history --badge \
  --sha "$GITHUB_SHA" --date "$(git show -s --format=%cI "$GITHUB_SHA")"
git add lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
# committed alongside client-size-report.json / client-size-history.jsonl
```

## Data schemas (repo root)

### `lighthouse-report.json` (committed baseline)

```jsonc
{
  "version": 1,
  "pages": {
    "/": {
      "scores": { "performance": 98, "accessibility": 100, "bestPractices": 100, "seo": 100 },
      "metrics": { "lcp": 1200, "tbt": 0, "cls": 0 },   // ms, ms, unitless
      "reportUrl": "https://storage.googleapis.com/..."  // present only if upload ran
    },
    "/docs/quick-start": { "scores": { ... }, "metrics": { ... } },
    "/demo": { "scores": { ... }, "metrics": { ... } }
  }
}
```

### `lighthouse-history.jsonl` (append one line per `main` commit)

One per-commit row, like `client-size-history.jsonl`. Per the user's "keep both"
decision after spec review, each page carries **both** category scores **and**
metrics (only the expiring `reportUrl` is dropped vs. the full report):

```json
{"sha":"...","date":"2026-06-15T...","pages":{"/":{"scores":{"performance":98,"accessibility":100,"bestPractices":100,"seo":100},"metrics":{"lcp":1200,"tbt":0,"cls":0}},"/docs/quick-start":{...},"/demo":{...}}}
```

### `lighthouse-badge.json` (shields.io endpoint schema)

```json
{ "schemaVersion": 1, "label": "lighthouse", "message": "98", "color": "brightgreen" }
```

`message` is the home page's rounded Performance score. `color` follows
Lighthouse's own banding: **≥90 → `brightgreen`**, **50–89 → `orange`**, **<50 →
`red`**.

## File-by-file changes

**New**

- `.lighthouserc.json` — LHCI collect/upload config (root).
- `scripts/measure-lighthouse.mjs` — extract median scores → report/history/badge.
- `scripts/render-lighthouse-comment.mjs` — render the PR sticky comment.
- `scripts/__tests__/measure-lighthouse.test.mjs` — extraction/history/badge units
  against a fixture `manifest.json` + LHR.
- `scripts/__tests__/render-lighthouse-comment.test.mjs` — comment rendering units
  (fresh-only "(new)", deltas, removed-page handling).
- `lighthouse-report.json`, `lighthouse-history.jsonl`, `lighthouse-badge.json` —
  seeded committed baselines (initial values from a local run; CI keeps them current).

**Modified**

- `package.json` (root) — add `@lhci/cli` to `devDependencies`; optional convenience
  script `"measure:lighthouse"`.
- `.github/workflows/ci.yml` — new PR-only `lighthouse` job (mirrors `client-size`,
  `needs: test`, `pull-requests: write`); extend `build-and-tag` to fold the three
  Lighthouse artifacts into the existing `[skip ci]` baseline commit.
- `README.md` — add the shields.io endpoint badge near the top.
- `CLAUDE.md` — note the new `@lhci/cli` devDependency and the three artifact files;
  state explicitly that Lighthouse is CI-only and not part of the 6-step pre-push.

> Not modified: the `format` glob. `scripts/**` and root JSON are already outside
> it, so the new scripts and committed artifacts won't trip `format:check` (they
> are still kept prettier-clean by hand for consistency).

## README badge snippet

```markdown
[![Lighthouse Performance](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/sbesh91/hono-preact/main/lighthouse-badge.json)](https://framework.sbesh.com)
```

## CI job sketch (`lighthouse`, PR-only)

```yaml
lighthouse:
  name: Lighthouse
  needs: test
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  permissions:
    contents: read
    pull-requests: write
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with: { version: 10.18.3 }
    - uses: actions/setup-node@v4
      with: { node-version: lts/*, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
    - run: pnpm --filter site build
    - name: Serve + collect
      run: |
        pnpm --filter site exec wrangler dev -c dist/hono_preact/wrangler.json --local --port 8788 &
        WRANGLER_PID=$!
        # poll until 200, ~30s budget; dump wrangler log + fail on timeout
        npx --yes wait-on -t 30000 http://localhost:8788/
        pnpm exec lhci collect --config=.lighthouserc.json
        pnpm exec lhci upload --config=.lighthouserc.json || true   # never block on storage
        kill $WRANGLER_PID || true
    - name: Extract
      run: node scripts/measure-lighthouse.mjs --in .lighthouseci --out /tmp/fresh-lh.json
    - name: Render comment
      env:
        LH_COMMENT_SHA: ${{ github.event.pull_request.head.sha }}
        LH_COMMENT_RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
      run: node scripts/render-lighthouse-comment.mjs /tmp/fresh-lh.json lighthouse-report.json > /tmp/lh-comment.md
    - name: Post sticky comment
      uses: marocchino/sticky-pull-request-comment@v2
      with:
        header: lighthouse
        path: /tmp/lh-comment.md
```

(`wait-on` is illustrative; a small `curl` retry loop avoids the extra dependency.)

## Testing

- **Scripts:** unit tests under `scripts/__tests__/` (run by `vitest run`, already
  the test command). Drive `extractReport`/`historyRow`/`badgePayload` from a
  fixture `.lighthouseci/manifest.json` + a trimmed LHR; drive `renderComment` from
  fixed fresh/baseline objects to assert deltas, `(new)`, and removed-page rows.
  No Chrome, no network in unit tests.
- **CI smoke:** the first PR that adds the workflow is itself the integration test —
  it must produce a sticky comment and not fail `test`.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Lighthouse score noise | median-of-3 (LHCI representative run) + soft-only (never gates) + history file to observe real variance before any future threshold. |
| `wrangler dev` ready timing in CI | HTTP poll with bounded timeout, independent of wrangler's stdout wording; dump logs on timeout. |
| `temporary-public-storage` outage | upload step is `|| true` / continue-on-error; comment still renders without report links. |
| Badge staleness (shields/camo cache) | acceptable: a few minutes after a `main` baseline commit; the number moves slowly. |
| Job runtime (3 URLs × 3 runs + build) | ~3–5 min, runs parallel to `test`/`client-size`; PR-only. |
| Chrome availability on runner | `ubuntu-latest` ships Chrome; LHCI's `chrome-launcher` finds it; `--no-sandbox` set for the CI container. |

## Open implementation details (resolved during the plan, not blocking)

- Exact health-check loop (`curl --retry` vs `wait-on`) — pick the no-extra-dep form.
- Seed values for the initial committed baselines (from one local run on the spec
  author's machine; CI overwrites on first `main` merge).
