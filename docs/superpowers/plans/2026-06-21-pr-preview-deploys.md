# PR Preview Deploys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every pull request an isolated docs-site preview (a `*.workers.dev` URL posted as a sticky PR comment), without touching the tag-gated production deploy.

**Architecture:** Add a `preview` job to `.github/workflows/ci.yml` (which already triggers on `pull_request` and already hosts PR-only jobs). The job builds the site like the rest of CI, runs `wrangler versions upload` to publish a NON-ACTIVE version with a preview URL, captures that URL, and posts it via the same sticky-comment action CI already uses for size/lighthouse.

**Tech Stack:** GitHub Actions, pnpm workspaces, Vite (site build), Wrangler (`versions upload`), marocchino/sticky-pull-request-comment.

## Global Constraints

- No em-dashes in prose or comments (use a comma, colon, semicolon, parentheses, or two sentences). Verbatim from the user's global style rule.
- Mirror `ci.yml` conventions exactly: `actions/checkout@v4`, `pnpm/action-setup@v4` (unpinned; derives from the `packageManager` field), `actions/setup-node@v4` with `node-version: lts/*` and `cache: pnpm`. The top-level `env: FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` is workflow-wide and is inherited by the new job; do not repeat it.
- Framework build filter is exactly: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`. The site build resolves cross-package exports through the framework `dist/`, so it must run first.
- Preview upload command is exactly `pnpm --filter site deploy:upload` (which runs `wrangler versions upload -c dist/hono_preact/wrangler.json`); it reads `dist/hono_preact/wrangler.json` produced by `pnpm --filter site build`, so build must precede it.
- The job MUST use `wrangler versions upload` (non-active version), NEVER `wrangler deploy`. Previews must not change the active `framework.sbesh.com` deployment.
- Wrangler authenticates from env: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (existing repo secrets). No new secret.
- The job is PR-scoped: `if: github.event_name == 'pull_request'`, `needs: test`, `permissions: { contents: read, pull-requests: write }`, matching the existing `client-size` and `lighthouse` jobs.
- Sticky comment header is exactly `preview-docs` (so each PR keeps one updating comment).
- No local YAML linter is available (no actionlint / pyyaml / requireable js-yaml). Automated verification is content assertions via `grep`; final YAML validity is confirmed by GitHub parsing the workflow, and the real acceptance test is opening a PR and seeing the preview comment.

---

### Task 1: Add the `preview` job to ci.yml

**Files:**
- Modify: `.github/workflows/ci.yml` (insert a new `preview` job immediately before the `build-and-tag:` job)

**Interfaces:**
- Consumes (existing repo secrets): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Produces: on every pull request, after `test` passes, a non-active version upload and a sticky `preview-docs` PR comment containing the `*.workers.dev` preview URL.

- [ ] **Step 1: Write the failing content-assertion check and run it (job absent, so it fails)**

Run this block. With no `preview` job yet, it must print a FAIL line and exit non-zero:

```bash
F=.github/workflows/ci.yml
fail() { echo "FAIL: $1"; exit 1; }
grep -qE '^  preview:' "$F" || fail "no preview job"
grep -q 'name: Preview deploy' "$F" || fail "no preview job name"
grep -q 'if: github.event_name == .pull_request.' "$F" || fail "preview not PR-scoped"
grep -q 'pnpm --filter site deploy:upload' "$F" || fail "no versions-upload step"
grep -q 'wrangler deploy' "$F" && fail "preview must not use wrangler deploy"
grep -q 'header: preview-docs' "$F" || fail "no sticky preview comment header"
grep -qiE 'workers\.dev' "$F" || fail "no preview URL capture"
grep -q 'CLOUDFLARE_API_TOKEN' "$F" || fail "no CF token in upload step"
echo "PASS: all assertions satisfied"
```

Expected: `FAIL: no preview job`, exit code 1.

(Note: the `grep ... 'wrangler deploy' && fail` guard asserts the *absence* of `wrangler deploy` in ci.yml. ci.yml does not contain that string today, so this guard is satisfied both before and after; it exists to catch a future implementer wiring up the wrong command.)

- [ ] **Step 2: Insert the `preview` job**

Open `.github/workflows/ci.yml`. Find the line `  build-and-tag:` (the job key, indented two spaces). Insert the following job text immediately BEFORE that line, leaving one blank line between the new job's last line and `  build-and-tag:`:

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

      # Upload a NON-ACTIVE version (wrangler versions upload), not a deploy.
      # It serves at a *.workers.dev preview URL and never touches the active
      # framework.sbesh.com deployment or its custom-domain route, so it needs
      # only the account-level Workers Scripts permission the token already has.
      - name: Upload preview version
        id: upload
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          set -o pipefail
          pnpm --filter site deploy:upload 2>&1 | tee /tmp/preview-upload.log
          url="$(grep -ioE 'https://[a-z0-9.-]+\.workers\.dev' /tmp/preview-upload.log | head -1)"
          if [ -z "$url" ]; then
            echo "Could not find a *.workers.dev preview URL in wrangler output" >&2
            exit 1
          fi
          echo "url=$url" >> "$GITHUB_OUTPUT"

      - name: Post preview comment
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: preview-docs
          message: |
            ### Docs site preview

            A non-production preview of this PR (uploaded via `wrangler versions upload`, not the live site):

            ${{ steps.upload.outputs.url }}

            Built from ${{ github.event.pull_request.head.sha }}. Updates on every push.
```

- [ ] **Step 3: Run the content-assertion check again (now passes)**

Re-run the exact block from Step 1.
Expected: `PASS: all assertions satisfied`, exit code 0.

- [ ] **Step 4: Sanity-check indentation against a sibling job**

The new job must sit at the same indentation as `test`, `client-size`, `lighthouse`, and `build-and-tag` (two-space job key, four-space `name:`/`steps:`). Confirm:

```bash
grep -nE '^  (test|client-size|lighthouse|preview|build-and-tag):' .github/workflows/ci.yml
```

Expected: five lines, one per job, all at the same two-space indent, with `preview:` listed before `build-and-tag:`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add PR preview deploys via wrangler versions upload

Build the site on every PR and upload a non-active version (preview URL on
*.workers.dev), posting it as a sticky preview-docs comment. Isolated from
the tag-gated production deploy; reuses the existing Cloudflare secrets."
```

---

### Task 2: Document the preview job in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (extend the existing "Deploying the docs site" section)

**Interfaces:**
- Consumes: the `preview` job from Task 1.
- Produces: an in-repo record so future agents know PRs get an isolated preview distinct from the tag-gated production deploy.

Rationale: `CLAUDE.md` already has a "Deploying the docs site" section (added with the production gate). Future agents need to know PR previews exist, are non-production, and reuse the same secrets. `CLAUDE.md` is not covered by `pnpm format:check` (globs are `packages/**` and `apps/**/src/**`), so there is no format step for this task.

- [ ] **Step 1: Add the preview paragraph**

In `CLAUDE.md`, find the `## Deploying the docs site` section. It ends with a paragraph that begins "So a normal merge to `main` does **not** update the live site" and finishes with the parenthetical about Workers Builds being disabled. Insert the following new paragraph immediately AFTER that paragraph and BEFORE the next heading (`## PR workflow`), separated by a blank line on each side:

```markdown
Pull requests get an isolated **preview deploy** via the `preview` job in `.github/workflows/ci.yml`. It runs `wrangler versions upload` (a non-active version of the same Worker, served at a `*.workers.dev` preview URL) and posts the URL as a sticky `preview-docs` PR comment that updates on every push. Previews never touch the live `framework.sbesh.com` deployment or its route, and reuse the existing `CLOUDFLARE_API_TOKEN` (the upload needs only Workers Scripts: Edit, not the zone Workers Routes permission the production deploy needs).
```

- [ ] **Step 2: Verify the paragraph landed and there are no em-dashes**

```bash
grep -q 'isolated \*\*preview deploy\*\*' CLAUDE.md && echo "paragraph present"
grep -n '—' CLAUDE.md && echo "FAIL: em-dash found" || echo "no em-dashes"
```

Expected: `paragraph present`, then `no em-dashes`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note PR preview deploys in the docs-site deploy section"
```

---

## Prerequisites (operator, outside the repo)

- The account's `workers.dev` subdomain must be enabled for preview URLs to resolve. Cloudflare Workers Builds previews worked previously, so this is expected to already be enabled; the first preview run confirms it.
- No new GitHub secret is needed. Previews reuse `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, and `wrangler versions upload` needs only the Account-level Workers Scripts permission the token already has (it does not call the `/workers/routes` endpoint that the production deploy's zone permission gap currently blocks).

## Acceptance / Verification

- Open a PR. Confirm the `preview` job runs after `test`, the "Upload preview version" step prints a `Version Preview URL`, the step captures it, and the `preview-docs` sticky comment appears with a working `*.workers.dev` URL that renders the branch's docs.
- If the capture step fails to find a URL, the wrangler output wording changed: switch the capture to the structured path (set `WRANGLER_OUTPUT_FILE_DIRECTORY` to a temp dir, then read the emitted `version-upload` JSON record's preview-URL field). Re-run.
- Confirm `framework.sbesh.com` is unchanged after a preview upload (the version is non-active).
- Push a second commit to the same PR and confirm the existing comment updates in place rather than a new one being added.

## Self-Review Notes

- **Spec coverage:** mechanism = `versions upload` (Task 1 upload step + Global Constraints); placement = `preview` job in `ci.yml` (Task 1); `needs: test` / PR-scoped / permissions (Task 1 job header); URL capture with documented fallback (Task 1 step + Acceptance); sticky `preview-docs` comment (Task 1); fork-PR and no-cleanup non-goals (inherent to `pull_request` + not implementing lifecycle); workers.dev subdomain prerequisite + no-new-secret (Prerequisites); documentation (Task 2). All spec sections map to a task or a prerequisite.
- **Non-goals honored:** no `wrangler deploy` (asserted absent in Task 1), no change to `deploy-docs.yml` or release scripts, no preview-version cleanup, no `pull_request_target`.
