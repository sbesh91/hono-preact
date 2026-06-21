# Version-Gated Docs Deploys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the docs site (`framework.sbesh.com`) only from release-tag pushes, so the live site always matches the latest published version instead of unreleased `main`.

**Architecture:** Replace Cloudflare Workers Builds' push-to-`main` auto-deploy with a new GitHub Actions workflow (`.github/workflows/deploy-docs.yml`) triggered by `v*.*.*` (framework) and `hono-preact-ui@*` (UI) tag pushes, plus a manual `workflow_dispatch`. The job mirrors the existing CI build steps, then runs `wrangler deploy` authenticated by repo secrets. Two operator-only prerequisites (create the Cloudflare token; disable Workers Builds auto-deploy) live outside the repo and are listed at the end.

**Tech Stack:** GitHub Actions, pnpm workspaces, Vite (site build), Wrangler (Cloudflare Workers deploy).

## Global Constraints

- No em-dashes in prose or comments (use a comma, colon, semicolon, parentheses, or two sentences). Verbatim from the user's global style rule.
- Mirror `ci.yml` conventions exactly: `actions/checkout@v4`, `pnpm/action-setup@v4` (no pinned version; it derives from the `packageManager` field), `actions/setup-node@v4` with `node-version: lts/*` and `cache: pnpm`, top-level `env: FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`.
- Framework build filter is exactly: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`. The site build resolves cross-package types/exports through the framework `dist/`, so it must run first.
- Site deploy command is exactly `pnpm --filter site deploy` (which runs `wrangler deploy -c dist/hono_preact/wrangler.json`); it reads `dist/hono_preact/wrangler.json` produced by `pnpm --filter site build`, so build must precede deploy.
- Wrangler authenticates from env: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, supplied as GitHub repo secrets.
- No local YAML linter is available (no actionlint / pyyaml / requireable js-yaml). Automated verification is content assertions via `grep`; final YAML validity is confirmed by GitHub parsing the workflow on push and by the operator's `workflow_dispatch` smoke run.

---

### Task 1: Create the version-gated deploy workflow

**Files:**
- Create: `.github/workflows/deploy-docs.yml`

**Interfaces:**
- Consumes (operator-provided, see Operator Prerequisites): GitHub repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Produces: a `Deploy docs` workflow that runs exactly one build-and-`wrangler deploy` job on each `v*.*.*` or `hono-preact-ui@*` tag push, and on manual `workflow_dispatch`.

- [ ] **Step 1: Write the failing content-assertion check and run it (file absent, so it fails)**

Run this block. With no workflow file yet, it must print a FAIL line and exit non-zero:

```bash
F=.github/workflows/deploy-docs.yml
fail() { echo "FAIL: $1"; exit 1; }
test -f "$F" || fail "missing $F"
grep -q "'v\*\.\*\.\*'" "$F" || fail "missing framework tag glob"
grep -q "'hono-preact-ui@\*'" "$F" || fail "missing UI tag glob"
grep -q "workflow_dispatch" "$F" || fail "missing workflow_dispatch trigger"
grep -q "cancel-in-progress: false" "$F" || fail "missing serialized concurrency"
grep -q "contents: read" "$F" || fail "missing least-privilege permissions"
grep -Eq "pnpm --filter '@hono-preact/\*' --filter hono-preact --filter hono-preact-ui build" "$F" || fail "missing framework build step"
grep -q "pnpm --filter site build" "$F" || fail "missing site build step"
grep -q "pnpm --filter site deploy" "$F" || fail "missing deploy step"
grep -q "CLOUDFLARE_API_TOKEN" "$F" || fail "missing API token env"
grep -q "CLOUDFLARE_ACCOUNT_ID" "$F" || fail "missing account id env"
grep -q "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true" "$F" || fail "missing node24 env parity"
echo "PASS: all assertions satisfied"
```

Expected: `FAIL: missing .github/workflows/deploy-docs.yml`, exit code 1.

- [ ] **Step 2: Create the workflow file**

Create `.github/workflows/deploy-docs.yml` with exactly this content:

```yaml
name: Deploy docs

# The docs site (framework.sbesh.com) deploys ONLY from release tags, so the
# live site always matches the latest published version, never unreleased main.
# Cloudflare Workers Builds auto-deploy is disabled (see the deploy spec), so
# this workflow is the sole deploy path.
on:
  push:
    tags:
      - 'v*.*.*' # hono-preact / create-hono-preact releases
      - 'hono-preact-ui@*' # independent UI library releases
  workflow_dispatch: {} # manual escape hatch for urgent docs/infra fixes

# Never interrupt an in-flight wrangler deploy; queue overlapping releases
# (a framework tag and a UI tag pushed close together) instead of cancelling.
concurrency:
  group: deploy-docs
  cancel-in-progress: false

permissions:
  contents: read

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  deploy:
    name: Build and deploy docs site
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Version derives from the `packageManager` field in package.json.
      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # Build framework packages first so the site build resolves their
      # published dist/ types and exports (workspace exports point at dist).
      - name: Build framework packages
        run: pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build

      - name: Build site
        run: pnpm --filter site build

      # wrangler reads CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from env and
      # deploys dist/hono_preact/wrangler.json produced by the site build.
      - name: Deploy to Cloudflare
        run: pnpm --filter site deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 3: Run the content-assertion check again (now passes)**

Re-run the exact block from Step 1.
Expected: `PASS: all assertions satisfied`, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-docs.yml
git commit -m "ci: deploy docs site only on release tags

Add deploy-docs.yml triggered by v*.*.* and hono-preact-ui@* tag pushes
(plus workflow_dispatch), replacing push-to-main Workers Builds auto-deploy
so framework.sbesh.com always matches the latest published version."
```

---

### Task 2: Document the deploy model for future agents

**Files:**
- Modify: `CLAUDE.md` (add a "Deploying the docs site" section)

**Interfaces:**
- Consumes: the workflow from Task 1 (references `.github/workflows/deploy-docs.yml`).
- Produces: an in-repo record so future agents understand why a `main` push no longer deploys, and what the operator prerequisites are.

Rationale: `CLAUDE.md` is the project's agent-facing memory and currently says nothing about deployment. Without this note, a future agent will see no deploy step in `ci.yml`, push to `main`, and wrongly expect the site to update. `CLAUDE.md` is not covered by `pnpm format:check` (its globs are `packages/**` and `apps/**/src/**`), so there is no format step for this task.

- [ ] **Step 1: Add the section**

Insert the following block into `CLAUDE.md` immediately after the end of the existing `## Pre-push verification` section and before the `## PR workflow` section:

```markdown
## Deploying the docs site

The docs site (`framework.sbesh.com`, a Cloudflare Worker) deploys **only on release-tag pushes**, never on a push to `main`. The live site is meant to match the latest *published* version, not unreleased `main`. The single deploy path is `.github/workflows/deploy-docs.yml`, which triggers on:

- `v*.*.*` tags (pushed by `pnpm release` for `hono-preact` / `create-hono-preact`),
- `hono-preact-ui@*` tags (pushed by `pnpm release:ui`),
- manual `workflow_dispatch` (urgent docs/infra fix between releases; deploys current `main` HEAD).

So a normal merge to `main` does **not** update the live site; the docs ship with the next version cut. Two prerequisites are operator-managed outside the repo: the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets, and Cloudflare Workers Builds auto-deploy being **disabled** (if it is ever re-enabled, every `main` push deploys again and defeats the gate).
```

- [ ] **Step 2: Verify the section landed and contains no em-dashes**

```bash
grep -q "## Deploying the docs site" CLAUDE.md && echo "section present"
grep -n '—' CLAUDE.md && echo "FAIL: em-dash found" || echo "no em-dashes"
```

Expected: `section present`, then `no em-dashes`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note docs site deploys only on release tags"
```

---

## Operator Prerequisites (manual, outside the repo)

These cannot be done by the implementing agent; they are dashboard/secret actions for the repo owner. The workflow from Task 1 does nothing useful until both are done.

1. **Cloudflare API token + GitHub secrets.** Create a Cloudflare API token scoped for Workers deploys (*Workers Scripts: Edit*, plus the Account / Workers Routes permissions needed to update the `framework.sbesh.com` custom-domain route). Add two GitHub repo secrets: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (the account id).
2. **Disable Cloudflare Workers Builds auto-deploy** for this Worker (disconnect the git integration, or turn off automatic branch builds in the Cloudflare dashboard). Critical: if it stays enabled, every push to `main` deploys in parallel with this workflow and unreleased `main` keeps going live, defeating the change.

## Acceptance / Verification

- After Task 1 + operator step 1: trigger the workflow manually (`gh workflow run "Deploy docs"` or the Actions tab) and confirm it builds and deploys `main` HEAD successfully. This is the smoke test that the build steps and Cloudflare auth work.
- After operator step 2: confirm a normal push to `main` no longer produces a Cloudflare deploy.
- On the next `pnpm release`: confirm the `vX.Y.Z` tag push produces exactly one deploy of the tagged commit, and that the `next` tag move and `chore(metrics)` commit do not trigger a deploy.

## Self-Review Notes

- **Spec coverage:** trigger model (Task 1 `on:` block), separate workflow file (Task 1), build-then-deploy steps + concurrency + least-privilege permissions + no test re-run (Task 1), auth via secrets (Task 1 + Operator step 1), disable Workers Builds (Operator step 2), edge cases `next`/`chore(metrics)`/dispatch (covered by the tag globs in Task 1 and the Acceptance checks), agent-facing documentation of the new model (Task 2). All spec sections map to a task or an operator step.
- **Non-goals honored:** no preview/staging, no rollback automation, no edits to `release.mjs` / `release-ui.mjs`, no test-suite re-run in the deploy job.
