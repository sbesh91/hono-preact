#!/usr/bin/env python3
"""PreToolUse(Bash) nudge.

This session has no Grep tool; symbol searches happen as `rg`/`grep` shell
commands run through Bash. When such a command looks like it is hunting a
TypeScript symbol (a definition or a call site), remind the agent to prefer
Serena's symbol-aware tools instead.

Non-blocking: the command always proceeds; this only injects a reminder when
the heuristic matches. Tune the heuristic or flip it to a block in
.claude/settings.json if symbol greps keep slipping past it.
"""
import sys, json, re

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

ti = data.get("tool_input", data) or {}
cmd = (ti.get("command") or "").strip()
if not cmd:
    sys.exit(0)

# Only react to search commands (rg / grep family / ag), as a command word.
if not re.search(r"(^|[|;&]\s*|\s)(rg|ripgrep|grep|egrep|fgrep|ag)\b", cmd):
    sys.exit(0)

# Is the search aimed at TypeScript, or unscoped enough to hit it?
ts_targeted = bool(re.search(r"\.tsx?\b|\*\.tsx?|\{[^}]*\btsx?\b[^}]*\}|--type[= ]+ts|-t\s*ts|\btypescript\b", cmd))
has_scope = bool(re.search(r"(--glob|\s-g\b|--type|\s-t\b|\*\.[A-Za-z0-9]+)", cmd))
if not (ts_targeted or not has_scope):
    sys.exit(0)

# Does a search term look like a symbol rather than prose/regex?
# Identifiers must start with a letter/underscore, never "$" (that would catch
# shell variables like $1 / $pattern / $file and fire on ordinary commands).
IDENT = r"[A-Za-z_][A-Za-z0-9_]*"
term = None
m = re.search(rf"""(['"])({IDENT})\(?\1""", cmd)  # quoted identifier
if m:
    term = m.group(2)
elif re.search(rf"(?<![-\w])(function|class|interface|type|enum)\s+{IDENT}", cmd):
    term = re.search(rf"(?<![-\w])(function|class|interface|type|enum)\s+{IDENT}", cmd).group(0)
else:
    # bare first non-flag argument after the search command
    toks = cmd.split()
    for i, t in enumerate(toks):
        if re.fullmatch(r"(rg|ripgrep|grep|egrep|fgrep|ag)", t):
            for nxt in toks[i + 1:]:
                if nxt.startswith("-"):
                    continue
                if re.fullmatch(rf"{IDENT}\(?", nxt):
                    term = nxt
                break
            break
if not term:
    sys.exit(0)

msg = (
    f"Serena nudge: this looks like a TypeScript symbol search ({term!r}). "
    "Prefer Serena's symbol-aware tools over rg/grep. If their schemas aren't "
    "loaded yet, run ToolSearch with "
    "'select:mcp__serena__find_symbol,mcp__serena__find_referencing_symbols' "
    "first, then use find_symbol (definitions) or find_referencing_symbols "
    "(call sites). Fall back to this search only if Serena comes up empty."
)
print(json.dumps({
    "systemMessage": msg,
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "additionalContext": msg,
    },
}))
