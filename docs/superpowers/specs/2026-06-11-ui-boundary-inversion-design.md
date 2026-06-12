# UI boundary inversion (Section B, ui half) design

**Date:** 2026-06-11
**Status:** Approved design, pre-implementation
**Source:** Section B (the ui bullet) of `docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`. Follows the merged framework-spine PRs B1 (server, #88) and B2 (iso, #89).
**Goal:** Fix the inverted ui public surface: the genuinely valuable composition hooks (`usePositioner`, `useListboxSelection`) are internal while five trivial/leaked helpers are public. Promote the two hooks to fully-supported public primitives (with docs); demote the five helpers. No structural tiering: ui stays a single curated public barrel.

## Scope decisions (locked with user)

1. **Single curated public barrel (no new subpath).** ui has no framework-emitted tier (nothing generates ui imports), and for a headless component library the composition primitives are a first-class feature, not an escape hatch. The entire change is *which symbols `packages/ui/src/index.ts` exports* plus matching docs. No `@hono-preact/ui/internal` door.
2. **Promote + demote only; defer context access.** Context participation (`activeId` accessors, raw context exports, `buildSafePolygon` for custom corridors) has no current consumer (the dogfood demos all use the provided parts), so it is deferred to a later spec driven by a concrete custom-part use case (e.g. RTL submenus). The `unknown`-seam reshape in `useListboxSelection` and live demos for the primitive hooks are also out of scope (Sections E and F respectively).
3. **Premise corrections from the dogfood check.** `matchSubstring` is genuinely public (used and documented by the Combobox demos), not a micro-helper, so it stays. The four list-nav helpers are documented public API (not accidental leaks), so demoting them is a deliberate un-publish that also removes their docs.

## Demote (remove from the public barrel)

Remove from `packages/ui/src/index.ts`:
- `getItems`, `wrapNext`, `wrapPrev`, `matchTypeahead` (from the `./list-navigation.js` export block).
- `OPTION_SELECTOR` (from the `./select/index.js` export block).

These remain internal module exports (still imported internally by `useListNavigation`, the menu/select navigation code, etc.); only the public re-export from the barrel is removed. They are trivial or re-derivable (index-wrap math, a `querySelectorAll` wrapper, a circular string-match loop) and `useListNavigation` remains the real public list-navigation API.

`matchSubstring` (`./combobox/autocomplete.js`) **stays** on the barrel: the Combobox demos (`ComboboxDemo`, `ComboboxCreatableDemo`, `ComboboxInlineDemo`, `ComboboxMultiDemo`) import it and `combobox.mdx` documents it as the consumer-side filter helper.

**Docs:** remove the four documented helper rows/tables (`getItems`, `wrapNext`, `wrapPrev`, `matchTypeahead`) from `apps/site/src/pages/docs/components/use-list-navigation.mdx` (`OPTION_SELECTOR` has no docs). Leave the `useListNavigation` documentation intact.

## Promote (add to the public barrel)

Add to `packages/ui/src/index.ts`:
- From `./use-positioner.js`: `usePositioner`, and the types `UsePositionerOptions`, `PositionerProps`, `UsePositionerResult`.
- From `./listbox/selection.js`: `useListboxSelection`, and the types `UseListboxSelectionOptions`, `ListboxSelection`, `OptionEntry`.
- From `./use-position.js`: `ClientRectGetter` (a type). It is referenced by `UsePositionerOptions.getAnchorRect` but is not currently on the barrel; exporting `usePositioner` without it would leave the public signature referencing a non-public type. `Side`, `Align`, and `PositionState` (also referenced by the positioner signature) are already public.

Promote **as-is**, with only light doc-comment generalization: the option JSDoc currently names specific framework components ("the Combobox passes its inputRef here", "context-menu pointer anchor, combobox anchor-or-input"); reword to general terms appropriate for public API. Do **not** reshape the pre-existing `unknown` generic-erasure seams in `useListboxSelection` (`OptionEntry.value: unknown`, `isSelected(optionValue: unknown)`, etc.); that is Section E work.

`usePositioner` encodes top-layer promotion, the UA-`[popover]` style neutralization, presence interplay, and the mount strategy; `useListboxSelection` encodes the registry/version threading (the PR #82 stale-label fix) and hidden-field form serialization. This knowledge is not re-derivable from the lower-level public hooks, which is why these two are the promotion targets.

## Docs (satisfy the "public = has a docs page" rule)

Add two pages under `apps/site/src/pages/docs/components/`:
- `use-positioner.mdx`
- `use-listbox-selection.mdx`

At the same bar as the existing primitive-hook pages (`use-position.mdx`, `use-dismiss.mdx`, etc.): prose + an API reference table, with a code snippet. Live demos are not required (that bar is a separate Section F concern). The pages must follow the **add-docs-page skill** (the Component/Reference template, three pillars), be wired into the Components docs nav, and pass the `docs-template-check.sh` PostToolUse hook. Build the API tables from the actual exported types in `packages/ui/src/`.

## Tests

Update `packages/ui/src/__tests__/exports.test.ts` (the existing barrel-surface test) to assert the new boundary:
- `usePositioner` and `useListboxSelection` are exported (functions).
- `getItems`, `wrapNext`, `wrapPrev`, `matchTypeahead`, `OPTION_SELECTOR` are NOT exported from the barrel.
- `matchSubstring` is still exported.

Existing component and primitive-hook tests stay green; the demoted helpers' internal usage is unchanged, so nothing else needs touching.

## Breaking changes

Only the five demoted helpers break for any external importer (four documented-but-trivial, one undocumented). Pre-1.0 and unreleased; recorded in the next release notes. The promotions and the `ClientRectGetter` export are additive.

## PR decomposition

One cohesive PR: the barrel edit (`packages/ui/src/index.ts`), the docs changes (two new pages + the `use-list-navigation.mdx` trim), and the surface test. Small enough not to split.

## Out of scope (deferred)

- **Context access** for custom parts (`activeId` read accessors, `buildSafePolygon`, raw context exports). Its own future spec, driven by a real consumer such as RTL submenus.
- **The `unknown`-seam reshape** in `useListboxSelection`/`ComboboxValueState` (Section E).
- **Live demos** for the primitive-hook docs pages (Section F dogfood).
