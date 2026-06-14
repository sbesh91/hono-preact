# Primitive live demos (Section F2) — Design

**Status:** Approved 2026-06-14
**Backlog item:** Section F2 of the primitives DX review (`docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`). The last open item in the A–F backlog.

## Goal

Give every public `@hono-preact/ui` primitive docs page a live, interactive `<Example>` demo. Today these pages are snippet-only: they show code blocks that are never compiled. A live demo is both better documentation (the reader sees the primitive work) and the **only consumer-side exercise of the primitive's public surface** — the site build compiles and type-checks each demo against the published types, so a demo is a build-time regression test that a code block can never be.

## Verified current state

A re-check of the tree corrected two stale assumptions from the backlog notes:

- **`use-presence` already has a live demo** (`UsePresenceDemo`, shipped with `usePresence` in PR #81). It is the structural template for this work, not a target.
- **`useTypeahead` is a public export** (barrel `packages/ui/src/index.ts:133`) **with no docs page at all.** It is only mentioned in a small "Companion exports" table on the `useListNavigation` page. This is a documentation gap, not merely a missing demo.

So the scope is: **10 existing snippet-only pages get a demo, plus one brand-new page (`use-typeahead`) that gets prose + API reference + a demo.** Eleven demos total.

The 10 existing pages: `use-position`, `use-positioner`, `use-dismiss`, `use-safe-area`, `use-focus-return`, `use-list-navigation`, `use-listbox-selection`, `use-controllable-state`, `merge-refs`, `render-element`.

## Conventions (from the existing demos)

- A demo is a small self-contained component at `apps/site/src/components/docs/<Name>Demo.tsx` that imports the primitive from `@hono-preact/ui` and uses **only its public API**.
- Styling is plain CSS under `.docs-*` classes in `apps/site/src/styles/root.css`. The library ships unstyled, so each demo supplies minimal local styling. A generic `.docs-example` frame already exists.
- The page imports `Example` and the demo, then adds a `## Demo` section: `<Example><XxxDemo /></Example>`. This mirrors `use-presence.mdx` exactly: imports precede the `# Title`; the `## Demo` section sits after the lead paragraph and before `## Signature`; the existing `## Example`/`## Signature`/`## Options` content is untouched.
- Demos are **not** unit-tested (only `CodeTabs` and `CopyButton` have tests). Their verification is the site build (`pnpm --filter site build`) type-checking and compiling them, plus the route↔nav parity test for the new page.

Every page edit in this work is **purely additive**: two prepended import lines and one inserted `## Demo` section. No existing prose, snippet, table, or signature is rewritten.

## Per-primitive demo specifications

Each demo must exercise the primitive's real public API (not a re-implementation) and be keyboard/pointer interactive where the primitive's value is interactive. Each gets its own `.docs-*` CSS.

1. **`useControllableState` → `UseControllableStateDemo`**
   Render the page's own `Toggle` (uncontrolled `defaultPressed`) as a live On/Off button. Exercises `useControllableState<boolean>` and proves the stable setter. Minimal but real.

2. **`mergeRefs` → `MergeRefsDemo`**
   One `<input ref={mergeRefs(internalRef, measureRef)}>`. A "Focus" button focuses via `internalRef`; a live readout shows the input's measured width via `measureRef` (read in an effect / on resize). Both refs receiving the same node is the visible proof.

3. **`renderElement` → `RenderElementDemo`**
   The page's `Button` (built on `renderElement`) rendered three ways side by side: default `<button>`, `render={<a href="…" />}` (a real anchor, inspectable), and the function form `render={(props, state) => …}` toggling its own label from `state.pressed`. Demonstrates polymorphism live.

4. **`usePosition` → `UsePositionDemo`**
   Bare placement only: a toggle button plus a floating box anchored by `usePosition`, with side and align controls and a readout of the **resolved** `side`/`align` (so a collision flip is visible). Deliberately *not* a popover — no presence, no Popover API, no dismissal. This keeps it distinct from the higher-level demos and from the `Popover` component demo.

5. **`usePositioner` → `UsePositionerDemo`**
   A complete custom anchored overlay built directly on `usePositioner`: open button → `{...positionerProps}` panel with an arrow element, `mount: 'unmount'` branching on `isPresent`, side-aware styling from `state.side`. This is the "build your own overlay without rediscovering the platform quirks" story; the arrow + lifecycle distinguish it from the bare `usePosition` demo.

6. **`useDismiss` → `UseDismissDemo`**
   A button opens a panel (`ref` listed in `refs`). Clicking outside or pressing Escape closes it via `onDismiss`, and the demo shows the last dismissal **reason** ("dismissed via: escape" / "outside-press"). Exercises both dismissal paths and the reason argument.

7. **`useFocusReturn` → `UseFocusReturnDemo`**
   A trigger opens a panel with two buttons; `useFocusReturn` moves focus to the first on open and returns focus to the trigger on close. Paired with `useDismiss` so Escape closes it (the pages already cross-link this pairing). The returned focus ring on the trigger is the visible proof.

8. **`useListNavigation` → `UseListNavigationDemo`**
   An `activedescendant` listbox: a trigger keeps focus while ArrowUp/ArrowDown, Home/End, and typeahead move `aria-activedescendant` over a small set of `role="option"` rows (wrapping at the ends, scrolling into view). Exercises `onKeyDown`, `getItems`, `setActiveItem`, and the `loop`/`typeahead`/`homeEnd` behavior.

9. **`useListboxSelection` → `UseListboxSelectionDemo`**
   A custom `role="listbox"` with a single/multi toggle (re-mount or `multiple` prop), rows wired to `isSelected`/`toggle`/`registerOption`, a readout of `selectedLabels()`, and the rendered `hiddenFields`. Demonstrates the selection core and native-form serialization.

10. **`useSafeArea` → `UseSafeAreaDemo`**
    A hover-opened card positioned with a **diagonal gap** from its trigger. `useSafeArea` keeps it open while the pointer travels the corridor toward it and closes it (after the grace period) once the pointer leaves the safe region. This is the one behavior the static `SafeAreaDiagram` cannot convey; the demo lets the reader feel the corridor. (Pointer-driven; not unit-testable, which is exactly why a live demo matters.)

11. **`useTypeahead` → `UseTypeaheadDemo`** *(on the new page)*
    A focusable list (or a labeled box) where typing printable characters accumulates a query via the `onChar` callback and jumps to / highlights the first matching row; the demo shows the live buffer string and the idle reset (default 500 ms). Exercises the accumulation and the idle-reset timer.

## New page: `use-typeahead.mdx`

Create `apps/site/src/pages/docs/components/use-typeahead.mdx` following the hook/primitive template (reference: `use-dismiss.mdx`, `merge-refs.mdx`):

- Lead paragraph: what `useTypeahead` does (returns an `onChar(char)` callback that accumulates printable characters into a query string, resetting after an idle gap; the caller matches the query against item labels). Note it is the hook `useListNavigation` uses internally, with a cross-link.
- `## Signature` with the `UseTypeaheadOptions` interface and the `(char: string) => string` return.
- `## Options` table (`idleMs`, default 500).
- `## Demo` with `<Example><UseTypeaheadDemo /></Example>`.
- `## Example` snippet (a minimal type-to-select against a list).
- A "See also" link back to `useListNavigation`.

The page must satisfy the `docs-template-check` hook's required pillars (Prose + Examples + API reference) and the route↔nav parity test.

## nav.ts edit

Add `{ title: 'useTypeahead', route: '/docs/components/use-typeahead' }` to the `Foundations` section in `apps/site/src/pages/docs/nav.ts`, placed immediately after the `useListNavigation` entry (its conceptual companion). The `useListNavigation` page's "Companion exports" table should gain a link to the new page.

## Testing and verification

- Each demo is verified by the site build type-checking and compiling it.
- The new page is verified by `pnpm test docs/__tests__` (route ↔ nav parity).
- Full six-step CI before the PR (per `CLAUDE.md`): framework build, `format:check`, `typecheck`, `test:coverage`, `test:integration`, `pnpm --filter site build`.
- The `docs-template-check` hook (soft-warn) should be clean for the new page and for each edited page (each keeps its required pillars and gains the recommended `## Demo`).

## Non-goals

- No changes to the primitives themselves — `@hono-preact/ui` is untouched; demos consume the existing public API.
- No rewrite of existing page prose, snippets, or tables — every edit is additive.
- No `use-presence` work — it already has its demo.
- No new shared demo infrastructure — reuse `Example` and the `.docs-*` CSS convention.
- No `## Styling` `<CodeTabs>` for these primitive pages — they are hooks, not styled components; the demo CSS lives in `root.css` as supporting styling, not as a copy-paste recipe.

## Decomposition

One PR, subagent-driven. Tasks grouped by kind so each is a self-contained, independently reviewable unit (demo component(s) + their `root.css` styles + the `## Demo` wiring):

1. Pure utilities: `useControllableState`, `mergeRefs`, `renderElement`.
2. Positioning pair: `usePosition`, `usePositioner`.
3. Overlay behavior: `useDismiss`, `useFocusReturn`, `useSafeArea`.
4. Collections: `useListNavigation`, `useListboxSelection`.
5. New page: `use-typeahead.mdx` + `UseTypeaheadDemo` + nav entry + `useListNavigation` companion link.
6. Final: full six-step CI green; whole-branch review.

(Exact task granularity is settled in the implementation plan.)
