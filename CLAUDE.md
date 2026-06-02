# hono-preact

## Tooling notes for AI agents

**Serena MCP is configured** (see `.mcp.json`). For code navigation and symbol-level edits, prefer Serena's tools over `rg`/`grep` + Read + Edit:

- `find_symbol`, `get_symbols_overview` instead of grepping for definitions
- `find_referencing_symbols` instead of grepping for call sites
- `replace_symbol_body`, `insert_before_symbol`, `insert_after_symbol` for structural edits

**MANDATORY trigger:** before running any `rg`/`grep` (via Bash) whose target is a TypeScript *definition* or *call site*, you MUST first try Serena. There is no Grep tool in this harness; symbol searches go through Bash, and a `PreToolUse` hook (`.claude/hooks/prefer-serena.py`) will nudge you when it spots one. Serena's tools are deferred, so load them once per session with `ToolSearch` (`select:mcp__serena__find_symbol,mcp__serena__find_referencing_symbols`), then call them. Only fall back to `rg`/`grep` if Serena returns nothing.

`rg`/`grep` + Read remain correct for prose, config files, and quick one-offs.

If Serena is unavailable in a session (run `/mcp` to check), fall back to native tools.

## Worktree setup

When feature work runs in a fresh `git worktree`, the worktree shares tracked files but starts without the gitignored local state and build artifacts this monorepo needs. Run `pnpm wt:setup` (i.e. `bash scripts/worktree-setup.sh`) from inside the new worktree to bring it up: it copies `.env` and `.claude/settings.local.json` from the primary checkout, runs `pnpm install`, builds the framework `dist/`, and runs `pnpm typecheck`. Add `-- --test` to also run the unit suite (`pnpm wt:setup -- --test`).

Two caveats the script cannot fix for you:

- **Serena stays on the main checkout.** `.mcp.json` launches Serena with `--project .`, which binds to the primary checkout, so Serena keeps indexing main even while you work in the worktree. There is no in-session re-point tool. In a worktree, use `rg`/Read/Edit and do **not** use Serena's symbol/edit tools (they resolve paths against main, so an edit would land in the wrong tree). Re-pointing Serena needs an MCP restart against the worktree path, only worth it for large structural refactors.
- **It is not auto-run.** Creating a worktree (e.g. via `EnterWorktree`) does not trigger setup; run `pnpm wt:setup` as the explicit next step.

`.wrangler/` is intentionally not copied: it is local Cloudflare emulation state that regenerates on `wrangler dev`, and a stale copy is worse than a cold start.

## Pre-push verification

Before `git push` (especially before opening a PR), run the same checks CI runs, in the same order CI runs them. Skipping any of these means CI catches a failure you should have caught locally, which wastes a round-trip.

The CI pipeline lives in `.github/workflows/ci.yml`. Mirror it locally:

1. `pnpm --filter '@hono-preact/*' --filter hono-preact build` (framework dist must be current; `pnpm typecheck` and `apps/site` resolve cross-package types through the published `dist/`, so stale dist surfaces as fake "missing export" errors).
2. `pnpm format:check`
3. `pnpm typecheck`
4. `pnpm test:coverage` (or `pnpm test` if coverage isn't needed locally).
5. `pnpm test:integration`
6. `pnpm --filter site build`

If `format:check` fails, run `pnpm format` to fix and commit the result. Do not push commits that you have not personally seen pass these six steps. The single biggest miss is `format:check`, which is fast to run and trivially fixable, but reliably forgotten.

## PR workflow

Any time a PR is opened, immediately run a deep PR review as the first follow-up step (before any other post-open work).

The deep review must include these checks beyond correctness, style, and types:

- **Replacement parity.** When a PR replaces or rewrites a subsystem (handler, hook, plugin, generated entry, resolver), enumerate every behavior the predecessor had and verify each one survives in the replacement. Read the deleted or renamed files via git history (`git show <pre-PR-sha>:path` or the PR's deletion diff). Do not trust comments in the new code that claim "X is preserved" or "X is folded in elsewhere"; treat them as hypotheses and confirm by reading the code they point to.
- **Cross-cutting concerns end-to-end.** For each request path the PR touches, trace middleware composition, auth/permission gates, caching, observability hooks, and error reporting all the way through the new path and compare to the pre-PR path. A silently dropped middleware layer (especially anything auth- or permission-adjacent) is a P0 finding that blocks merge.

## Type casts

When the code needs a cast, the cast is usually the smell. Prefer reshaping the type. Apply this when writing plans too, not just when writing code; a cast prescribed in a plan ships as a cast unless someone notices. Common reshapes that come up here:

- **`as Record<symbol, unknown>` to read a symbol-keyed property**: declare the symbol key on the value's type and use `in` narrowing or a type predicate.
- **`as <StatusCode>` to widen a literal**: type the source field as the wider type from the start (e.g. `SerializedEnvelope.status: ContentfulStatusCode`).
- **`as T` after a runtime check**: write the check as a type predicate (`function isT(x): x is T`) so narrowing carries through.

Acceptable cast boundaries (where reshape doesn't help): parsing untrusted JSON, reading FormData entries, structural reads off user-defined module exports. Don't fight these.
