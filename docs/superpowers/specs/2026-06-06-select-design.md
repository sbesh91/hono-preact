# Select (listbox) (Phase 4): design spec

Status: approved design, ready for an implementation plan.
Date: 2026-06-06.
Predecessor context: `docs/superpowers/specs/2026-05-31-headless-components-investigation.md` (§3.4 collections/navigation, §8 roadmap Phase 4), the shipped Menu + Context Menu slice (`docs/superpowers/specs/2026-06-05-menu-context-menu-design.md`, PR #78), and the deferred-work backlog (`project_menu_slice_followups`: promote the collection + `useTypeahead` to a public primitive when Select is a second consumer).

## 1. Goal and scope

Build **Phase 4** of the headless component roadmap: the **Select** (custom listbox) component for `@hono-preact/ui`, supporting single and multiple selection, a generic value type, and HTML form submission. This slice also **promotes the internal navigation machinery to a public primitive** (`useListNavigation`), validated by two consumers (Menu via roving tabindex, Select via `aria-activedescendant`), and refactors Menu onto it.

Select differs from Menu in its navigation model: focus stays on the trigger and an `aria-activedescendant` pointer names the active option (the APG select-only combobox pattern), rather than Menu's roving DOM focus. It reuses the positioning, dismissal, controllable-state, render-prop, and `data-state` machinery already shipped.

The custom listbox is the only Select built. No native-`<select>`-backed escape-hatch variant is shipped (decided during brainstorming).

## 2. Locked decisions (from brainstorming)

1. **Single and multiple selection**, forked by a `multiple` prop: `value` is `Value | undefined` (single) or `Value[]` (multi). Single selecting closes the listbox; multi toggles and stays open (`aria-multiselectable`).
2. **Generic value type `<Value>`, defaulting to `string`.** Equality is `Object.is` by default, overridable via an optional `isValueEqual(a, b)` on `Root` (also sidesteps the inline-new-reference footgun for object values). Strings and numbers are zero-config; objects and enums are supported.
3. **Form integration via a hidden native field.** A `name` prop makes `Root` render hidden native inputs mirroring the value (single: one; multi: one per selected value, repeated `name`, matching native multi-select submission). The string is produced by an optional `serializeValue(value) => string` on `Root` (default `String(value)`), consulted only when `name` is set. The hidden field is a real input, so the value is present in the form even before hydration.
4. **Select-only combobox ARIA / focus model.** `Select.Trigger` is a button with `role="combobox"`, `aria-expanded`, `aria-controls`, and `aria-activedescendant` (while open); **focus stays on the trigger**. The surface is `role="listbox"`; options are `role="option"`. This is the exact shape Phase 5 (Combobox) reuses with a text input in place of the button.
5. **Auto-label, always-mounted listbox.** Each `Select.Option` registers its `value -> label` into `Root`; the listbox is always in the DOM (visually hidden when closed) so `Select.Value` auto-shows the selected label even while closed (like native `<select>`, which also keeps all options in the DOM). `Select.Value` takes a `placeholder` and an optional render-prop escape hatch for custom or SSR-accurate labels (registration is client-only).
6. **Promote `useListNavigation` to a public primitive** (supporting both `roving` and `activedescendant` modes), promote `useTypeahead` and the pure nav helpers to public exports, refactor Menu onto it, and add a Foundations docs page. Fulfils the backlog item and sets up Combobox.

## 3. Architecture

Same compound-component shape as the prior slices: each part renders via `useRender` over a context provided by `Root`.

```
@hono-preact/ui
  (reused, already shipped)
    useRender / RenderProp      render-prop composition + state arg
    mergeRefs                   ref merging
    useControllableState        open state + value / value-set
    usePosition                 @floating-ui/dom binding (positioning + autoUpdate)
    useDismiss + dismiss-stack  shared capture-phase Escape / outside-press (single-node; no tree)
    inline useId wiring         aria-* id plumbing
    data-state contract         data-state / data-side / data-align
    matchTypeahead, wrapNext,   pure nav helpers (promoted to public this slice)
      wrapPrev
    useTypeahead                keystroke buffer (promoted to public this slice)

  (new shared machinery, built + promoted this slice)
    useListNavigation           public primitive: active-item state + movement keydown +
                                roving | activedescendant DOM effect; getItems(container, selector)

  (refactored)
    Menu.Popup                  rewired onto useListNavigation (mode: 'roving'); behavior preserved,
                                guarded by the existing 134 menu tests

  (new component)
    Select.*                    Root, Trigger, Value, Positioner, Popup (listbox), Option,
                                OptionGroup, OptionGroupLabel, Arrow?; Root renders the hidden field
```

## 4. The navigation primitive: `useListNavigation`

### 4.1 Promoted to public

A new public hook at `packages/ui/src/use-list-navigation.ts` that unifies list movement across both navigation models:

- Owns the **active item** (`activeId`) and a setter; derives the ordered, enabled item list from a container via a configurable selector (`getItems(container, selector)`, generalizing the Menu's `getMenuItems`).
- Returns an **`onKeyDown(event)`** that handles ArrowDown/ArrowUp (Home/End, and typeahead via `useTypeahead` + `matchTypeahead`), updating the active item with `loop` wrapping.
- Applies the navigation effect by **`mode`**:
  - `'roving'`: focuses the active element on change (Menu). The component renders the item's `tabIndex` from `activeId`.
  - `'activedescendant'`: does not move focus; the component renders `aria-activedescendant` on the focused container (Select trigger) from `activeId`.
- Accepts an initial-active resolver (first / last / a specific id, e.g. the selected option) for on-open positioning.

The pure helpers (`wrapNext`, `wrapPrev`, `matchTypeahead`) and `useTypeahead` are promoted to public barrel exports alongside it. The exact hook signature, the `getItems` scope-exclusion for nested same-role containers (menus need it; Select does not), and how `activeId` ownership is split between the hook and the component are finalized in the implementation plan (§9).

### 4.2 Menu refactor

`Menu.Popup` replaces its bespoke ArrowUp/Down/Home/End/typeahead switch with `useListNavigation({ mode: 'roving', ... })`. The Menu-specific keys stay in `Menu.Popup`, composed with the primitive's `onKeyDown`: Enter/Space activate the active item, Tab closes, and the dismiss-stack still owns Escape and outside-press. The submenu keyboard (ArrowRight/Left) is unchanged. This refactor is behavior-preserving; the 134 existing menu tests are the safety net, and any divergence is a blocking finding.

## 5. Component API: Select

| Part | Role | Key wiring |
| --- | --- | --- |
| `Select.Root<Value>` | Context provider | props: `value` / `defaultValue` / `onValueChange`, `multiple?` (default `false`), `open` / `defaultOpen` / `onOpenChange`, `name?`, `disabled?`, `required?`, `isValueEqual?`, `serializeValue?`, `side` (default `bottom`), `align` (default `start`), `offset`, `loop` (default `true`), `typeahead` (default `true`). Owns value state, open state, the `useListNavigation` (activedescendant) instance, the option `value -> label` registry, ids, and refs. Renders the hidden form field when `name` is set. |
| `Select.Trigger` | `role="combobox"` button | `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls={listboxId}`, `aria-activedescendant={activeId}` (while open), `aria-required` (when `required`), `id`, `data-state`, `disabled`. Owns the keydown handler (movement via the primitive plus open / select / close). Focus stays here. Default anchor for `usePosition`. |
| `Select.Value` | Selected-value display | Shows the selected option's registered label (single) or a comma-joined summary (multi); `placeholder` shown when empty. Optional render-prop `(value) => VNode` for custom or SSR-accurate display. |
| `Select.Positioner` | Fixed wrapper | `usePosition` + Popover-API promotion while open; carries `data-side` / `data-align`. Always rendered; `hidden` (and not promoted) while closed. |
| `Select.Popup` | Listbox surface | `role="listbox"`, `id={listboxId}`, `aria-multiselectable` (multi), `aria-labelledby` / `aria-label`, `data-state`. Always in the DOM (so options register); hidden while closed. Not focused (focus stays on the trigger). |
| `Select.Option` | A choice | `role="option"`, `id`, `value: Value`, `aria-selected`, `data-highlighted` (active), `data-selected`, `data-disabled`. Registers `value -> label` on mount. Pointer hover sets active; click selects. |
| `Select.OptionGroup` + `Select.OptionGroupLabel` | Grouped options | `role="group"` + `aria-labelledby`; label is presentational. |
| `Select.Arrow` | Optional arrow | floating-ui arrow data; `data-side`. |

- **Selection (single):** `value: Value | undefined`. Activating an option sets the value and closes. On open, the active descendant initializes to the selected option (or the first enabled option).
- **Selection (multi):** `value: Value[]`. Activating an option toggles it in the set and keeps the listbox open; the listbox sets `aria-multiselectable="true"`. On open, the active descendant initializes to the first selected option (or the first enabled option).
- **Equality:** an Option is selected when its `value` matches the Root value under `isValueEqual` (default `Object.is`). The label registry and selection both use `isValueEqual`, so object values with stable references or a custom comparator work.

## 6. The form field and value display

### 6.1 Hidden native field (`name`)

When `name` is set, `Root` renders, outside the listbox, hidden native inputs carrying the serialized value(s):
- single: one `<input type="hidden" name={name} value={serializeValue(value)} />` (empty when nothing selected).
- multi: one hidden input per selected value, all sharing `name` (repeated field, the native multi-select convention).

`serializeValue` defaults to `String(value)`, which covers string and number values with no config; object values that need form submission supply a `serializeValue`. `required` / `disabled` propagate to the trigger (`aria-required`, `disabled`); full constraint validation is out of scope (§8).

### 6.2 Auto-label and `Select.Value`

Each `Select.Option` registers `{ value, label }` (label from its text content) into a `Root` registry on mount and unregisters on unmount. Because the listbox is always mounted (§5), the registry is populated whenever the component is alive, so `Select.Value` can render the selected option's label even while the listbox is closed. `Select.Value` finds the entry whose `value` matches the selected value under `isValueEqual`. Multi renders a comma-joined list of labels by default. The `placeholder` shows when nothing is selected. The optional render-prop form `(value) => VNode` gives full control (chips, counts) and is the path to an SSR-accurate label, since registration is a client-only effect (on SSR the auto-label is empty and fills on hydration).

## 7. Cross-cutting concerns

### 7.1 Keyboard map (APG select-only combobox)

- **Closed trigger:** Enter / Space / ArrowDown / ArrowUp / Alt+ArrowDown open the listbox; the active descendant starts on the selected option.
- **Open:** ArrowDown / ArrowUp move the active descendant (wrap when `loop`), Home / End jump, printable characters drive typeahead, **Enter / Space** select the active option (single: select and close; multi: toggle and stay open), **Escape** closes without changing the selection, **Tab** closes and proceeds. Disabled options are skipped by navigation and typeahead.

### 7.2 Data-attribute contract

`data-state="open|closed"` on trigger, positioner, popup; `data-highlighted` on the active option; `data-selected` and `aria-selected` on selected options; `data-disabled` on disabled options and a disabled trigger; `data-side` / `data-align` on the positioner (mirrored where useful). `@starting-style` entry animation; no exit animation (the standing `usePresence` deferral). No CSS ships from the package.

### 7.3 SSR and hydration

The listbox is rendered (with all options) on the server but `hidden`, so the markup is present and the hidden form field carries the initial value (submittable pre-hydration). The Popover-API promotion is applied imperatively while open (no hydration attribute mismatch), as in Menu/Popover. Ids come from `useId`. `Select.Value` auto-label is client-only (registration runs in an effect); for an SSR-accurate label use its render-prop form. Positioning runs only while open.

### 7.4 Documentation (apps/site)

- `/docs/components/select` under the Components nav (Overlays or a Forms grouping, matching the existing nav shape): full per-part API reference plus styled live demos for **single and multiple** selection, with a copy button in **CSS + Tailwind** flavors (parity rules per `feedback_css_tailwind_parity`; base Tailwind v4, `starting:` for entry). Describe what is; no migration breadcrumbs. The page documents its own parts in full (per `feedback_docs_self_contained_parts`).
- A **Foundations page for `useListNavigation`** (and the now-public `useTypeahead`), matching how `usePosition` / `useDismiss` were documented.

### 7.5 Size tracking

Add `select` to `COMPONENT_MODULES` and a `select` prefix to `CHUNK_PREFIXES` in `scripts/client-size-config.mjs`. Do not regenerate the committed `client-size-report.json` baseline in the PR. The Menu refactor onto the shared primitive may shift Menu's measured bundle slightly; that is expected and reported by the size comment.

### 7.6 Testing

Package unit tests in the established style:
- **`useListNavigation`**: movement + wrap + Home/End; typeahead; both modes (roving focuses the element, activedescendant updates the active id without moving focus); `getItems` ordering and disabled exclusion.
- **Menu regression**: the full menu suite must stay green after the refactor (the primary guard that the refactor is behavior-preserving).
- **Select**: activedescendant movement; single select-and-close; multi toggle-and-stay; `aria-selected` / `data-selected`; disabled options skipped; typeahead; Escape-closes-without-change; the hidden form field (single value, multi repeated names, `serializeValue`); generic value with a custom `isValueEqual` (object values); `Select.Value` auto-label and render-prop; SSR-rendered-but-hidden listbox; full ARIA wiring (`role="combobox"` / `listbox` / `option`, `aria-expanded` / `aria-controls` / `aria-activedescendant` / `aria-multiselectable`).

### 7.7 Accessibility bar

APG select-only-combobox / listbox conformance with a documented keyboard map. The NVDA / JAWS / VoiceOver matrix stays documented-not-automated, per the investigation. Avoid passing an automated scan while failing a real screen reader.

## 8. Deferred / future work

Restated for a durable backlog when the PR merges.

- **Native-`<select>`-backed variant**: explicitly not built (brainstorming decision).
- **Option virtualization**: add only when a real large-list use case demands it.
- **Typeahead while closed** (changing the value by typing on the closed trigger, as native selects do): a nicety; typeahead is open-only this slice.
- **Async / loading options**, and **constraint validation** (`required` beyond `aria-required`).
- **Exit animations (`usePresence`)** and the **styling-variant runtime helper**: standing cross-slice deferrals.
- **Roadmap continuation:** Phase 5 **Combobox** (the hardest), which reuses this slice's `useListNavigation`, `aria-activedescendant` wiring, and the select-only-combobox trigger shape, swapping the button for a text input with `aria-autocomplete`.

## 9. Open items for the implementation plan

- Finalize the `useListNavigation` signature: how `activeId` ownership splits between the hook and the consuming component, the initial-active resolver shape, and whether `getItems` takes an optional scope selector for nested same-role containers (menus need it, Select does not).
- Confirm the option `value -> label` registry shape (an array of `{ value, label }` matched by `isValueEqual`, given object values cannot be Map-keyed by reference reliably).
- Confirm how the listbox is hidden while closed across browsers (the `hidden` attribute vs a `data-state`-keyed style), so options register but the surface is inert and invisible without requiring consumer CSS, and so it composes with the Popover-API promotion.
- Decide whether `Select.Arrow` and `Select.OptionGroup` ship in v1 (both cheap; default is to ship them).
- Sequence the Menu refactor so it lands behind the green menu suite before Select is built on the shared primitive.
- TDD task breakdown, subagent-buildable, on a feature branch + PR (only spec / plan docs go to main).
