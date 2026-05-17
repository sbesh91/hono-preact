#!/bin/bash
# PreToolUse hook on Bash. Warns (does not block) when a `git commit` would
# include packages/ changes with no accompanying docs/ changes.
#
# Input on stdin: JSON with `tool_input.command`.
# Exits 0 always; warnings are written to stderr for the agent to see.

cmd=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null <<< "$(cat)")

# Only act on git commit invocations.
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Staged file list. If we can't read it, stay silent.
staged=$(git diff --cached --name-only 2>/dev/null) || exit 0
[ -z "$staged" ] && exit 0

pkg_changed=0
docs_changed=0
while IFS= read -r f; do
  case "$f" in
    packages/*) pkg_changed=1 ;;
    apps/site/src/pages/docs/*) docs_changed=1 ;;
  esac
done <<< "$staged"

if [ "$pkg_changed" = "1" ] && [ "$docs_changed" = "0" ]; then
  echo "keep-docs-fresh: this commit stages packages/ changes but no docs/ updates." >&2
  echo "  Grep apps/site/src/pages/docs/ for any changed/added/renamed public symbols and stage doc updates alongside." >&2
  echo "  If this commit is a pure internal refactor with no public-API surface change, proceed." >&2
fi

exit 0
