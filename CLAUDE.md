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
