# Version-gated docs site deploys

**Date:** 2026-06-20
**Status:** Design approved, pending implementation plan

## Problem

The docs site (`framework.sbesh.com`) is a Cloudflare Worker. It is deployed
today by **Cloudflare Workers Builds**, the dashboard git integration, which
auto-builds and deploys on **every push to `main`**. That includes the bot's
`chore(metrics)` baseline commits, demo tweaks, and doc edits, none of which
correspond to a published framework version.

The repo accumulates docs for **unreleased** work on `main` (e.g. the entire
A-F primitives backlog has been documented but unreleased for weeks). With
push-to-`main` auto-deploy, those unreleased docs are live, so the public site
describes APIs that are not yet on npm.

**Goal:** the live docs site must always reflect the latest *published*
framework version, never unreleased `main`. A docs change should go live only
when its corresponding version ships.

## Release signal (already exists)

Cutting a version already produces a precise, commit-anchored signal:

- `pnpm release` (`scripts/release.mjs`) publishes `hono-preact` +
  `create-hono-preact`, then runs `git tag vX.Y.Z` (at `main` HEAD) and
  `git push origin vX.Y.Z`.
- `pnpm release:ui` (`scripts/release-ui.mjs`) publishes `hono-preact-ui` on
  its own independent version line and pushes a `hono-preact-ui@x.y.z` tag.

Because each tag points at the exact released commit, **building and deploying
from the tag yields the docs that ship with that npm version**, by
construction. No new release-signal machinery is needed; we only need to hook a
deploy onto the tag push.

## Approach

Replace push-to-`main` auto-deploy with a GitHub Actions workflow that fires on
release-tag pushes (and a manual button). Decision record of the options
considered:

- **GitHub Actions on tag push (chosen).** In-repo, reviewable, testable;
  deploys the exact released commit. One-time cost: a Cloudflare API token
  secret and disabling Workers Builds auto-deploy.
- Keep Workers Builds, point its production branch at a long-lived `release`
  branch the release flow fast-forwards. Rejected: adds a branch to maintain
  and moves the trigger logic out of the repo into a dashboard convention.
- Keep Workers Builds on `main`, gate with a build-command guard. Rejected:
  Workers Builds triggers on branch pushes (not tag pushes), couples the guard
  to "the commit that bumped `package.json`", and reports aborted builds as
  failures (noise).

## Design

### Trigger

```yaml
on:
  push:
    tags:
      - 'v*.*.*'            # framework releases (hono-preact / create-hono-preact)
      - 'hono-preact-ui@*'  # independent UI library releases
  workflow_dispatch: {}     # manual escape hatch for urgent docs/infra fixes
```

Both tag patterns deploy: the docs site documents both the framework (Guide
area) and the independently-versioned `hono-preact-ui` (Components area), so a
UI release must be able to refresh the Components docs without waiting for the
next framework version.

### Workflow file: `.github/workflows/deploy-docs.yml`

A new, separate workflow file (not a job inside `ci.yml`): the trigger set
differs (tags + dispatch vs. push/PR to `main`), and a focused file keeps
`ci.yml` readable.

Single job, mirroring the existing `ci.yml` `test` job's build steps, then
deploying:

1. `actions/checkout@v4`
2. `pnpm/action-setup@v4` (version derives from the `packageManager` field)
3. `actions/setup-node@v4` with `node-version: lts/*`, `cache: pnpm`
4. `pnpm install --frozen-lockfile`
5. `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
   (framework dist; the site build resolves cross-package types/exports through it)
6. `pnpm --filter site build` (produces `apps/site/dist/hono_preact/wrangler.json`)
7. `pnpm --filter site deploy` (`wrangler deploy -c dist/hono_preact/wrangler.json`),
   with `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`) from repo secrets in `env`

Job-level settings:

- `permissions: { contents: read }` (no PR/issue writes needed).
- `concurrency: { group: deploy-docs, cancel-in-progress: false }` so two
  back-to-back releases (a framework tag and a UI tag pushed close together)
  **queue** rather than kill an in-flight `wrangler deploy`.
- **No** typecheck / unit / integration / format re-run. The tagged commit
  already passed full CI on its `main` push; a build failure in step 5/6 still
  blocks the deploy, so a broken commit cannot ship.

### Authentication

`wrangler deploy` authenticates via environment, not interactive login:

- `CLOUDFLARE_API_TOKEN` (required): repo secret.
- `CLOUDFLARE_ACCOUNT_ID` (set it; optional only when the token scopes to a
  single account, but explicit is safer for the custom-domain route): repo
  secret.

## One-time manual prerequisites (outside the repo)

These are operator actions, not code, and must happen for the design to take
effect:

1. **Create a Cloudflare API token** scoped for Workers deploys: *Workers
   Scripts: Edit*, plus the Account / Workers Routes permissions needed to
   update the `framework.sbesh.com` custom-domain route. Add it as the GitHub
   repo secret `CLOUDFLARE_API_TOKEN`. Add the account id as
   `CLOUDFLARE_ACCOUNT_ID`.
2. **Disable Cloudflare Workers Builds auto-deploy** for this Worker
   (disconnect the git integration, or turn off automatic branch builds in the
   dashboard). **Critical:** if it stays on, every push to `main` still deploys
   in parallel with the new workflow, you get double deploys, and unreleased
   `main` keeps going live, which defeats the entire change.

## Edge cases

- The `next` tag (moved by `ci.yml`'s `build-and-tag` job via `git tag -f next`)
  does **not** match `v*.*.*` or `hono-preact-ui@*`, so it never triggers a
  deploy.
- `chore(metrics)` baseline commits are branch pushes carrying `[skip ci]` and
  are never tags, so they never trigger a deploy.
- `workflow_dispatch` run from `main` deploys current `main` HEAD. This is the
  intended manual path for an urgent docs typo or infra fix between releases;
  using it knowingly ships whatever is on `main`.
- A `vX.Y.Z` tag may point at a commit that the metrics-baseline bot later
  advanced past on `main`. That is fine: the deploy checks out the tag, so it
  builds exactly the released tree regardless of where `main` has moved.

## Non-goals

- No preview/staging environment or per-PR preview deploys.
- No rollback automation.
- No change to `scripts/release.mjs` or `scripts/release-ui.mjs`: the tags they
  already push are the trigger; the release scripts are untouched.
- No re-running of the test suite in the deploy workflow (covered by the `main`
  CI run on the same commit).

## Verification

- Validate the workflow's trigger and build steps via the `workflow_dispatch`
  path first (a manual run deploys `main`), before relying on the tag path.
- Confirm a normal `main` push no longer deploys once Workers Builds auto-deploy
  is disabled.
- Confirm the next `pnpm release` tag push produces exactly one deploy of the
  tagged commit.
