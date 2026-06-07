# Combobox (Phase 5): design spec

Date: 2026-06-07
Status: design approved (brainstorming), not yet planned or built
Predecessors: [Select (Phase 4)](./2026-06-06-select-design.md), [headless components investigation](./2026-05-31-headless-components-investigation.md)

## 1. Goal and scope

Ship `Combobox`, the APG "editable text input with a popup listbox" pattern, as the
fifth and final component of the hard behavioral cluster in `@hono-preact/ui`. It is
the hardest of the cluster: `aria-autocomplete` semantics, manual vs list vs inline
autocomplete, IME/composition handling, and the documented gap between markup and
screen-reader reality. It gets the heaviest test budget.

In scope for v1:

- Single and multiple selection (multiple is a headless token/tag input).
- All three autocomplete modes (`none`, `list`, `both`), including inline completion.
- Consumer-owned filtering (the library never filters).
- Select-from-list-only commit semantics, with an explicit creatable recipe for
  adding values that do not yet exist.
- A built-in screen-reader results announcer (`Combobox.Status`).
- Optional helper parts: a chevron `Trigger`, a `Clear` button, and an `Empty` slot.

Out of scope for v1: see Section 8.

## 2. Locked decisions (from brainstorming)

1. **Filtering: consumer-owned (headless).** The library owns the input value, open
   state, navigation, ARIA, and selection. The consumer reads the input value and
   renders only the matching `<Combobox.Option>` children. We also ship a tiny
   standalone `matchSubstring`-style helper for the common in-memory case.
2. **Autocomplete: all three modes day one.** `none`, `list` (default), and `both`
   (inline completion) including IME/composition handling.
3. **Add-new: select-from-list-only invariant, creatable recipe.** The committed
   value is always a known option. Adding a new value is done by rendering a
   synthetic `Create "X"` option when nothing matches; selecting it fires
   `onValueChange` plus an optional `onCreate` convenience. No free-solo /
   `allowCustomValue`.
4. **Cardinality: single + multiple.** Multiple is a headless token input: the
   consumer renders chips, Backspace on an empty input removes the last token, the
   popup stays open on toggle, `aria-multiselectable` on the listbox.
5. **Screen-reader status: library-owned.** `Combobox.Status` is a visually-hidden
   `aria-live` region with sensible defaults and a render-prop override.
6. **Code sharing: extract a shared selection/collection core and refactor Select
   onto it.** This follows the codebase's established promote-and-refactor pattern
   (promote `useListNavigation`, refactor Menu onto it). The Positioner/Popup/Arrow
   trio dedup across Popover/Tooltip/Menu/Select/Combobox stays a pre-existing
   cross-component backlog item, not this slice.
7. **Mount strategy: always-mounted Popup (hidden when closed), following Select's
   convention.** See Section 7.5 for the nuance: because filtering is
   consumer-owned, label resolution still relies on a value-to-label cache and
   `itemToString`, not on the container being mounted.
8. **Optional parts: ship all three** (`Trigger`, `Clear`, `Empty`) in v1.

## 3. Architecture

### 3.1 Shared selection/collection core: `useListboxSelection`

`SelectRoot` today hand-rolls three concerns that Combobox needs identically. Extract
them into one internal hook so both components share a single tested implementation:

```
packages/ui/src/listbox/selection.ts   ->  useListboxSelection<Value>(opts)
```

`useListboxSelection` owns:

- **Generic-value erasure and comparator.** The `equal` / `serialize` / `valuesArray`
  seam (the only `as Value` casts in the component), driven by the optional
  `isValueEqual` / `serializeValue` props. The module-level Preact context cannot
  carry a per-instance generic, so values are stored as `unknown`; the Root re-applies
  the generic in this one place.
- **Selection.** `isSelected(v)`, `toggle(v)` (single replaces and closes; multiple
  toggles and stays open), and the `multiple` flag.
- **Option/label registry.** `registerOption(id, value, label)` and
  `selectedLabels()`, plus a **value-to-label snapshot cache** (new, see Section 7.5)
  so a selected value's label survives the option being filtered out of the DOM.
- **Hidden form fields.** The `name`-driven `<input type="hidden">` renderer (single:
  one input; multiple: one per selected value, repeated name).

The hook returns a plain object that each Root spreads into its own context. It stays
**internal** in v1 (shared by Select and Combobox); promotion to a public Foundations
primitive is deferred (Section 8).

`OPTION_SELECTOR` moves to the shared `listbox/` module; Select and Combobox both
re-export it (Select keeps its current public re-export for API stability).

### 3.2 Select refactor onto the core

`SelectRoot` drops its inline registry / comparator / toggle / hidden-field code and
calls `useListboxSelection`. There is no public API change to Select. Select's full
test suite is the regression safety net for the extraction and must stay green.

### 3.3 Combobox slice layout

Mirrors the established per-component layout:

```
packages/ui/src/combobox/
  context.ts        ComboboxContext (generic erased to unknown) + useComboboxContext
  combobox.tsx      all parts
  autocomplete.ts   pure inline-completion + IME helpers (unit-tested in isolation)
  index.ts          named exports + the `Combobox` namespace object
```

Reused unchanged: `useListNavigation` (activedescendant mode), `usePosition`,
`useDismiss`, `useControllableState`, `useRender`, `mergeRefs`, and the new
`useListboxSelection`.

### 3.4 `useListNavigation` extension: `homeEnd`

Add `homeEnd?: boolean` (default `true`) to `UseListNavigationOptions`. When `false`,
the hook does not handle Home/End, leaving them as native text-caret movement. Select
keeps the default (`true`, unchanged); Combobox passes `false` (APG requires Home/End
to move the input caret, not the list). This is the only change to a shipped primitive.

## 4. State model

### 4.1 The four state pieces

`ComboboxRoot` owns, all via `useControllableState` where controllable:

- `value: Value | Value[]` (committed selection).
- `inputValue: string` (the filter query, see 4.2).
- `open: boolean`.
- `activeId: string | null` (the `aria-activedescendant` target).

The consumer reads `inputValue` and renders the matching `<Combobox.Option>` children.
That is the entire filtering contract.

### 4.2 `inputValue` is the query (display vs query split)

The public `inputValue` (and `onInputChange`) is always the **typed query**: what the
user typed, and what the consumer filters on. In `both` mode the DOM input may display
a longer completed string, but that completion is an internal display-plus-selection
concern. Consumers never filter on the completion, so filtering is identical across all
three modes.

Internally the Input is a controlled input whose value is `displayText`:

- `none` / `list`: `displayText === inputValue` (the query).
- `both`: `displayText` is the completed text; the appended suffix is a selected range
  re-applied after each render (Section 6.2).

### 4.3 Lifecycle

| Event | Single | Multiple |
| --- | --- | --- |
| Type a char | set `inputValue` = typed; open; auto-highlight first match (list/both); inline-complete (both) | same |
| Commit an option (click / Enter) | set value; `inputValue` = selected label; close; clear active | toggle value; `inputValue` = ''; stay open; keep focus in input |
| Close without selecting | revert `inputValue` to the selected value's label (or '') | `inputValue` = '' (tokens already reflect value) |
| `Combobox.Clear` | value -> empty; `inputValue` = ''; focus input | same |
| Backspace on empty input | (no-op) | remove the last token |

Open triggers: typing a printable char, ArrowDown/ArrowUp on a closed input, clicking
the Input or the `Trigger`. `openOnFocus` is deferred (Section 8).

## 5. Component API

### 5.1 Parts

```tsx
<Combobox.Root>          // owns value(s), open, inputValue, autocomplete mode, refs/ids, creatable
  <Combobox.Input />     // editable <input role="combobox"> the focus surface
  <Combobox.Trigger />   // chevron button toggling open; tabindex=-1; input keeps focus
  <Combobox.Clear />     // button: clears value + input, focuses input
  <Combobox.Positioner>  // identical to Select.Positioner
    <Combobox.Popup>      // role="listbox"; always-mounted, hidden when closed
      <Combobox.Empty />        // shown when zero options are registered
      <Combobox.OptionGroup>
        <Combobox.OptionGroupLabel />
        <Combobox.Option value={...} />   // role="option"; render-prop {selected,disabled,highlighted}
      </Combobox.OptionGroup>
      <Combobox.Arrow />        // optional floating arrow
    </Combobox.Popup>
  </Combobox.Positioner>
  <Combobox.Status />     // visually-hidden aria-live=polite results announcer
</Combobox.Root>
```

`Positioner`, `Popup`, `Option`, `OptionGroup`, `OptionGroupLabel`, and `Arrow` match
the corresponding Select parts in structure, data attributes, and render-prop state.

### 5.2 `Combobox.Root` props

Select's value / selection / positioning props carry over verbatim. Additions are in
bold.

| Prop | Type | Note |
| --- | --- | --- |
| `value` / `defaultValue` / `onValueChange` | `Value \| Value[]` | from Select |
| `multiple` | `boolean` | from Select |
| `open` / `defaultOpen` / `onOpenChange` | `boolean` | from Select |
| **`inputValue` / `defaultInputValue` / `onInputChange`** | `string` | the filter query (controllable) |
| **`autocomplete`** | `'none' \| 'list' \| 'both'` | default `'list'` |
| **`onCreate`** | `(inputValue: string) => void` | creatable convenience (optional) |
| **`itemToString`** | `(value: Value) => string` | label for a value whose option is not rendered (optional) |
| `name` / `disabled` / `required` | | from Select |
| `isValueEqual` / `serializeValue` | | from Select (generic seam) |
| `side` / `align` / `offset` / `loop` | | from Select |

No `typeahead` prop (typing filters, it does not typeahead-jump). No `freeSolo` /
`allowCustomValue` (creatable-only).

### 5.3 Multiple: the token input

For multiple selection the consumer renders chips. `Combobox.Value` is a non-visual
render-prop accessor (mirrors `Select.Value`, extended for multiple) exposing the
selected items and a remove function:

```tsx
<Combobox.Value>
  {({ selectedItems, remove }) =>
    selectedItems.map((it) => (
      <Chip key={it.id} onRemove={() => remove(it.value)}>{it.label}</Chip>
    ))
  }
</Combobox.Value>
```

`selectedItems` is `{ id, value, label }[]`, labels resolved via the registry plus the
value-to-label cache plus `itemToString`. `remove(value)` calls `toggle(value)`.

### 5.4 Creatable recipe

When the typed query matches no existing option, the consumer renders a synthetic
option marked with the `create` boolean prop:

```tsx
{filtered.length === 0 && query !== '' && (
  <Combobox.Option value={query} create>Create "{query}"</Combobox.Option>
)}
```

A `create` option is a real, focusable, ARIA-announced option (the
select-from-list-only invariant holds), but selecting it (click or Enter) calls
`Root`'s `onCreate(inputValue)` instead of the normal `toggle`. This is the single
explicit mechanism: `onValueChange` does not fire for a `create` option, so consumers
never have to disambiguate create-vs-select. The consumer's `onCreate` handler persists
the new option and, typically, sets `value` to it. If `onCreate` is not provided, a
`create` option falls back to normal `toggle` semantics (its `value` is committed as-is,
which is valid because it is a rendered option).

## 6. Autocomplete modes, inline completion, IME

### 6.1 The three modes

`autocomplete` sets `aria-autocomplete` on the input and governs two behaviors:
auto-highlight (does the first match become `activeId` as you type) and inline
completion.

| Mode | `aria-autocomplete` | Auto-highlight first on type | Inline completion |
| --- | --- | --- | --- |
| `none` | `none` | no (arrow keys only) | no |
| `list` (default) | `list` | yes | no |
| `both` | `both` | yes | yes |

Filtering is consumer-owned in every mode; the mode changes only ARIA semantics,
auto-highlight, and inline completion.

### 6.2 Inline completion (`combobox/autocomplete.ts`)

Pure logic, unit-tested with no DOM:

```ts
computeInlineCompletion(typed: string, firstLabel: string | null):
  { text: string; selStart: number; selEnd: number } | null
// returns the completed text with the appended suffix selected (selStart=typed.length,
// selEnd=text.length), or null when firstLabel does not start with `typed`
// (case-insensitive) or there is no firstLabel.
```

The completion source is the **first option currently registered in the listbox** (the
consumer-filtered top match). No completion when the list is empty.

Application rules in `Combobox.Input`:

- **Forward typing only.** Compare the new value to the previous one; on deletion
  (Backspace/Delete, or any shrink) do not complete.
- **Display vs query.** The DOM input is controlled by `displayText`. After each render
  with an active completion, a layout effect re-applies
  `setSelectionRange(selStart, selEnd)` (Preact rewrites `.value` on each render, so the
  selection must be re-applied). The public `inputValue` / `onInputChange` stay equal to
  the query (the typed prefix).
- A programmatic `displayText` write must not re-trigger completion; completion is
  computed only from a user `onInput` (or post-composition) event.

### 6.3 IME / composition

Track `compositionstart` / `compositionend`. While composing (`isComposing` true): do
not inline-complete, and do not run the `onInput` filter side effects that would fight
the IME. Apply completion only after `compositionend`, and only for forward input. This
is the highest-risk area and gets the heaviest manual test budget across the SR matrix.

### 6.4 Active-option management / auto-highlight

Reuse `useListNavigation` in `activedescendant` mode for ArrowUp/Down and
`setActiveItem`, with `typeahead: false` and `homeEnd: false`. On open: active = the
selected option (single) or the first option (multiple / none). In `list` and `both`, a
layout effect resets active to the first option whenever the filtered set changes (the
auto-highlight, so Enter commits the top match). In `none`, typing does not move active;
arrow keys do.

## 7. Cross-cutting concerns

### 7.1 Keyboard map (APG combobox, input focused)

| Key | Closed | Open |
| --- | --- | --- |
| Printable | filter + open + highlight/inline | filter + re-highlight/inline |
| `ArrowDown` | open, active -> selected/first | active down |
| `ArrowUp` | open, active -> last | active up |
| `Alt+ArrowDown` | open (do not move active) | (no-op) |
| `Alt+ArrowUp` | (no-op) | close |
| `Home` / `End` | caret (default) | caret (default) |
| `Enter` | submit form (default) | commit active option; `preventDefault` |
| `Escape` | reset input to selected label / clear | close + revert display to query |
| `Tab` | (default focus move) | `both`: accept inline completion (commit active); else close; then default focus move |
| `Backspace` | (multi, empty input) remove last token | (multi, empty input) remove last token |

`preventDefault` is called only on keys the component handles, so unhandled keys retain
native behavior (form submit, caret movement, focus traversal).

### 7.2 ARIA roles

- `Input`: `role="combobox"`, `aria-expanded`, `aria-controls` = listbox id,
  `aria-autocomplete` = mode, `aria-activedescendant` = `activeId` (when open),
  `aria-required` / `aria-disabled`, consumer `aria-label` / `aria-labelledby`.
- `Popup`: `role="listbox"`, id, `aria-multiselectable` (multiple),
  `aria-label` / `aria-labelledby`.
- `Option`: `role="option"`, `aria-selected`, `aria-disabled`, id.
- `Trigger` (chevron): `tabindex=-1`, `aria-label`, `aria-controls`, toggles open and
  refocuses the input.
- `Clear`: focusable button, `aria-label` (default "Clear").
- `Status`: `aria-live="polite"`, `aria-atomic="true"`, visually hidden.

### 7.3 `Combobox.Status` (aria-live)

A visually-hidden `aria-live="polite" aria-atomic="true"` region. Default content is
derived from the registered enabled-option count and `open`: open and count > 0 ->
"{count} results available"; count === 0 -> "No results"; closed -> cleared. A render
prop `({ count, open }) => ComponentChildren` overrides for i18n and async ("Loading")
states; the consumer composes loading text from their own fetch state plus the exposed
count. Content updates in an effect keyed on `[open, count]`; `polite` queues so rapid
typing does not spam.

### 7.4 Data-attribute contract (mirrors Select)

- `Input`: `data-state` (open/closed).
- `Positioner` / `Popup`: `data-side`, `data-align`, `data-state`; `Popup` also
  `data-empty` when the registered count is 0.
- `Option`: `data-selected`, `data-highlighted`, `data-disabled`.
- `Trigger`: `data-state`.

### 7.5 Mount strategy and initial label

The Popup is always mounted and `hidden` while closed, matching Select's convention.
The nuance: because filtering is consumer-owned, the option children are
consumer-filtered regardless of the container being mounted, so a selected value that
has been filtered out is not in the registry. Label resolution therefore relies on:

1. the **value-to-label cache** in the shared core (snapshots a label at selection
   time, so "select, then filter out, then close and revert to label" works within a
   session), and
2. **`itemToString`** for the initial selected label (a `defaultValue` whose option was
   never rendered) and for SSR. Without `itemToString`, the initial label fills after
   the option is first registered on the client.

### 7.6 SSR and hydration

The server renders the input (controlled or empty `inputValue`) and the closed (hidden)
listbox. Option registration, the count, and the value-to-label cache are client-only
effects (same as Select). For an SSR-accurate initial selected label, the consumer uses
`itemToString` (pure, SSR-safe). Top-layer / Popover-API promotion stays effect-gated
(no SSR), identical to Select.

### 7.7 Form submission

Hidden native field(s) per `name` come from the shared core (single: one input;
multiple: one per value with the repeated name). The committed value(s) submit; the
`inputValue` query never does. Identical to Select.

### 7.8 Documentation (apps/site)

A `/docs/components/combobox` page under the Components area, with CSS and Tailwind
tabs, following the docs-template standard (prose / examples / API reference). Examples:
single, multiple token input, creatable, async with `Status` and a loading message, and
inline autocomplete. The component's definition of done includes the copyable styled
examples in both flavors. The `useListNavigation` Foundations page gets a note for the
new `homeEnd` option.

### 7.9 Size tracking

Add `combobox` to `COMPONENT_MODULES` in `scripts/client-size-config.mjs` (Section C).
The shared `listbox/selection.ts` counts under UI core; Combobox's marginal-over-core is
measured. Update the committed baseline and history per the chore-commit convention.

### 7.10 Testing

- Unit: `autocomplete.ts` (`computeInlineCompletion`: prefix and case-insensitive
  match, no-completion, forward-typing predicate); `useListNavigation` with
  `homeEnd: false`.
- Component (preact testing + `act`): type -> filter -> auto-highlight; Enter commits
  the top match; Escape close-then-revert and second-Escape reset; Tab accepts inline
  in `both`; Arrow and Alt+Arrow open and navigate; multiple toggle + stay-open +
  Backspace token removal; creatable (synthetic option commit + `onCreate`); Status
  announcements; disabled options skipped; full ARIA wiring (combobox / listbox /
  option, activedescendant, autocomplete attribute).
- IME: a `compositionstart` / `input` / `compositionend` sequence asserts no inline
  completion mid-composition.
- The Select regression suite must stay green as the safety net for the core
  extraction.
- Test command: `pnpm exec vitest run`.

### 7.11 Accessibility bar

WAI-ARIA APG combobox conformance plus the NVDA / JAWS / VoiceOver matrix per the
standing a11y bar. Inline completion plus IME gets the heaviest manual budget (the
investigation's "do this last, with the most test budget").

## 8. Deferred / future work

- Free-solo / `allowCustomValue`: explicitly not built (creatable-only decision).
- Option virtualization (large / async lists).
- `openOnFocus` prop.
- Promote `useListboxSelection` (and / or a standalone collection primitive) to a
  public Foundations primitive; internal in v1, revisit at a third consumer.
- Positioner / Popup / Arrow trio dedup across Popover / Tooltip / Menu / Select /
  Combobox (pre-existing cross-component backlog).
- Standing cross-slice increments: `usePresence` exit animations; the styling-variant
  runtime helper.
- Touch / mobile (virtual keyboard, no hover): documented limitations.

## 9. Open items for the implementation plan

- Exact default `Status` message strings, and whether the render prop receives only
  `count` / `open` or a fully composed default message to wrap.
- Pin down the `displayText` reconciliation effect for inline mode (the Preact
  controlled-value plus selection-range interplay) with a focused test before building
  outward; this is the riskiest single mechanism.
- The shape of the value-to-label cache (keyed by serialized value vs by comparator
  identity) and its interaction with `itemToString`.
- The `matchSubstring` helper's name and signature (it ships as a public package-root
  export per decision 2.1; the open question is only its exact shape, for example
  case-folding options and whether it returns a boolean or a filtered list).
- TDD task ordering: shared core extraction + Select refactor first (regression-safe),
  then Combobox parts bottom-up (context, Input, Popup/Option, navigation, inline/IME,
  Status, Trigger/Clear/Empty), then docs and size.
