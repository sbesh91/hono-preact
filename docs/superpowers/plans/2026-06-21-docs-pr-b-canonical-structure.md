# PR B - Canonical Page Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Refinement (post-plan):** the classifier shipped as `apps/site/scripts/docs-structure.ts` (TypeScript), not `.mjs`, and the `.d.mts` declaration file was dropped. Node runs `.ts` directly via native type-stripping (the project's `engines` floor `^22.18.0 || >=24.11.0` supports it unflagged), so the authoring hook shells out with `node --disable-warning=ExperimentalWarning docs-structure.ts <file>`. Both the gate and the classifier unit test live under `apps/site/scripts/__tests__/` (outside the browser app's composite tsconfig), so a real `.ts` classifier needs no hand-written declarations. Where this plan says `.mjs`/`.d.mts` below, read `.ts`.

**Goal:** Establish one canonical docs page order (benefit lead → examples → nuances → API reference), codify it in three enforcement layers (skill template, authoring hook, CI gate) backed by a single shared classifier, and bring all 45 docs pages to that order.

**Architecture:** A single deterministic, dependency-free classifier module (`apps/site/scripts/docs-structure.mjs`) is the one source of truth for the structure rules R1/R2/R3. The new CI vitest gate imports it and asserts every page. The existing `docs-template-check.sh` authoring hook shells out to the same module (CLI mode) for its soft-warn ordering nudge, so the hook and the gate can never drift. The `add-docs-page` / `keep-docs-fresh` skills document the canonical order so authors target it. Then every page is rewritten to conform (reorder sections + sharpen the lead), each verified against the classifier.

**Tech Stack:** Node ESM (`.mjs`, no deps), vitest (run by the root `vitest.config.ts`, which globs `**/*.test.ts`), bash (the hook), MDX.

## Global Constraints

These bind **every** task. The exact rules below are copied verbatim into the classifier, the gate, and the hook; do not paraphrase them.

- **The three buckets.** Classify each `## ` heading by its lowercased, trimmed text:
  - **reference** (the API surface, tables last): matches `/^(api reference|api|options|signature|parameters|props|properties|returns)$/` OR contains the substring `options reference`.
  - **nuance** (how-it-works / gotchas / limitations): matches `/^(how it works|known behavior|known limitations|limitations|caveats|gotchas|under the hood)$/`.
  - **example heading**: matches `/^(example|demo|usage|basic usage|worked examples|a complete example|recipes|common patterns)$/` OR starts with `example:` OR starts with `example ` (note the trailing space).
  - Any heading matching none of the three is **neutral** (conceptual prose, `See also`, `Styling`, `Accessibility`, `Keyboard`, `Data attributes`, `Result`, etc.) and is **unconstrained in position**.
- **The hard rules** (enforced by the classifier; line numbers are 1-based, fenced-code regions are skipped when scanning for examples):
  - **R1 (examples before mechanics):** the first runnable example (a ```` ``` ```` fenced block or an `<Example` tag, outside fenced code) must appear at an earlier line than the first **nuance** heading AND earlier than the first **reference** heading. (If a page has a nuance or reference heading but no runnable example at all, that is an R1 violation.)
  - **R2 (reference last):** no **example heading** and no **nuance** heading may appear after the first **reference** heading.
  - **R3 (benefit lead):** an `# ` H1 must be followed, before the first `## `, by at least one non-empty prose line (not blank, not `import `, not a heading, not a fence, not a `<` JSX line).
- **`index.mdx` pages are exempt** from all rules (area overviews). The classifier and gate skip them.
- **Reorder, do not invent.** Page rewrites may reorder whole sections (heading + its body, moved intact) and sharpen the lead paragraph. They may NOT add, remove, or alter any technical claim, code block, option/prop table, API name, or cross-link. The only prose edits permitted beyond the lead are fixing directional wording broken by a move (e.g. "as shown above" that now points the wrong way).
- **No em-dashes** in prose, code comments, or commit messages. Use a comma, colon, parentheses, or two sentences.
- **Pre-push CI mirror (seven steps), in order**, before any push: (1) `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`, (2) `pnpm format:check`, (3) `pnpm typecheck`, (4) `pnpm test:types`, (5) `pnpm test:coverage` (or `pnpm test`), (6) `pnpm test:integration`, (7) `pnpm --filter site build`. `format:check` is the historically-missed step; run it explicitly. If it fails, `pnpm format` and re-commit.
- **Classifier fidelity.** Before any page rewrite, the classifier must flag **exactly these 16 pages** and no others: `actions`, `live-loaders`, `loaders`, `realtime` (R1); `structure` (R3); `prefetch`, `components/merge-refs`, `components/render-element`, `components/use-controllable-state`, `components/use-dismiss`, `components/use-focus-return`, `components/use-list-navigation`, `components/use-positioner`, `components/use-presence`, `components/use-safe-area`, `components/use-typeahead` (R2). The other 29 pages must report zero problems. After all rewrites, all 45 must report zero.

### Shared Page-Rewrite Procedure

Every page task (Tasks 3-47) follows these steps exactly. The per-task section adds only the file path and the page-specific target order.

1. Read the whole page. Note its current `## `/`### ` section order.
2. **Lead (R3):** ensure `# Title` is immediately followed by a one-paragraph benefit statement: what the feature does and why a developer would reach for it. Sharpen a weak or purely-mechanical lead into a benefit-framed one. Do not introduce new technical claims; restate what the page already asserts.
3. **Reorder (R1/R2):** move whole sections (heading + body, intact) so the three buckets obey **examples → nuance → reference**. Neutral/conceptual sections may stay where they read best. Surface a runnable example before the first nuance/reference heading. Keep the reference bucket (`## API reference` / `## Options` / `## Signature` / `## Parameters` / `## Returns`) last among the three buckets.
4. **Do not invent.** No new/changed technical claims, code, tables, API names, or cross-links. After moving sections, scan the prose for directional references ("above", "below", "earlier", "the previous example") and fix any that the move inverted.
5. **Verify structure:** run `node apps/site/scripts/docs-structure.mjs apps/site/src/pages/docs/<page>` from the repo root. It must print nothing and exit 0 (zero problems).
6. **Verify format:** run `pnpm exec prettier --check apps/site/src/pages/docs/<page>`. If it fails, `pnpm exec prettier --write` the file.
7. **Commit:** `git commit` the single page with message `docs(site): canonical order for <route>` (no em-dash).

---

## File Structure

- **Create** `apps/site/scripts/docs-structure.mjs` - the classifier. Pure exported functions (`classifyHeading`, `analyzePageStructure`) plus a guarded CLI `main` (reads files named on argv, prints warnings to stderr, exits 0) so the bash hook can call it. No dependencies, no client-bundle exposure (lives outside `src/`).
- **Create** `apps/site/scripts/docs-structure.d.mts` - hand-written type declarations for the `.mjs`, so the `.ts` gate and unit test import typed symbols (no casts, clean under `pnpm typecheck`).
- **Create** `apps/site/scripts/__tests__/docs-structure.test.ts` - unit tests over synthetic fixtures (one passing + one failing fixture per rule) plus the fidelity assertion (exactly the 16 listed pages flagged today).
- **Create** `apps/site/src/pages/docs/__tests__/page-structure.test.ts` - the CI gate: iterate every docs `.mdx` (excluding `index.mdx`), assert `analyzePageStructure` returns no problems. Modeled on `example-code-gate.test.ts`.
- **Modify** `.claude/skills/add-docs-page.md` - rewrite the Guide and primitive Reference templates to the canonical order.
- **Modify** `.claude/skills/keep-docs-fresh.md` - reference the canonical order.
- **Modify** `.claude/hooks/docs-template-check.sh` - append a soft-warn ordering check that delegates to `docs-structure.mjs`.
- **Modify** all 45 docs `.mdx` pages (Tasks 3-47).

---

### Task 1: Classifier module + unit tests

**Files:**
- Create: `apps/site/scripts/docs-structure.mjs`
- Create: `apps/site/scripts/docs-structure.d.mts`
- Test: `apps/site/scripts/__tests__/docs-structure.test.ts`

**Interfaces:**
- Produces:
  - `export function classifyHeading(text: string): 'reference' | 'nuance' | 'example' | 'neutral'`
  - `export function analyzePageStructure(source: string): { rule: 'R1'|'R2'|'R3'; message: string }[]` - returns `[]` for a conformant page; never throws.
  - CLI: `node docs-structure.mjs <file...>` reads each file, prints `path: Rn message` lines to stderr for any problems, always exits 0.

- [ ] **Step 1: Write the classifier.** Implement the three bucket predicates exactly as the Global Constraints define them. `analyzePageStructure` scans line by line, tracks fenced-code regions (toggle on lines matching `/^```/`), records: first runnable example line (first ```` ``` ```` open or `^<Example`), first nuance heading line, first reference heading line, last example-heading line, last nuance heading line, and the lead (H1 then a qualifying prose line before the first `## `). Then emits R1/R2/R3 problems per the rules. Skip `index.mdx` callers at the CLI/gate layer, not inside `analyzePageStructure` (the pure function analyzes whatever source it is given).

```js
// apps/site/scripts/docs-structure.mjs
// Canonical docs page-structure classifier. Single source of truth for the
// R1/R2/R3 rules, shared by the CI gate (page-structure.test.ts) and the
// authoring hook (docs-template-check.sh). No dependencies; runnable by node
// directly so the bash hook can shell out to it.
import { fileURLToPath } from 'node:url';

const REFERENCE = /^(api reference|api|options|signature|parameters|props|properties|returns)$/;
const NUANCE = /^(how it works|known behavior|known limitations|limitations|caveats|gotchas|under the hood)$/;
const EXAMPLE = /^(example|demo|usage|basic usage|worked examples|a complete example|recipes|common patterns)$/;

export function classifyHeading(text) {
  const h = text.trim().toLowerCase();
  if (REFERENCE.test(h) || h.includes('options reference')) return 'reference';
  if (NUANCE.test(h)) return 'nuance';
  if (EXAMPLE.test(h) || h.startsWith('example:') || h.startsWith('example ')) return 'example';
  return 'neutral';
}

export function analyzePageStructure(source) {
  const lines = source.split('\n');
  let inFence = false;
  let firstExample = null, firstNuance = null, firstRef = null;
  let lastExampleHeading = null, lastNuance = null;
  let seenH1 = false, seenH2 = false, hasLead = false;

  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const raw = lines[i];
    if (/^```/.test(raw)) {
      if (!inFence) { inFence = true; if (firstExample === null) firstExample = ln; }
      else inFence = false;
      continue;
    }
    if (inFence) continue;
    if (/^<Example/.test(raw)) { if (firstExample === null) firstExample = ln; continue; }
    if (/^# /.test(raw)) { seenH1 = true; continue; }
    if (seenH1 && !seenH2) {
      if (/^## /.test(raw)) seenH2 = true;
      else if (!hasLead && !/^\s*$/.test(raw) && !/^import /.test(raw) && !/^#/.test(raw) && !/^</.test(raw)) hasLead = true;
    }
    const m = /^## (.+)$/.exec(raw);
    if (m) {
      const kind = classifyHeading(m[1]);
      if (kind === 'reference' && firstRef === null) firstRef = ln;
      else if (kind === 'nuance') { if (firstNuance === null) firstNuance = ln; lastNuance = ln; }
      else if (kind === 'example') lastExampleHeading = ln;
    }
  }

  const problems = [];
  if (!seenH1 || !hasLead) problems.push({ rule: 'R3', message: 'missing an H1 followed by a lead paragraph (what it does and why)' });
  if (firstNuance !== null && (firstExample === null || firstExample > firstNuance))
    problems.push({ rule: 'R1', message: `nuance heading at line ${firstNuance} precedes the first example (${firstExample ?? 'none'})` });
  if (firstRef !== null && (firstExample === null || firstExample > firstRef))
    problems.push({ rule: 'R1', message: `reference heading at line ${firstRef} precedes the first example (${firstExample ?? 'none'})` });
  if (firstRef !== null) {
    if (lastExampleHeading !== null && lastExampleHeading > firstRef)
      problems.push({ rule: 'R2', message: `example heading at line ${lastExampleHeading} appears after the reference section (line ${firstRef})` });
    if (lastNuance !== null && lastNuance > firstRef)
      problems.push({ rule: 'R2', message: `nuance heading at line ${lastNuance} appears after the reference section (line ${firstRef})` });
  }
  return problems;
}

// --- CLI (hook delegate). Always exits 0; soft-warn only. ---
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { readFileSync } = await import('node:fs');
  for (const file of process.argv.slice(2)) {
    if (file.endsWith('index.mdx')) continue;
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    for (const p of analyzePageStructure(src)) {
      process.stderr.write(`${file}: ${p.rule} ${p.message}\n`);
    }
  }
  process.exit(0);
}
```

Then create the sibling declaration file so the `.ts` test and gate import typed symbols (no casts, clean under `pnpm typecheck`):

```ts
// apps/site/scripts/docs-structure.d.mts
export type HeadingKind = 'reference' | 'nuance' | 'example' | 'neutral';
export type StructureProblem = { rule: 'R1' | 'R2' | 'R3'; message: string };
export function classifyHeading(text: string): HeadingKind;
export function analyzePageStructure(source: string): StructureProblem[];
```

- [ ] **Step 2: Write unit tests.** Cover `classifyHeading` for one heading per bucket (e.g. `API reference`->reference, `How it works`->nuance, `Demo`->example, `See also`->neutral, `` `.View()` options reference ``->reference, `API routes alongside middleware`->neutral). Cover `analyzePageStructure` with a conformant fixture (returns `[]`) and one failing fixture per rule (R1: nuance heading before any fence; R2: a `## Example` after `## API reference`; R3: H1 then immediately a fence). Add the **fidelity test**: read every real docs page, run `analyzePageStructure`, and assert the set of pages with problems equals the 16 in Global Constraints. (Use `node:fs`/`node:path` + `import.meta.url` like `example-code-gate.test.ts`; resolve `../../src/pages/docs`.)

```ts
// apps/site/scripts/__tests__/docs-structure.test.ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyHeading, analyzePageStructure } from '../docs-structure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../../src/pages/docs');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.mdx') && e.name !== 'index.mdx' ? [p] : [];
  });
}

describe('classifyHeading', () => {
  it('buckets headings', () => {
    expect(classifyHeading('API reference')).toBe('reference');
    expect(classifyHeading('`.View()` options reference')).toBe('reference');
    expect(classifyHeading('How it works')).toBe('nuance');
    expect(classifyHeading('Demo')).toBe('example');
    expect(classifyHeading('Example: listing page')).toBe('example');
    expect(classifyHeading('See also')).toBe('neutral');
    expect(classifyHeading('API routes alongside middleware')).toBe('neutral');
  });
});

describe('analyzePageStructure', () => {
  it('passes a conformant page', () => {
    expect(analyzePageStructure('# T\nlead.\n\n## Example\n```\nx\n```\n\n## How it works\np\n\n## API reference\n| a |\n')).toEqual([]);
  });
  it('flags R1 (nuance before example)', () => {
    expect(analyzePageStructure('# T\nlead.\n\n## How it works\np\n\n## Example\n```\nx\n```\n').some((p) => p.rule === 'R1')).toBe(true);
  });
  it('flags R2 (example after reference)', () => {
    expect(analyzePageStructure('# T\nlead.\n\n## API reference\n| a |\n\n## Example\n```\nx\n```\n').some((p) => p.rule === 'R2')).toBe(true);
  });
  it('flags R3 (no lead)', () => {
    expect(analyzePageStructure('# T\n```\nx\n```\n').some((p) => p.rule === 'R3')).toBe(true);
  });
});

const EXPECTED_VIOLATORS = [
  'actions.mdx', 'live-loaders.mdx', 'loaders.mdx', 'realtime.mdx', 'structure.mdx', 'prefetch.mdx',
  'components/merge-refs.mdx', 'components/render-element.mdx', 'components/use-controllable-state.mdx',
  'components/use-dismiss.mdx', 'components/use-focus-return.mdx', 'components/use-list-navigation.mdx',
  'components/use-positioner.mdx', 'components/use-presence.mdx', 'components/use-safe-area.mdx',
  'components/use-typeahead.mdx',
].sort();

// Fidelity guard for THIS task only. Deleted in Task 48 once every page conforms
// (then the gate asserts zero violators). Keeps the classifier honest mid-sweep.
describe('classifier fidelity (pre-sweep snapshot)', () => {
  it('flags exactly the 16 known violators', () => {
    const flagged = walk(docsDir)
      .filter((f) => analyzePageStructure(readFileSync(f, 'utf8')).length > 0)
      .map((f) => relative(docsDir, f))
      .sort();
    expect(flagged).toEqual(EXPECTED_VIOLATORS);
  });
});
```

- [ ] **Step 3: Run unit tests, expect pass.** `pnpm test apps/site/scripts/__tests__/docs-structure.test.ts`. Expected: all pass, including the fidelity test asserting exactly the 16 violators. If the fidelity test reports a different set, the classifier regex is wrong; fix the classifier (not the expected list) until it matches.
- [ ] **Step 4: Smoke the CLI.** `node apps/site/scripts/docs-structure.mjs apps/site/src/pages/docs/loaders.mdx apps/site/src/pages/docs/components/dialog.mdx`. Expected: `loaders.mdx` prints R1/R2 lines to stderr; `dialog.mdx` prints nothing; exit code 0.
- [ ] **Step 5: Commit.** `git add apps/site/scripts/docs-structure.mjs apps/site/scripts/docs-structure.d.mts apps/site/scripts/__tests__/docs-structure.test.ts && git commit -m "feat(site): docs page-structure classifier + unit tests"`

---

### Task 2: Skills + authoring hook

**Files:**
- Modify: `.claude/skills/add-docs-page.md`
- Modify: `.claude/skills/keep-docs-fresh.md`
- Modify: `.claude/hooks/docs-template-check.sh`

**Interfaces:**
- Consumes: `apps/site/scripts/docs-structure.mjs` CLI (Task 1).

- [ ] **Step 1: Rewrite the Guide template** in `add-docs-page.md` to the canonical order. Today it lists `## How it works` before the example; that is the bug. New skeleton:

```
# Title
<lead paragraph: what this does and the benefit>

## Example                 (or the first runnable section; common case first)
  …more examples for edge cases…

## How it works            (nuances, gotchas, known behavior, limitations)

## Options / <reference>   (a GFM table of the API the page documents; last)

<cross-links to related docs pages>
```

- [ ] **Step 2: Flip the primitive (hook) Reference template** in `add-docs-page.md` so examples precede the signature/options:

```
# name
<lead paragraph>

## Demo                        (optional <Example> live demo)
## Example                     (fuller usage; common case first)
## Signature                   (or go straight to ## Options)
### Options / ### Parameters   (a markdown table)
```

Leave the component variant (`## Demo` -> `## Usage` -> `## Styling` -> `## API reference` -> `## Accessibility`) as is; it already leads with examples (`Styling`/`Accessibility` are neutral and may follow the reference). Add a sentence to the Page templates section stating the canonical bucket order (examples -> nuance -> reference) and that the `docs-template-check` hook now soft-warns on ordering, enforced hard by `page-structure.test.ts`.

- [ ] **Step 3: Update `keep-docs-fresh.md`** - in the "Page templates" reference near the end, add a line: pages follow the canonical order (benefit lead -> examples -> nuances -> API reference); the structure gate enforces it.
- [ ] **Step 4: Extend the hook.** After the existing pillar reporting in `docs-template-check.sh` (before its final `exit 0`), append an ordering check that delegates to the classifier so there is no second copy of the rules:

```bash
# Ordering nudge (R1/R2/R3): delegate to the shared classifier so the hook and
# the CI gate can never drift. Soft-warn only; never blocks.
if command -v node >/dev/null 2>&1; then
  repo_root="${file_path%%/apps/site/*}"
  cli="${repo_root}/apps/site/scripts/docs-structure.mjs"
  if [ -f "$cli" ]; then
    order_out=$(node "$cli" "$file_path" 2>&1)
    if [ -n "$order_out" ]; then
      echo "docs-template-check: canonical order (see add-docs-page skill):" >&2
      echo "$order_out" | sed 's/^/    /' >&2
    fi
  fi
fi
```

- [ ] **Step 5: Verify the hook.** Pipe a violator and a clean page through it:

```bash
echo '{"tool_input":{"file_path":"'"$PWD"'/apps/site/src/pages/docs/loaders.mdx"}}' | bash .claude/hooks/docs-template-check.sh; echo "exit=$?"
echo '{"tool_input":{"file_path":"'"$PWD"'/apps/site/src/pages/docs/components/dialog.mdx"}}' | bash .claude/hooks/docs-template-check.sh; echo "exit=$?"
```

Expected: `loaders.mdx` prints the ordering warning lines; `dialog.mdx` prints nothing new; both exit 0. (Run from the repo root so `$PWD` resolves the absolute path the hook expects.)

- [ ] **Step 6: Commit.** `git add .claude/skills/add-docs-page.md .claude/skills/keep-docs-fresh.md .claude/hooks/docs-template-check.sh && git commit -m "docs(skills): canonical page order in templates, hook, freshness guide"`

---

## Page rewrites (Tasks 3-47)

Each task below follows the **Shared Page-Rewrite Procedure** (Global Constraints) on one page. The per-task line gives the file and the page-specific target. "Conformant; lead-audit only" means the page already passes the gate: verify it still passes, then sharpen the lead into a benefit statement and only reorder if a clean improvement presents itself without violating reorder-not-invent. Each task ends by confirming `node apps/site/scripts/docs-structure.mjs <file>` prints nothing, `prettier --check` passes, and committing that one file.

### Guide pages

- [ ] **Task 3: `actions.mdx`** (R1). Move `## How it works` to a nuance position after `## Defining actions` (the first example-bearing section), so an example precedes it. Fold nothing; move the whole section.
- [ ] **Task 4: `active-links.mdx`** - Conformant; lead-audit only.
- [ ] **Task 5: `cli.mdx`** - Conformant; lead-audit only.
- [ ] **Task 6: `csrf.mdx`** - Conformant; lead-audit only. (Leads with `## When you need it`; keep as conceptual lead-in unless an example moves up cleanly.)
- [ ] **Task 7: `deployment.mdx`** - Conformant; lead-audit only.
- [ ] **Task 8: `hono-middleware.mdx`** - Conformant; lead-audit only.
- [ ] **Task 9: `layouts.mdx`** - Conformant; lead-audit only.
- [ ] **Task 10: `link-prefetch.mdx`** - Conformant; lead-audit only.
- [ ] **Task 11: `live-loaders.mdx`** (R1). Target order: lead -> `## Example: activity bar` -> `## How it works` -> `## Scoping the persistence` -> `## Known behavior` -> `## API reference` -> `## See also`. (Move the two leading mechanics sections below the example.)
- [ ] **Task 12: `loaders.mdx`** (R1+R2; largest reorder). Target: lead -> `## Example: listing page` -> `## Example: detail page (using route params)` -> the conceptual sections (`The serverLoaders container`, `The .View() factory`, `Composing multiple loaders per route`, `The .Boundary escape hatch`, `Search-param dependencies`, `Layout-level loaders`, `Registering the loader endpoint`, `Caching navigation results`, `Page bindings with definePage`, `Cross-page invalidation`) -> the nuance sections (`How it works`, `Timeouts`, `The server/client boundary`) -> `## Options` (reference, last) -> `## See also`. Move whole sections intact; do not rewrite their bodies. Verify all internal "above/below" wording after moving.
- [ ] **Task 13: `loading-states.mdx`** - Conformant; lead-audit only. (`` `.View()` options reference `` is reference and already last before `Page-level fallbacks`/`See also`, which are neutral.)
- [ ] **Task 14: `middleware.mdx`** - Conformant; lead-audit only.
- [ ] **Task 15: `optimistic-ui.mdx`** - Conformant; lead-audit only.
- [ ] **Task 16: `pages.mdx`** - Conformant; lead-audit only.
- [ ] **Task 17: `prefetch.mdx`** (R2). Move `## Common patterns` (example bucket) above `## Options` (reference). Target: lead -> `## Basic usage` -> `## Common patterns` -> `## Why pass url and route?` -> `## Options` -> `## See also`.
- [ ] **Task 18: `quick-start.mdx`** - Conformant; lead-audit only.
- [ ] **Task 19: `realtime.mdx`** (R1). Move `## How it works` below `## Example: live shared counter`. Target: lead -> `## Example: live shared counter` -> `## How it works` -> `## Parameterized channels` -> `## Cross-connection fan-out` -> `## API reference` -> `## See also`.
- [ ] **Task 20: `reloading.mdx`** - Conformant; lead-audit only.
- [ ] **Task 21: `render-page.mdx`** - Conformant; lead-audit only.
- [ ] **Task 22: `routes.mdx`** - Conformant; lead-audit only.
- [ ] **Task 23: `streaming.mdx`** - Conformant; lead-audit only. Spec flagged its mechanics-first feel: add a benefit lead and, if it reads cleanly, surface a runnable example before the deep author/consumer-shape sections. Do not invent content.
- [ ] **Task 24: `structure.mdx`** (R3). Add a one-paragraph benefit lead between `# Project Structure` and the directory-tree code block (what the page shows and why it helps a newcomer). No reordering needed.
- [ ] **Task 25: `view-transitions.mdx`** - Conformant; lead-audit only.
- [ ] **Task 26: `vite-config.mdx`** - Conformant; lead-audit only.
- [ ] **Task 27: `websockets.mdx`** - Conformant; lead-audit only. (Leads with `## Choosing between sockets and live loaders`; keep as conceptual lead-in.)

### Component pages

- [ ] **Task 28: `components/combobox.mdx`** - Conformant; lead-audit only.
- [ ] **Task 29: `components/context-menu.mdx`** - Conformant; lead-audit only.
- [ ] **Task 30: `components/dialog.mdx`** - Conformant; lead-audit only.
- [ ] **Task 31: `components/menu.mdx`** - Conformant; lead-audit only.
- [ ] **Task 32: `components/merge-refs.mdx`** (R2). Move `## Example` above `## Signature`. Target: lead -> `## Demo` -> `## Example` -> `## Signature` (-> `### Parameters`).
- [ ] **Task 33: `components/popover.mdx`** - Conformant; lead-audit only.
- [ ] **Task 34: `components/render-element.mdx`** (R2). Move `## Example` (and the conceptual `## The three forms`) above `## Signature`. Target: lead -> `## Demo` -> `## Example` -> `## The three forms` -> `## Signature`.
- [ ] **Task 35: `components/select.mdx`** - Conformant; lead-audit only.
- [ ] **Task 36: `components/toast.mdx`** - Conformant; lead-audit only.
- [ ] **Task 37: `components/tooltip.mdx`** - Conformant; lead-audit only.
- [ ] **Task 38: `components/use-controllable-state.mdx`** (R2). Move `## Example` above `## Signature`. Target: lead -> `## Demo` -> `## Example` -> `## Signature`.
- [ ] **Task 39: `components/use-dismiss.mdx`** (R2). Move `## Example` above `## Signature`. Target: lead -> `## Demo` -> `## Example` -> `## Signature` -> `## Options`.
- [ ] **Task 40: `components/use-focus-return.mdx`** (R2). Move `## Example` above `## Signature`. Target: lead -> `## Demo` -> `## Example` -> `## Signature` -> `## Options`.
- [ ] **Task 41: `components/use-list-navigation.mdx`** (R2). Move `## Example` above `## Signature`. Target: lead -> `## Demo` -> `## Example` -> `## Signature` -> `## Options` -> `## Returns` -> `## Companion exports`.
- [ ] **Task 42: `components/use-positioner.mdx`** (R2). Move `## Example` above `## Signature`. Target: lead -> `## Demo` -> `## Example` -> `## Signature` -> `## Options`.
- [ ] **Task 43: `components/use-presence.mdx`** (R2). Move `## Example` above `## Signature`. Target: lead -> `## Demo` -> `## Example` -> `## Signature` -> `## Options` -> `## Transition or keyframes`.
- [ ] **Task 44: `components/use-safe-area.mdx`** (R2). Move `## Example` above `## Signature`; keep `## How it works` (nuance) after the examples and before the reference. Target: lead -> `## Demo` -> `## Example` -> `## How it works` -> `## Signature` -> `## Options`.
- [ ] **Task 45: `components/use-typeahead.mdx`** (R2). Move `## Example` above `## Signature`. Target: lead -> `## Demo` -> `## Example` -> `## Signature` -> `## Options`.
- [ ] **Task 46: `components/use-listbox-selection.mdx`** - Conformant; lead-audit only. (Demo -> Signature -> Options -> Result; `Result` is neutral, no trailing example.)
- [ ] **Task 47: `components/use-position.mdx`** - Conformant; lead-audit only.

---

### Task 48: CI gate over all pages

**Files:**
- Create: `apps/site/src/pages/docs/__tests__/page-structure.test.ts`
- Modify: `apps/site/scripts/__tests__/docs-structure.test.ts` (remove the now-obsolete pre-sweep fidelity test)

**Interfaces:**
- Consumes: `analyzePageStructure` (Task 1).

- [ ] **Step 1: Write the gate.** Iterate every docs `.mdx` (recursive, excluding `index.mdx`), assert `analyzePageStructure` returns `[]` per file. Model on `example-code-gate.test.ts`.

```ts
// apps/site/src/pages/docs/__tests__/page-structure.test.ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePageStructure } from '../../../../scripts/docs-structure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    if (e.isDirectory() && e.name !== '__tests__') return walk(p);
    return e.isFile() && e.name.endsWith('.mdx') && e.name !== 'index.mdx' ? [p] : [];
  });
}

describe('every docs page follows the canonical structure', () => {
  for (const file of walk(docsDir)) {
    const rel = relative(docsDir, file);
    it(`${rel}: canonical order (R1/R2/R3)`, () => {
      const problems = analyzePageStructure(readFileSync(file, 'utf8'));
      expect(problems, problems.map((p) => `${p.rule} ${p.message}`).join('; ')).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run the gate, expect all pass.** `pnpm test apps/site/src/pages/docs/__tests__/page-structure.test.ts`. Expected: every page green (all 45 rewritten). If any fail, the corresponding page task regressed; fix the page, not the gate.
- [ ] **Step 3: Remove the pre-sweep fidelity test** from `apps/site/scripts/__tests__/docs-structure.test.ts` (the `EXPECTED_VIOLATORS` block and its `describe`). The page-structure gate now asserts zero violators; the snapshot of "16 known violators" is obsolete and would fail (the pages are fixed). Keep the `classifyHeading` and `analyzePageStructure` fixture tests.
- [ ] **Step 4: Confirm the gate bites.** Temporarily reorder a section in one page to violate R1, run the gate, confirm it fails with a clear message, then revert.
- [ ] **Step 5: Commit.** `git add apps/site/src/pages/docs/__tests__/page-structure.test.ts apps/site/scripts/__tests__/docs-structure.test.ts && git commit -m "test(site): enforce canonical docs page structure across all pages"`

---

## Verification (whole-PR, before push)

- [ ] `node apps/site/scripts/docs-structure.mjs apps/site/src/pages/docs/**/*.mdx` (via a shell glob or the gate) reports zero problems across all 45 pages.
- [ ] Run the seven-step CI mirror in order (Global Constraints). `pnpm format:check` explicitly; `pnpm format` + recommit if it fails.
- [ ] `git status` is clean (no format-dirty committed files; the recurring subagent `format:check` trap).
- [ ] The client size baseline may shift slightly (no new client JS expected from PR B, but MDX changes recompile); note any movement in the size comment.

## Risks and mitigations

- **Reorder breaks directional prose.** Section moves can invert "above/below" references. Each page task scans for and fixes them (Shared Procedure step 4); the reviewer checks for stale directional wording.
- **Subagent rewrites content instead of reordering.** The reorder-not-invent constraint is in Global Constraints and every brief; the task reviewer diffs against the pre-rewrite file to confirm no technical claim, code, table, or cross-link changed (`git show <base>:<path>` vs the new file).
- **Classifier/hook drift.** Eliminated by design: the hook shells out to the same `.mjs` the gate imports. There is one rule implementation.
- **`format:check` trap after per-task commits.** Each page task runs `prettier --check`/`--write`; a final repo-wide `format:check` + `git status` review before push.
- **Gate false-positive on a legitimately conceptual page.** The classifier treats unrecognized headings as neutral (unconstrained), so tutorial/conceptual pages are not forced into the mold; only the three buckets are ordered. The fidelity test (Task 1) proves no false positives on today's 29 clean pages.
