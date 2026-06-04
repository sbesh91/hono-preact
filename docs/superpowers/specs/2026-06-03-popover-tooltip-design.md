# Popover + Tooltip (Phase 2): design spec

Status: approved design, ready for an implementation plan.
Date: 2026-06-03.
Predecessor context: `docs/superpowers/specs/2026-05-31-headless-components-investigation.md` (§5 machinery, §8 roadmap), and the shipped Dialog slice (`docs/superpowers/plans/2026-06-03-ui-dialog-slice.md`, PR #72).

## 1. Goal and scope

Build **Phase 2** of the headless component roadmap: the **Popover** and **Tooltip** components for `@hono-preact/ui`, plus only the shared Phase 0 machinery these two components actually need. Both lean on the platform as far as it goes, ship unstyled (data-attribute contract), and follow the compound-component patterns the Dialog slice established (`useRender` render-prop composition, `useControllableState`, inline `useId` wiring, `data-state`).

Phase 1 (Dialog) leaned entirely on native `<dialog>` for top-layer, focus containment, Escape, and backdrop, so it needed no positioning, dismissal, or portal machinery. Popover and Tooltip are anchored, non-modal overlays, so this is the slice that stands up the positioning and dismissal machinery the later phases (Menu, Select, Combobox) will reuse.

The guiding constraint from the user: **build the machinery this feature needs, but not more.** Section 4 states exactly what is built and what is deferred.

## 2. Locked decisions (from brainstorming)

1. **Render substrate: inline + Popover API as progressive enhancement.** The overlay renders in place with `position: fixed` (positioned by `@floating-ui/dom`), which escapes most ancestor clipping. Where the native Popover API is supported, the popup is promoted to the top layer for bulletproof clipping escape. **No portal and no `preact/compat`**, which keeps `@hono-preact/ui` standalone (the locked investigation decision: no React / preact-compat runtime dependency). Documented caveat: a transformed, filtered, or `will-change`-ed ancestor establishes a containing block for `position: fixed`; the Popover API enhancement covers that case where available, and it is otherwise a documented limitation.
2. **Dismissal: a tiny shared dismissal stack.** A module-level stack of open dismissable layers. One shared set of document-level **capture-phase** listeners (`keydown` for Escape, `pointerdown` for outside-press) routes to the **topmost enabled** layer only, so nested cases behave correctly (Escape closes a tooltip-inside-a-popover before the popover; nested popovers close innermost-first) without both firing at once. This is the seed Phase 3 (Menu submenus) reuses. The full `LayerHost` / portal / FloatingTree from investigation §5 unit 1 is **not** built.
3. **Popover focus: move in, return, no trap.** On open, focus moves into the popup (an `initialFocus` target, else the first focusable, else the popup container). On close, focus returns to the trigger. Tab is **not** trapped: tabbing past the last focusable flows into the rest of the page (true non-modal). No sentinel-guard `FocusScope` is built.
4. **Tooltip: WCAG 1.4.13, no delay group.** Hover + keyboard-focus triggers; per-tooltip open/close delay; hoverable, dismissible (Escape), persistent; suppressed on touch with the limitation documented. **No** shared delay-group Provider (it can be added later, additively and non-breaking).

## 3. Architecture

Same shape as Dialog: each component is a compound set of parts over a React-style context provided by `Root`. The parts are thin; the shared machinery underneath is the product.

```
@hono-preact/ui
  (reused, already shipped)
    useRender / RenderProp      render-prop composition + state arg
    mergeRefs                   ref merging
    useControllableState        controlled/uncontrolled open state
    inline useId wiring         aria-* id plumbing (per-Root, Dialog precedent)
    data-state contract         data-state / data-side / data-align

  (new shared machinery, built this slice)
    usePosition                 @floating-ui/dom binding (positioning + autoUpdate)
    dismissal stack + useDismiss module stack + shared capture listeners
    useFocusReturn              focus-in-on-open / return-on-close (Popover only)

  (new components)
    Popover.*                   Root, Trigger, Anchor?, Positioner, Popup, Arrow?, Title, Description, Close
    Tooltip.*                   Root, Trigger, Positioner, Popup, Arrow?
```

## 4. Machinery: what is built vs deferred

### 4.1 Built (the minimal shared set)

1. **`usePosition`** (new `@floating-ui/dom` dependency). Inputs: anchor element ref, floating element ref, options (`side`, `align`, `offset`, `flip`, `shift`, optional `arrow` element ref). Runs `computePosition` with the `offset` / `flip` / `shift` / `arrow` middleware under `autoUpdate` (scroll, resize, reflow) inside a layout effect; writes `position: fixed; left/top` onto the floating element and derives `data-side` / `data-align` plus arrow coordinates. Client-only: the server renders the overlay closed, and positioning runs only after mount. Shared verbatim by Popover and Tooltip.
2. **Dismissal stack + `useDismiss`.** A module-level singleton stack of registered open layers. On open, a layer registers (pushes); the stack lazily attaches one shared pair of document **capture-phase** listeners (`keydown`, `pointerdown`) and routes each event to the topmost enabled layer whose configuration opts into that dismissal kind. `useDismiss({ enabled, onDismiss, refs, escape, outsidePress })` is the per-component hook. Popover registers Escape + outside-press; Tooltip registers Escape only. Unregister on close/unmount; detach the shared listeners when the stack empties.
3. **`useFocusReturn`** (Popover only). Captures `document.activeElement` when the popover opens, moves focus into the popup (`initialFocus` → first focusable → popup container), and returns focus to the captured element (the trigger) on close. A small effect, not a trap.

### 4.2 Reused (already shipped in the Dialog slice)

`useRender` / `RenderProp`, `mergeRefs`, `useControllableState`, the inline `useId` wiring pattern (ids derived per-`Root`, as Dialog does), and the `data-state` contract. No new abstraction is extracted for id wiring; the Dialog precedent of inline ids in `Root` is followed for consistency.

### 4.3 Deferred (not built this slice), with rationale

- **Full `LayerHost` / portal / FloatingTree nested coordination** (§5 unit 1): replaced by the inline substrate + the tiny dismissal stack. Largely moot now that rendering is inline.
- **`FocusScope` sentinel trap** (§5 unit 3): not needed for a non-modal, no-trap Popover.
- **Collection / navigation / typeahead** (§5 unit 5): Phase 3+ (Menu, Select, Combobox).
- **Tooltip delay-group Provider**: ergonomic polish, not an accessibility requirement; addable later non-breaking.
- **Styling-variant runtime helper** (investigation §6.4 option 2): deferred as future-optional.
- **`usePresence` exit animations**: the post-slice increment owns animating overlays out as they unmount; entry animation uses `@starting-style` only.

### 4.4 New dependency

`@floating-ui/dom` becomes the **first runtime dependency** of `@hono-preact/ui` (today the package is `preact` peer-only). It is framework-agnostic, roughly 5 to 7 KB gzipped, and is the investigation's explicitly chosen positioning engine, so this is consistent with the locked direction. It will appear in the Section C size table; bucketing is specified in §8.

## 5. Component API: Popover

Non-modal, interactive overlay. Compound parts:

| Part | Role | Key wiring |
| --- | --- | --- |
| `Popover.Root` | Context provider | props: `open`, `defaultOpen`, `onOpenChange`, `side`, `align`, `offset`, `initialFocus?`. Owns open state (`useControllableState`), ids, anchor + floating refs, placement config. |
| `Popover.Trigger` | Toggle button + default anchor | `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls={popupId}`, `data-state`. Sets the anchor ref (unless `Anchor` overrides). Attaches to the consumer's element via `render`. |
| `Popover.Anchor` | Optional alternate anchor | Lets positioning target a different element than the Trigger. Overrides which element `usePosition` measures. |
| `Popover.Positioner` | Fixed-positioned wrapper | Carries `data-side` / `data-align`; receives the `position: fixed; left/top` from `usePosition`. |
| `Popover.Popup` | Visible surface | `role="dialog"`, `id={popupId}`, `data-state`; the focus target for `useFocusReturn`. |
| `Popover.Arrow` | Optional arrow | Reads floating-ui arrow middleware data; `data-side`. |
| `Popover.Title` | Accessible name | `id={titleId}`; Popup wires `aria-labelledby`. Reuses Dialog's pattern. |
| `Popover.Description` | Accessible description | Ref-counted presence (Dialog precedent) so Popup wires `aria-describedby` only when present. |
| `Popover.Close` | Dismiss button | Sets open false; `data-state`. |

- **Dismissal**: Escape + outside-press through the shared stack; `Close` and controlled `open` also close it.
- **Focus**: move-in on open, return-to-trigger on close, no trap.
- **Positioner / Popup split** follows Base UI: the Positioner owns the layout box and `data-side` / `data-align`; the Popup owns the surface, focus, and `data-state`. `Anchor` and `Arrow` are optional.

## 6. Component API: Tooltip

Non-interactive (no focus move, no outside-press). Compound parts:

| Part | Role | Key wiring |
| --- | --- | --- |
| `Tooltip.Root` | Context provider | props: `open`, `defaultOpen`, `onOpenChange`, `delay`, `closeDelay`, `side`, `align`, `offset`. Owns open state, ids, anchor + floating refs, timing. |
| `Tooltip.Trigger` | Anchor + describedby source | Wires `aria-describedby={popupId}`; binds hover (`pointerenter` / `pointerleave` with delay) and `focus` / `blur`; `data-state`. Attaches to the consumer's own control via `render`. |
| `Tooltip.Positioner` | Fixed wrapper | `data-side` / `data-align`. |
| `Tooltip.Popup` | Tooltip surface | `role="tooltip"`, `id={popupId}`, `data-state`. Hoverable: its own `pointerenter` / `pointerleave` keep it open. |
| `Tooltip.Arrow` | Optional arrow | As Popover. |

**WCAG 1.4.13 behaviors:**
- **Hoverable**: moving the pointer from the trigger onto the popup keeps it open (the close-delay plus the Popup's own hover handlers bridge the gap between trigger and popup).
- **Dismissible**: Escape closes it (stack, Escape leg only; no outside-press for a tooltip).
- **Persistent**: stays open until blur, pointer-leave, or Escape; never auto-times-out.
- **Touch**: suppressed when `pointerType === 'touch'` (tooltips are inaccessible on touch); documented as a known limitation.

Tooltip reuses `usePosition` and the Escape leg of the dismissal stack. It does not move focus or register outside-press.

## 7. Cross-cutting concerns

### 7.1 Data-attribute contract

`data-state="open|closed"` on trigger, positioner, popup, and arrow. `data-side="top|right|bottom|left"` and `data-align="start|center|end"` on the positioner (mirrored to popup / arrow where useful). These drive appearance and motion from CSS, including `@starting-style` entry animation. No CSS ships from the package.

### 7.2 SSR and hydration

The popup mounts on open via a client layout effect; the server renders the overlay closed. The Popover API attribute is applied **imperatively** on the DOM node (`el.popover = 'manual'`, then `showPopover()` / `hidePopover()` in sync with open, feature-detected) rather than as a rendered prop, so there is no hydration mismatch and no `preact/compat`. `popover="manual"` is used (not `"auto"`) so the framework retains full control of dismissal via the stack. The `useIsHydrated` flag from the investigation notes is available if a browser-API read needs to gate on hydration, but the imperative-in-layout-effect approach should avoid needing it. Entry animation uses `@starting-style`; there is no exit animation in this slice (it disappears with no exit transition), consistent with the deferred `usePresence` increment.

### 7.3 Documentation (apps/site)

Under the existing **Overlays** nav section in the Components docs area:
- `/docs/components/popover` and `/docs/components/tooltip`: full API reference (props per part, render-prop forms) and a styled live demo with a **copy button** in **CSS + Tailwind** flavors (reusing the shipped `CodeTabs`). Per the docs-style rule, describe what is, with no migration breadcrumbs.
- Two new **Foundations** pages documenting the new primitives `usePosition` and `useDismiss`, matching how the Dialog slice documented `useRender` / `useControllableState` / `mergeRefs`.

Each component's definition of done includes its copyable styled examples in both flavors (the Base UI distribution model); examples are not a later documentation pass.

### 7.4 Size tracking

Add `popover` and `tooltip` to `COMPONENT_MODULES` in `scripts/client-size-config.mjs` (Section C of the client-JS tracker). `@floating-ui/dom` is **not** added to the `ui-core` floor: `ui-core` stays the three universal primitives (`useRender` / `mergeRefs` / `useControllableState`) that every component truly shares, so the floor keeps representing what a component like Dialog actually pays. Because Popover and Tooltip both import the positioning machinery, the bundler's import tracing pulls `@floating-ui/dom` into each component's measured bundle, so it shows up in the Popover and Tooltip marginal-over-ui-core numbers (it is counted once per component row, which is the honest per-component cost a consumer pays for that component). CI already builds `@hono-preact/*` before measuring, so no workflow change is needed. Do not regenerate the committed `client-size-report.json` baseline in the PR (that zeroes deltas); it refreshes on main-push.

### 7.5 Testing

Package unit tests in the Dialog style (Dialog shipped 33), covering:
- `usePosition`: the floating-ui binding (in jsdom, or via a thin mock) and `data-side` / `data-align` derivation.
- Dismissal stack: topmost-only routing, Escape and outside-press legs, register/unregister, nested ordering.
- `useFocusReturn`: focus-in on open, return-to-trigger on close.
- Tooltip: hover, focus, Escape, **hoverable** (pointer bridges to popup), touch suppression, delay timing.
- SSR-closed render for both components.
- Full ARIA wiring: `aria-haspopup` / `aria-expanded` / `aria-controls` / `aria-labelledby` / `aria-describedby`, `role="dialog"` / `role="tooltip"`.

`packages/ui` is already in `vitest.config.ts` (added in the Dialog slice), so only new test files are added.

### 7.6 Accessibility bar

APG conformance for the disclosure / dialog-popover and tooltip patterns, with documented keyboard maps. The NVDA / JAWS / VoiceOver screen-reader matrix stays aspirational and documented, not automated, per the investigation. Avoid the failure mode of passing an automated axe scan while failing a real screen reader.

## 8. Out of scope (restated)

Exit animations (`usePresence`), the Tooltip delay-group Provider, a Popover focus trap, a portal / `LayerHost`, collection / navigation / typeahead, and the styling-variant runtime helper. These are explicitly deferred per §4.3.

## 9. Open items for the implementation plan

- Confirm the exact `@floating-ui/dom` middleware set and `autoUpdate` options, and the `usePosition` return shape consumed by Positioner / Arrow.
- (resolved in §7.4) `@floating-ui/dom` bucketing: rides in each component's marginal via import tracing; `ui-core` stays the three universal primitives.
- Decide the `useDismiss` configuration surface (`escape` / `outsidePress` toggles, the `refs` array the stack treats as "inside").
- Decide whether `Popover.Anchor` and `*.Arrow` ship in v1 or are a fast follow (both are cheap; default is to ship them).
- TDD task breakdown, following the Dialog slice's subagent-buildable style. Implementation runs on a feature branch + PR (only spec / plan docs go to main).
