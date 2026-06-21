# Docs: navigation, structure, and AI access

**Date:** 2026-06-20
**Status:** Design approved, pending spec review
**Scope:** `apps/site` docs site + the `.claude/skills` and `.claude/hooks` that govern it

## Problem

User feedback on the docs site, decomposed into three independent problems:

1. **No way to see or jump to sections.** Headings carry no `id` (the MDX pipeline
   runs only `remark-gfm` + `rehype-shiki`), so nothing is deep-linkable, there is no
   per-page table of contents, and there is no search. The user must scroll a page to
   discover its sections. Concrete example they named: jumping to the `.View()` options
   reference, which today sits 6 sections deep on `live-loaders.mdx`
   (`## API reference` -> `### loader.View(render, { initial, reduce })`).

2. **Inconsistent page structure.** Pages disagree on order. Several lead with mechanics
   before showing anything runnable: `loaders.mdx` puts `## How it works`, the container
   prose, and `## Options` ahead of `## Example`; `streaming.mdx` opens straight into
   `## Streaming loaders` -> `### Author shape`. The user wants one order everywhere:
   feature name -> brief why/what/benefit -> examples -> nuances (gotchas, how it works)
   -> API reference.

3. **Docs are not easily AI-accessible.** The site already generates `llms.txt` (curated
   index) and `llms-full.txt` (full corpus) at build, emitted at the site root, but they
   are linked nowhere in the UI, so users do not know they exist.

**Overriding requirement (from the user):** every change must be codified for long-term
maintenance. The docs must stay up to date, fresh, and correct without manual upkeep of
parallel artifacts.

## Goals

- Per-page "On this page" TOC and anchored, shareable headings.
- A Cmd+K command palette that searches page titles and every section heading across all
  pages, and navigates to `route#anchor`.
- One canonical page structure, enforced so it cannot silently drift.
- The existing `llms.txt` / `llms-full.txt` made visible in the UI.
- Zero hand-maintained derived artifacts: TOC, search index, and `llms.txt` all derive
  from the docs source.

## Non-goals

- Full-text body search (user chose Cmd+K over titles + headings; full text is heavier and
  out of scope).
- A new per-page `.md` endpoint or per-page "open in ChatGPT/Claude" buttons (user chose
  "surface existing `llms.txt` only").
- Publishing a separate skill package for adopters (the framework already ships AGENTS.md
  scaffolding + `llms.txt`; out of scope here).
- Rewriting technical claims. PR B reorders and sharpens; it does not change what the docs
  assert about behavior.

## Cross-cutting principle: derive, then enforce

Two ideas run through all three PRs and are the answer to the maintenance requirement:

**Derive everything.** The TOC, the Cmd+K index, and `llms.txt` are all generated from the
MDX files plus `nav.ts`. There is no second source of truth to keep in sync.

**Enforce structure in three layers**, weakest-to-strongest:

1. **Authoring guide** - `.claude/skills/add-docs-page.md` templates describe the canonical
   shape.
2. **Authoring-time nudge** - the `docs-template-check.sh` PostToolUse hook soft-warns
   (stderr, never blocks) when a freshly written page violates the shape.
3. **CI gate** - a vitest test in `apps/site` fails the build when any page violates the
   structure or when the derived search index drifts from the rendered anchors.

The hook catches mistakes while writing; the gate guarantees they cannot merge.

## Sequencing

A -> B -> C.

- **PR A** establishes heading anchors and the auto-derived heading index that PR B's
  rewrite reads cleanly.
- **PR B** is the largest effort and benefits from anchors already existing (the TOC makes
  a well-ordered page legible).
- **PR C** is small and order-independent; it ships last.

Each PR gets its own implementation plan and its own GitHub PR.

---

## PR A - In-page navigation

### A1. Anchored headings

Add to `apps/site/vite.config.ts` `mdxOptions.rehypePlugins`, in this order:

- `rehype-slug` - assigns each heading a GitHub-style `id`.
- `rehype-autolink-headings` (`behavior: 'append'`) - a subtle hover `#` permalink so a
  reader can grab a link to any section.

Both compose with the existing `rehype-shiki` (slug/autolink touch headings, shiki touches
code; independent). New devDependencies: `rehype-slug`, `rehype-autolink-headings`,
`github-slugger`.

### A2. Auto-derived heading index

A build-time generator beside `apps/site/src/llms/generate-llms.ts` (e.g.
`generate-docs-index.ts`) that, for every nav entry, reads the MDX off disk (reusing
`routeToFile` and `nav`), extracts `##`/`###` headings (ignoring `#` lines inside fenced
code), and emits:

```ts
type DocPage = {
  title: string;          // nav title
  route: string;          // /docs/loaders
  headings: { text: string; id: string; depth: 2 | 3 }[];
};
```

**Slug parity is the critical detail.** The `id`s in the index must equal the `id`s
`rehype-slug` produces, or anchors break. Both must use `github-slugger`, run over the
page's headings **in document order including the H1** (the slugger dedupes by appending
`-1`, `-2`, so ordering and starting point must match rehype-slug's per-document pass). A
parity test (below) locks this.

The index is exposed to the client through a small Vite plugin as a virtual module
(e.g. `virtual:docs-index`), resolved in both dev and build so there is no generated file
checked into `src/`. Both the TOC and the palette import it.

### A3. "On this page" TOC

`apps/site/src/components/docs/TableOfContents.tsx`:

- Reads the current route's headings from the index (keyed by `useLocation().path`).
- IntersectionObserver scroll-spy highlights the section currently in view.
- Rendered only when the page has >= 2 headings; hidden below the wide breakpoint.

`DocsLayout` grows from a 2-column grid (sidebar | content) to 3 columns on wide screens
(sidebar | content | TOC). Content keeps its `max-w-[65ch]`.

### A4. Cmd+K command palette

`apps/site/src/components/CommandPalette.tsx`:

- Opens on Cmd/Ctrl+K (global key listener) and on a visible search button added to the
  docs topbar.
- Fuzzy-matches over the index: page titles and every heading. Results grouped by page;
  each result shows page title + section. Enter navigates to `route` or `route#id` (via
  preact-iso navigation).
- Built by **dogfooding `hono-preact-ui`**: Dialog as the surface, `useListNavigation` /
  the listbox primitives for keyboard movement. Falls back to bespoke markup only if the
  primitives prove awkward for this layout.
- Dep-free fuzzy matcher (small subsequence/scoring util) to avoid bundle bloat and a new
  supply-chain dependency.
- Honors the Baseline-widely-available constraint (IntersectionObserver and native
  `<dialog>` qualify; the Popover/anchor-positioning features are not required here).

### A5. PR A enforcement / tests

- **Index parity test** (`apps/site`): for every nav route, every heading `id` in the
  generated index matches the `id` `rehype-slug` would assign (run the same slugger), and
  every nav route resolves to a file. This is the gate that keeps anchors and the index in
  agreement forever.
- Component smoke tests for TOC (renders current-route headings) and palette (filters,
  Enter navigates).

---

## PR B - Canonical page structure

### B1. The canonical order

```
# Feature name
<lead: a brief what / why / benefit statement>

## Example            (common case first; runnable)
   ...more examples for edge cases...

## How it works       (nuances, gotchas, under-the-hood, known behavior, limitations)

## API reference      (or ## Options / ## Signature / ## Parameters; tables last)
```

The hard rule, stated so a test can enforce it:

- **R1 (examples before mechanics):** the first runnable example (a fenced code block or an
  `<Example>`) must appear before the first "how it works"/nuance heading and before the
  first API-reference/options heading.
- **R2 (reference last):** the API-reference/options section is the last of the three
  buckets.
- **R3 (benefit lead):** an `# H1` followed by a lead paragraph (already enforced).

Sections that do not fall into example / nuance / reference buckets (general conceptual
prose) are unconstrained in position, so tutorial-style guides are not forced into an
awkward mold; only the three buckets must keep their relative order.

Component pages already roughly conform (`## Demo` -> `## Usage` -> `## Styling` ->
`## API reference` -> `## Accessibility`); the rewrite mostly affects guide pages, but all
pages are audited.

### B2. Codify it (three layers)

1. **`.claude/skills/add-docs-page.md`** - rewrite both the Guide and Reference template
   skeletons to the canonical order (today the Guide template lists `## How it works`
   before the example; that is the bug being corrected at the source).
2. **`.claude/hooks/docs-template-check.sh`** - extend with an ordering check that soft-warns
   (stderr, exit 0, non-blocking, matching current behavior) when R1/R2 are violated, in
   addition to the existing pillar-presence checks.
3. **CI gate** - a new vitest test in `apps/site` (e.g.
   `pages/docs/__tests__/page-structure.test.ts`) that classifies each page's headings into
   buckets and asserts R1/R2/R3 for **every** page. This is the hard enforcement; the hook
   is only the authoring-time nudge.

Also update `.claude/skills/keep-docs-fresh.md` to reference the canonical order so the two
skills agree.

### B3. Rewrite all pages

All ~44 pages (24 guide + 20 component) brought to the canonical order. Executed
subagent-driven, one page per task. Each subagent is constrained to:

- **Reorder** existing sections into canonical order and **sharpen the lead** into a clear
  benefit statement.
- **Not invent or alter** technical claims, code, option tables, or cross-links.
- Verify its page against the new structure gate, the existing nav/route parity tests, and
  `format:check`.

The reorder-not-rewrite constraint plus the structure gate keeps the large content sweep
safe.

---

## PR C - Surface llms.txt

- A small "For LLMs" affordance in the docs topbar linking `/llms.txt`.
- A short "AI-friendly docs" note on the docs Overview page (`docs/index.mdx`) pointing at
  `/llms.txt` and `/llms-full.txt`.
- Optionally a `<link rel="alternate" type="text/plain" href="/llms.txt">` in the document
  head.

Already auto-generated, so this PR adds visibility only, no new maintenance surface.

---

## Testing and verification

- PR A: index/anchor parity test, TOC + palette smoke tests.
- PR B: per-page structure gate over all pages; the existing nav <-> route parity tests
  (`pages/docs/__tests__`) continue to pass.
- All PRs: the seven-step pre-push CI mirror (build framework dist, `format:check`,
  `typecheck`, `test:types`, `test:coverage`, `test:integration`, `site build`) before each
  push. `format:check` is the historically-missed step and is run explicitly.

## Risks and mitigations

- **Slug parity drift** (anchors vs index): both use `github-slugger` over document-ordered
  headings; a parity test fails the build on any divergence.
- **Subagent rewrite inaccuracy** (PR B): reorder-not-invent constraint, structure gate,
  and human review; subagents may not change technical claims, code, or tables.
- **`format:check` trap** after subagent per-task commits (a recurring miss in this repo):
  run `pnpm format` and a final `git status` review before pushing each PR.
- **Client bundle growth** (PR A adds palette + index JS): dep-free matcher, lazy-load the
  palette, keep the index minimal; the size baseline moving is expected and will be noted in
  the size-tracking comment.

## Resolved decisions

- TOC sourced from a **build-time index** (SSR-friendly, also powers Cmd+K), not runtime DOM
  reading.
- **One umbrella spec** (this document) covering all three PRs; each PR then gets its own
  implementation plan, planned and executed A -> B -> C.
