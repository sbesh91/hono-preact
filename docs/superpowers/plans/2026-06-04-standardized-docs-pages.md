# Standardized Docs Pages + Validator Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codify two docs-page templates (Guide/Concept, Component/Reference) and add a soft-warn Claude hook that validates a docs `.mdx` page against its template's three required pillars (prose, examples, API reference).

**Architecture:** A new PostToolUse `Edit|Write` hook (`docs-template-check.sh`) infers the template from the file path, parses the written `.mdx` with grep/awk, and writes a non-blocking stderr note listing any missing required sections. The canonical skeletons live in the `add-docs-page` skill (single source of truth); the hook is a thin, lenient validator. No app code, no new components, no MDX-pipeline change.

**Tech Stack:** Bash + grep + awk + python3 (JSON parse), Claude Code hooks (`.claude/settings.json`), Markdown skills.

**Spec:** `docs/superpowers/specs/2026-06-04-standardized-docs-pages-design.md`

---

## Implementation notes (as shipped, PR #75 on branch `standardize-docs-pages`)

Two deviations from the hook draft below, discovered when PR #74's new
component-area pages (`use-dismiss`, `use-focus-return`, `use-position`) revealed
a third, leaner hook-page shape whose API surface lives under a bare `## Options`
(no `## Signature` or `## API reference`):

1. **API-reference pillar aliases widened** to `## API reference`, `## Signature`,
   `## Options`, or `## Parameters` (plus a table), not just the first two. The
   draft regex (`api reference|signature`) would have false-warned on the three
   bare-`## Options` hook pages.
2. **Recommended Demo/Styling/Accessibility nudges gated on an "is-component"
   signal** (a live `<Example>` or a `## Styling`/`## Demo` heading) instead of a
   `## Signature` check, so hook/primitive pages are never nagged about those.

Ratification: the shipped hook produces zero output across all 31 validated docs
pages (2 `index.mdx` overviews exempt). The lone non-conforming page,
`deployment.mdx`, got a one-line lead paragraph so it meets the Prose pillar; that
edit is an extra commit not in the task list below. The embedded script in Task 1
is the original draft and is kept for the historical record; the version that
shipped is `.claude/hooks/docs-template-check.sh`.

---

## File Structure

| File | Responsibility |
|---|---|
| `.claude/hooks/docs-template-check.sh` | **New.** Parse a docs `.mdx`, infer its template, warn on missing required sections. Always exit 0. |
| `.claude/settings.json` | **Modify.** Register the hook under the existing PostToolUse `Edit|Write` group. |
| `.claude/skills/add-docs-page.md` | **Modify.** Add a "Page templates" section (the source-of-truth skeletons) and a checklist line. |
| `.claude/skills/keep-docs-fresh.md` | **Modify.** One-line cross-reference to the structure check. |

**Output-stream note:** the hook writes to **stderr and exits 0**, mirroring the existing `keep-docs-fresh-commit.sh` convention ("warnings are written to stderr for the agent to see"). If the model turns out not to surface stderr on exit 0 in this Claude Code version, the trivial upgrade is to emit JSON on stdout with `hookSpecificOutput.additionalContext`. That upgrade is out of scope here; we match the repo's existing hooks.

**Robust input parse:** the existing `keep-docs-fresh.sh` reads `file_path` at the JSON top level, while `keep-docs-fresh-commit.sh` reads `tool_input.command`. To work regardless of payload shape, the new hook reads `tool_input.file_path` and falls back to top-level `file_path`.

---

## Task 1: Write the validator hook

**Files:**
- Create: `.claude/hooks/docs-template-check.sh`

- [ ] **Step 1: Write the hook script**

Create `.claude/hooks/docs-template-check.sh` with exactly this content:

````bash
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
#   Prose      : an `# h1` followed by a lead paragraph.
#   Examples   : >=1 fenced code block, or an <Example> live demo.
#   API ref    : (Reference template only) a `## API reference` or `## Signature`
#                heading plus a markdown table.
# Recommended (component variant of the Reference template only): ## Demo,
# ## Styling, ## Accessibility. Reported as optional, never a blocker.
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
  # API reference pillar (required).
  api_heading=0
  printf '%s\n' "$headings" | grep -qE '^#{2,3} (api reference|signature)' && api_heading=1
  if [ "$api_heading" = "0" ] || [ "$has_table" = "0" ]; then
    missing+=("API reference: a \`## API reference\` or \`## Signature\` section with a prop/options markdown table.")
  fi

  # Recommended sections apply to the component variant only. Primitive/hook
  # pages use the Signature/Example shape and are not nagged about these.
  is_primitive=0
  printf '%s\n' "$headings" | grep -qE '^#{2,3} signature' && is_primitive=1
  if [ "$is_primitive" = "0" ]; then
    printf '%s\n' "$headings" | grep -qE '^#{2,3} demo' || recommend+=("## Demo with an <Example> live demo")
    printf '%s\n' "$headings" | grep -qE '^#{2,3} styling' || recommend+=("## Styling")
    printf '%s\n' "$headings" | grep -qE '^#{2,3} accessibility' || recommend+=("## Accessibility")
  fi
fi
# Guide template: prose + examples are the only checks. A reference/options
# table is encouraged in the skill but not nagged here (many guides are pure
# tutorial), to keep the hook signal clean.

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
````

- [ ] **Step 2: Make it executable**

Run: `chmod +x .claude/hooks/docs-template-check.sh`
Expected: no output, exit 0.

- [ ] **Step 3: Verify it is silent on a non-docs path**

Run:
```bash
echo '{"tool_input":{"file_path":"/tmp/foo.ts"}}' | .claude/hooks/docs-template-check.sh; echo "exit=$?"
```
Expected: no stderr/stdout, then `exit=0`.

- [ ] **Step 4: Verify it is silent on an exempt index.mdx**

Run:
```bash
echo '{"tool_input":{"file_path":"'"$PWD"'/apps/site/src/pages/docs/components/index.mdx"}}' | .claude/hooks/docs-template-check.sh; echo "exit=$?"
```
Expected: no output, then `exit=0`.

- [ ] **Step 5: Verify it ratifies every existing docs page (no required warnings)**

Run:
```bash
for f in $(find apps/site/src/pages/docs -name '*.mdx'); do
  out=$(echo "{\"tool_input\":{\"file_path\":\"$f\"}}" | .claude/hooks/docs-template-check.sh 2>&1)
  if echo "$out" | grep -q "Missing required sections"; then
    echo "=== REQUIRED-WARN: $f ==="; echo "$out"
  fi
done
echo "scan complete"
```
Expected: only `scan complete` (no `REQUIRED-WARN` blocks). This proves the standard ratifies the 25 non-index pages. If any page prints a required warning, the fix is in the hook's parser (loosen the pillar check), **not** in the docs page, because the standard must match current reality.

- [ ] **Step 6: Verify it warns on a deliberately broken Reference page**

Run:
```bash
cat > apps/site/src/pages/docs/components/__fixture.mdx <<'MDX'
# Broken
A page with prose and a code example but no API reference section.

```ts
const x = 1;
```
MDX
echo '{"tool_input":{"file_path":"'"$PWD"'/apps/site/src/pages/docs/components/__fixture.mdx"}}' | .claude/hooks/docs-template-check.sh
rm apps/site/src/pages/docs/components/__fixture.mdx
```
Expected (on stderr): a `docs-template-check: ... (reference template)` block whose "Missing required sections" list contains the `API reference` line, plus an optional "Recommended" list (Demo/Styling/Accessibility). Confirm the fixture file is removed afterward (`git status` shows no `__fixture.mdx`).

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/docs-template-check.sh
git commit -m "feat(hooks): add docs-template-check validator hook"
```

---

## Task 2: Register the hook in settings.json

**Files:**
- Modify: `.claude/settings.json`

- [ ] **Step 1: Add the hook to the existing PostToolUse Edit|Write group**

Replace the entire contents of `.claude/settings.json` with:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/keep-docs-fresh.sh"
          },
          {
            "type": "command",
            "command": ".claude/hooks/docs-template-check.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/keep-docs-fresh-commit.sh"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/prefer-serena.py"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Validate the JSON parses**

Run: `python3 -m json.tool .claude/settings.json > /dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "chore(hooks): register docs-template-check on PostToolUse Edit|Write"
```

---

## Task 3: Add the "Page templates" section to the add-docs-page skill

**Files:**
- Modify: `.claude/skills/add-docs-page.md`

- [ ] **Step 1: Insert the "Page templates" section before the "## Checklist" heading**

In `.claude/skills/add-docs-page.md`, locate the line `## Checklist` and insert the following block immediately **before** it (leave the existing `## Checklist` section in place; it is amended in Step 2):

````markdown
## Page templates

Every docs page rests on three pillars: **prose**, **examples**, **API reference**. The `docs-template-check` hook (PostToolUse) infers the page's template from its path and soft-warns on stderr if a required pillar is missing. It never blocks. Match one of the two templates below.

| Pillar | What it is | How the hook recognizes it |
|---|---|---|
| Prose | What the page documents and why it exists | An `# Title` h1 followed by a lead paragraph before the first `##` |
| Examples | Realistic code, common case first | At least one fenced code block, or an `<Example>` live demo |
| API reference | The configurable surface | A `## API reference` or `## Signature` heading plus a GFM table |

`index.mdx` pages (area overviews) are exempt from the hook.

### Guide template (`docs/*.mdx`)

```
# Title
<lead paragraph: what this does and why it exists>

## How it works            (or the first concept section)
  …prose interleaved with code examples…

## Options / <reference>   (a GFM table of the API the page documents)

<cross-links to related docs pages>
```

- **Required:** Prose, Examples.
- **Recommended:** a reference/options table where the page documents configurable API; cross-links to related pages.

Reference implementations: `loaders.mdx`, `actions.mdx`.

### Component/Reference template (`docs/components/*.mdx`)

Two variants. The hook's required set is their common core (Prose + Examples + API reference); the component variant additionally gets optional nudges for `## Demo`, `## Styling`, `## Accessibility`.

**Component variant** (reference implementation: `components/dialog.mdx`):

```
# Name
<lead: what it is, why it exists, "ships unstyled" if applicable>

## Demo          (<Example> wrapping a live demo)
## Usage         (common-case code)
## Styling       (CSS + Tailwind via <CodeTabs>)
## API reference (markdown prop tables, one per part)
## Accessibility
```

**Primitive/hook variant** (reference implementations: `use-render.mdx`, `merge-refs.mdx`, `use-controllable-state.mdx`):

```
# name
<lead paragraph>

## Signature
### Options / ### Parameters   (markdown table)
## Example
```

- **Required (both variants):** Prose, Examples, API reference (`## API reference` or `## Signature` + a table).
- **Recommended (component variant):** `## Demo` with `<Example>`, `## Styling`, `## Accessibility`.

### Shared UI

Use the existing docs components rather than rolling new markup:

- `<Example>` (from `components/docs/Example.js`) frames a live demo.
- `<CodeTabs labels={[...]}>` (from `components/docs/CodeTabs.js`) for multi-flavor code (e.g. CSS + Tailwind).
- API reference tables are plain GFM markdown tables (styled by `.mdx-content`).

````

- [ ] **Step 2: Add a checklist line for template conformance**

In the same file, find the `## Checklist` block and add this line as the last checklist item (after the existing `pnpm test docs/__tests__` line):

```markdown
- [ ] Page matches its template's required sections (the `docs-template-check` hook warns on stderr if not)
```

- [ ] **Step 3: Verify the section was added**

Run: `grep -c "## Page templates" .claude/skills/add-docs-page.md`
Expected: `1`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/add-docs-page.md
git commit -m "docs(skill): add Page templates section to add-docs-page"
```

---

## Task 4: Cross-reference from keep-docs-fresh skill

**Files:**
- Modify: `.claude/skills/keep-docs-fresh.md`

- [ ] **Step 1: Add a cross-reference line at the end of the "Docs Location" section**

In `.claude/skills/keep-docs-fresh.md`, the `## Docs Location` section ends with the line ``Each MDX file maps to a route: `loaders.mdx` → `/docs/loaders`, etc.`` and is followed by the `## Red Flags — You Are About to Leave Docs Stale` heading. Insert the following as a new paragraph between that last line and the `## Red Flags` heading (a blank line above and below it):

```markdown
When adding or restructuring a page, also follow the **Page templates** section of the `add-docs-page` skill; the `docs-template-check` hook soft-warns when a page is missing its template's required sections.
```

- [ ] **Step 2: Verify the line was added**

Run: `grep -c "Page templates" .claude/skills/keep-docs-fresh.md`
Expected: `1`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/keep-docs-fresh.md
git commit -m "docs(skill): cross-reference docs-template-check from keep-docs-fresh"
```

---

## Final verification

- [ ] **Re-run the ratification scan** (Task 1, Step 5) to confirm all existing pages still pass with zero required warnings.
- [ ] **Confirm the hook fires end-to-end:** edit any docs page trivially (e.g. add then remove a trailing newline via the Edit tool) and confirm no spurious warning appears for a conforming page; the absence of a warning is the success signal.
- [ ] **`git log --oneline -5`** shows the four task commits plus the spec commit.

No `pnpm` build/test/typecheck is required: this plan touches only `.claude/` tooling and `docs/`, not `apps/` or `packages/` source. The repo's six-step pre-push CI sequence is unaffected.
