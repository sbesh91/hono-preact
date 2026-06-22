# Move CI metric state off `main`

**Date:** 2026-06-22
**Status:** Approved, pending implementation plan

## Problem

The `build-and-tag` job in `.github/workflows/ci.yml` runs on every push to `main`
and commits the three Lighthouse baseline files whenever they change:

```
lighthouse-report.json
lighthouse-history.jsonl
lighthouse-badge.json
```

Because Lighthouse scores jitter a few points run-to-run, `lighthouse-report.json`
changes on nearly every run, so the job produces roughly **one
`chore(metrics): update lighthouse baselines [skip ci]` commit per real commit**.
At the time of writing, ~27 of the last 60 commits on `main` are this bot noise,
which makes `git log` hard to read.

The client-size tracking does **not** have this problem: PR #149 converted it to a
live PR-head-vs-base diff with no committed baseline, so it contributes zero commits.
Only Lighthouse still commits to `main`.

## Goal

Remove **all** bot commits from `main` while keeping the three things that depend on
durable metric state:

- the **README Lighthouse badge** (a shields.io endpoint reading a committed JSON file),
- the **PR `lighthouse` job's baseline diff** (fresh scores vs. the committed `lighthouse-report.json`),
- the **`lighthouse-history.jsonl` trend log** (append-only, one row per `main` commit).

Non-goal: changing how Lighthouse is measured, what it measures, or the client-size job.

## Approach: dedicated orphan `metrics` branch

A long-lived **orphan** branch named `metrics` holds the three files. It shares no
history with `main`, so it stays tiny and its own commit churn is invisible to anyone
reading `main`. Pushes to `metrics` do not match the workflow's `branches: [main]`
trigger, so they neither re-trigger CI nor require a `[skip ci]` marker, and there is
no risk of a commit loop.

### Components

#### 1. `build-and-tag` job (producer)

Currently the job, after measuring, does:

```sh
git add lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
git commit -m "chore(metrics): update lighthouse baselines [skip ci]"
git push origin HEAD:main
```

After the change it instead writes the files onto the `metrics` branch:

- Fetch and check out the `metrics` branch into a separate working tree
  (`git worktree add`) so the append step sees the prior `lighthouse-history.jsonl`.
- Run `measure-lighthouse.mjs` writing the report, appended history, and badge into
  that worktree.
- Commit there and `git push origin metrics`.

The `Move next tag to HEAD` step is unaffected: it already anchors to `$GITHUB_SHA`,
and now that `main` HEAD never advances during the job, that anchoring is simply
redundant rather than load-bearing (keep it; it is harmless and correct).

The `continue-on-error: true` softness on the measure step is preserved: a
wrangler/Chrome/LHCI hiccup must not block the `next` tag move.

#### 2. PR `lighthouse` job (consumer)

Currently:

```sh
node scripts/render-lighthouse-comment.mjs /tmp/fresh-lh.json lighthouse-report.json
```

The baseline file will no longer exist in the checked-out tree. The job will fetch it
from the branch instead:

```sh
git fetch origin metrics --depth=1 || true
git show FETCH_HEAD:lighthouse-report.json > /tmp/baseline.json 2>/dev/null || echo '{}' > /tmp/baseline.json
node scripts/render-lighthouse-comment.mjs /tmp/fresh-lh.json /tmp/baseline.json
```

(`FETCH_HEAD` rather than `origin/metrics`: a bare `git fetch origin metrics` does not
reliably update the `origin/metrics` remote-tracking ref, but `FETCH_HEAD` always points
at what was just fetched.)

First-run guard: if the `metrics` branch or the file does not yet exist, fall back to
an empty baseline so the comment still renders (no diff arrows, just current scores).
The renderer already tolerates a missing/empty baseline (it did during initial seeding).

#### 3. README badge

One-line edit in `README.md`:

```diff
-https://raw.githubusercontent.com/sbesh91/hono-preact/main/lighthouse-badge.json
+https://raw.githubusercontent.com/sbesh91/hono-preact/metrics/lighthouse-badge.json
```

`raw.githubusercontent.com` serves any branch, and the shields.io `endpoint` resolver
reads it the same way. No other badge change is needed.

#### 4. `main` cleanup

- `git rm` the three files from `main`.
- Add them to `.gitignore` so a local `measure-lighthouse.mjs` run (which writes to the
  repo root) does not dirty the working tree or get re-committed by accident.

### One-time bootstrap

Before (or as part of) merging the workflow change, seed the orphan branch from the
current files:

```sh
git checkout --orphan metrics
git rm -rf --cached .
git checkout main -- lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
git add lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
git commit -m "chore(metrics): seed metrics branch"
git push origin metrics
git checkout main
```

This preserves the existing history rows and the current baseline rather than starting
the trend over.

### Script change

`scripts/measure-lighthouse.mjs` currently hardcodes the history and badge paths to the
repo root (`join(ROOT, 'lighthouse-history.jsonl')` / `join(ROOT, 'lighthouse-badge.json')`);
only `--out` (the report path) is configurable. To write all three cleanly into the
`metrics` worktree, add an `--out-dir <dir>` flag that, when present, resolves all three
output paths against that directory (with `--out` still able to override the report path
specifically). Cover the new flag with a unit test alongside the existing
`scripts/__tests__/` coverage. This is preferred over `ROOT`-rewriting gymnastics in the
YAML because it is explicit and testable.

## Decisions

- **Branch name:** `metrics` (not `ci-metrics` / `badges`).
- **Branch history:** the `metrics` branch simply **accumulates** commits. A single
  rolling force-pushed orphan commit per run would keep it at one commit, but that is
  polish on a branch no human reads; not worth the force-push race surface.
- **Client-size job:** untouched. It is already live-diff with no committed baseline.
- **`[skip ci]`:** removed from the metrics commit message; it is no longer needed once
  the push targets `metrics` instead of `main`.

## Docs to update

- `CLAUDE.md`: the "Deploying the docs site" / Lighthouse paragraph states the `main`
  push job "commits the `lighthouse-report.json` / `lighthouse-history.jsonl` /
  `lighthouse-badge.json` baselines." Update to say it pushes them to the `metrics`
  branch, and note the badge reads from `metrics`.

## Net effect

`main` goes from ~1 bot commit per real commit to **zero**. The README badge, the PR
baseline diff, and the trend history all keep working, sourced from the `metrics` branch.

## Verification

- After bootstrap, the shields.io badge URL pointed at the `metrics` branch resolves to
  the current Performance score (open the raw URL and the shields endpoint URL).
- A PR's `lighthouse` job posts its sticky comment with diff arrows against the
  `metrics` baseline (and renders cleanly when the branch is empty).
- A push to `main` produces **no** new commit on `main`; the `metrics` branch gains one
  commit; the `next` tag still moves to the pushed SHA.
- `git log main` over a few merges shows no `chore(metrics)` commits.
