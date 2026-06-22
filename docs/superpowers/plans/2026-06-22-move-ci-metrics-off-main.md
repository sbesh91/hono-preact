# Move CI Metric State off `main` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `build-and-tag` CI job from committing Lighthouse baseline files to `main`; persist them on a dedicated orphan `metrics` branch instead, so `main` history carries zero bot commits while the README badge, PR baseline diff, and trend history keep working.

**Architecture:** A long-lived orphan branch `metrics` holds `lighthouse-report.json`, `lighthouse-history.jsonl`, and `lighthouse-badge.json`. The `main`-push producer job writes them into a checked-out worktree of that branch and pushes to `metrics`. The PR consumer job fetches the baseline from `metrics`. The README badge and CLAUDE.md are repointed; the three files are removed from `main` and gitignored.

**Tech Stack:** GitHub Actions (`.github/workflows/ci.yml`), Node ESM scripts under `scripts/`, Vitest (`scripts/__tests__/`), `@lhci/cli`, shields.io endpoint badge.

## Global Constraints

- **No em-dashes** in prose, comments, or commit messages (CLI flags, table separators, code identifiers are fine).
- **Do not push to `main`** as part of this work. The only branch this plan pushes is `metrics` (Task 1), and that push must be explicitly authorized by the user.
- **Pre-push CI parity:** before any push of the PR branch, run the eight-step sequence from `CLAUDE.md` ("Pre-push verification"); `pnpm format:check` is the most-missed and is fast to fix with `pnpm format`.
- **Branch name is exactly `metrics`.**
- **Repo slug in badge/raw URLs is `sbesh91/hono-preact`.**
- **Bot commit message on the `metrics` branch:** `chore(metrics): update lighthouse baselines` (no `[skip ci]`; pushes to `metrics` do not match the `branches: [main]` trigger, so no marker is needed).

---

## Task 1: Bootstrap the orphan `metrics` branch (one-time, manual)

This must run **first**, while the three files still exist on `main` (the bootstrap copies them out of `main`). It pushes a new branch `metrics`; it never touches `main`. **The `git push` here requires explicit user authorization.**

**Files:** none modified in the working tree. Creates the remote branch `origin/metrics`.

**Interfaces:**
- Produces: remote branch `metrics` containing exactly `lighthouse-report.json`, `lighthouse-history.jsonl`, `lighthouse-badge.json` with the current `main` contents.

- [ ] **Step 1: Confirm the three files are currently tracked on `main`**

Run:
```bash
git ls-files | grep -E 'lighthouse-(report|history|badge)'
```
Expected output (three lines):
```
lighthouse-badge.json
lighthouse-history.jsonl
lighthouse-report.json
```

- [ ] **Step 2: Create the orphan branch with only the three files**

Run from a clean working tree on `main`:
```bash
git checkout --orphan metrics
git rm -rf --cached . >/dev/null
git checkout main -- lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
git add lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
git status --short
```
Expected: exactly three staged `A` entries, nothing else.

- [ ] **Step 3: Commit the seed**

```bash
git commit -m "chore(metrics): seed metrics branch"
```

- [ ] **Step 4: Push the branch (REQUIRES USER AUTHORIZATION)**

Do not run this without the user's explicit go-ahead.
```bash
git push -u origin metrics
```

- [ ] **Step 5: Return to `main` and clean up local working tree**

```bash
git checkout main
git worktree prune
```
Expected: back on `main`, the three files present and unchanged (they are still tracked on `main` at this point; Task 5 removes them).

- [ ] **Step 6: Verify the branch is reachable**

```bash
git fetch origin metrics --depth=1
git show FETCH_HEAD:lighthouse-badge.json
```
Expected: prints the badge JSON (a `{ "schemaVersion": 1, "label": "lighthouse", ... }` object). Also open `https://raw.githubusercontent.com/sbesh91/hono-preact/metrics/lighthouse-badge.json` in a browser and confirm it serves that JSON.

---

## Task 2: Add `--out-dir` to `measure-lighthouse.mjs`

The script hardcodes the history and badge paths to repo root; only `--out` (report path) is configurable. Add an `--out-dir <dir>` flag that bases all three files under `<dir>`, so the producer job can write straight into the `metrics` worktree. `--out` still overrides the report path specifically. Done test-first via a new pure `resolveOutputPaths` export.

**Files:**
- Modify: `scripts/measure-lighthouse.mjs`
- Test: `scripts/__tests__/measure-lighthouse.test.mjs`

**Interfaces:**
- Produces: `resolveOutputPaths({ root, outDir, out }) -> { report, history, badge }` (all absolute when `root`/`outDir` are absolute). Consumed only by this script's CLI block.

- [ ] **Step 1: Write the failing test**

Add to `scripts/__tests__/measure-lighthouse.test.mjs`. First extend the import at the top of the file:

```js
import {
  pageKey,
  parseManifest,
  extractReport,
  historyRow,
  badgePayload,
  resolveOutputPaths,
} from '../measure-lighthouse.mjs';
```

Then append this describe block at the end of the file:

```js
describe('resolveOutputPaths', () => {
  it('defaults all three files to root', () => {
    expect(resolveOutputPaths({ root: '/repo' })).toEqual({
      report: '/repo/lighthouse-report.json',
      history: '/repo/lighthouse-history.jsonl',
      badge: '/repo/lighthouse-badge.json',
    });
  });

  it('bases all three under outDir when given', () => {
    expect(resolveOutputPaths({ root: '/repo', outDir: '/wt' })).toEqual({
      report: '/wt/lighthouse-report.json',
      history: '/wt/lighthouse-history.jsonl',
      badge: '/wt/lighthouse-badge.json',
    });
  });

  it('lets out override only the report path', () => {
    const p = resolveOutputPaths({ root: '/repo', outDir: '/wt', out: '/tmp/r.json' });
    expect(p.report).toBe('/tmp/r.json');
    expect(p.history).toBe('/wt/lighthouse-history.jsonl');
    expect(p.badge).toBe('/wt/lighthouse-badge.json');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run scripts/__tests__/measure-lighthouse.test.mjs`
Expected: FAIL. The `resolveOutputPaths` import is `undefined`, so the new cases throw `TypeError: resolveOutputPaths is not a function`.

- [ ] **Step 3: Add the `resolveOutputPaths` export**

In `scripts/measure-lighthouse.mjs`, insert this exported function immediately after the `badgePayload` function (after the closing brace of `badgePayload`, around line 87):

```js
// Resolve the three output file paths. With `outDir`, all three live under it;
// otherwise they default to the repo root. `out` overrides the report path only,
// preserving the existing --out flag.
export function resolveOutputPaths({ root, outDir, out } = {}) {
  const base = outDir ?? root;
  return {
    report: out ?? join(base, 'lighthouse-report.json'),
    history: join(base, 'lighthouse-history.jsonl'),
    badge: join(base, 'lighthouse-badge.json'),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run scripts/__tests__/measure-lighthouse.test.mjs`
Expected: PASS, including the three new `resolveOutputPaths` cases.

- [ ] **Step 5: Wire the CLI to use `resolveOutputPaths` and the new flag**

In the CLI block of `scripts/measure-lighthouse.mjs`, replace the path setup and the two write sites. Change the report setup (currently lines ~99-103):

```js
  const inDir = arg('in') ?? join(ROOT, '.lighthouseci');
  const outPath = arg('out') ?? join(ROOT, 'lighthouse-report.json');
  const report = extractReport(inDir);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${outPath} (home performance ${report.pages[HOME]?.scores.performance ?? 'n/a'})`);
```

to:

```js
  const inDir = arg('in') ?? join(ROOT, '.lighthouseci');
  const outPath = resolveOutputPaths({ root: ROOT, outDir: arg('out-dir'), out: arg('out') });
  const report = extractReport(inDir);
  writeFileSync(outPath.report, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${outPath.report} (home performance ${report.pages[HOME]?.scores.performance ?? 'n/a'})`);
```

Change the history write (currently `const historyPath = join(ROOT, 'lighthouse-history.jsonl');`) to:

```js
    const historyPath = outPath.history;
```

Change the badge write (currently `const badgePath = join(ROOT, 'lighthouse-badge.json');`) to:

```js
    const badgePath = outPath.badge;
```

- [ ] **Step 6: Update the usage comment at the top of the file**

Add a line to the `// Usage:` block (after the existing `--append-history` example line, around line 9):

```js
//   node scripts/measure-lighthouse.mjs --out-dir DIR --append-history --badge --sha <sha> --date <iso>
```

- [ ] **Step 7: Sanity-check the CLI still writes to root by default and honors `--out-dir`**

Run (uses the gitignored `.lighthouseci/` only if present; the assertion is on path resolution wiring, so a missing input is fine to ignore):
```bash
node -e "import('./scripts/measure-lighthouse.mjs').then(m => { console.log(JSON.stringify(m.resolveOutputPaths({ root: '/r', outDir: '/wt' }))); })"
```
Expected: `{"report":"/wt/lighthouse-report.json","history":"/wt/lighthouse-history.jsonl","badge":"/wt/lighthouse-badge.json"}`

- [ ] **Step 8: Format and run the script test suite**

Run:
```bash
pnpm format
pnpm vitest run scripts/__tests__/measure-lighthouse.test.mjs
```
Expected: format writes (or no-ops), tests PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/measure-lighthouse.mjs scripts/__tests__/measure-lighthouse.test.mjs
git commit -m "feat(ci): add --out-dir to measure-lighthouse for off-main metric writes"
```

---

## Task 3: Producer — `build-and-tag` pushes baselines to `metrics`, not `main`

Rework the `main`-push job so it writes the three files into a worktree of the `metrics` branch and pushes there. The `next`-tag move is preserved. The metrics infra must never block the `next` tag, so the worktree prep is failure-tolerant.

**Files:**
- Modify: `.github/workflows/ci.yml` (the `build-and-tag` job, currently lines ~267-330, and the concurrency header comment lines ~9-12).

**Interfaces:**
- Consumes: `scripts/measure-lighthouse.mjs --out-dir` from Task 2.
- Produces: pushes commits to `origin/metrics` consumed by Task 4.

- [ ] **Step 1: Update the concurrency header comment**

In `.github/workflows/ci.yml`, replace the comment block at lines ~9-12:

```yaml
# Collapse superseded runs per ref. Cancel-in-progress only for PRs: a fast
# series of pushes to a PR branch should drop stale runs (and the stale size
# comment they'd post). On main, build-and-tag commits the lighthouse baselines and
# force-pushes the `next` tag, so never interrupt it mid-flight.
```

with:

```yaml
# Collapse superseded runs per ref. Cancel-in-progress only for PRs: a fast
# series of pushes to a PR branch should drop stale runs (and the stale size
# comment they'd post). On main, build-and-tag pushes the lighthouse baselines to
# the `metrics` branch and force-pushes the `next` tag, so never interrupt it mid-flight.
```

- [ ] **Step 2: Insert a "Prepare metrics worktree" step before the measure step**

In the `build-and-tag` job, immediately before the `- name: Measure Lighthouse baseline` step (line ~291), insert:

```yaml
      - name: Prepare metrics worktree
        # Failure-tolerant: a missing metrics branch must not block the `next` tag
        # move below. Always sets METRICS_WT so the measure step has a target.
        run: |
          set +e
          git fetch origin metrics --depth=1 2>/dev/null && git worktree add metrics-wt FETCH_HEAD
          if [ -e metrics-wt/.git ]; then
            echo "metrics worktree ready"
          else
            echo "::warning::metrics branch unavailable; lighthouse baselines will not persist this run (run the one-time bootstrap)."
            mkdir -p metrics-wt
          fi
          echo "METRICS_WT=$PWD/metrics-wt" >> "$GITHUB_ENV"
```

- [ ] **Step 3: Point the measure step at the worktree**

In the `- name: Measure Lighthouse baseline` step, change the final command (currently lines ~310-311):

```yaml
          node scripts/measure-lighthouse.mjs --in .lighthouseci --append-history --badge \
            --sha "$GITHUB_SHA" --date "$(git show -s --format=%cI "$GITHUB_SHA")"
```

to:

```yaml
          node scripts/measure-lighthouse.mjs --in .lighthouseci --append-history --badge \
            --out-dir "$METRICS_WT" \
            --sha "$GITHUB_SHA" --date "$(git show -s --format=%cI "$GITHUB_SHA")"
```

- [ ] **Step 4: Replace the "Commit baselines" step with a "Push metrics" step**

Replace the entire `- name: Commit baselines` step (currently lines ~313-321):

```yaml
      - name: Commit baselines
        run: |
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git config user.name "github-actions[bot]"
          if ! git diff --quiet lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json; then
            git add lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
            git commit -m "chore(metrics): update lighthouse baselines [skip ci]"
            git push origin HEAD:main
          fi
```

with:

```yaml
      - name: Push metrics
        # The worktree (when present) is the `metrics` branch checkout; commit and
        # push there. Skips cleanly when the branch was unavailable (plain dir, no
        # .git gitlink). main HEAD is never touched.
        run: |
          if [ ! -e metrics-wt/.git ]; then
            echo "no metrics worktree; skipping push"
            exit 0
          fi
          git -C metrics-wt config user.email "github-actions[bot]@users.noreply.github.com"
          git -C metrics-wt config user.name "github-actions[bot]"
          git -C metrics-wt add lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
          if ! git -C metrics-wt diff --cached --quiet; then
            git -C metrics-wt commit -m "chore(metrics): update lighthouse baselines"
            git -C metrics-wt push origin HEAD:metrics
          fi
```

- [ ] **Step 5: Update the stale comment in the "Move next tag to HEAD" step**

In the `- name: Move next tag to HEAD` step, replace the comment (currently lines ~327-328):

```yaml
          # Anchor to the triggering commit, not local HEAD: the 'Commit baselines'
          # step above may have advanced HEAD with a bookkeeping commit.
```

with:

```yaml
          # Anchor to the triggering commit defensively. Baselines now push to the
          # `metrics` branch, so main HEAD no longer advances during this job.
```

- [ ] **Step 6: Validate the workflow YAML parses**

Run:
```bash
node -e "const fs=require('fs');const c=fs.readFileSync('.github/workflows/ci.yml','utf8');console.log('lines',c.split('\n').length); if(/\t/.test(c)){console.error('TAB FOUND');process.exit(1);} console.log('no tabs ok')"
```
Expected: prints the line count and `no tabs ok` (YAML indentation must be spaces). If `actionlint` is available (`which actionlint`), also run `actionlint .github/workflows/ci.yml` and expect no errors.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: push lighthouse baselines to the metrics branch instead of main"
```

Note: the producer job only runs on a push to `main`, so it cannot be exercised on the PR. Its real verification is the post-merge observation in the final Verification section.

---

## Task 4: Consumer — PR `lighthouse` job reads baseline from `metrics`

The PR job currently diffs against `lighthouse-report.json` in the checked-out tree. After Task 5 that file is gone from `main`, so fetch the baseline from the `metrics` branch, falling back to an empty baseline on first run.

**Files:**
- Modify: `.github/workflows/ci.yml` (the `lighthouse` job's "Render comment" step, currently lines ~180-184).

**Interfaces:**
- Consumes: `origin/metrics:lighthouse-report.json` from Task 1 / Task 3.
- Consumes: `scripts/render-lighthouse-comment.mjs <fresh> <baseline>` (unchanged; it already tolerates an empty baseline via `baseline.pages ?? {}`).

- [ ] **Step 1: Replace the "Render comment" step run command**

In the `lighthouse` job, replace the `- name: Render comment` step's `run:` (currently line ~184):

```yaml
        run: node scripts/render-lighthouse-comment.mjs /tmp/fresh-lh.json lighthouse-report.json > /tmp/lh-comment.md
```

with:

```yaml
        run: |
          git fetch origin metrics --depth=1 2>/dev/null \
            && git show FETCH_HEAD:lighthouse-report.json > /tmp/baseline.json \
            || echo '{}' > /tmp/baseline.json
          node scripts/render-lighthouse-comment.mjs /tmp/fresh-lh.json /tmp/baseline.json > /tmp/lh-comment.md
```

(The `env:` block on this step stays unchanged.)

- [ ] **Step 2: Validate the workflow YAML still parses (no tabs)**

Run:
```bash
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(/\t/.test(c)){console.error('TAB FOUND');process.exit(1);} console.log('no tabs ok')"
```
Expected: `no tabs ok`. If `actionlint` is available, run it and expect no errors.

- [ ] **Step 3: Locally confirm the empty-baseline fallback renders**

Run (proves the `{}` fallback path the first PR run will use is safe):
```bash
node scripts/measure-lighthouse.mjs --in .lighthouseci --out /tmp/fresh-lh.json 2>/dev/null || echo '{"version":1,"pages":{"/":{"scores":{"performance":99,"accessibility":100,"bestPractices":100,"seo":100},"metrics":{"lcp":900,"tbt":0,"cls":0}}}}' > /tmp/fresh-lh.json
echo '{}' > /tmp/baseline.json
node scripts/render-lighthouse-comment.mjs /tmp/fresh-lh.json /tmp/baseline.json | head -20
```
Expected: prints Lighthouse comment markdown with the home page table and `(new)` in the delta column. No crash.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: read lighthouse PR baseline from the metrics branch"
```

---

## Task 5: Repoint README + CLAUDE.md, remove files from `main`, gitignore them

The badge and docs reference the files on `main`; repoint them to `metrics`, drop the tracked files from `main`, and gitignore them so a local measure run does not dirty the tree.

**Files:**
- Modify: `README.md:7` (badge URL)
- Modify: `CLAUDE.md` (the Lighthouse paragraph in "Deploying the docs site")
- Modify: `.gitignore`
- Delete from `main`: `lighthouse-report.json`, `lighthouse-history.jsonl`, `lighthouse-badge.json`

**Interfaces:**
- Depends on Task 1 having pushed the `metrics` branch (else the badge URL 404s after this lands).

- [ ] **Step 1: Repoint the README badge to the `metrics` branch**

In `README.md` line 7, change the badge URL:

```diff
-[![Lighthouse Performance](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/sbesh91/hono-preact/main/lighthouse-badge.json)](https://framework.sbesh.com)
+[![Lighthouse Performance](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/sbesh91/hono-preact/metrics/lighthouse-badge.json)](https://framework.sbesh.com)
```

- [ ] **Step 2: Remove the three files from `main`**

Run:
```bash
git rm lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
```
Expected: three `rm` lines. (The contents live on the `metrics` branch from Task 1.)

- [ ] **Step 3: Gitignore the local-run outputs**

In `.gitignore`, after the existing `.lighthouseci/` entry (lines ~42-43), add:

```gitignore
# lighthouse metric files now live on the `metrics` branch; local measure runs write
# them to root, so keep them out of `main`
lighthouse-report.json
lighthouse-history.jsonl
lighthouse-badge.json
```

- [ ] **Step 4: Update the Lighthouse paragraph in `CLAUDE.md`**

In `CLAUDE.md`, in the "Deploying the docs site" section, find the sentence:

> The PR-only `lighthouse` job posts a soft sticky comment; the `main` push job commits the `lighthouse-report.json` / `lighthouse-history.jsonl` / `lighthouse-badge.json` baselines.

Replace it with:

> The PR-only `lighthouse` job posts a soft sticky comment, reading its baseline from the `metrics` branch; the `main` push job pushes the `lighthouse-report.json` / `lighthouse-history.jsonl` / `lighthouse-badge.json` baselines to the dedicated orphan `metrics` branch (never to `main`), and the README badge reads `lighthouse-badge.json` from that branch. This keeps `main` history free of automated metric commits.

- [ ] **Step 5: Verify the removed files are gone from the index but the metrics branch still has them**

Run:
```bash
git ls-files | grep -E 'lighthouse-(report|history|badge)' || echo "not tracked on main (correct)"
git show FETCH_HEAD:lighthouse-badge.json >/dev/null 2>&1 && echo "still on metrics (correct)" || echo "WARN: run Task 1 bootstrap first"
```
Expected: `not tracked on main (correct)` and `still on metrics (correct)`.

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add README.md CLAUDE.md .gitignore lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
git commit -m "docs(ci): repoint lighthouse badge and docs to the metrics branch"
```
(The deleted files are included in the commit as removals.)

---

## Final Verification

Run the full pre-push sequence and the post-merge observations.

- [ ] **Step 1: Run the eight-step pre-push CI parity (from `CLAUDE.md`)**

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
Expected: all pass. If `format:check` fails, run `pnpm format`, recommit, and rerun.

- [ ] **Step 2: Open the PR and confirm the PR `lighthouse` job posts its comment**

After pushing the PR branch, the `lighthouse` job should fetch the `metrics` baseline and post the sticky comment with `Δ vs base` populated (not all `(new)`), proving Task 4 reads the branch correctly.

- [ ] **Step 3 (post-merge): Confirm `main` gains no metric commit**

After the PR merges to `main`, watch the `build-and-tag` run. Expected:
- the run pushes one commit to `origin/metrics` (visible via `git log origin/metrics --oneline -1`),
- `git log origin/main --oneline -3` shows the merge commit and **no** `chore(metrics)` commit,
- the `next` tag points at the merged SHA (`git ls-remote origin refs/tags/next`).

- [ ] **Step 4 (post-merge): Confirm the badge still renders**

Open `https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/sbesh91/hono-preact/metrics/lighthouse-badge.json` and confirm it shows the current Performance score.

---

## Self-Review Notes

- **Spec coverage:** producer (Task 3), consumer (Task 4), README badge (Task 5), `main` cleanup + gitignore (Task 5), bootstrap (Task 1), `--out-dir` script change (Task 2), CLAUDE.md docs (Task 5). All spec sections mapped.
- **Sequencing:** Task 1 runs while files still exist on `main`; Task 5 removes them only after the branch exists. The badge URL flips to `metrics` in the same PR that removes the files, so there is no window where the badge points at a deleted `main` file.
- **First-run safety:** consumer falls back to `{}` (renders `(new)`); producer skips the push when the branch is absent and warns. Both degrade without failing the `next`-tag move.
