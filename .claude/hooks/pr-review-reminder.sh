#!/usr/bin/env python3
"""PostToolUse(Bash) reminder: after `gh pr create` succeeds, prompt the deep PR review.

The repo's review policy (CLAUDE.md -> REVIEW.md) is that opening a PR is
immediately followed by a deep review. A PR opened from a Claude Code session
runs through the Bash tool as `gh pr create`, so this hook injects the review
prompt right after the new PR URL comes back.

Non-blocking and success-gated: it stays silent unless the command was a
`gh pr create` AND the tool output contains a created-PR URL, so a failed,
aborted, or dry-run invocation does not trigger a phantom review. The policy in
CLAUDE.md / REVIEW.md is the backstop if the URL is ever not captured.

Input on stdin: PostToolUse JSON with `tool_input.command` and `tool_response`.
"""
import sys, json, re

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

ti = data.get("tool_input", {}) or {}
cmd = ti.get("command") or ""

# Only react to `gh pr create` (tolerate flags, pipes, and env prefixes around it).
if not re.search(r"\bgh\s+pr\s+create\b", cmd):
    sys.exit(0)

# Success gate: `gh pr create` prints the new PR URL on success. Serialize the
# whole tool_response (field shape varies) and require a created-PR URL so we
# never fire on a failed creation.
resp = json.dumps(data.get("tool_response", ""))
m = re.search(r"https://github\.com/[^\s\"']+/pull/\d+", resp)
if not m:
    sys.exit(0)
pr_url = m.group(0)

msg = (
    f"PR opened ({pr_url}). Per the repo review policy, run the deep PR review "
    "NOW as the first follow-up step, before any other post-open work. Read "
    "REVIEW.md at the repo root and work its checklist against this PR's diff: "
    "the six lenses (performance, maintainability, effective testing, "
    "modularity, bundle size, effective use of web platform features) plus the "
    "repo-specific must-checks (replacement parity, cross-cutting concerns "
    "end-to-end, public-API/breaking-change surface, docs sync). Report findings "
    "by severity; a silently dropped auth/permission middleware layer is a P0 "
    "that blocks merge."
)

print(json.dumps({
    "systemMessage": msg,
    "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": msg,
    },
}))
