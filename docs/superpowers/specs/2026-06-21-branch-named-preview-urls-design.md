# Stable branch-named preview URLs

**Date:** 2026-06-21
**Status:** Design approved, pending implementation plan
**Folds into:** PR #152 (`ci/pr-preview-deploys`), the PR preview-deploys feature (not yet merged)

## Problem

The `preview` job added in PR #152 posts a preview URL of the form
`https://<version-id>-hono-preact.<subdomain>.workers.dev`. The
`<version-id>` prefix is a per-upload hash, so the URL changes on every push
and is not human-readable. We want a canonical, stable URL that matches the
branch, the way Cloudflare's own Workers preview comments do.

**Goal:** the preview comment links to a stable per-branch URL
(`https://<branch-alias>-hono-preact.<subdomain>.workers.dev`) that stays the
same across pushes to the branch, replacing the commit-hash URL.

## Mechanism

`wrangler versions upload` accepts `--preview-alias <name>` (wrangler
>= 4.21.0; present in the repo's 4.92.0). Passing an alias produces a stable
preview URL `https://<alias>-<worker-name>.<subdomain>.workers.dev` that is
reused across uploads with the same alias. The site is on `workers.dev` and has
no Durable Objects, so preview URLs are generated. We pass the branch name
(sanitized) as the alias.

Worker name is `hono-preact` (`apps/site/wrangler.jsonc` `name`); the observed
account subdomain is `s-beshensky`, so the alias URL is
`https://<alias>-hono-preact.s-beshensky.workers.dev`.

## Design

### Branch source

For `pull_request` events, `github.head_ref` is the PR's source branch name.
That is the alias source.

### Sanitizing the branch into a valid alias

A preview alias must be a valid DNS label (lowercase, alphanumeric, hyphens),
and `<alias>-hono-preact` must be <= 63 characters. `hono-preact` plus the
joining hyphen is 12 characters, so the alias must be <= 51 characters.
Transform the branch name:

1. Lowercase.
2. Replace every run of non-`[a-z0-9]` characters with a single `-` (so `/`,
   `_`, `.`, etc. collapse to `-`).
3. Trim leading and trailing `-`.
4. Truncate to 51 characters, then strip a trailing `-` left by truncation.
5. If the result is empty, fall back to `pr-<PR number>`
   (`github.event.pull_request.number`).

Worked example: `ci/pr-preview-deploys` becomes `ci-pr-preview-deploys`, giving
`https://ci-pr-preview-deploys-hono-preact.s-beshensky.workers.dev`.

**Accepted limitation:** two concurrently open PRs whose branch names both
exceed 51 characters and share the same 51-character prefix would collide on a
single alias. For a single-maintainer repo with normal branch names this does
not occur. Cloudflare's own truncate-plus-4-char-hash scheme is deliberately
omitted as YAGNI; it can be added later if long branch names ever collide.

### Injection safety

`github.head_ref` is influenceable by whoever opens the PR, so it must NOT be
interpolated directly into the shell `run:` block via `${{ github.head_ref }}`
(a documented GitHub Actions command-injection vector). It is passed into the
step through an `env:` variable (`HEAD_REF`) and the script reads `"$HEAD_REF"`.
Likewise `github.event.pull_request.number` is passed via an `env:` var
(`PR_NUMBER`). After sanitization the alias contains only `[a-z0-9-]`, so
interpolating it into the `--preview-alias` argument and into the URL-capture
grep is safe.

### Upload and URL capture

Append `--preview-alias "$alias"` to the existing upload command
(`pnpm --filter site deploy:upload -- --preview-alias "$alias"`, which forwards
to `wrangler versions upload -c dist/hono_preact/wrangler.json
--preview-alias <alias>`). With an alias passed, wrangler prints the alias
preview URL. Capture it by grepping for the alias-prefixed URL
(`https://<alias>-...workers.dev`); the alias is sanitized so it is regex-safe
to interpolate. Keep the existing loud empty-guard (fail the step if no URL is
found) and the documented `WRANGLER_OUTPUT_FILE_DIRECTORY` structured fallback.

### Comment

The sticky `preview-docs` comment shows only the stable branch URL (replacing
the commit-hash URL), still annotated as a non-production preview and still
noting the build commit (`github.event.pull_request.head.sha`).

## Where it goes

Fold into the open PR #152 (`ci/pr-preview-deploys`), since this refines a
feature that has not shipped. The change self-tests on that PR: once pushed,
#152's own `preview-docs` comment should update to the
`ci-pr-preview-deploys-hono-preact.s-beshensky.workers.dev` URL.

## Non-goals

- No truncate-plus-hash for over-length branch names (accepted limitation
  above).
- No change to the production deploy (`deploy-docs.yml`) or release scripts.
- No second URL in the comment (branch URL only, per the chosen design).

## Verification

- Push to PR #152 and confirm the `preview` job computes the alias
  `ci-pr-preview-deploys`, uploads with `--preview-alias`, and the
  `preview-docs` comment shows
  `https://ci-pr-preview-deploys-hono-preact.s-beshensky.workers.dev`.
- Confirm that URL returns HTTP 200 and renders the docs.
- Confirm a second push to the same PR leaves the URL unchanged (stable) and
  updates the existing comment in place.
- Confirm the branch name reaches the script only through `$HEAD_REF`, never via
  a `${{ }}` expression inside a `run:` block.
