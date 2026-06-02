#!/usr/bin/env bash
# Prepare a fresh git worktree for hono-preact development.
#
# Run from INSIDE a newly created worktree (e.g. right after EnterWorktree /
# `git worktree add`). A worktree shares tracked files but starts without the
# gitignored local state and build artifacts this monorepo needs, so this
# script copies that state across, installs deps, and builds the framework
# dist that typecheck + apps/site resolve cross-package types through.
#
# Usage:
#   bash scripts/worktree-setup.sh           # install + build + typecheck
#   bash scripts/worktree-setup.sh --test    # also run the unit test suite
#
# Serena note: .mcp.json launches Serena with `--project .`, which resolves to
# the primary checkout, so Serena keeps indexing main even while you work here.
# In this worktree, use rg/Read/Edit rather than Serena's symbol/edit tools
# (those resolve paths against main) unless you relaunch Serena pointed here.
set -euo pipefail

# Resolve the primary checkout so we can copy gitignored local files from it.
MAIN_ROOT=$(cd "$(git rev-parse --git-common-dir)/.." && pwd -P)
WT_ROOT=$(git rev-parse --show-toplevel)

if [ "$MAIN_ROOT" = "$WT_ROOT" ]; then
  echo "Not in a linked worktree (run this from inside the worktree)." >&2
  exit 1
fi
echo "Main checkout: $MAIN_ROOT"
echo "Worktree:      $WT_ROOT"

# 1) Copy gitignored local files a worktree does not carry.
#    .wrangler/ is intentionally NOT copied: it is local CF emulation state
#    (D1/KV/R2) that regenerates on `wrangler dev`; a stale copy is worse than
#    a cold start.
for f in .env .claude/settings.local.json; do
  if [ -f "$MAIN_ROOT/$f" ] && [ ! -f "$WT_ROOT/$f" ]; then
    mkdir -p "$WT_ROOT/$(dirname "$f")"
    cp "$MAIN_ROOT/$f" "$WT_ROOT/$f"
    echo "copied $f"
  fi
done

# 2) Install deps. pnpm's store is global/content-addressed, so this is mostly
#    linking rather than a fresh download.
pnpm install

# 3) Build the framework dist. typecheck and apps/site resolve cross-package
#    types through the built dist/, so a worktree without it surfaces fake
#    "missing export" errors.
pnpm --filter '@hono-preact/*' --filter hono-preact build

# 4) Baseline. typecheck is the fast must-pass; unit tests are opt-in via --test
#    since the full suite is the slow part.
pnpm typecheck
if [ "${1:-}" = "--test" ]; then
  pnpm test
fi

cat <<EOF

Worktree ready at $WT_ROOT
Reminder: Serena still indexes the MAIN checkout. In this worktree, use
rg/Read/Edit rather than Serena's symbol/edit tools unless you relaunch
Serena pointed here.
EOF
