#!/usr/bin/env python3
"""
PreToolUse hook (matcher: Edit|Write|Bash).

Keeps feature work out of the PRIMARY checkout's default branch and in an
isolated `git worktree` (see CLAUDE.md "Worktree setup"). It is a *soft* gate:
when it trips it asks the user to approve rather than blocking outright, so a
deliberate exception is one keystroke away.

Trips (returns permissionDecision "ask") when EITHER:
  - Edit/Write targets a file in the primary checkout while HEAD is the
    default branch, OR
  - a `git commit` / `git push` would run against the primary checkout while
    HEAD is the default branch.

Always allowed (exits 0, no opinion):
  - anything inside a linked worktree (git-dir != git-common-dir),
  - the primary checkout while on a NON-default branch,
  - Edit/Write under `<toplevel>/.claude/` or `<toplevel>/.git/`,
  - non-git paths, detached HEAD, or any detection error (fail open).

The hook never emits permissionDecision "allow" (that would bypass the normal
permission prompt for every Edit/Write/Bash); it only speaks up to "ask".
"""

import json
import os
import re
import subprocess
import sys

# Matches a `git ... commit` / `git ... push` within a single shell segment
# (does not cross && | ;). `re.search` still finds a git invocation in any
# later segment, e.g. `cd x && git push`.
GIT_MUTATION = re.compile(r"\bgit\b[^&|;]*?\b(commit|push)\b")
# The repo-selecting `git -C <dir>` is a GLOBAL option: it must appear before
# the subcommand. Only scan the text before the subcommand so we don't mistake
# the `commit -C <commit>` "reuse message" option for a directory.
DASH_C = re.compile(r"-C\s+(\S+)")
# First path component (relative to the worktree root) that is exempt.
EXEMPT_TOP = {".claude", ".git"}


def git(args, cwd):
    """Run a git command in `cwd`; return stripped stdout, or None on failure."""
    try:
        out = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def nearest_existing_dir(path):
    """Walk up from `path` to the closest existing directory (a Write target's
    parent may not exist yet); return None if nothing exists."""
    d = path if os.path.isdir(path) else os.path.dirname(path)
    while d and not os.path.isdir(d):
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent
    return d or None


def is_linked_worktree(cwd):
    """True if `cwd` is in a linked worktree, False if the primary checkout,
    None if not a git repo / on error."""
    git_dir = git(["rev-parse", "--absolute-git-dir"], cwd)
    common = git(["rev-parse", "--git-common-dir"], cwd)
    if git_dir is None or common is None:
        return None
    if not os.path.isabs(common):
        common = os.path.join(cwd, common)
    return os.path.realpath(git_dir) != os.path.realpath(common)


def default_branch(cwd):
    ref = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd)
    if ref and ref.startswith("origin/"):
        return ref[len("origin/") :]
    return "main"


def on_primary_default_branch(cwd):
    """True when `cwd` is the primary checkout AND HEAD is its default branch
    (i.e. the situation we want to gate). False/None otherwise."""
    linked = is_linked_worktree(cwd)
    if linked is None or linked:
        return False  # not a repo / error / inside a worktree -> allow
    branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd)
    if not branch:
        return False  # detached HEAD -> allow
    return branch == default_branch(cwd)


def is_exempt_path(file_path, cwd):
    """True for files under the worktree's .claude/ or .git/ (config maintenance)."""
    toplevel = git(["rev-parse", "--show-toplevel"], cwd)
    if not toplevel:
        return False
    try:
        rel = os.path.relpath(os.path.realpath(file_path), os.path.realpath(toplevel))
    except ValueError:
        return False
    first = rel.split(os.sep, 1)[0]
    return first in EXEMPT_TOP


def emit_ask(reason):
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    sys.exit(0)


WORKTREE_HINT = (
    "Per CLAUDE.md this belongs in an isolated `git worktree`: create one "
    "(EnterWorktree, or `git worktree add ../<name>` then `pnpm wt:setup`) and "
    "work there. Approve to proceed on the primary checkout's default branch anyway."
)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input", {}) or {}
    payload_cwd = data.get("cwd") or os.getcwd()

    if tool in ("Edit", "Write"):
        file_path = tool_input.get("file_path")
        if not file_path:
            sys.exit(0)
        probe_dir = nearest_existing_dir(file_path)
        if not probe_dir:
            sys.exit(0)
        if not on_primary_default_branch(probe_dir):
            sys.exit(0)
        if is_exempt_path(file_path, probe_dir):
            sys.exit(0)
        emit_ask(
            f"Worktree guard: {tool} would modify the PRIMARY checkout on its "
            f"default branch ({file_path}). " + WORKTREE_HINT
        )

    elif tool == "Bash":
        command = tool_input.get("command", "")
        mut = GIT_MUTATION.search(command)
        if not mut:
            sys.exit(0)  # cheap short-circuit: not a commit/push
        # Read `-C <dir>` only from before the subcommand so `commit -C <commit>`
        # (reuse-message) is not mistaken for a repo directory.
        m = DASH_C.search(command[: mut.start(1)])
        target_dir = m.group(1).strip("\"'") if m else payload_cwd
        probe_dir = nearest_existing_dir(target_dir) or target_dir
        if not on_primary_default_branch(probe_dir):
            sys.exit(0)
        emit_ask(
            "Worktree guard: this `git commit`/`git push` would run against the "
            "PRIMARY checkout on its default branch. " + WORKTREE_HINT
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
