# Menu + Context Menu (Phase 3): design spec

Status: approved design, ready for an implementation plan.
Date: 2026-06-05.
Predecessor context: `docs/superpowers/specs/2026-05-31-headless-components-investigation.md` (§5 machinery, §8 roadmap), the shipped Dialog slice (`docs/superpowers/specs/2026-06-01-ui-dialog-slice-design.md`, PR #72), and the shipped Popover + Tooltip slice (`docs/superpowers/specs/2026-06-03-popover-tooltip-design.md`, PR #74), plus the `useSafeArea` primitive (PR #77).

## 1. Goal and scope

Build **Phase 3** of the headless component roadmap: the **Menu** (button-triggered dropdown) and **Context Menu** (right-click) components for `@hono-preact/ui`, plus the shared machinery these two components need that does not exist yet. Both ship unstyled (data-attribute contract), lean on the platform as far as it goes, and follow the compound-component patterns the Dialog and Popover/Tooltip slices established (`useRender` render-prop composition, `useControllableState`, inline `useId` wiring, `data-state`).

Phase 2 (Popover + Tooltip) stood up the positioning (`usePosition`) and dismissal (`useDismiss` + the flat `dismiss-stack`) machinery for anchored, non-modal overlays, and the `useSafeArea` primitive (PR #77) added the pointer-grace corridor. This slice is the first that needs **collections** (roving-tabindex item navigation), **typeahead**, and **nested overlay coordination** (a submenu and its parent menu dismissing as a tree). The investigation frames Phase 3 as "the first real test of nested dismissal."

The guiding constraint, carried from prior slices: **build the machinery this feature needs, but not more.** Section 4 states exactly what is built and what is deferred. The full Phase 3 scope was chosen during brainstorming: full menu (all item types), both trigger models (button and context), and nested submenus.

## 2. Locked decisions (from brainstorming)

1. **One shared core, two public namespaces.** The trigger is the only real difference between a dropdown menu and a context menu; everything below the surface is identical. An internal `menu` core (context, collection, roving navigation, typeahead, items, submenu machinery, Positioner/Popup) is consumed by two thin public namespaces: `Menu.*` (button trigger) and `ContextMenu.*` (right-click trigger). The shared parts are re-exported under `ContextMenu` names so each example stays self-consistent (a consumer never mixes `Menu.Item` inside `ContextMenu.Root`). This is the Radix-tested split.
2. **Full item model.** `menuitem` (action), `menuitemcheckbox` (toggle, controllable `checked`), `menuitemradio` (single-select within a `RadioGroup`, controllable `value`), `separator`, and labelled `group`. Disabled items are supported and skipped by navigation/typeahead.
3. **Nested submenus, coordinated as a tree.** The flat `dismiss-stack` is extended with an optional `parent` link. Escape closes innermost-first; an outside-press closes the whole tree; a press inside any layer of the same tree dismisses nothing. Popover and Tooltip pass no parent and keep their current behavior unchanged.
4. **Roving tabindex + typeahead.** Real DOM focus moves between items (exactly one item carries `tabindex=0`, the rest `-1`); typeahead (type-to-focus) is on by default. These are built as internal machinery this slice and kept internal; promotion to a public Foundations primitive is deferred to Phase 4 (Select), which is the second consumer that validates the shape.
5. **Submenu pointer corridors reuse `useSafeArea`.** The pointer can travel diagonally from a parent item into an open submenu without the submenu closing, using the shipped `useSafeArea` primitive. No new corridor machinery is invented.
6. **Item activation closes the whole tree by default**, and `onSelect` can `preventDefault()` to keep it open. `CheckboxItem`/`RadioItem` also close-on-select by default (Radix parity), with the documented keep-open recipe.
7. **Submenu direction is LTR** (ArrowRight opens, ArrowLeft closes). RTL is deferred and documented as a known limitation, consistent with the investigation's "no Adobe-grade i18n" scope (§7).

## 3. Architecture

Same shape as Dialog/Popover: each component is a compound set of parts over a context provided by `Root`. The parts are thin; the shared machinery underneath is the product.

```
@hono-preact/ui
  (reused, already shipped)
    useRender / RenderProp      render-prop composition + state arg
    mergeRefs                   ref merging
    useControllableState        open state, checkbox `checked`, radio-group `value`
    usePosition                 @floating-ui/dom binding (positioning + autoUpdate)
    useDismiss + dismiss-stack   shared capture-phase Escape / outside-press routing
    useFocusReturn              focus-in-on-open / return-on-close (root menu + each submenu)
    useSafeArea                 pointer-grace corridor (submenu diagonal travel)
    inline useId wiring         aria-* id plumbing (per-Root, Dialog precedent)
    data-state contract         data-state / data-side / data-align

  (new shared machinery, built this slice)
    collection + roving nav     context + ref-collection item registration, arrow-key nav
    useTypeahead                type-to-focus buffer (idle reset)
    dismiss-stack tree          optional parent link; whole-tree outside-press dismissal
    usePosition virtual anchor  {x, y} point anchor for the context-menu trigger

  (new components)
    Menu.*                      Root, Trigger, Positioner, Popup, Item, CheckboxItem,
                                RadioGroup, RadioItem, Separator, Group, GroupLabel,
                                SubmenuRoot, SubmenuTrigger, SubmenuPositioner, SubmenuPopup, Arrow?
    ContextMenu.*               Root, Trigger (area), + the shared parts under ContextMenu names
```

## 4. Machinery: what is built vs deferred

### 4.1 Built (the minimal new shared set)

1. **Collection + roving tabindex.** A context + ref-collection: items self-register on mount into an ordered collection, order derived from the DOM. Exactly one item carries `tabindex=0` (the highlighted/last-focused item), the rest `-1`. Arrow keys move real focus and wrap when `loop` is set; Home/End jump to first/last; disabled items, separators, and group labels are skipped. This is the reusable seed Phase 4 (Select) and Phase 5 (Combobox) draw on; it is kept internal this slice.
2. **`useTypeahead`.** Buffers keystrokes, resets on ~500ms idle, and moves focus to the next item whose text content matches the buffer. APG-recommended for menus and listboxes. Internal this slice.
3. **Dismiss-stack tree extension.** The existing module-level `dismiss-stack.ts` gains an optional `parent` field on a registered layer. New routing semantics: **Escape** closes the innermost (topmost) enabled layer first, already natural from stack order; an **outside-press** closes the *whole tree* (dismiss its root, which cascades through children); a press **inside any layer of the same tree** (parent or any descendant) dismisses nothing. Layers that register with no parent (Popover, Tooltip) are single-node trees and behave exactly as today, so this is a backward-compatible extension, not a rewrite.
4. **`usePosition` virtual anchor.** The anchor input is extended to accept a `{x, y}` point (a `@floating-ui/dom` virtual element with a derived `getBoundingClientRect`) in addition to the existing element ref, so the context-menu trigger can anchor the surface at the pointer coordinates. This is a public addition to an already-public primitive.

### 4.2 Reused (already shipped)

`useRender` / `RenderProp`, `mergeRefs`, `useControllableState`, `usePosition` (element-ref path), `useDismiss` (single-node path), `useFocusReturn`, `useSafeArea`, the inline `useId` wiring pattern, and the `data-state` contract. No new id-wiring abstraction is extracted; the inline-ids-in-`Root` precedent is followed for consistency.

### 4.3 Deferred (not built this slice)

These are restated in §8 (Deferred / future work) and will be captured in a durable memory backlog when the PR merges.

- **Menubar** (the APG horizontal application-menu pattern): a distinct component, not needed for either dropdown shape.
- **Context-menu long-press on touch**: v1 is pointer `contextmenu` only; long-press is a documented limitation.
- **RTL submenu direction**: ArrowRight/ArrowLeft and default submenu side assume LTR; documented limitation.
- **Promoting collection / `useTypeahead` to a public primitive**: kept internal until Phase 4 (Select) validates the API as a second consumer.
- **Exit animations (`usePresence`)**: still the post-slice increment that owns animating overlays out as they unmount; entry animation uses `@starting-style` only, as in Popover/Tooltip.
- **Styling-variant runtime helper** (investigation §6.4 option 2): future-optional, unchanged by this slice.

### 4.4 No new dependency

`@floating-ui/dom` is already a runtime dependency (added in the Popover/Tooltip slice). The virtual-anchor extension uses its existing virtual-element support. Nothing new is added to `package.json`.

## 5. Component API: Menu

Button-triggered, non-modal, interactive overlay. Compound parts:

| Part | Role | Key wiring |
| --- | --- | --- |
| `Menu.Root` | Context provider | props: `open`, `defaultOpen`, `onOpenChange`, `side` (default `bottom`), `align` (default `start`), `offset`, `loop` (default `true`), `typeahead` (default `true`). Owns open state (`useControllableState`), ids, trigger + surface refs, the collection, and the dismiss-tree node (root, no parent). |
| `Menu.Trigger` | Toggle button + anchor | `aria-haspopup="menu"`, `aria-expanded`, `aria-controls={menuId}`, `data-state`. Opens on click / Enter / Space / ArrowDown (focus first item) / ArrowUp (focus last item). Default anchor for `usePosition`. Attaches to the consumer's element via `render`. |
| `Menu.Positioner` | Fixed-positioned wrapper | Carries `data-side` / `data-align`; receives `position: fixed; left/top` from `usePosition`. |
| `Menu.Popup` | Menu surface | `role="menu"`, `id={menuId}`, `aria-orientation="vertical"`, `aria-labelledby={triggerId}`, `data-state`. Focus moves here (to the first item) on open. |
| `Menu.Item` | Action item | `role="menuitem"`, roving `tabindex`, `data-highlighted` when active, `data-disabled`. `onSelect(event)`; activation closes the tree unless `event.preventDefault()` is called. Skipped by navigation when `disabled`. |
| `Menu.CheckboxItem` | Toggle item | `role="menuitemcheckbox"`, `aria-checked`, props `checked` / `defaultChecked` / `onCheckedChange` (controllable via `useControllableState`), `data-state="checked\|unchecked"`. Toggles and closes by default; `onSelect` preventDefault keeps it open for multi-toggle. |
| `Menu.RadioGroup` | Single-select group | props `value` / `defaultValue` / `onValueChange` (controllable), `role="group"`. Provides selection context to its `RadioItem` children. |
| `Menu.RadioItem` | Radio item | `role="menuitemradio"`, `aria-checked`, prop `value`; selecting sets the group value, then closes by default. |
| `Menu.Separator` | Divider | `role="separator"`, non-focusable, skipped by navigation and typeahead. |
| `Menu.Group` | Labelled section | `role="group"`, `aria-labelledby={labelId}` when a `GroupLabel` is present. |
| `Menu.GroupLabel` | Group label | Presentational, non-focusable; `id={labelId}` referenced by the enclosing `Group`. |
| `Menu.SubmenuRoot` | Nested submenu context | Owns its own open state and a dismiss-tree node whose `parent` is the enclosing menu's node. |
| `Menu.SubmenuTrigger` | Item that opens a submenu | A `menuitem` with `aria-haspopup="menu"`, `aria-expanded`, `aria-controls={submenuId}`, `data-highlighted`. Opens on pointer hover (open delay) or ArrowRight; the `useSafeArea` corridor keeps it open during diagonal travel toward the submenu. |
| `Menu.SubmenuPositioner` | Submenu fixed wrapper | Default `side="right"`, `align="start"`; flips on collision. `data-side` / `data-align`. |
| `Menu.SubmenuPopup` | Submenu surface | `role="menu"`, own collection, own focus-return to the `SubmenuTrigger` on close. |
| `Menu.Arrow` | Optional arrow | Reads floating-ui arrow middleware data; `data-side`. |

- **Dismissal**: Escape + outside-press through the shared dismiss-tree; `open` (controlled) and item activation also close it.
- **Focus**: move-in to the first item on open, return-to-trigger on close, no trap (reuses `useFocusReturn`); each submenu has its own focus-return to its `SubmenuTrigger`.
- **Positioner / Popup split** follows Base UI and the Popover precedent: the Positioner owns the layout box and `data-side` / `data-align`; the Popup owns the surface, `role`, focus, and `data-state`.

## 6. Component API: ContextMenu

Right-click-triggered. Same surface and item model as `Menu`; only `Root` and `Trigger` differ.

| Part | Role | Key wiring |
| --- | --- | --- |
| `ContextMenu.Root` | Context provider | Same state model as `Menu.Root`, but anchors the surface to a **virtual point** rather than a trigger element. Stores the pointer `{x, y}` captured on open. |
| `ContextMenu.Trigger` | Right-click area | An area composed onto the consumer's element via `render`. Listens for `contextmenu`, calls `preventDefault()` to suppress the native menu, records `{x, y}`, and opens. On touch there is no long-press fallback in v1 (documented limitation). |
| `ContextMenu.Positioner` / `Popup` / `Item` / `CheckboxItem` / `RadioGroup` / `RadioItem` / `Separator` / `Group` / `GroupLabel` / `Submenu*` / `Arrow` | Shared parts | The same underlying components as `Menu.*`, re-exported under `ContextMenu` names. |

- **Anchoring**: `usePosition`'s virtual-anchor path positions the surface at the captured pointer coordinates; `flip` / `shift` keep it on screen.
- **Focus**: `useFocusReturn` captures `document.activeElement` at open and returns focus there on close (there is no trigger button to return to).
- **Dismissal, navigation, typeahead, submenus**: identical to `Menu`.

## 7. Cross-cutting concerns

### 7.1 Keyboard map (APG Menu Button / Menu)

- **Closed trigger** (`Menu` only): Enter / Space / ArrowDown / ArrowUp open. ArrowDown focuses the first item; ArrowUp focuses the last.
- **Open menu**: ArrowDown / ArrowUp move highlight (wrap when `loop`), Home / End jump to first / last, printable characters drive typeahead, Enter / Space activate the highlighted item, Escape closes and returns focus to the trigger, Tab closes the menu and then performs the default tab.
- **Submenu**: ArrowRight on a `SubmenuTrigger` opens the submenu and focuses its first item; ArrowLeft inside a submenu closes it and returns focus to the `SubmenuTrigger`; Escape closes the innermost submenu first.

### 7.2 Data-attribute contract

`data-state="open|closed"` on trigger, positioner, popup, arrow; `data-state="checked|unchecked"` on checkbox/radio items; `data-side` / `data-align` on positioner (mirrored to popup/arrow where useful); `data-highlighted` on the active item; `data-disabled` on disabled items. These drive appearance and motion from CSS, including `@starting-style` entry animation. No CSS ships from the package.

### 7.3 SSR and hydration

The surface mounts on open via a client layout effect; the server renders it closed. The Popover-API promotion (top-layer placement where supported) is applied imperatively on the DOM node, in sync with open and feature-detected, so there is no hydration mismatch and no `preact/compat`, identical to the Popover slice. Ids for ARIA wiring come from `useId` (SSR-stable). Entry animation uses `@starting-style`; there is no exit animation in this slice.

### 7.4 Documentation (apps/site)

Under the existing **Overlays** nav section in the Components docs area:
- `/docs/components/menu` and `/docs/components/context-menu`: full per-part API reference (props per part, render-prop forms, the data-attribute contract, the keyboard map) and a styled live demo with a **copy button** in **CSS + Tailwind** flavors (reusing the shipped `CodeTabs`). Both pages follow the docs-template standard (PRs #75/#76): the three pillars (prose / examples / API reference), built from the `packages/` types, describing what *is* with no migration breadcrumbs. CSS and Tailwind tabs must be feature-equivalent (base Tailwind v4 only).
- **No new Foundations page** this slice: the collection and `useTypeahead` stay internal (no public surface to document), and the `usePosition` virtual-anchor addition folds into the existing `usePosition` Foundations page.

Each component's definition of done includes its copyable styled examples in both flavors (the Base UI distribution model); examples are not a later documentation pass. The styled demos must look correct without exit animations (the surface disappears with no exit transition), per the browser-support rule.

### 7.5 Size tracking

Add `menu` and `context-menu` to `COMPONENT_MODULES` in `scripts/client-size-config.mjs` (Section C of the client-JS tracker). Because both import the positioning, dismissal, collection, and typeahead machinery, the bundler's import tracing pulls those into each component's measured marginal-over-`ui-core` number, which is the honest per-component cost a consumer pays. `ui-core` stays the three universal primitives (`useRender` / `mergeRefs` / `useControllableState`); do not add the new machinery to the floor. CI already builds `@hono-preact/*` before measuring, so no workflow change is needed. Do not regenerate the committed `client-size-report.json` baseline in the PR (that zeroes deltas); it refreshes on main-push.

### 7.6 Testing

Package unit tests in the Dialog/Popover style, covering:
- **Roving navigation**: ArrowUp/Down movement, `loop` wrap-around, Home/End, disabled/separator/label skipped, exactly-one-`tabindex=0` invariant.
- **Typeahead**: match focuses the right item, idle buffer reset, no match is a no-op.
- **Checkbox/radio model**: `checked` / `onCheckedChange` controllable, radio-group `value` / `onValueChange`, close-on-select default, `preventDefault` keep-open.
- **Submenu**: open/close via ArrowRight/ArrowLeft, pointer open/close delay, and the **safe-area corridor** keeping it open during diagonal travel; focus-return to the `SubmenuTrigger`.
- **Dismiss-tree**: Escape closes innermost-first, outside-press closes the whole tree, a press inside any layer of the tree dismisses nothing; Popover/Tooltip single-node behavior is unchanged (regression guard).
- **Context menu**: `contextmenu` event suppresses the native menu, the virtual anchor positions at the pointer, focus returns to the prior `activeElement`.
- **SSR**: closed render for both components.
- **ARIA wiring**: `role` per part (`menu` / `menuitem` / `menuitemcheckbox` / `menuitemradio` / `group` / `separator`), `aria-haspopup` / `aria-expanded` / `aria-controls` / `aria-checked` / `aria-orientation` / `aria-labelledby`.

Per the Preact-testing lesson, raw events dispatched in tests are flushed via `act()`. `packages/ui` is already in `vitest.config.ts`, so only new test files are added.

### 7.7 Accessibility bar

APG conformance for the Menu Button and Menu patterns, with documented keyboard maps. The NVDA / JAWS / VoiceOver screen-reader matrix stays documented-not-automated, per the investigation. Avoid the failure mode of passing an automated axe scan while failing a real screen reader. Heed Adrian Roselli's caution (investigation §3.5): the `role="menu"` pattern is for application menus and command lists, not site navigation, and the docs say so.

## 8. Deferred / future work

This section is the spec-local record of everything intentionally left out, so the spec is self-contained. When the menu PR merges, these are also captured in a durable memory backlog (`project_menu_slice_followups.md`, mirroring the #12/#22 followup memories) so a future session surfaces them regardless of which spec is open.

**Menu-specific (new, not tracked elsewhere before this spec):**
- **Menubar** (APG horizontal application-menu pattern).
- **Context-menu long-press** trigger on touch.
- **RTL submenu direction** (ArrowRight/Left and default submenu side currently assume LTR).
- **Promote collection / `useTypeahead` to a public Foundations primitive** when Phase 4 (Select) validates the API as a second consumer.

**Cross-slice (restated so they stay alive):**
- **Exit animations (`usePresence`)**: the standing post-slice increment that owns animating overlays out as they unmount.
- **Styling-variant runtime helper** (investigation §6.4 option 2): future-optional.

**Roadmap continuation:** Phase 4 **Select (listbox)** and Phase 5 **Combobox**, tracked in investigation §8.

## 9. Open items for the implementation plan

- Confirm the collection's order source: DOM order via `querySelectorAll` on the surface vs registration order, and how it stays correct under conditional/reordered children.
- Confirm the dismiss-tree API shape: the `parent` field type on a registered layer and how a `SubmenuRoot` obtains its parent node from context.
- Confirm `usePosition`'s virtual-anchor input shape (`{x, y}` point vs a full virtual-element object) and how `autoUpdate` behaves for a static point anchor.
- Decide the submenu open/close delay defaults and whether they are configurable on `SubmenuRoot`.
- Decide whether `Menu.Arrow` ships in v1 (cheap; default is to ship it, as Popover did).
- Confirm the `ContextMenu` re-export mechanism (same component instances under `ContextMenu` names) keeps tree-shaking and the size buckets honest.
- TDD task breakdown, following the Dialog/Popover slices' subagent-buildable style. Implementation runs on a feature branch + PR (only spec / plan docs go to main).
