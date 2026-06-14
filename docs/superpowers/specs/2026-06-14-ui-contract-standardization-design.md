# UI contract standardization (Section E Group 2) design

**Section:** Primitives DX review, Section E ("UI: move the dedup trigger from fifth copy to second copy"), Group 2 (standardize the small contract forks). Follows the completed Group 1 dedups ([[project_section_e_dedup]]).

**Source:** `docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`, Section E + the UI friction bullets (lines 110-118).

## Goal

Standardize the small public-contract forks across the seven `@hono-preact/ui` components while the surface is still small. These are breaking API changes, but free: `@hono-preact/ui` is private/unpublished (version `0.0.0`, 404 on npm), so there are no external consumers. Ships as one PR (a single break point).

## Scope

Five work items in one PR. Item numbering follows the review.

### 1. One delay vocabulary

`TooltipRootProps` names the hover-open delay `delay`; `SubmenuRootProps` names it `openDelay` (both already use `closeDelay`). Standardize on `openDelay`.

- `tooltip/tooltip.tsx`: rename the `delay?: number` prop to `openDelay?: number` (keep the `// open delay (ms), default 600` comment), update the destructure (`delay = 600` -> `openDelay = 600`), and the `setTimeout(() => setOpen(true), delay)` -> `openDelay`.
- Docs: the Tooltip API reference table and any example/prose using `delay`.

### 2. `data-checked` instead of overloading `data-state`

`MenuCheckboxItem` and `MenuRadioItem` set `'data-state': checked ? 'checked' : 'unchecked'` (`menu.tsx:359,469`), overloading `data-state` (which means `open`/`closed` everywhere else). Switch to a dedicated present/absent `data-checked`, matching the `data-selected`/`data-highlighted`/`data-disabled` idiom used across the library.

- `menu/menu.tsx`: in both items, replace `'data-state': checked ? 'checked' : 'unchecked'` with `'data-checked': checked ? '' : undefined`.
- Docs: any `[data-state=checked]` / `[data-state=unchecked]` styling example becomes `[data-checked]` / `:not([data-checked])`; update the Menu data-attribute reference table(s) (Menu + ContextMenu).

### 3. Align the `Value` part shape + fix the generic-erasure leak (folds in review item 6)

`SelectValue` and `ComboboxValue` do genuinely different jobs (label display vs removable multi-select chips), so they keep distinct state. But their *part surface* should match, and `ComboboxValueState` should stop leaking `unknown`.

Current `SelectValue` shape (the target surface): `render?: RenderProp<State>` + `children?: (state) => ComponentChildren` + `& Omit<JSX.HTMLAttributes<HTMLSpanElement>, 'children'>`, renders a `<span>` via `renderElement`, passes `state`.

Current `ComboboxValue` (`combobox.tsx:842-856`): `{ children: (state: ComboboxValueState) => ComponentChildren }`, renders a bare `Fragment`, no `render` prop, no rest props; `ComboboxValueState { selectedItems: OptionEntry[]; remove: (value: unknown) => void }` leaks `unknown`.

Changes:

- `listbox/selection.ts`: make `OptionEntry` generic: `export interface OptionEntry<Value = unknown> { id: string; value: Value; label: string }`. Existing unparameterized uses resolve to `OptionEntry<unknown>`, no ripple.
- `combobox/combobox.tsx`: make the Value part generic and element-rendering:

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

The two parts now share a surface (render prop + element + rest + function-children); only their `state` contents differ (`{selectedLabels}` vs `{selectedItems, remove}`), which is the genuine job difference, documented as such. The `<span>` wrapper is new for Combobox (was a Fragment) and gives chip markup a styling hook via rest props; free since ui is unpublished.

### 5. Shared `PositioningProps` / `SelectionProps`

The positioning triple (`side`/`align`/`offset`) is byte-identical across the five positioning Roots (only default values differ, in comments); the selection quad (`value`/`defaultValue`/`onValueChange`/`multiple`) is identical across Select + Combobox. Extract both so the per-Root prop sets declare a shared base instead of drifting.

- `use-position.ts`: add `export interface PositioningProps { side?: Side; align?: Align; offset?: number }`. The Roots that position (`PopoverRootProps`, `TooltipRootProps`, `MenuRootProps`, `ContextMenuRootProps`, `SubmenuRootProps`, `SelectRootProps`, `ComboboxRootProps`) compose it (`& PositioningProps` for `type` aliases, or `extends PositioningProps` for `interface`). Per-Root default values stay in each Root's destructure; the type only declares the three props once. Keep each Root's existing default-documenting comments adjacent to its destructure (the shared type does not encode defaults).
- `listbox/selection.ts`: add `export interface SelectionProps<Value> { value?: Value | Value[]; defaultValue?: Value | Value[]; onValueChange?: (value: Value | Value[]) => void; multiple?: boolean }`. `SelectRootProps<Value>` and `ComboboxRootProps<Value>` compose it (each keeps its own `Value` default: Select `= string`, Combobox `= unknown`). The form-only props (`name`/`disabled`/`required` on Select) and the Combobox-only props stay per-Root.

**Non-goal:** no discriminated union on `multiple`. `value` stays `Value | Value[]`, so `onValueChange` still hands the consumer a union to narrow. Typing `value` precisely against `multiple` is a separate, much harder change; out of scope here. The shared `SelectionProps<Value>` only removes the duplication, it does not change today's typing.

### 4 — skipped (deliberate keep)

The review listed "one popup-id prop name." This is the internal context field `popupId` (Dialog/Popover/Menu/Tooltip) vs `listboxId` (Select/Combobox), not a user-facing prop. `listboxId` is semantically correct (the element has `role="listbox"`), and renaming is internal-only churn that loses meaning. Keep both names; this item is intentionally not done.

## Behavior

All changes are type/contract-level and behavior-preserving except the intended renames:
- The Tooltip open delay is the same timer, under a new prop name.
- The Menu checkbox/radio checked state is the same, under `data-checked` instead of `data-state`.
- `ComboboxValue` now renders a `<span>` wrapper (was a Fragment) and accepts a `render` prop; its function-children contract and the resolved selection are unchanged.
- The shared `PositioningProps`/`SelectionProps` are pure type extractions; runtime behavior and defaults are unchanged.

## Testing

- Existing suites stay green except the few tests asserting the renamed surface: update any test checking `data-state="checked"`/`"unchecked"` on menu items (-> `data-checked`), Tooltip `delay` (-> `openDelay`), or the `ComboboxValue` Fragment (-> the `<span>` wrapper).
- Add coverage: the generic `ComboboxValue` (`remove(value)` typed to `Value`, `selectedItems` typed `OptionEntry<Value>[]`), and the `ComboboxValue` `render` prop rendering an element with rest props.
- Type-level: a `tsc` compile is the check that `PositioningProps`/`SelectionProps` compose cleanly into each Root and that the `OptionEntry<Value>` generic does not ripple.
- Docs sweep: Tooltip `delay`->`openDelay`; Menu/ContextMenu `data-state=checked`->`data-checked` styling + reference tables; Combobox `Value` page gains the `render` prop / element note.
- Full six-step CI.

## Scope boundaries

In scope: items 1, 2, 3 (incl. 6), 5 above, in one PR.

Out of scope:
- Item 4 (popup-id rename) — deliberate keep (above).
- The `multiple` discriminated union / precise `value` typing — separate, harder change (non-goal above).
- Section F (dogfood-or-delete + live demos on primitive docs pages).
