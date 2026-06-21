# PR preview deploys for the docs site

**Date:** 2026-06-21
**Status:** Design approved, pending implementation plan

## Problem

We replaced Cloudflare Workers Builds' push-to-`main` auto-deploy with a
release-tag-gated GitHub Actions workflow (`deploy-docs.yml`, PR #140). That
deliberately dropped one Workers Builds behavior the maintainer relied on:
**automatic preview deployments for non-`main` work**, with a clickable URL to
view a branch's changes before merge.

**Goal:** restore automatic previews, scoped to pull requests, without
weakening the production gate. A preview must be fully isolated from the live
`framework.sbesh.com` deployment.

## Approach

### Mechanism: `wrangler versions upload`

Use `wrangler versions upload` (the site's existing `deploy:upload` script),
not `wrangler deploy`. `versions upload` uploads a **non-active version** of the
same Worker and returns a `*.workers.dev` **preview URL**; it does not change
the active deployment and does not touch the custom-domain route. Previews are
therefore isolated from production by construction. `preview_urls: true` is
already set in `apps/site/wrangler.jsonc`.

Because `versions upload` never calls the `/zones/{zone}/workers/routes`
endpoint, it needs only **Account -> Workers Scripts: Edit**, which the existing
`CLOUDFLARE_API_TOKEN` already has. Previews work even before the zone-level
Workers Routes permission (which production still needs) is added to the token.

Rejected alternative: re-enabling Cloudflare Workers Builds for non-production
branches only. It is branch/commit-scoped rather than PR-scoped (does not fit
"on every PR"), posts deployment statuses rather than a single updating PR
comment, reintroduces a dashboard dependency, and risks someone re-enabling
production-branch builds and undoing the release gate.

### Placement: a `preview` job in `ci.yml`

Add the preview as a new job in `.github/workflows/ci.yml`, not a separate
file. `ci.yml` already triggers on `pull_request` and already carries two
PR-only jobs gated by `if: github.event_name == 'pull_request'` (`client-size`,
`lighthouse`) that build the site. The preview job sits beside them, reusing
that trigger and the workflow's existing PR concurrency
(`cancel-in-progress: ${{ github.event_name == 'pull_request' }}`), which
already cancels superseded preview builds on a fast series of pushes.
`deploy-docs.yml` stays a separate file because it is tag-triggered; the preview
is `pull_request`-triggered, so it belongs with the other PR jobs in `ci.yml`.

## Design

### The `preview` job

```yaml
preview:
  name: Preview deploy
  needs: test
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  permissions:
    contents: read
    pull-requests: write
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: lts/*, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
    - run: pnpm --filter site build
    - name: Upload preview version
      # captures the preview URL into a step output
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    - name: Post sticky preview comment
      uses: marocchino/sticky-pull-request-comment@v2
```

- **`needs: test`**: a preview builds only after the `test` job passes, matching
  the `client-size` and `lighthouse` jobs. Consistent gating; a preview of code
  that fails tests is rarely what you want.
- **Permissions**: `contents: read` for checkout, `pull-requests: write` for the
  sticky comment. Same as the other two PR jobs.
- **Build steps**: identical to the rest of CI (framework build then site
  build), so the preview reflects exactly what CI validates.

### Capturing the preview URL

`wrangler versions upload` prints a line of the form
`Version Preview URL: https://<version>-hono-preact.<subdomain>.workers.dev`.
Capture it deterministically:

1. Run `pnpm --filter site deploy:upload` with stdout teed to a file.
2. Extract the preview URL from the `Version Preview URL:` line (grep the
   `https://...workers.dev` token) into a step output (`$GITHUB_OUTPUT`).
3. If the line is absent (wrangler wording change), the step fails loudly rather
   than posting an empty comment.

A structured alternative (set `WRANGLER_OUTPUT_FILE_DIRECTORY` and read the
emitted `version-upload` JSON record's preview-URL field) is available if the
stdout wording proves brittle; the implementation confirms which is reliable
against wrangler 4.92.x and uses one.

### The PR comment

Reuse `marocchino/sticky-pull-request-comment@v2` (already used for the size and
lighthouse comments) with header `preview-docs`, so each PR gets a single
comment that updates on every push. The body shows the preview URL, the short
commit SHA it was built from, and a note that it is a non-production preview.

## Decisions and non-goals

- **Fork PRs get no preview.** The `pull_request` event withholds secrets from
  forks, so the upload step has no token there. Acceptable for a single-owner
  repo; we do not use the riskier `pull_request_target`.
- **No preview-version cleanup.** Cloudflare retains a bounded version history;
  we do not manage version lifecycle.
- **No previews for branch pushes without a PR.** Previews are PR-scoped.
- **Production untouched.** Previews never deploy to `framework.sbesh.com`; they
  only upload non-active versions with `*.workers.dev` preview URLs.
- **No change to `deploy-docs.yml`** or the release scripts.

## Prerequisites

- The account's `workers.dev` subdomain must be enabled for preview URLs to
  resolve. Workers Builds previews worked previously, so this is expected to be
  already enabled; confirm on the first preview run.
- No new GitHub secret is required: previews reuse the existing
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, and `versions upload` needs
  only the Account-level Workers Scripts permission the token already has.

## Verification

- Open a PR and confirm the `preview` job runs, uploads a version, and posts the
  `preview-docs` sticky comment with a working `*.workers.dev` URL that renders
  the branch's docs.
- Confirm the active `framework.sbesh.com` deployment is unchanged after a
  preview upload (previews are non-active versions).
- Confirm a second push to the same PR updates the existing comment in place
  rather than adding a new one.

## Documentation

- Extend the `CLAUDE.md` "Deploying the docs site" section to record that PRs get
  an isolated preview via the `ci.yml` `preview` job (`wrangler versions upload`,
  non-active version, `*.workers.dev` URL), distinct from the tag-gated
  production deploy.
