# UI boundary inversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the inverted `@hono-preact/ui` public surface: promote the two valuable composition hooks (`usePositioner`, `useListboxSelection`) to documented public primitives and demote five trivial/leaked helpers, keeping ui a single curated public barrel.

**Architecture:** ui has one door (`.`). The change is purely which symbols `packages/ui/src/index.ts` exports plus matching docs. No new subpath, no behavior change. Demoted helpers stay internal module exports (still used internally); only their public re-export and docs are removed.

**Tech Stack:** TypeScript, plain `tsc` builds, Vitest, preact, the MDX docs site under `apps/site`.

**Source spec:** `docs/superpowers/specs/2026-06-11-ui-boundary-inversion-design.md`.

**Conventions:**
- Run a single test file with `pnpm exec vitest run <path>` from the repo root.
- No em-dashes in code/comments/commit messages: comma, colon, semicolon, parentheses, or two sentences.
- Docs pages follow the local `add-docs-page` skill (`.claude/skills/add-docs-page.md`): Hook/primitive template (Prose + Example + API reference table; no Demo/Styling/Accessibility), an entry in `apps/site/src/pages/docs/nav.ts` Foundations section, and the route-nav parity tests at `apps/site/src/pages/docs/__tests__/` (`nav.test.ts`, `mdx-routes.test.ts`, `docs-slug.test.ts`).
- Commit after each task; messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

## File map

- **Modify** `packages/ui/src/index.ts`: remove 5 helper re-exports (Task 1), add 2 hooks + their types + `ClientRectGetter` (Task 2).
- **Modify** `packages/ui/src/__tests__/exports.test.ts`: assert the new barrel surface (Tasks 1 + 2).
- **Modify** `packages/ui/src/use-positioner.ts`: generalize framework-specific option JSDoc (Task 2).
- **Modify** `apps/site/src/pages/docs/components/use-list-navigation.mdx`: trim the 4 demoted helper rows (Task 3).
- **Create** `apps/site/src/pages/docs/components/use-positioner.mdx` + `use-listbox-selection.mdx` (Task 4).
- **Modify** `apps/site/src/pages/docs/nav.ts`: add 2 Foundations entries (Task 4).

---

## Task 1: Demote the five helpers from the barrel

**Files:**
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/__tests__/exports.test.ts`

- [ ] **Step 1: Update the surface test to expect the demoted state.** In `packages/ui/src/__tests__/exports.test.ts`, replace the `it('exposes the list-navigation primitive + helpers', ...)` block (currently asserting `wrapNext`/`matchTypeahead`/`getItems` are functions) with:

```ts
  it('exposes the list-navigation primitive but not its internal helpers', () => {
    expect(typeof ui.useListNavigation).toBe('function');
    expect(typeof ui.useTypeahead).toBe('function');
    // The granular helpers are internal implementation details, not public API.
    expect('getItems' in ui).toBe(false);
    expect('wrapNext' in ui).toBe(false);
    expect('wrapPrev' in ui).toBe(false);
    expect('matchTypeahead' in ui).toBe(false);
    expect('OPTION_SELECTOR' in ui).toBe(false);
  });

  it('keeps matchSubstring public (used by the Combobox filter demos)', () => {
    expect(typeof ui.matchSubstring).toBe('function');
  });
```

- [ ] **Step 2: Run it to verify it fails.** `pnpm exec vitest run packages/ui/src/__tests__/exports.test.ts`
Expected: FAIL (the helpers are still exported, so `'getItems' in ui` is `true`).

- [ ] **Step 3: Remove the five helpers from the barrel.** In `packages/ui/src/index.ts`:
  - In the `./list-navigation.js` export block, remove `getItems`, `wrapNext`, `wrapPrev`, `matchTypeahead`. Keep `useListNavigation` and the types (`UseListNavigationOptions`, `ListNavigation`, `ListNavigationMode`). The block becomes:

```ts
export {
  useListNavigation,
  type UseListNavigationOptions,
  type ListNavigation,
  type ListNavigationMode,
} from './list-navigation.js';
```

  - In the `./select/index.js` export block, remove the `OPTION_SELECTOR,` line. Leave every other Select export (components + types) unchanged.

  (Do not touch `matchSubstring` on the last line, or `useTypeahead`.)

- [ ] **Step 4: Run the surface test to verify it passes.** `pnpm exec vitest run packages/ui/src/__tests__/exports.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full ui suite + typecheck (internal helper usage must be unaffected).**

Run: `pnpm --filter @hono-preact/ui build && pnpm exec vitest run packages/ui`
Expected: PASS. The helpers are still exported from their source modules (`list-navigation.ts`, `select/*`) and imported internally; only the barrel re-export was removed, so nothing internal breaks. (If a `Cannot find module '@hono-preact/...'` appears, run `pnpm install` and retry.)

- [ ] **Step 6: Commit.**
```bash
git add packages/ui/src/index.ts packages/ui/src/__tests__/exports.test.ts
git commit -m "refactor(ui): demote internal list-nav helpers + OPTION_SELECTOR off the public barrel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Promote usePositioner + useListboxSelection to the barrel

**Files:**
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/__tests__/exports.test.ts`
- Modify: `packages/ui/src/use-positioner.ts` (doc-comment generalization only)

- [ ] **Step 1: Add a surface test for the promoted hooks.** In `packages/ui/src/__tests__/exports.test.ts`, add inside the `describe('@hono-preact/ui exports', ...)` block:

```ts
  it('exposes the promoted composition hooks', () => {
    expect(typeof ui.usePositioner).toBe('function');
    expect(typeof ui.useListboxSelection).toBe('function');
  });
```

- [ ] **Step 2: Run it to verify it fails.** `pnpm exec vitest run packages/ui/src/__tests__/exports.test.ts`
Expected: FAIL (`ui.usePositioner` is `undefined`).

- [ ] **Step 3: Add the promotions to the barrel.** In `packages/ui/src/index.ts`, add these export blocks (place the positioner export next to the `use-position` export near the top, and the listbox-selection export near the Select/Combobox area; exact placement is cosmetic):

```ts
export {
  usePositioner,
  type UsePositionerOptions,
  type PositionerProps,
  type UsePositionerResult,
} from './use-positioner.js';
export {
  useListboxSelection,
  type UseListboxSelectionOptions,
  type ListboxSelection,
  type OptionEntry,
} from './listbox/selection.js';
```

  Also add `ClientRectGetter` to the existing `./use-position.js` export block (it is referenced by `UsePositionerOptions.getAnchorRect` and must be public so the positioner signature does not leak a non-public type). The block becomes:

```ts
export {
  usePosition,
  placementFor,
  sideAlignFromPlacement,
  type UsePositionOptions,
  type PositionState,
  type Side,
  type Align,
  type ClientRectGetter,
} from './use-position.js';
```

- [ ] **Step 4: Run the surface test to verify it passes.** `pnpm exec vitest run packages/ui/src/__tests__/exports.test.ts`
Expected: PASS.

- [ ] **Step 5: Generalize the framework-specific option JSDoc in `use-positioner.ts`.** These comments name specific framework components; reword them for public API. Make exactly these comment replacements in `packages/ui/src/use-positioner.ts` (change only the comments, not the code):
  - The comment `// usePosition anchor (the Combobox passes its inputRef here).` becomes `// The element the overlay is positioned against.`
  - The comment block `// Position against a point/virtual element instead of anchorRef (context-menu` / `// pointer anchor, combobox anchor-or-input). Undefined for the common case.` becomes `// Position against a point or virtual element instead of anchorRef (e.g. a` / `// pointer position). Undefined for the common anchor-element case.`
  - Leave the `setPosition`, `mount`, and `isPresent` comments as they are (they describe general behavior, not specific components).

- [ ] **Step 6: Build + typecheck.**

Run: `pnpm --filter @hono-preact/ui build && pnpm typecheck`
Expected: PASS. (`ClientRectGetter`, `Side`, `Align`, `PositionState` are now all public, so the promoted signatures reference only public types.)

- [ ] **Step 7: Commit.**
```bash
git add packages/ui/src/index.ts packages/ui/src/__tests__/exports.test.ts packages/ui/src/use-positioner.ts
git commit -m "feat(ui): promote usePositioner + useListboxSelection to the public barrel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Trim the demoted helpers from the list-navigation docs

**Files:**
- Modify: `apps/site/src/pages/docs/components/use-list-navigation.mdx`

- [ ] **Step 1: Remove the four helper rows from the "Companion exports" table.** In `apps/site/src/pages/docs/components/use-list-navigation.mdx`, the `## Companion exports` table currently has rows for `useTypeahead`, `wrapNext`, `wrapPrev`, `matchTypeahead`, `getItems`. Delete the `wrapNext`, `wrapPrev`, `matchTypeahead`, and `getItems` rows. Keep the `useTypeahead` row (it is a public hook).

- [ ] **Step 2: Reword the section intro** (which currently reads "also exports the pieces `useListNavigation` is built from, for composing your own navigation") since only `useTypeahead` remains. Replace the intro paragraph with:

```md
`@hono-preact/ui` also exports `useTypeahead`, the type-to-select hook
`useListNavigation` uses internally, for composing your own navigation:
```

- [ ] **Step 3: Verify the docs build + the route-nav parity test.**

Run: `pnpm exec vitest run apps/site/src/pages/docs/__tests__`
Expected: PASS. (No page was added or removed, so nav parity is unaffected; this confirms the MDX still parses and the route set is unchanged.)

- [ ] **Step 4: Commit.**
```bash
git add apps/site/src/pages/docs/components/use-list-navigation.mdx
git commit -m "docs(ui): drop demoted list-nav helpers from use-list-navigation reference

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Add docs pages for the promoted hooks

Follow the Hook/primitive template from `.claude/skills/add-docs-page.md` (reference implementation: `apps/site/src/pages/docs/components/use-dismiss.mdx`): `# name`, a lead paragraph, a `See also:` line, `## Signature`, `## Options` (a GFM table), `## Example`. No Demo/Styling/Accessibility sections (those are for components, not hooks).

**Files:**
- Create: `apps/site/src/pages/docs/components/use-positioner.mdx`
- Create: `apps/site/src/pages/docs/components/use-listbox-selection.mdx`
- Modify: `apps/site/src/pages/docs/nav.ts`

- [ ] **Step 1: Create `use-positioner.mdx`.** Use this content (the API table is authoritative, built from `UsePositionerOptions`; write the Example by modeling the real wiring in `packages/ui/src/popover/popover.tsx`, which calls `usePositioner`, and confirm it typechecks in Step 4):

````md
# usePositioner

`usePositioner` is the complete anchored-overlay positioning hook the library's
own Popover, Tooltip, Menu, Select, and Combobox parts are built on. It composes
`usePosition` (floating placement), `usePresence` (the open/close lifecycle),
top-layer promotion, and the user-agent `[popover]` style neutralization into a
single hook, so a custom anchored overlay does not have to rediscover the
platform quirks the library already handles.

See also: [usePosition](/docs/components/use-position), [usePresence](/docs/components/use-presence), [useDismiss](/docs/components/use-dismiss).

## Signature

```ts
import { usePositioner } from '@hono-preact/ui';

function usePositioner(opts: UsePositionerOptions): UsePositionerResult;
```

## Options

| Option          | Type                          | Notes                                                                                              |
| --------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `open`          | `boolean`                     | The overlay's open state; drives the presence lifecycle.                                            |
| `anchorRef`     | `RefObject<HTMLElement>`      | The element the overlay is positioned against.                                                      |
| `floatingRef`   | `RefObject<HTMLElement>`      | The positioned overlay element.                                                                     |
| `arrowRef`      | `RefObject<HTMLElement>`      | The arrow element, positioned along the chosen side.                                                |
| `side`          | `Side`                        | Preferred side: `top`, `right`, `bottom`, or `left`.                                                 |
| `align`         | `Align`                       | Alignment along the side: `start`, `center`, or `end`.                                               |
| `offset`        | `number`                      | Gap in pixels between anchor and overlay.                                                            |
| `getAnchorRect` | `ClientRectGetter`            | Optional. Position against a point or virtual element instead of `anchorRef` (e.g. a pointer position). |
| `setPosition`   | `(p: PositionState) => void`  | Publishes the resolved position so an arrow part can read it.                                        |
| `mount`         | `'unmount' \| 'hidden'`       | `'unmount'`: branch on `isPresent` and return `null` while closed. `'hidden'`: keep the element mounted and `hidden` while closed. |

`usePositioner` returns `{ isPresent, positionerProps, state }`: spread
`positionerProps` onto your positioner element, branch on `isPresent` when
`mount` is `'unmount'`, and read `state.side` / `state.align` for side-aware
styling.

## Example

```tsx
import { usePositioner } from '@hono-preact/ui';
import { useRef, useState } from 'preact/hooks';
import type { PositionState } from '@hono-preact/ui';

function Anchored({ open }: { open: boolean }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const [, setPosition] = useState<PositionState | null>(null);

  const { isPresent, positionerProps } = usePositioner({
    open,
    anchorRef,
    floatingRef,
    arrowRef,
    side: 'bottom',
    align: 'center',
    offset: 8,
    setPosition,
    mount: 'unmount',
  });

  return (
    <>
      <button ref={anchorRef}>anchor</button>
      {isPresent && (
        <div {...positionerProps}>
          <div ref={floatingRef}>overlay contents</div>
          <div ref={arrowRef} />
        </div>
      )}
    </>
  );
}
```
````

(Before committing, verify this example against `popover.tsx`'s real usage: confirm `positionerProps` is spread onto the positioner wrapper and that `floatingRef`/`arrowRef` go on the inner elements. Adjust the example to match the actual contract if it differs; the API table above is from the types and is authoritative.)

- [ ] **Step 2: Create `use-listbox-selection.mdx`.** Use this content (API table from `UseListboxSelectionOptions` and `ListboxSelection`; model the Example on `packages/ui/src/select/select.tsx`'s usage):

````md
# useListboxSelection

`useListboxSelection` is the selection core shared by Select and Combobox. It
owns single- and multi-select value tracking, an option registry that resolves
display labels in DOM order (so a closed control can show the selected label
without rendering its list), and hidden form-field serialization. Reach for it
when building a custom listbox-style control that needs the same selection
semantics as the built-in components.

See also: [useListNavigation](/docs/components/use-list-navigation), [Select](/docs/components/select), [Combobox](/docs/components/combobox).

## Signature

```ts
import { useListboxSelection } from '@hono-preact/ui';

function useListboxSelection<Value = string>(
  opts: UseListboxSelectionOptions<Value>
): ListboxSelection;
```

## Options

| Option           | Type                                  | Notes                                                                       |
| ---------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `value`          | `Value \| Value[] \| undefined`       | The controlled selected value(s).                                            |
| `setValue`       | `(next: Value \| Value[]) => void`    | Called with the next selection.                                              |
| `multiple`       | `boolean`                             | Whether multiple options can be selected.                                    |
| `setOpen`        | `(open: boolean) => void`             | Called to close the control after a single-select choice.                    |
| `isValueEqual`   | `(a: Value, b: Value) => boolean`     | Optional. Custom equality; defaults to `Object.is`.                          |
| `serializeValue` | `(value: Value) => string`            | Optional. Serializes a value for the hidden form field.                      |
| `itemToString`   | `(value: Value) => string`            | Optional. Resolves a display label when no option is registered for a value. |
| `name`           | `string`                              | Optional. Hidden form-field name; enables native form submission.            |
| `disabled`       | `boolean`                             | Optional. Disables selection.                                                |

## Result

| Member           | Type                                                  | Notes                                                              |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| `isSelected`     | `(optionValue: unknown) => boolean`                   | Whether a value is currently selected.                             |
| `toggle`         | `(optionValue: unknown) => void`                      | Select or deselect a value (closes the control in single-select).  |
| `registerOption` | `(id, value, label) => () => void`                    | Register an option in the label registry; returns a cleanup fn.    |
| `selectedLabels` | `() => string[]`                                      | Selected labels in registry (DOM) order.                           |
| `selectedItems`  | `() => OptionEntry[]`                                  | Selected options in value order, labels resolved via the registry. |
| `labelFor`       | `(value: unknown) => string`                          | Resolve a single value's display label.                            |
| `optionCount`    | `number`                                              | Number of currently-registered options.                           |
| `hiddenFields`   | `ComponentChild[] \| null`                            | Hidden `<input>`s for native form submission, or `null`.           |

## Example

```tsx
import { useListboxSelection } from '@hono-preact/ui';
import { useState } from 'preact/hooks';

function CustomSelect() {
  const [value, setValue] = useState<string>();
  const [, setOpen] = useState(false);

  const selection = useListboxSelection<string>({
    value,
    setValue: (next) => setValue(next as string),
    multiple: false,
    setOpen,
    name: 'fruit',
  });

  return (
    <ul role="listbox">
      {['apple', 'pear'].map((v) => (
        <li
          role="option"
          aria-selected={selection.isSelected(v)}
          onClick={() => selection.toggle(v)}
        >
          {v}
        </li>
      ))}
      {selection.hiddenFields}
    </ul>
  );
}
```
````

(Verify the Example typechecks in Step 4; adjust the `setValue` adapter if the generic signature needs it.)

- [ ] **Step 3: Add both nav entries.** In `apps/site/src/pages/docs/nav.ts`, in the Components area's `Foundations` section `entries` array, add (place `usePositioner` right after the `usePosition` entry, and `useListboxSelection` after `useListNavigation`):

```ts
{ title: 'usePositioner', route: '/docs/components/use-positioner' },
```
```ts
{ title: 'useListboxSelection', route: '/docs/components/use-listbox-selection' },
```

- [ ] **Step 4: Run the docs route-nav parity test + the site typecheck of the examples.**

Run: `pnpm exec vitest run apps/site/src/pages/docs/__tests__` (route-nav parity: every `docs/**/*.mdx` route must have a nav entry and vice-versa).
Expected: PASS.

Then verify the MDX examples typecheck: `pnpm --filter site build` (the MDX is compiled and type-checked as part of the site build). Expected: PASS. If the build flags a type error in an example, fix the example (the API tables are authoritative; the example must conform to them).

- [ ] **Step 5: Commit.**
```bash
git add apps/site/src/pages/docs/components/use-positioner.mdx \
  apps/site/src/pages/docs/components/use-listbox-selection.mdx \
  apps/site/src/pages/docs/nav.ts
git commit -m "docs(ui): add use-positioner + use-listbox-selection reference pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full pre-push verification

**Files:** none.

- [ ] **Step 1: Run the six-step CI mirror in order, each expecting PASS:**
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

- [ ] **Step 2: If `format:check` fails,** `pnpm format`, restage into the relevant commit or a `style:` commit, and re-run from Step 1.

- [ ] **Step 3: Note on flakes.** If `measure-client-size` (a UI bundle-size test) times out under load, re-run it in isolation (`pnpm exec vitest run scripts/__tests__/measure-client-size.test.mjs`) before treating it as a real failure; it does real builds and has a tight timeout.

---

## Self-review

- **Spec coverage:** demote 5 helpers + invert the surface test (Task 1), promote 2 hooks + `ClientRectGetter` + doc-comment polish (Task 2), trim the list-nav docs (Task 3), add 2 docs pages + nav (Task 4), keep `matchSubstring` (Task 1 asserts it), defer context/Section-E/Section-F (not in any task, correct). All covered.
- **Placeholder scan:** the only "verify against real usage" notes are for the two docs Examples, which carry full illustrative code + authoritative API tables and a concrete file to model on (`popover.tsx`/`select.tsx`); that is guided verification, not a placeholder. Barrel edits, test code, and API tables are complete.
- **Type/name consistency:** the five demoted names (`getItems`, `wrapNext`, `wrapPrev`, `matchTypeahead`, `OPTION_SELECTOR`) and the two promoted names (`usePositioner`, `useListboxSelection`) plus their type lists match across the barrel edits, the surface test, the docs, and the nav routes. `ClientRectGetter` is consistently the type added to the `use-position` block and referenced by the positioner table.
