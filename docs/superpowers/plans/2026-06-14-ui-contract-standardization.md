# UI contract standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the small public-contract forks across `@hono-preact/ui` (delay prop name, `data-checked`, the `Value` part shape + its generic, shared positioning/selection prop types) in one breaking-but-free PR.

**Architecture:** Mechanical contract changes to public component props/attributes/types. `@hono-preact/ui` is private/unpublished (`0.0.0`), so breaking is free. Each task ends green; behavior is preserved except the intended renames.

**Tech Stack:** Preact, TypeScript, Vitest + @testing-library/preact (happy-dom), `@hono-preact/ui`.

**Spec:** `docs/superpowers/specs/2026-06-14-ui-contract-standardization-design.md`

**Conventions for every task:**
- Work on the feature branch (verify `git branch --show-current` before each commit; never commit to `main`).
- Run `pnpm format` before committing so the committed state is Prettier-clean.
- `noUnusedLocals`/`noUnusedParameters` are ON: after removing a usage, delete the orphaned import or `tsc` fails.
- Focused test: `pnpm exec vitest run <path>`. Per-package typecheck: `pnpm --filter @hono-preact/ui exec tsc --noEmit`. Whole ui suite: `pnpm exec vitest run packages/ui`.
- The site build resolves `@hono-preact/ui` through its `dist/`; the framework build (`pnpm --filter '@hono-preact/*' --filter hono-preact build`) refreshes it. Run a clean rebuild before the final CI (Task 5).

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/ui/src/tooltip/tooltip.tsx` | `delay` -> `openDelay` | 1 |
| `apps/site/src/pages/docs/components/tooltip.mdx` | docs for the prop rename | 1 |
| `packages/ui/src/menu/menu.tsx` | `data-state` checked -> `data-checked` | 2 |
| `apps/site/src/pages/docs/components/{menu,context-menu}.mdx` | docs for the attr change | 2 |
| `packages/ui/src/listbox/selection.ts` | `OptionEntry<Value>` generic; `SelectionProps<Value>` | 3, 4 |
| `packages/ui/src/combobox/combobox.tsx` | `ComboboxValue` shape + generic | 3 |
| `apps/site/src/pages/docs/components/combobox.mdx` | docs for the `Value` part | 3 |
| `packages/ui/src/use-position.ts` | `PositioningProps` | 4 |
| `packages/ui/src/{popover,tooltip,menu,context-menu,select,combobox}/*.tsx`, `menu/submenu.tsx` | Root props compose the shared types | 4 |
| `packages/ui/src/index.ts` | export the two shared types | 4 |

---

## Task 1: Delay vocabulary (Tooltip `delay` -> `openDelay`)

**Files:**
- Modify: `packages/ui/src/tooltip/tooltip.tsx`, `apps/site/src/pages/docs/components/tooltip.mdx`
- Test: an existing tooltip test (find any that passes `delay`)

- [ ] **Step 1: Update tests first**

Run: `rg -n "\bdelay\b" packages/ui/src/__tests__/tooltip-*.tsx`
For each hit that passes a `delay={...}` prop to `Tooltip.Root` (or `<TooltipRoot delay=...>`), change the prop name to `openDelay`. (Assertions about timing behavior don't change.) If there are no such hits, note that and proceed.

- [ ] **Step 2: Run the tooltip suite to see the (possibly already-passing) baseline**

Run: `pnpm exec vitest run packages/ui/src/__tests__/tooltip-trigger.test.tsx packages/ui/src/__tests__/tooltip-popup.test.tsx`
Expected: if a test now passes `openDelay` (not yet a real prop), it still type-checks at runtime (vitest doesn't typecheck) but exercises the default; the real verification is Step 4's typecheck.

- [ ] **Step 3: Rename the prop in `tooltip.tsx`**

In `packages/ui/src/tooltip/tooltip.tsx`:
- In `TooltipRootProps` (line ~16): `delay?: number; // open delay (ms), default 600` -> `openDelay?: number; // open delay (ms), default 600`.
- In the `TooltipRoot` destructure (line ~29): `delay = 600,` -> `openDelay = 600,`.
- In `scheduleOpen` (line ~63): `setTimeout(() => setOpen(true), delay)` -> `setTimeout(() => setOpen(true), openDelay)`; and the dep array `[cancelPending, setOpen, delay]` -> `[cancelPending, setOpen, openDelay]`.

- [ ] **Step 4: Typecheck + tooltip suite**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS (and a test still passing `delay` would now be a TS error — fix it to `openDelay`).

Run: `pnpm exec vitest run packages/ui/src/__tests__/tooltip-trigger.test.tsx packages/ui/src/__tests__/tooltip-popup.test.tsx packages/ui/src/__tests__/tooltip-presence.test.tsx`
Expected: PASS.

- [ ] **Step 5: Docs**

In `apps/site/src/pages/docs/components/tooltip.mdx`:
- Line ~41 prose: "Set `delay` and `closeDelay`" -> "Set `openDelay` and `closeDelay`".
- Line ~147 API table row: `| \`delay\` | \`number\` | \`600\` | Open delay ...` -> rename the cell to `openDelay`.
- Line ~167 prose: "after `delay` on a mouse `pointerenter`" -> "after `openDelay` ...".

Re-grep to be sure: `rg -n "\bdelay\b" apps/site/src/pages/docs/components/tooltip.mdx` should show only `closeDelay` (and prose like "short delay" if any reads naturally — leave non-prop prose).

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/ui/src/tooltip/ apps/site/src/pages/docs/components/tooltip.mdx
git commit -m "refactor(ui)!: rename Tooltip delay prop to openDelay"
```

---

## Task 2: `data-checked` on Menu checkbox/radio items

**Files:**
- Modify: `packages/ui/src/menu/menu.tsx`, `apps/site/src/pages/docs/components/menu.mdx`, `apps/site/src/pages/docs/components/context-menu.mdx`
- Test: `packages/ui/src/__tests__/menu-checkable.test.tsx`

- [ ] **Step 1: Add the failing assertions**

`menu-checkable.test.tsx` currently asserts only `aria-checked` (no `data-state`), so the existing tests stay green as-is. ADD `data-checked` assertions (present-when-checked / absent-otherwise), matching the file's plain-DOM style:

- In the `CheckboxItem` test, right after `expect(item.getAttribute('aria-checked')).toBe('false');`:
```tsx
    expect(item.hasAttribute('data-checked')).toBe(false);
```
- In the `RadioGroup` test, right after the two `aria-checked` assertions (`'true'`/`'false'`):
```tsx
    expect(getByText('Small').getAttribute('data-checked')).toBe('');
    expect(getByText('Large').hasAttribute('data-checked')).toBe(false);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/menu-checkable.test.tsx`
Expected: FAIL (the `Small` item currently emits `data-state="checked"`, not `data-checked`, so `getAttribute('data-checked')` is `null`, not `''`).

- [ ] **Step 3: Switch the attribute in `menu.tsx`**

In `packages/ui/src/menu/menu.tsx`, in BOTH `MenuCheckboxItem` (line ~359) and `MenuRadioItem` (line ~469), replace:
```tsx
      'data-state': checked ? 'checked' : 'unchecked',
```
with:
```tsx
      'data-checked': checked ? '' : undefined,
```
(Leave `aria-checked`, `data-disabled`, `data-highlighted`, `data-menu-item` unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/menu-checkable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Docs**

In `apps/site/src/pages/docs/components/menu.mdx`:
- Line ~74 prose ("`checked`/`unchecked` on checkbox and radio items"): reword to "`data-checked` (present when checked) on checkbox and radio items".
- Line ~208 data-attribute table row: change the `data-state | CheckboxItem, RadioItem | checked | unchecked` row to a `data-checked | CheckboxItem, RadioItem | present when checked` row (and confirm the remaining `data-state` row covers only the open/closed parts).
- Lines ~311, ~341 ("Sets `aria-checked` and `data-state=\"checked\" | \"unchecked\"`"): change to "Sets `aria-checked` and `data-checked` (present when checked)".

In `apps/site/src/pages/docs/components/context-menu.mdx`: the same three kinds of edits at lines ~67, ~290, ~320.

Re-grep: `rg -n "data-state.*checked|data-state=.checked" apps/site/src/pages/docs/components/menu.mdx apps/site/src/pages/docs/components/context-menu.mdx` should be empty.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/ui/src/menu/menu.tsx apps/site/src/pages/docs/components/menu.mdx apps/site/src/pages/docs/components/context-menu.mdx
git commit -m "refactor(ui)!: Menu checkbox/radio use data-checked not data-state"
```

---

## Task 3: `Value` part shape alignment + generic-erasure fix

**Files:**
- Modify: `packages/ui/src/listbox/selection.ts` (OptionEntry generic), `packages/ui/src/combobox/combobox.tsx` (ComboboxValue)
- Test: `packages/ui/src/__tests__/combobox-value.test.tsx`
- Docs: `apps/site/src/pages/docs/components/combobox.mdx`

- [ ] **Step 1: Make `OptionEntry` generic**

In `packages/ui/src/listbox/selection.ts`, change:
```ts
export interface OptionEntry {
  id: string;
  value: unknown;
  label: string;
}
```
to:
```ts
export interface OptionEntry<Value = unknown> {
  id: string;
  value: Value;
  label: string;
}
```
Existing unparameterized `OptionEntry` references resolve to `OptionEntry<unknown>`, so nothing else in this file changes.

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS (the default keeps every existing use valid).

- [ ] **Step 2: Add the failing tests**

The two existing `combobox-value.test.tsx` tests query the inner chips (`[data-testid="chip"]`), not the wrapper, so they stay green after the `<span>` is added. ADD two tests to the `describe('Combobox Value (multi)', ...)` block (reuse the existing harness shape — `ComboboxRoot multiple defaultOpen value={['apple']}` with an `apple` option):

```tsx
  it('wraps function-children in a span carrying rest props', async () => {
    render(
      <ComboboxRoot multiple defaultOpen value={['apple']}>
        <ComboboxValue class="chips">
          {({ selectedItems }) =>
            selectedItems.map((it) => (
              <span key={it.id} data-testid="chip">
                {it.label}
              </span>
            ))
          }
        </ComboboxValue>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    await act(async () => {});
    const wrapper = document.querySelector('[data-testid="chip"]')!.parentElement!;
    expect(wrapper.tagName).toBe('SPAN');
    expect(wrapper.className).toContain('chips');
  });

  it('render prop replaces the default span and receives state', async () => {
    render(
      <ComboboxRoot multiple defaultOpen value={['apple']}>
        <ComboboxValue
          render={(props, state) => (
            <ul {...props} data-testid="value-list">
              {state.selectedItems.map((it) => (
                <li key={it.id}>{it.label}</li>
              ))}
            </ul>
          )}
        />
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    await act(async () => {});
    const list = document.querySelector('[data-testid="value-list"]')!;
    expect(list.tagName).toBe('UL');
    expect(list.textContent).toContain('Apple');
  });
```

(The first test confirms the new `<span>` wrapper + rest-prop passthrough; the second confirms the new `render` prop and that the function form receives `(props, state)`. The existing `remove`/label-update tests already cover `remove(value)` and `selectedItems`.)

Run: `pnpm exec vitest run packages/ui/src/__tests__/combobox-value.test.tsx`
Expected: FAIL (ComboboxValue is still a bare Fragment: no `<span>` wrapper, no `class` passthrough, no `render` prop).

- [ ] **Step 3: Rewrite `ComboboxValue`**

In `packages/ui/src/combobox/combobox.tsx`, replace the `ComboboxValueState` / `ComboboxValueProps` / `ComboboxValue` block (currently lines ~842-856) with:
```tsx
export interface ComboboxValueState<Value = unknown> {
  selectedItems: OptionEntry<Value>[];
  remove: (value: Value) => void;
}

export type ComboboxValueProps<Value = unknown> = {
  render?: RenderProp<ComboboxValueState<Value>>;
  children?: (state: ComboboxValueState<Value>) => ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLSpanElement>, 'children'>;

export function ComboboxValue<Value = unknown>(
  props: ComboboxValueProps<Value>
): VNode {
  const { render, children, ...rest } = props;
  const ctx = useComboboxContext('Value');
  // The module-level context erases Value to unknown; the Root owns the generic,
  // so re-apply it here at the one confined seam (mirrors useListboxSelection).
  const selectedItems = ctx.selectedItems() as OptionEntry<Value>[];
  const remove = (value: Value) => ctx.selectOption(value);
  const state: ComboboxValueState<Value> = { selectedItems, remove };
  return renderElement<ComboboxValueState<Value>>({
    render,
    defaultTag: 'span',
    props: rest,
    state,
    children: children ? children(state) : null,
  });
}
```
Then fix imports: `Fragment` (from `preact`) is now unused in this file — remove it from the import. `JSX` must be imported (it likely already is for other prop types; if not, add `type JSX` to the `preact` import). `renderElement`/`RenderProp`/`ComponentChildren`/`VNode`/`OptionEntry` are already imported.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS.

Run: `pnpm exec vitest run packages/ui/src/__tests__/combobox-value.test.tsx`
Expected: PASS.

- [ ] **Step 5: Docs**

In `apps/site/src/pages/docs/components/combobox.mdx`, in the `### Combobox.Value` section (around lines 364, 566-576) and the chips example (~115-126):
- Note that `Combobox.Value` now renders a `<span>` and accepts a `render` prop and standard HTML attributes (like `Select.Value`); `children` is the function form receiving `{ selectedItems, remove }` and is now optional.
- The API table: add a `render` row (`(state: ComboboxValueState<Value>) => VNode`), keep the `children` row but mark it optional, and note `ComboboxValueState<Value>` is generic (`selectedItems: OptionEntry<Value>[]`, `remove: (value: Value) => void`).
- The chips example still works (function children) but can show styling the wrapper via a class on `Combobox.Value`.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/ui/src/listbox/selection.ts packages/ui/src/combobox/combobox.tsx packages/ui/src/__tests__/combobox-value.test.tsx apps/site/src/pages/docs/components/combobox.mdx
git commit -m "refactor(ui)!: align ComboboxValue shape with SelectValue + make it generic"
```

---

## Task 4: Shared `PositioningProps` / `SelectionProps`

Pure type extraction, verified by `tsc`. All seven Root prop types are `interface`s, so they `extends` the shared types.

**Files:**
- Modify: `packages/ui/src/use-position.ts`, `packages/ui/src/listbox/selection.ts`, the seven Root files, `packages/ui/src/index.ts`

- [ ] **Step 1: Add `PositioningProps`**

In `packages/ui/src/use-position.ts`, add (near the `Side`/`Align` exports):
```ts
// Shared positioning props for every overlay Root. Defaults are applied per-Root
// in its destructure (they differ: side 'top'/'bottom', offset 0/8, etc.), so
// this type only declares the props, not their defaults.
export interface PositioningProps {
  side?: Side;
  align?: Align;
  offset?: number;
}
```

- [ ] **Step 2: Add `SelectionProps`**

In `packages/ui/src/listbox/selection.ts`, add:
```ts
// Shared controlled/uncontrolled selection props for Select + Combobox Roots.
// Each Root keeps its own Value default (Select = string, Combobox = unknown).
export interface SelectionProps<Value> {
  value?: Value | Value[];
  defaultValue?: Value | Value[];
  onValueChange?: (value: Value | Value[]) => void;
  multiple?: boolean;
}
```

- [ ] **Step 3: Compose `PositioningProps` into the five non-listbox Roots**

For each of these, delete the three lines `side?: Side;` / `align?: Align;` / `offset?: number;` from the interface body, add `extends PositioningProps` to the declaration, and add `import type { PositioningProps } from '../use-position.js';` (the file already imports `Side`/`Align` from there — keep those imports if still used elsewhere; `tsc` flags any that became unused):

- `packages/ui/src/popover/popover.tsx`: `export interface PopoverRootProps extends PositioningProps {` (remove lines ~17-19).
- `packages/ui/src/tooltip/tooltip.tsx`: `export interface TooltipRootProps extends PositioningProps {` (remove lines ~18-20). NOTE: keep `openDelay`/`closeDelay` (added/renamed in Task 1).
- `packages/ui/src/menu/menu.tsx`: `export interface MenuRootProps extends PositioningProps {` (remove lines ~29-31).
- `packages/ui/src/context-menu/context-menu.tsx`: `export interface ContextMenuRootProps extends PositioningProps {` (remove the side/align/offset lines).
- `packages/ui/src/menu/submenu.tsx`: `export interface SubmenuRootProps extends PositioningProps {` (remove the side/align/offset lines; keep `openDelay`/`closeDelay`).

- [ ] **Step 4: Compose both shared types into Select + Combobox Roots**

- `packages/ui/src/select/select.tsx`: `export interface SelectRootProps<Value = string> extends SelectionProps<Value>, PositioningProps {` — delete the four selection lines (`value?`/`defaultValue?`/`onValueChange?`/`multiple?`, lines ~31-34) AND the three positioning lines (~43-45). Keep `name?`/`disabled?`/`required?`/`loop?`/`typeahead?`/`children?` and the rest. Add imports: `import type { PositioningProps } from '../use-position.js';` and `import type { SelectionProps } from '../listbox/selection.js';` (the file already imports other things from `../listbox/selection.js` — extend that import).
- `packages/ui/src/combobox/combobox.tsx`: `export interface ComboboxRootProps<Value = string> extends SelectionProps<Value>, PositioningProps {` — delete the four selection lines (~38-41) and the three positioning lines (~56-58). Keep all Combobox-specific props. Add the `PositioningProps` import; extend the existing `../listbox/selection.js` import with `SelectionProps`.

- [ ] **Step 5: Export the shared types from the barrel**

In `packages/ui/src/index.ts`:
- In the `from './use-position.js'` block (lines ~12-15, currently exports `type Side`, `type Align`): add `type PositioningProps,`.
- In the `from './listbox/selection.js'` block (lines ~192-193, currently exports `type OptionEntry`): add `type SelectionProps,`.

- [ ] **Step 6: Typecheck + whole ui suite**

Run: `pnpm --filter @hono-preact/ui exec tsc --noEmit`
Expected: PASS. This is the real verification that every Root composes the shared types and the generics line up. If `tsc` flags an unused `Side`/`Align` import in a Root `.tsx` (because its only use was the removed prop line), remove it.

Run: `pnpm exec vitest run packages/ui`
Expected: PASS (pure type change; runtime behavior unchanged).

- [ ] **Step 7: Commit**

```bash
pnpm format
git add packages/ui/src/use-position.ts packages/ui/src/listbox/selection.ts packages/ui/src/popover/ packages/ui/src/tooltip/ packages/ui/src/menu/ packages/ui/src/context-menu/ packages/ui/src/select/ packages/ui/src/combobox/ packages/ui/src/index.ts
git commit -m "refactor(ui): shared PositioningProps/SelectionProps across Roots"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Contract sanity greps**

Run: `rg -n "data-state': checked|delay = 600|delay\?: number" packages/ui/src`
Expected: no matches (Tooltip uses `openDelay`; menu items use `data-checked`).

Run: `rg -n "value: unknown" packages/ui/src/combobox`
Expected: no matches in `ComboboxValueState`/`ComboboxValueProps` (the generic replaced it). (Other `value: unknown` in the erased context interface are expected and fine.)

Run: `rg -n "side\?: Side" packages/ui/src/*/[a-z]*.tsx packages/ui/src/menu/submenu.tsx`
Expected: no matches in Root interfaces (now via `PositioningProps`). (`use-position.ts`'s `PositioningProps` is the one definition.)

- [ ] **Step 2: Clean rebuild + six-step CI**

```bash
rm -rf packages/*/dist
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all green. If `format:check` fails, `pnpm format`, commit, re-run. (The clean rebuild guards against the stale-dist trap: a renamed/changed `@hono-preact/ui` surface must be validated against a fresh `dist/`.)

- [ ] **Step 3: Final state review**

```bash
git status            # clean
git log --oneline main..HEAD
```
Expected: clean tree; the commit series from Tasks 1-4.

---

## Notes for the final reviewer

- **Replacement parity:** these are intentional contract changes, not behavior changes. Confirm the Tooltip open timer is the same (just `openDelay`), the menu checked state is the same (just `data-checked` present/absent), `ComboboxValue`'s resolved selection + function-children contract is unchanged (only the `<span>` wrapper + `render` prop are added), and `PositioningProps`/`SelectionProps` are pure extractions (each Root's defaults unchanged — check a couple of destructures, e.g. ContextMenu `offset = 0`, Tooltip `side = 'top'`).
- **Generic confinement:** `ComboboxValue`'s `as OptionEntry<Value>[]` is the single new cast, at the documented Root-owns-the-generic seam (matches `useListboxSelection`). No other casts should appear.
- **Docs parity:** the renamed surface (Tooltip `openDelay`, Menu `data-checked`, Combobox `Value` render prop) is reflected in the API tables and styling examples; no stale `delay`/`data-state="checked"` references remain in `apps/site`.
- **Non-goals honored:** no `popupId`/`listboxId` rename; no `multiple` discriminated union (value stays `Value | Value[]`).
