# Headless Toast primitive for `hono-preact-ui`

Date: 2026-06-18
Status: Approved (design), pending implementation plan
Package: `hono-preact-ui` (dir `packages/ui`)

## Summary

Add a headless, accessible Toast notification primitive to `hono-preact-ui`,
modeled on Sonner's imperative API but rendered through this library's
compound-component idiom. Unlike every existing component in the package
(Dialog, Popover, Tooltip, Menu, Select, Combobox), Toast is **imperative**: it
is fired from anywhere via a `toast(...)` call rather than driven by local
declarative state. That forces a new architectural element for this package, a
module-level store, and is the central reason this primitive is worth owning
rather than adopting an off-the-shelf library.

The motivating research (see `deep-research` run, 2026-06-18) found that no
truly framework-agnostic toast library fully nails accessibility: Notyf ships a
bare `aria-live="polite"` announcer but no `role` switching and no
reduced-motion handling; toastify-js exposes a configurable `ariaLive` but sets
no `role`; iziToast documents no a11y at all; Sonner has the best developer
experience but is React-only. The accessible ARIA-live-region pattern (a
pre-mounted live region, polite vs assertive by urgency, visible list kept out
of the live region to avoid double-announcement) is the real primitive worth
owning, and this design centers it.

## Goals

- A Sonner-shaped imperative API: `toast()` plus `success`/`error`/`info`/
  `warning`/`loading`/`custom`/`promise`/`dismiss`.
- Fully headless rendering through compound parts
  (`Toast.Root`/`Title`/`Description`/`Action`/`Close`), styled entirely via a
  `data-*` and CSS-variable contract, consistent with the rest of the package.
- Best-in-class accessibility: a pre-mounted, separate `aria-live` announcer
  with polite/assertive routing, a labeled landmark region with list semantics,
  keyboard reach via a hotkey, focus preservation on dismiss, and
  reduced-motion correctness.
- Full Sonner feature parity: position presets, stacked expand/collapse,
  swipe-to-dismiss, and reflow-on-remove.

## Non-goals (explicitly deferred)

- `richColors` / themed presets (the component is headless; theming is the
  consumer's CSS).
- RTL swipe-axis mirroring.
- Multiple independent `Toaster` instances / scoped stores.
- A public `useToasts()` hook (the `<Toaster>` render prop already exposes the
  per-toast data).
- A `cancel` action / `Toast.Cancel` part (Sonner's second button); deferred to
  keep the prototype's part list to the approved five.
- Any `position: fixed` fallback for the region (see Browser support below).

## Decisions captured from brainstorming

1. **Scope: full Sonner parity.** Includes swipe-to-dismiss, the
   expand-on-hover / collapse-to-pile stacking animation, position presets, and
   reflow. (User selected this over a smaller core-only first cut.)
2. **Render model: compound parts.** The library owns `<Toaster>` and the item
   wrapper (gesture, stacking, a11y, `data-state`); the consumer writes one
   `renderToast` function using `Toast.*` parts that read the active record from
   context. `toast.custom((id) => <node/>)` remains the per-toast escape hatch.
3. **Store: module-level singleton** (Sonner's Observer model), so `toast()` is
   callable from anywhere with zero ceremony. SSR-safe because the queue is
   always empty at render time and `toast()` is only ever called post-hydration.
4. **A11y: a separate, pre-mounted visually-hidden `aria-live` announcer** owned
   by `<Toaster>`. The visible list is deliberately not a live region.
5. **DOM placement: top layer via `popover="manual"`, mandatory, no fallback.**
   (User: "popover api is mandatory, no fallback needed.")

## Browser support exception

This deviates from the standing project constraint (recorded in project memory
`project_browser_support_constraint.md`) that primitives depend only on
Baseline Widely Available platform features and treat the Popover API as
progressive enhancement only. Toast makes the Popover API a **hard
requirement** for the rendered region, with no `position: fixed` fallback path,
per explicit user direction. Rationale: the Popover API is interoperable across
all current engines (Chrome 114+, Safari 17+, Firefox 125+) and crosses to
Baseline Widely Available in late 2026; the simplification (single rendering
path, guaranteed top-layer stacking immune to ancestor transforms/overflow) is
worth the raised floor. This exception is scoped to Toast and must be documented
on the Toast docs page so it does not silently widen the package's baseline.

## Architecture

The design is **layered** so the risky parity behaviors cannot destabilize the
foundation: a small, fully-functional core (store -> `<Toaster>` -> `Toast.*`
parts -> a11y announcer -> auto-dismiss timers) works as a plain stacked list,
and the gesture/animation parity (swipe, expand/collapse, positions, reflow) is
additive on top, expressed through data attributes and CSS variables the library
sets. With the parity layer stripped, you still get an announced, dismissible,
auto-timing stacked list.

A second simplification follows from the layering: **reflow is
CSS-transition-driven, not JS FLIP.** Toasts never reorder; they only shift
along one axis as siblings enter and leave. Transitioning `transform` (driven by
CSS variables the library updates) handles reflow, which sidesteps the
mid-animation re-measure jitter trap from prior drag work. Heights are measured
only on mount and on content change, never during an animation.

### Files (new directory `packages/ui/src/toast/`)

| File | Responsibility |
| --- | --- |
| `toast-store.ts` | Module singleton: `toasts[]`, subscriber set, `add`/`update`/`dismiss`/`remove`/`subscribe`; `ToastRecord` and related types. No JSX except a held `custom` render fn. |
| `toast.ts` | The public callable `toast` object: `toast()`, `.success`/`.error`/`.info`/`.warning`/`.loading`, `.custom`, `.promise`, `.dismiss`. Thin wrapper over the store. |
| `context.ts` | `ToasterContext` (region config + paused signal + height registry) and `ToastItemContext` (the active record). |
| `toaster.tsx` | `<Toaster>`: top-layer `popover="manual"` region, store subscription, announcer mount, hotkey + pause wiring; invokes the render prop per toast. |
| `toast-parts.tsx` | `ToastRoot` (item wrapper: height, stack offset, swipe, timer, exit via `usePresence`) + `ToastTitle`/`ToastDescription`/`ToastAction`/`ToastClose`. |
| `use-toast-timer.ts` | Per-toast auto-dismiss timer honoring the region pause signal and tracking remaining time. |
| `use-toast-swipe.ts` | Pointer-driven swipe-to-dismiss (the riskiest unit, isolated). |
| `announcer.tsx` | Pre-mounted hidden polite + assertive live regions and `announce()`. |
| `index.ts` | Flat exports + `Toast` namespace + `Toaster` + `toast`. |

Store subscription uses a tiny internal hook (`useReducer` force-update +
`useEffect(() => store.subscribe(...), [])`) to stay off `preact/compat` (no
`useSyncExternalStore`), consistent with the rest of the package.

## Store and imperative API

`toast.ts` exports a callable object:

```ts
toast(message, opts?) -> id            // default type
toast.success(message, opts?)          // data-type="success"
toast.error(message, opts?)            // important -> assertive announce
toast.info / toast.warning / toast.loading
toast.custom((id) => <VNode/>, opts?)  // per-toast render escape hatch
toast.promise(promise, { loading, success, error }) // mutates one toast as it settles
toast.dismiss(id?)                     // id omitted = dismiss all
```

`opts` (Sonner-aligned):

```ts
interface ToastOptions {
  id?: string | number;        // passing an existing id updates in place
  description?: ComponentChildren;
  duration?: number;           // ms; Infinity = sticky; default 4000
  important?: boolean;         // route announcement to assertive (auto for error)
  action?: { label: ComponentChildren; onClick: (e) => void };
  onDismiss?: (record) => void;
  onAutoClose?: (record) => void;
}
```

A `cancel` action (Sonner's second, dismiss-on-click button) is intentionally
out of scope for the prototype because the approved part list has no
`Toast.Cancel`; it is listed under Non-goals and can be added as a follow-up
part later.

`ToastRecord` (store-internal) carries the data; `Toast.Root` receives it via
the render prop. `important` defaults true for `toast.error`. Passing an
existing `id` updates the record in place, which is also the mechanism behind
`toast.promise` (one record transitions loading -> success | error).

`toast.promise(p, msgs)` immediately adds a `loading` record, then on settle
updates the same id to `success` (using `msgs.success`, which may be a function
of the resolved value) or `error` (using `msgs.error`, a function of the
rejection). Returns the id.

## Component tree and styling contract

```tsx
<Toaster
  position="bottom-right"
  expand={false}
  visibleToasts={3}
  gap={14}
  hotkey={['altKey', 'KeyT']}
  label="Notifications"
>
  {(t) => (
    <Toast.Root toast={t}>
      <Toast.Title />
      <Toast.Description />
      <Toast.Action />
      <Toast.Close />
    </Toast.Root>
  )}
</Toaster>
```

`<Toaster>` is library-owned (region, popover, subscription, a11y, pause,
hotkey). `Toast.Root` is the library-owned item wrapper (height measurement,
stack offset, swipe, timer, exit). The content parts are thin and read the
active record from `ToastItemContext`. Every part accepts the standard `render`
prop (the `renderElement` escape hatch used across the package).

The wrapper emits data attributes and CSS variables; the consumer does all
visual work in CSS. This vocabulary mirrors Sonner's so existing Sonner CSS is
largely portable while the component stays fully unstyled.

| Attribute / variable | On | Meaning |
| --- | --- | --- |
| `data-state="open\|closed"` | Root | enter / exit; `usePresence` awaits the exit animation |
| `data-type` | Root | `default\|success\|error\|info\|warning\|loading\|custom` |
| `data-position` | region + Root | e.g. `bottom-right`; sets swipe axis + entry direction |
| `data-expanded` | Root | stack expanded (hover/focus) vs collapsed pile |
| `data-front` | Root | the frontmost toast |
| `data-swiping` | Root | a drag is in progress |
| `--toast-index`, `--toasts-before` | Root | position in the stack |
| `--toast-offset`, `--toast-height` | Root | computed stack offset + measured height (transition `transform` off these) |
| `--toast-swipe-amount` | Root | live drag distance |

### Public exports (barrel additions)

- `toast` (the imperative fn object).
- `Toaster`, `type ToasterProps`.
- `Toast` namespace = `{ Root, Title, Description, Action, Close }`.
- Flat `ToastRoot`/`ToastTitle`/`ToastDescription`/`ToastAction`/`ToastClose`
  plus their prop types.
- Types: `ToastRecord` (read-only shape passed to consumers), `ToastOptions`,
  `ToastType`, `ToastPosition`.

## Accessibility

The differentiator. No agnostic library fully implements this, which is why the
primitive is worth building.

### Announcer (separate from the visible list)

`<Toaster>` mounts, once and always, two visually-hidden containers that exist
in the DOM before any text is injected (a live region must be present and
monitored before it is populated):

```html
<div role="status" aria-live="polite"    aria-atomic="true" class="sr-only"></div>
<div role="alert"  aria-live="assertive"  aria-atomic="true" class="sr-only"></div>
```

When a toast appears, `announce(record)` writes `title` + `description` (or an
explicit announcer-text override) into the polite region by default, or the
assertive region when `important` is set (auto for `toast.error`). Text is
cleared on a short timer so a repeat of the same message re-announces.
`aria-atomic="true"` makes a multi-line title + description read as one unit.

The visible toast list is deliberately not a live region, which avoids the
double-announce-on-reflow bug that plagues naive implementations. A
`toast.loading` announces politely; when `toast.promise` resolves it, the update
re-announces (assertive on error).

### Visible region structure

A labeled landmark: `<section role="region" aria-label="Notifications"
tabindex="-1">` (label configurable via the `label` prop). Toasts render inside
an `<ol>`, each `Toast.Root` as an `<li>`-equivalent, so screen-reader users can
navigate the list structurally. `Toast.Close` is a real `<button>` with an
accessible label.

### Keyboard and focus

- `hotkey` (default `Alt+T`) moves focus to the region, so keyboard users can
  reach toasts that otherwise sit outside the tab flow (APG-style).
- Hovering or focusing the region pauses every toast's auto-dismiss timer and
  expands the stack (`data-expanded`).
- Dismissing the focused toast moves focus to the next toast, or back to the
  region if it was the last, so focus is never lost to `<body>`.
- `Escape` while the region (or a toast within it) has focus dismisses the
  focused toast.

### Reduced motion

Exit waits run through `usePresence`, which already short-circuits under
`prefers-reduced-motion: reduce` (it does not wait on transitions). The library
never forces motion: it only sets data attributes and CSS variables; all
transitions live in CSS. An RM user whose CSS guards its transitions behind
`@media (prefers-reduced-motion: no-preference)` gets instant placement. The
shipped demo CSS models this correctly, and the docs Accessibility section
documents the contract.

## Parity behaviors

### Position presets

`position`: the six Sonner values `top-left | top-center | top-right |
bottom-left | bottom-center | bottom-right` (default `bottom-right`). Drives
`data-position` on the region and each Root; CSS uses it to pin the region
corner, choose entry direction, and pick the swipe axis. The top-layer popover
makes corner pinning immune to ancestor transforms.

### Stacking (expand / collapse)

Each `Toast.Root` measures its own height (ref + `ResizeObserver`, re-measured
only on content change, never mid-animation) and registers it in the Toaster
context's height registry keyed by id. From the registry the Root computes
`--toasts-before` (count in front) and `--toast-index`:

- Collapsed (default): the front toast is flat; each toast behind peeks by a
  fixed step and scales down slightly (`--toasts-before` feeds `translateY` +
  `scale` in CSS). Only `visibleToasts` (default 3) are visually stacked; deeper
  ones fade under.
- Expanded (region hovered/focused, or `expand` prop true): `--toast-offset` =
  sum of the heights of the toasts in front + `gap` each, so toasts fan out to
  their true heights. CSS transitions `transform` between the two states.

### Reflow on remove

When a toast leaves, the front-counts and offsets of the remaining toasts
change; because those are CSS variables feeding a transitioned `transform`, the
survivors animate to their new offsets automatically. No JS FLIP, no re-measure
during animation.

### Swipe-to-dismiss (`use-toast-swipe.ts`)

Pointer Events with `setPointerCapture`:

- Swipe axis derived from `position` (right-anchored toasts swipe right to
  dismiss; `*-center` swipe down for bottom positions, up for top).
- During drag: `data-swiping`, live `--toast-swipe-amount`, timer paused.
- Release past threshold (approximately 45px or 25% of width, whichever first)
  dismisses (`toast.dismiss(id)` -> exit via `usePresence` with a swipe-out
  class). Below threshold, snap back (CSS transition to 0).
- `touch-action` set so off-axis page scroll still works; snap-back honors
  `prefers-reduced-motion`.

### Timers and pause (`use-toast-timer.ts`)

Per-toast remaining-duration timer (default 4000ms; `loading` and
`duration: Infinity` are sticky). Pauses while the region is hovered or focused,
a swipe is active, or the document is hidden (`visibilitychange`), tracking
elapsed time so it resumes with the correct remainder rather than restarting. On
expiry it dismisses and fires `onAutoClose`.

## Testing

vitest + `@testing-library/preact`, matching the existing `__tests__/` suite;
raw events are flushed inside `act()` per the Popover/Menu lessons.

| Test | Covers |
| --- | --- |
| `toast-store.test.ts` | add/update/dismiss/remove, id-update-in-place, `dismiss()` all, subscriber notify/unsub. Pure, no DOM. |
| `toast-promise.test.ts` | loading -> success and loading -> error transitions mutate one record. |
| `toaster-a11y.test.tsx` | announcer containers exist before the first toast (pre-mounted); polite vs assertive routing by `important`/`error`; `aria-atomic`; region landmark + `<ol>/<li>` semantics; `Toast.Close` button label. Spec centerpiece. |
| `toaster-timer.test.tsx` | auto-dismiss fires; pause on hover/focus/hidden; resume uses remaining time (fake timers). |
| `toast-swipe.test.tsx` | synthetic pointer drag past/under threshold -> dismiss vs snap-back; timer paused during drag. |
| `toaster-ssr.test.tsx` | `@vitest-environment node`: `<Toaster>` renders an empty, stable region with no `toast()` calls (the SSR-safety claim for the singleton store). |
| `exports.test.ts` (extend) | the `Toast` namespace + `toast`/`Toaster` (the package's drift gate). |

Reduced motion is asserted through `usePresence`'s existing RM path (mock
`matchMedia`), reused rather than re-tested.

## Docs and site integration

Per the `add-docs-page` skill (Component template) and the site recon:

- `apps/site/src/pages/docs/components/toast.mdx`: lead -> `## Demo`
  (`<Example>`) -> `## Usage` -> `## Styling` (`<CodeTabs>` CSS + Tailwind, with
  feature parity, base Tailwind v4 only) -> `## API reference` (one prop table
  per part + the `toast` fn signature) -> `## Accessibility` (must call out the
  Popover-API requirement and the reduced-motion CSS contract).
- `apps/site/src/components/docs/ToastDemo.tsx`: live demo as conformant app
  code (preact-only imports, public `hono-preact-ui` surface, no casts), styled
  with `.docs-toast*` rules added to `apps/site/src/styles/root.css` using the
  real tokens (`--foreground`, `--muted`, `--accent-foreground`, `--surface`,
  `--border-color`), transitions guarded behind
  `@media (prefers-reduced-motion: no-preference)`.
- Nav: add `{ title: 'Toast', route: '/docs/components/toast' }` to the
  `Overlays` section in `apps/site/src/pages/docs/nav.ts`.
- Size table: add `toast: ['toast/index.js']` to `COMPONENT_MODULES` and
  `['toast', 'components']` to `CHUNK_PREFIXES` in
  `scripts/client-size-config.mjs`; regenerate the baselines
  (`client-size-report.json`, `client-size-history.jsonl`) via the measure
  script.

## Risks and open considerations

- **Swipe + top-layer pointer capture.** Pointer capture inside a `popover`
  element in the top layer should behave normally, but needs a real-browser
  check; the unit tests use synthetic pointer events and cannot prove the
  top-layer interaction.
- **Hotkey collision.** `Alt+T` is configurable; the default may collide with a
  consumer shortcut. Documented, and overridable per `Toaster`.
- **Height registry timing.** First-paint height measurement must not fight the
  enter animation; measure on mount before the open transition starts, and treat
  a zero/again-changed height as a re-measure trigger only on content change.
- **MCP cannot verify motion.** Per project memory, the MCP browser backgrounds
  the document, so view-transition-like animations and the swipe gesture cannot
  be visually verified through it; rely on unit tests for DOM/state and on a
  manual real-browser pass for the animation feel.

## Out of scope (restated)

`richColors`/theme presets, RTL swipe mirroring, multiple/scoped Toaster
instances, and a public `useToasts()` hook. Each can be a follow-up once the
prototype lands.
