# Stable Branch-Named Preview URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PR preview comment link a stable per-branch URL (`https://<branch-alias>-hono-preact.s-beshensky.workers.dev`) instead of the per-commit hash URL.

**Architecture:** In the existing `preview` job's "Upload preview version" step in `.github/workflows/ci.yml`, compute a sanitized DNS-label alias from the PR branch name and pass it to `wrangler versions upload --preview-alias`. The branch name reaches the script only through an `env:` var (injection-safe). The comment step is unchanged; it already renders the captured URL.

**Tech Stack:** GitHub Actions, pnpm, Wrangler (`versions upload --preview-alias`).

## Global Constraints

- No em-dashes in prose or comments (use a comma, colon, semicolon, parentheses, or two sentences). Verbatim from the user's global style rule.
- The branch name (`github.head_ref`) and PR number (`github.event.pull_request.number`) MUST be passed into the step via `env:` vars (`HEAD_REF`, `PR_NUMBER`) and read as `"$HEAD_REF"` / `"$PR_NUMBER"`. They MUST NOT be interpolated as `${{ ... }}` inside the `run:` script (shell-injection vector). `github.head_ref` must appear exactly once in `ci.yml`, on its env line.
- Alias sanitization (exact): lowercase, replace each run of non-`[a-z0-9]` with a single `-`, trim leading/trailing `-`, truncate to 51 characters, strip a trailing `-` left by truncation, and if empty fall back to `pr-<PR number>`. The 51-char cap keeps `<alias>-hono-preact` within the 63-char DNS limit.
- The upload command stays `wrangler versions upload` (via `pnpm --filter site deploy:upload`), NEVER `wrangler deploy`. It only adds `--preview-alias "$alias"`.
- Worker name is `hono-preact`; the account subdomain is `s-beshensky`; so the alias URL is `https://<alias>-hono-preact.s-beshensky.workers.dev`.
- No truncate-plus-hash for over-length branches (accepted limitation per spec). No second URL in the comment (branch URL only). No change to `deploy-docs.yml`, the release scripts, or `CLAUDE.md` (its preview paragraph does not mention URL format, so it stays accurate).
- No local YAML linter is available. Verification is content assertions via `grep`; final validity is confirmed by GitHub on the PR, and the real acceptance test is PR #152's own preview comment updating to the branch URL (this change self-tests there).

---

### Task 1: Pass a sanitized branch alias to wrangler versions upload

**Files:**
- Modify: `.github/workflows/ci.yml` (the `preview` job's "Upload preview version" step)

**Interfaces:**
- Consumes: `github.head_ref`, `github.event.pull_request.number` (via env), existing secrets.
- Produces: `steps.upload.outputs.url` now holds the stable branch-alias URL, consumed unchanged by the "Post preview comment" step.

- [ ] **Step 1: Write the failing content-assertion check and run it (alias not wired yet, so it fails)**

Run this block. Without the change it must print a FAIL line and exit non-zero:

```bash
F=.github/workflows/ci.yml
fail() { echo "FAIL: $1"; exit 1; }
grep -q 'preview-alias' "$F" || fail "no --preview-alias flag"
grep -qF 'HEAD_REF: ${{ github.head_ref }}' "$F" || fail "branch not passed via HEAD_REF env"
grep -qF 'PR_NUMBER: ${{ github.event.pull_request.number }}' "$F" || fail "no PR_NUMBER env"
grep -qF '"$HEAD_REF"' "$F" || fail "script does not read quoted \$HEAD_REF"
[ "$(grep -c 'github\.head_ref' "$F")" = "1" ] || fail "github.head_ref must appear exactly once (the env line only)"
echo "PASS: all assertions satisfied"
```

Expected: `FAIL: no --preview-alias flag`, exit code 1.

- [ ] **Step 2: Replace the upload step**

In `.github/workflows/ci.yml`, replace this exact block:

```yaml
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
```

with this block (same indentation):

```yaml
      - name: Upload preview version
        id: upload
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          # Branch name and PR number pass through env, never interpolated into
          # the run script, so an attacker-influenced ref cannot inject shell.
          # The sanitized alias below contains only [a-z0-9-].
          HEAD_REF: ${{ github.head_ref }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: |
          set -o pipefail
          # Sanitize the branch into a valid DNS label for the preview alias:
          # lowercase, non-alphanumeric runs -> '-', trim, then cap so that
          # "<alias>-hono-preact" stays within the 63-char DNS limit (alias <= 51).
          alias="$(printf '%s' "$HEAD_REF" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
          alias="${alias:0:51}"
          alias="${alias%-}"
          if [ -z "$alias" ]; then alias="pr-${PR_NUMBER}"; fi
          echo "Preview alias: $alias"
          pnpm --filter site deploy:upload -- --preview-alias "$alias" 2>&1 | tee /tmp/preview-upload.log
          url="$(grep -ioE "https://${alias}-[a-z0-9.-]*\.workers\.dev" /tmp/preview-upload.log | head -1)"
          if [ -z "$url" ]; then
            echo "Could not find the aliased *.workers.dev preview URL in wrangler output" >&2
            exit 1
          fi
          echo "url=$url" >> "$GITHUB_OUTPUT"
```

Leave the "Post preview comment" step that follows unchanged.

- [ ] **Step 3: Run the content-assertion check again (now passes)**

Re-run the exact block from Step 1.
Expected: `PASS: all assertions satisfied`, exit code 0.

- [ ] **Step 4: Confirm injection safety and structure by eye**

```bash
grep -n 'github\.head_ref' .github/workflows/ci.yml
```

Expected: exactly one line, the `HEAD_REF: ${{ github.head_ref }}` env line (an `env:`-block line, not a line inside a `run:` script). Confirm the `run:` script references `"$HEAD_REF"` and `"$PR_NUMBER"`, and that `${{ steps.upload.outputs.url }}` is still the only interpolation in the comment body.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(preview): stable branch-named preview URL via --preview-alias

Derive a sanitized DNS-label alias from the PR branch and pass it to
wrangler versions upload --preview-alias, so the preview comment links a
stable per-branch URL instead of the per-commit hash. Branch name passes
through an env var, never interpolated into the run script."
```

---

## Acceptance / Verification

- This change self-tests on PR #152. After pushing, confirm the `preview` job logs `Preview alias: ci-pr-preview-deploys`, runs the upload with `--preview-alias`, and the `preview-docs` comment updates to `https://ci-pr-preview-deploys-hono-preact.s-beshensky.workers.dev`.
- Confirm that URL returns HTTP 200 and renders the docs.
- Confirm a second push to the PR leaves the URL unchanged (it is stable per branch) and updates the existing comment in place.
- If `pnpm --filter site deploy:upload -- --preview-alias "$alias"` does not forward the flag to wrangler (the alias would be missing from the upload and the aliased-URL grep would fail the step), switch the upload line to the explicit form `pnpm --filter site exec wrangler versions upload -c dist/hono_preact/wrangler.json --preview-alias "$alias"` and re-run.
- If the aliased-URL grep finds nothing despite a successful upload, the wrangler output wording changed: switch the capture to the structured path (`WRANGLER_OUTPUT_FILE_DIRECTORY` + the emitted `version-upload` JSON record's preview-URL field), as the spec documents.

## Self-Review Notes

- **Spec coverage:** mechanism `--preview-alias` (Task 1 Step 2 + Global Constraints); branch source `github.head_ref` (Step 2 env); sanitization rule exact (Global Constraints + Step 2 script); injection safety via env var, head_ref appears once (Global Constraints + Step 1 assertion + Step 4); alias URL form and worker/subdomain names (Global Constraints + Acceptance); capture the alias-prefixed URL with fallbacks (Step 2 + Acceptance); branch-URL-only comment unchanged (Step 2 leaves comment step alone); self-test on #152 (Acceptance). All spec sections map to the task or a verification step.
- **Non-goals honored:** no `wrangler deploy`, no truncate-plus-hash, no second comment URL, no change to `deploy-docs.yml` / release scripts / `CLAUDE.md`.
