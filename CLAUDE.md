# hono-preact

## Tooling notes for AI agents

**Serena MCP is configured** (see `.mcp.json`). For code navigation and symbol-level edits, prefer Serena's tools over grep + Read + Edit:

- `find_symbol`, `get_symbols_overview` instead of grepping for definitions
- `find_references` instead of grepping for call sites
- `replace_symbol_body`, `insert_before_symbol`, `insert_after_symbol` for structural edits

Grep + Read remain correct for prose, config files, and quick one-offs. Use Serena when you'd otherwise re-read the same TS/TSX file multiple times to locate a symbol.

If Serena is unavailable in a session (run `/mcp` to check), fall back to native tools.

## PR workflow

Any time a PR is opened, immediately run a deep PR review as the first follow-up step (before any other post-open work).

The deep review must include these checks beyond correctness, style, and types:

- **Replacement parity.** When a PR replaces or rewrites a subsystem (handler, hook, plugin, generated entry, resolver), enumerate every behavior the predecessor had and verify each one survives in the replacement. Read the deleted or renamed files via git history (`git show <pre-PR-sha>:path` or the PR's deletion diff). Do not trust comments in the new code that claim "X is preserved" or "X is folded in elsewhere"; treat them as hypotheses and confirm by reading the code they point to.
- **Cross-cutting concerns end-to-end.** For each request path the PR touches, trace middleware composition, auth/permission gates, caching, observability hooks, and error reporting all the way through the new path and compare to the pre-PR path. A silently dropped middleware layer (especially anything auth- or permission-adjacent) is a P0 finding that blocks merge.
