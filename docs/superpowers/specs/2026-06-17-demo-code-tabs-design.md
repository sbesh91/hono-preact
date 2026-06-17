# Demo + Code tabs for docs pages

Date: 2026-06-17
Status: Approved (brainstorm); ready for planning

## Problem

The component pages under `apps/site/src/pages/docs/components/` each render a live
demo through `<Example>` (today just a bordered frame around a demo component like
`<TooltipDemo />`). The code that actually powers each demo is not shown. Pages
instead carry a separate, hand-written `## Usage` fence that is a clean abstract
snippet maintained by hand, so it can drift from the real demo.

We want to show the code that powers each demo, alongside the demo, using a tabbed
Demo | Code treatment. There is no general tabs component yet; the existing
`CodeTabs` is a code-only tab strip used for CSS vs Tailwind styling samples.

## Goals

- Show the real source that powers each component-page demo, in a Demo | Code tab.
- The shown code is the single source of truth: it is the file that is actually
  rendered, not a hand-copied snippet, so it cannot drift.
- Introduce one small, accessible docs tab primitive and put both the new Demo |
  Code tabs and the existing `CodeTabs` on it.
- Ship zero runtime syntax highlighter; highlight at build time like the rest of
  the site.

## Non-goals

- No new live demos for framework pages (loaders, actions, routes, streaming,
  etc.). Those teach with static fences and have no demos today. Live-demoing
  server concepts on a static docs site is a separate, larger initiative. Noted
  as future work.
- Not building a `hono-preact-ui` Tabs primitive. The library was deliberately
  scoped to the hard floating/focus-management cluster (finished with Combobox).
  A full APG Tabs library component is its own product decision and deserves its
  own spec. This spec builds a docs-site-only tab component.
- No change to the Styling section model. Each page keeps its `## Styling`
  `CodeTabs` (CSS vs Tailwind); the `docs-*` classes shown there are the same
  ones the demo files use.

## Decisions (resolved during brainstorming)

1. **Source of truth: the demo file itself.** The demo file is rendered live and
   shown raw (highlighted) via a `?highlighted` import. Hybrid approach C: where a
   demo needs interactive scaffolding, a clean core file is the source of truth and
   a thin harness wraps it for the live view.
2. **Tab UI lives in the docs site**, not the UI library. One generic `Tabs`
   component; `CodeTabs` is refactored onto it.
3. **Per-demo judgment for the explorer tension.** Default to what-you-see-is-
   what-you-get (the file is rendered and shown wholesale). Use a core + harness
   split only for the few genuine explorers (e.g. Tooltip's placement explorer)
   where interactivity earns its keep.
4. **Scope: existing component-page demos only**, plus the `CodeTabs` refactor.
5. **The Code tab replaces the hand-written `## Usage` fence.** Single source of
   truth, no drift. Demo files use the minimum classes needed to read cleanly and
   lean on each component's `data-*` styling contract; the `docs-*` classes that
   remain are exactly the ones the Styling section documents.
6. **Highlighting is build-time via a Vite plugin** (option i), reusing the
   existing Shiki investment through one shared config. No runtime Shiki (the
   client-size budget forbids it).

## Architecture

Four pieces, each with a single responsibility.

### `Tabs.tsx` (new, generic docs primitive)

Owns only tab switching and accessibility:

- `role="tablist"` / `role="tab"` / `role="tabpanel"`.
- `aria-selected` on the active tab; `aria-controls` / `id` linkage between each
  tab and its panel.
- Roving tabindex with ArrowLeft / ArrowRight / Home / End.
- Renders all panels and hides inactive ones with the `hidden` attribute (proper
  APG pattern), rather than destroying the inactive panel as today's `CodeTabs`
  does. This keeps the code present in SSR DOM (visible and copyable before JS),
  keeps the live demo mounted across tab switches (no state loss or remount), and
  makes `aria-controls` point at panels that actually exist.

API shape:

- `labels: string[]` (one per panel, in order).
- Children: the panels, one per label (matching `CodeTabs`'s current shape).
- An optional tablist accessory slot for the copy button. The accessory needs to
  know the active index (copy applies only to code panels), so `Tabs` exposes the
  active index to the accessory (small context or render slot; exact mechanism is
  a plan detail). It also needs the active panel's text for copy.

This is a real accessibility upgrade over today's `CodeTabs`, which has
`role=tablist` / `role=tab` but no arrow-key roving, no `tabpanel`, and no
`aria-controls` wiring.

### `CodeTabs.tsx` (refactored onto `Tabs`)

Becomes a thin wrapper: `<Tabs>` plus a copy-button accessory that copies the
active panel's source. Its public `labels` + children API is unchanged, so all
existing `<CodeTabs>` usages keep working untouched. All panels are code, so copy
is always shown.

### `Example.tsx` (enriched, not renamed)

Gains an optional `code` prop (the highlighted source string).

- With `code`: renders a Demo | Code `<Tabs>`. Demo panel = the live `children`;
  Code panel = the highlighted source with a copy button. Copy is shown only on
  the Code tab (copying a live demo's DOM text is meaningless). Default active tab
  is Demo.
- Without `code`: today's plain bordered frame.

Keeping the name and making `code` optional lets the rollout proceed page by page;
any not-yet-migrated demo still renders as before.

### `shiki-config.ts` + `vite-plugin-highlight.ts` (new)

- `shiki-config.ts`: extract the dual-theme Shiki config currently inline in
  `vite.config.ts` (`themes: { light: 'github-light', dark: 'github-dark' }`,
  `defaultColor: 'light'`, the `langs` list) into one shared module.
- `@shikijs/rehype` (MDX fences) and the new plugin both consume it, so demo
  source renders byte-identically to fenced blocks and inherits dark mode through
  the same `root.css` rules.
- `vite-plugin-highlight.ts`: resolves imports with a `?highlighted` query (e.g.
  `import code from './FooDemo.tsx?highlighted'`), reads the file, runs Shiki
  `codeToHtml` with the shared config and the lang inferred from the file
  extension, and exports the HTML string (`export default <json-stringified
  html>`). The highlighted HTML is injected with `dangerouslySetInnerHTML`; this
  is safe because the input is our own files highlighted at build time.
- `shiki` likely needs to become an explicit devDependency of `apps/site` rather
  than leaning on the transitive one pulled by `@shikijs/rehype`.
- An ambient `declare module '*?highlighted'` provides the `string` default-export
  type for the imports.

## Demo file model

### WYSIWYG demos (the majority)

One file is both rendered and shown. The page imports the component and the same
file's highlighted source:

```tsx
import { PopoverDemo } from '../../../components/docs/PopoverDemo.js';
import popoverCode from '../../../components/docs/PopoverDemo.tsx?highlighted';
// ...
<Example code={popoverCode}>
  <PopoverDemo />
</Example>
```

Two imports, fully typed via the ambient `*?highlighted` module, no registry
magic. Drift is structurally impossible: the Code tab is the rendered file.

### Explorer demos (the few, e.g. Tooltip)

Split into:

- a clean core (e.g. `TooltipExample.tsx`), shown via `?highlighted`, and
- a harness (e.g. `TooltipDemo.tsx`), rendered live, that wraps the core and adds
  the explorer controls (side / align pickers).

The page shows the core's source and renders the harness:

```tsx
import { TooltipDemo } from '../../../components/docs/TooltipDemo.js';
import tooltipCode from '../../../components/docs/TooltipExample.tsx?highlighted';
// ...
<Example code={tooltipCode}>
  <TooltipDemo />
</Example>
```

The core is the real thing the harness renders, so what you read is what runs. The
unshown harness is the only structural surface, which decision 3 accepted. Whether
a given core takes props (so the harness can drive it) versus the harness
duplicating a little markup is a per-demo call left to the plan; the principle is
that the Code tab always shows a real component file that the live demo actually
renders, directly (WYSIWYG) or as its inner core (explorer).

### Classes and the Styling section

The `docs-*` classes in demo files are exactly the ones the `## Styling`
`CodeTabs` documents, so each page stays coherent: Code tab (TSX) + Styling tab
(CSS for those same classes) = the complete picture. Demo files use the minimum
classes needed to look right; the hand-written `## Usage` fence is deleted per
decision 5.

## Rendering and accessibility model

- All panels render; inactive panels are hidden via the `hidden` attribute.
- Default active tab is Demo.
- The live demo stays mounted across tab switches.
- Highlighted HTML is injected with `dangerouslySetInnerHTML` (trusted,
  build-time, our own files).

## Page structure after migration

For each component page:

- `## Demo` section: `<Example code={...}>` with the Demo | Code tabs.
- `## Usage` hand-written fence: deleted.
- `## Styling` `CodeTabs` (CSS vs Tailwind): unchanged.

## Testing and gates

- Unit-test `Tabs` accessibility: active switching, ArrowLeft/Right/Home/End
  roving, `aria-selected` / `aria-controls` wiring, `hidden` toggling.
- Keep and extend the existing `CodeTabs` test through the refactor (behavior
  parity, including copy).
- Test `Example`: renders Demo | Code when `code` is present, plain frame when
  absent, copy shown only on the Code tab.
- Unit-test the highlight plugin: non-empty HTML output, expected token markup,
  correct lang from extension.
- Light doc gate (in the spirit of the existing `exports-coverage` and
  `mdx-routes` tests): every `<Example>` under `docs/components/**` passes a
  `code` prop, so no demo silently ships without its Code tab.

## Rollout / sequencing

1. `shiki-config.ts` extraction + `vite-plugin-highlight.ts` + ambient
   `*?highlighted` types. No visible change yet.
2. `Tabs` primitive + tests; refactor `CodeTabs` onto it (behavior unchanged).
3. Enrich `Example` with the `code` prop and Demo | Code rendering.
4. Migrate the component pages: convert each demo to WYSIWYG or core + harness,
   add `code`, delete its `## Usage` fence. (combobox has 4 demos, select has 2;
   the rest have 1 each.)
5. Add the doc gate; run the full six-step CI mirror (build, format:check,
   typecheck, test, test:integration, site build) before pushing.

## Risks and notes

- **Client/page weight.** The highlighted source HTML ships in each component
  page's payload (it is passed as a prop string to the island). This is docs-site
  content, tracked separately from framework runtime size, and is acceptable; note
  it when the size comment runs.
- **Explorer drift surface.** The harness in the core + harness split is unshown.
  Decision 3 accepted this small surface. Prefer prop-driven cores so the harness
  reuses the core rather than duplicating markup, where practical.
- **Shiki dependency.** Making `shiki` an explicit devDependency must match the
  major used by `@shikijs/rehype` to avoid two highlighter versions.
- **format:check trap.** Prior multi-file docs work has shipped format-dirty test
  or demo files; run `pnpm format` and review `git status` before any commit.
