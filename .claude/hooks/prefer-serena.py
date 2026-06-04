#!/usr/bin/env python3
"""PreToolUse(Bash) nudge, narrowed to edit-intent symbol searches.

This session has no Grep tool; symbol searches happen as `rg`/`grep` shell
commands run through Bash. Plain read/measure searches are fine on rg and are
NOT nudged. This hook fires only when a search looks like the front half of a
*textual refactor* of a TypeScript symbol: an rg/grep whose matches feed an
in-place rewrite (`sed -i`, `perl -pi`, `sd`, `... | xargs sed`, etc.). That is
the one case where Serena clearly wins: a blind find-and-replace can miss call
sites or rewrite re-exports, strings, and same-named locals, whereas
`find_referencing_symbols` / `rename_symbol` operate on the symbol graph.

Non-blocking: the command always proceeds; this only injects a reminder when
the heuristic matches. Tune the heuristic or flip it to a block in
.claude/settings.json if textual refactors keep slipping past it.
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

# 1. Only react to search commands (rg / grep family / ag), as a command word.
#    Boundary class includes `(` and backtick so `sed ... $(rg -l ...)` and
#    legacy `` `rg ...` `` command substitution are detected, not just piped forms.
if not re.search(r"(^|[|;&(`]\s*|\s)(rg|ripgrep|grep|egrep|fgrep|ag)\b", cmd):
    sys.exit(0)

# 2. EDIT-INTENT GATE (the narrowing). Exit silently unless the command also
#    carries an in-place text mutator. A bare search, a count (`| wc -l`), or a
#    file list (`rg -l`) piped into a read (`| xargs wc`) all pass through here
#    untouched. Mutators: sed/gsed -i, perl -i/-pi, sd, sponge, or any of those
#    downstream of `xargs`.
MUTATOR = re.compile(
    r"""\bg?sed\b[^|;&\n]*(-i\b|--in-place|-i\.\w+)   # sed -i / --in-place / -i.bak
      | \bperl\b[^|;&\n]*(-p?i\b|-i\.\w+|-p\s+-i\b)   # perl -i / -pi / -p -i
      | (^|[|;&]\s*|xargs\s+)g?sd\b                   # sd (edits in place by default)
      | \bsponge\b                                    # moreutils sponge
      | \|\s*xargs\b[^|]*\b(g?sed|perl|g?sd)\b        # grep | xargs <mutator>
    """,
    re.VERBOSE,
)
if not MUTATOR.search(cmd):
    sys.exit(0)

# 3. Is the search aimed at TypeScript, or unscoped enough to hit it?
ts_targeted = bool(re.search(r"\.tsx?\b|\*\.tsx?|\{[^}]*\btsx?\b[^}]*\}|--type[= ]+ts|-t\s*ts|\btypescript\b", cmd))
has_scope = bool(re.search(r"(--glob|\s-g\b|--type|\s-t\b|\*\.[A-Za-z0-9]+)", cmd))
if not (ts_targeted or not has_scope):
    sys.exit(0)

# 4. Does a search term look like a symbol rather than prose/regex?
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
    # bare first non-flag argument after the search command. Strip a leading
    # `$(` / backtick so command-substitution tokens like `$(rg` still match.
    toks = cmd.split()
    for i, t in enumerate(toks):
        if re.fullmatch(r"(rg|ripgrep|grep|egrep|fgrep|ag)", t.lstrip("$(`")):
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
    f"Serena nudge: this looks like a textual rewrite of a TypeScript symbol "
    f"({term!r}) via a shell mutator. A blind find-and-replace can miss call "
    "sites or rewrite re-exports, strings, and same-named locals. For a rename "
    "or signature change, Serena is safer: find_referencing_symbols enumerates "
    "the real call sites and rename_symbol rewrites them on the symbol graph. "
    "Load schemas once with ToolSearch 'select:mcp__serena__find_referencing_"
    "symbols,mcp__serena__rename_symbol', then use those. Proceed with this "
    "command if you have already scoped the change and a textual rewrite is "
    "what you want."
)
print(json.dumps({
    "systemMessage": msg,
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "additionalContext": msg,
    },
}))
