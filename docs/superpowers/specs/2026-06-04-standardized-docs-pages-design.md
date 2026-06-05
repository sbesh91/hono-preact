# Standardized docs pages + validator hook

**Date:** 2026-06-04
**Status:** Approved (design)

## Problem

The docs site has grown to 27 MDX pages across two areas (Guide and
Components), but each page is hand-shaped. There is no codified page structure,
so new pages drift in section order, vocabulary, and which shared UI they use.
We want every page to rest on the same three pillars (prose, examples, API
reference), reuse the same docs UI components, and have a Claude hook that nudges
authors toward the standard. The standard must **ratify how the best existing
pages are already written**, not impose an aspirational shape that current pages
fail.

## Goals

- A documented, canonical structure for docs pages, expressed as **two
  templates** that authors target.
- All pages reuse the existing docs UI (`Example`, `CodeTabs`, `CopyButton`) and
  GFM markdown tables; consistency comes from the template plus `.mdx-content`
  styling. **No new components, no MDX-pipeline change.**
- A **soft-warn** Claude hook that detects a docs `.mdx` write, infers its
  template from the path, and writes a non-blocking note listing any missing
  required sections, pointing back to the authoritative skill.

## Non-goals

- Building new docs components (PropsTable, Callout, PageHeader, etc.). Decided
  against: keep markdown, standardize usage.
- A hard gate / blocking validation. The hook never blocks; it warns.
- A CI lint script. Noted as a possible future upgrade if a hard guarantee is
  ever wanted; out of scope here.
- Frontmatter-based template declaration. The MDX pipeline loads only
  `remark-gfm` (no `remark-frontmatter`), so template type is inferred from the
  directory split that already exists.

## Decisions (from brainstorming)

1. **Two templates, both standardized**: a Guide/Concept template and a
   Component/Reference template. Not one universal mold (would force tutorial
   pages into a reference shape), not component-only (Guide pages benefit too).
2. **Soft warn, validate sections**: a PostToolUse hook that validates required
   sections and writes a non-blocking stderr note. Matches the tone of the
   existing `keep-docs-fresh-commit.sh` hook; never blocks work-in-progress.
3. **Standardize usage, keep markdown**: reuse `Example`/`CodeTabs`/`CopyButton`
   and keep API references as GFM markdown tables.
4. **Skill as source of truth + validator hook (Approach A)**: the skeletons
   live in the `add-docs-page` skill; the hook is a thin, lenient, path-aware
   validator. No stub files, no node script.

## The three pillars

Every docs page rests on three pillars. The hook validates the **pillars** via
accepted-heading aliases (not rigid exact section names); the skill documents the
concrete skeletons authors should target.

| Pillar | What it is | How it is satisfied |
|---|---|---|
| **Prose** | What the page documents and why it exists | An `# h1` plus a lead paragraph before the first `##` |
| **Examples** | Runnable/realistic code, common case first | ≥1 fenced code block, or an `<Example>` live demo |
| **API reference** | The configurable surface | A `## API reference` or `## Signature` heading plus ≥1 GFM table |

## Template 1: Guide/Concept (`apps/site/src/pages/docs/*.mdx`, top level)

```
# Title
<lead paragraph: what this does and why it exists>

## How it works            (or the first concept section)
  …prose interleaved with ```code``` examples…

## Options / <reference>   (a GFM table of the API the page documents)

<cross-links to related docs pages>
```

- **Required pillars:** Prose (h1 + lead paragraph), Examples (≥1 fenced code
  block).
- **Recommended:** a reference/options GFM table (the API-reference pillar is
  *soft* here, since some guide pages are pure tutorial, e.g. Quick Start);
  cross-links to related docs pages.

Reference implementations already in the tree: `loaders.mdx`, `actions.mdx`.

## Template 2: Component/Reference (`apps/site/src/pages/docs/components/*.mdx`)

The Components area has two real shapes. Both are variants of one template; the
hook's required set is their common core.

### Component variant (reference implementation: `components/dialog.mdx`)

```
# Name
<lead: what it is, why it exists, "ships unstyled" if applicable>

## Demo          (<Example> wrapping a live demo component)
## Usage         (common-case code)
## Styling       (CSS + Tailwind via <CodeTabs>)
## API reference (markdown prop tables, one per part)
## Accessibility
```

### Primitive/hook variant (reference implementations: `use-render.mdx`, `merge-refs.mdx`, `use-controllable-state.mdx`)

```
# name
<lead paragraph>

## Signature
### Options / ### Parameters   (markdown table)
## Example
```

- **Required pillars (both variants):** Prose (h1 + lead), Examples (≥1 fence or
  `<Example>`), API reference (a `## API reference` **or** `## Signature` heading
  **and** ≥1 markdown table).
- **Recommended (component variant only):** `## Demo` with `<Example>`,
  `## Styling`, `## Accessibility`.

### Exemptions

Any `index.mdx` is exempt from validation (area landings / overviews:
`docs/index.mdx`, `docs/components/index.mdx`). These are navigational overview
pages and do not fit either skeleton.

## The hook: `.claude/hooks/docs-template-check.sh`

- **Type / matcher:** PostToolUse, matcher `Write|Edit`. Registered in
  `.claude/settings.json` alongside `keep-docs-fresh.sh`.
- **Input:** JSON on stdin with `tool_input.file_path`.
- **Guard:** act only when the path matches
  `apps/site/src/pages/docs/**/*.mdx` and the basename is not `index.mdx`.
  Silently `exit 0` otherwise.
- **Infer template:** path contains `/docs/components/` → Reference; else →
  Guide.
- **Parse the file on disk** (the post-write content), extracting:
  - h1 present (`^# `)
  - lead paragraph present (a non-empty, non-heading, non-import line between the
    h1 and the first `##`)
  - headings (lowercased `##`/`###` text)
  - fenced-code-block count (` ``` ` openers)
  - `<Example` presence
  - GFM table presence (a header row followed by a `|---|` separator row)
- **Validate** the inferred template's required pillars using alias sets:
  - Prose: h1 + lead paragraph.
  - Examples: fence count ≥ 1 OR `<Example` present.
  - API reference (Reference template only, required): a heading matching
    `api reference|signature` AND a GFM table present.
- **Output:** a single non-blocking stderr block that:
  - lists any missing **required** pillars,
  - gently notes missing **recommended** sections (e.g., a Reference/component
    page with no `## Accessibility`),
  - points to the `add-docs-page` skill for the full skeletons.
- **Exit:** always `0`. Soft warn, never blocks. Alias-based and lenient by
  design, so an occasional false negative is harmless.

### Why path-inference and not frontmatter

MDX frontmatter is not parsed in this project (only `remark-gfm` is loaded in
`apps/site/vite.config.ts`; there is no `remark-frontmatter`). The Guide vs
Components directory split already encodes template type, so the hook reads it
from the path with zero pipeline changes.

## Skill change: `.claude/skills/add-docs-page.md`

- Add a **"Page templates"** section carrying both skeletons (Guide, and
  Reference's two variants), each annotated Required / Recommended, plus the
  three-pillars summary and the exact heading aliases the hook recognizes, so
  the author target and the validator never disagree.
- Update the checklist with: "page matches its template's required sections
  (the `docs-template-check` hook will warn if not)."
- Add a one-line cross-reference from `keep-docs-fresh.md` noting that the
  structure check (this hook) complements the freshness check.

## Files touched

| File | Change |
|---|---|
| `.claude/hooks/docs-template-check.sh` | **New.** The validator hook. |
| `.claude/settings.json` | Register the hook under PostToolUse `Write\|Edit`. |
| `.claude/skills/add-docs-page.md` | Add "Page templates" section + checklist line. |
| `.claude/skills/keep-docs-fresh.md` | One-line cross-reference. |

No app code, no new components, no MDX-pipeline change.

## Verification

1. Run the hook against **every existing docs page** (27 MDX files; the 2
   `index.mdx` pages are skipped as exempt, leaving 25 validated). All validated
   pages must pass with **zero required-pillar warnings**, which proves the
   standard ratifies current reality. Concretely:
   - Guide pages: pass on Prose + Examples.
   - `dialog.mdx`: passes on all three required pillars; no missing-recommended
     warnings (it has Demo, Styling, Accessibility).
   - `use-render.mdx`, `merge-refs.mdx`, `use-controllable-state.mdx`: pass on
     Prose + Examples + API reference (via `## Signature` + `### Options` table).
   - `index.mdx` pages: skipped (exempt).
2. Run the hook against a deliberately broken fixture (a Reference page missing
   its `## API reference`/`## Signature` + table) to confirm it warns.

This is dev-tooling (a Claude hook), not shipped app code, so verification is
manual against the real pages rather than a CI test.

## Risks / trade-offs

- **Bash markdown parsing is approximate.** Mitigated by warn-only semantics and
  alias matching; a false negative just means a missing nudge, never a broken
  build.
- **The standard could ossify a shape that should evolve.** Mitigated by keeping
  the source of truth in the skill (easy to edit) and the hook lenient.
- **Future upgrade path:** if a hard guarantee is ever wanted, promote the same
  pillar checks into a `pnpm docs:lint` node script run in CI (Approach C),
  reusing this spec's pillar definitions.
