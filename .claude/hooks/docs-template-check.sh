#!/bin/bash
# PostToolUse hook on Edit|Write. Soft-warns when a docs .mdx page is written
# that is missing the required sections for its template. Never blocks: it
# writes notes to stderr for the agent to see and always exits 0.
#
# Templates are inferred from the file path:
#   apps/site/src/pages/docs/components/*.mdx  -> Reference template
#   apps/site/src/pages/docs/*.mdx (elsewhere) -> Guide template
# index.mdx pages (area overviews) are exempt.
#
# Required pillars (warned on if missing):
#   Prose    : an `# h1` followed by a lead paragraph.
#   Examples : >=1 fenced code block, or an <Example> live demo.
#   API ref  : (Reference template only) a `## API reference`, `## Signature`,
#              or `## Options`/`## Parameters` heading plus a markdown table.
# Recommended (component pages only -- those with a live demo or styling):
#   ## Demo, ## Styling, ## Accessibility. Reported as optional, never blocks.
# Hook/primitive pages (no live demo) are never nagged about those.
#
# See .claude/skills/add-docs-page.md (Page templates) for the canonical
# skeletons the author should target.

# Read the written file path from the tool input JSON on stdin. Try the nested
# tool_input.file_path first, fall back to a top-level file_path.
file_path=$(python3 -c "import sys,json; d=json.load(sys.stdin); ti=d.get('tool_input',{}); print(ti.get('file_path') or d.get('file_path') or '')" 2>/dev/null <<< "$(cat)")

# Only act on docs .mdx files.
case "$file_path" in
  *apps/site/src/pages/docs/*.mdx) ;;
  *) exit 0 ;;
esac

# Exempt area-overview pages.
[ "$(basename "$file_path")" = "index.mdx" ] && exit 0

# Must exist on disk (post-write).
[ -f "$file_path" ] || exit 0

# Infer template from path.
case "$file_path" in
  *apps/site/src/pages/docs/components/*) template="reference" ;;
  *) template="guide" ;;
esac

# --- Parse the file ------------------------------------------------------

has_h1=0
grep -qE '^# ' "$file_path" && has_h1=1

# Lead paragraph: a prose line between the h1 and the first '## '. Lines before
# the h1 (imports, etc.) are ignored; blank/heading/import/fence/JSX lines after
# the h1 do not count as prose.
has_lead=$(awk '
  BEGIN { seen=0; done=0; found=0 }
  !seen && /^# / { seen=1; next }
  seen && /^## / { done=1 }
  done { next }
  seen {
    if ($0 ~ /^[[:space:]]*$/) next
    if ($0 ~ /^import /) next
    if ($0 ~ /^#/) next
    if ($0 ~ /^```/) next
    if ($0 ~ /^</) next
    found=1
  }
  END { print found }
' "$file_path")

# Examples: at least one fenced code block OR an <Example> live demo.
fence_lines=$(grep -cE '^```' "$file_path")
has_example_tag=0
grep -q '<Example' "$file_path" && has_example_tag=1

# Headings (##/###), lowercased, for alias matching.
headings=$(grep -E '^#{2,3} ' "$file_path" | tr '[:upper:]' '[:lower:]')

# A GFM table separator row, e.g. | --- | --- | or |:--|--:|.
has_table=0
grep -qE '^[[:space:]]*\|?([[:space:]]*:?-+:?[[:space:]]*\|)+' "$file_path" && has_table=1

# --- Validate ------------------------------------------------------------

missing=()
recommend=()

# Prose pillar (both templates).
if [ "$has_h1" = "0" ] || [ "$has_lead" = "0" ]; then
  missing+=("Prose: an \`# Title\` heading followed by a lead paragraph (what it does and why).")
fi

# Examples pillar (both templates).
if [ "$fence_lines" -lt 1 ] && [ "$has_example_tag" = "0" ]; then
  missing+=("Examples: at least one fenced code block or an <Example> live demo.")
fi

if [ "$template" = "reference" ]; then
  # API reference pillar (required). Accept the component heading (API reference)
  # and the hook/primitive headings (Signature, Options, Parameters).
  api_heading=0
  printf '%s\n' "$headings" | grep -qE '^#{2,3} (api reference|signature|options|parameters)' && api_heading=1
  if [ "$api_heading" = "0" ] || [ "$has_table" = "0" ]; then
    missing+=("API reference: a \`## API reference\`, \`## Signature\`, or \`## Options\`/\`## Parameters\` section with a prop/options markdown table.")
  fi

  # Recommended sections apply to component pages (those with a live demo or a
  # styling section). Hook/primitive pages have neither and are not nagged.
  is_component=0
  [ "$has_example_tag" = "1" ] && is_component=1
  printf '%s\n' "$headings" | grep -qE '^#{2,3} (styling|demo)' && is_component=1
  if [ "$is_component" = "1" ]; then
    printf '%s\n' "$headings" | grep -qE '^#{2,3} demo' || recommend+=("## Demo with an <Example> live demo")
    printf '%s\n' "$headings" | grep -qE '^#{2,3} styling' || recommend+=("## Styling")
    printf '%s\n' "$headings" | grep -qE '^#{2,3} accessibility' || recommend+=("## Accessibility")
  fi
fi
# Guide template: prose + examples are the only checks (many guides are pure
# tutorial), keeping the hook's signal clean.

# --- Ordering nudge (R1/R2/R3) ------------------------------------------
# Delegate to the shared classifier so the hook and the CI gate can never
# drift. node runs the .ts directly via native type-stripping (the project's
# engines floor, ^22.18.0 || >=24.11.0, supports it). --disable-warning keeps
# stderr clean on versions that still print the type-stripping ExperimentalWarning.
# Soft-warn only; never blocks.
if command -v node >/dev/null 2>&1; then
  repo_root="${file_path%%/apps/site/*}"
  cli="${repo_root}/apps/site/scripts/docs-structure.ts"
  if [ -f "$cli" ]; then
    order_out=$(node --disable-warning=ExperimentalWarning "$cli" "$file_path" 2>&1)
    if [ -n "$order_out" ]; then
      echo "docs-template-check: canonical order (see add-docs-page skill):" >&2
      echo "$order_out" | sed 's/^/    /' >&2
    fi
  fi
fi

# --- Report --------------------------------------------------------------

[ ${#missing[@]} -eq 0 ] && [ ${#recommend[@]} -eq 0 ] && exit 0

rel="${file_path#*hono-preact/}"
echo "docs-template-check: ${rel} (${template} template)" >&2

if [ ${#missing[@]} -gt 0 ]; then
  echo "  Missing required sections:" >&2
  for m in "${missing[@]}"; do
    echo "    - ${m}" >&2
  done
fi

if [ ${#recommend[@]} -gt 0 ]; then
  echo "  Recommended (optional):" >&2
  for r in "${recommend[@]}"; do
    echo "    - ${r}" >&2
  done
fi

echo "  See .claude/skills/add-docs-page.md (Page templates) for the full skeleton." >&2

exit 0
