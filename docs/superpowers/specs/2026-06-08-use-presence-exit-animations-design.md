# usePresence exit animations: design spec

Date: 2026-06-08
Status: design approved (brainstorming), not yet planned or built
Predecessors: [Dialog (Phase 1)](./2026-06-01-ui-dialog-slice-design.md) §7 (the vetted exit-animation mechanism), [headless components investigation](./2026-05-31-headless-components-investigation.md)

## 1. Goal and scope

Ship `usePresence`, a public Foundations primitive in `@hono-preact/ui`, and wire it
into all seven overlay components so they can animate **out** as they close. Today the
library animates entry only (CSS `@starting-style` on `[data-state="open"]`); closing
removes the element from the DOM (or the top layer) immediately, so any exit transition
is cut off. `usePresence` keeps the element alive for the duration of a CSS exit
transition, then finalizes (unmount, or `close()` for the native dialog).

The mechanism is not new: it was designed and vetted on 2026-06-01 and recorded in the
Dialog slice spec §7 as "deferred to a separate `usePresence` increment." This spec
promotes that mechanism into a real primitive and rolls it out across the cluster.

In scope for v1:

- A public `usePresence(present, options?)` hook built on `Element.getAnimations()`.
- Exit-animation support in all seven overlays: Dialog, Popover, Tooltip, Menu,
  ContextMenu, Select, Combobox (and Menu/ContextMenu submenus).
- The consumer styling contract: a single `[data-state="closed"]` exit rule per
  component, reduced-motion handling, and updated copyable examples (CSS + Tailwind)
  on every component docs page.
- A `/docs/components/use-presence` Foundations page.

Out of scope for v1: see Section 9. Notably: View Transitions as the animation
substrate (Section 8 explains why), exit animation as anything other than opt-in CSS,
and any framework (`@hono-preact/iso`) coupling.

## 2. Locked decisions (from brainstorming)

1. **Substrate: `Element.getAnimations()`, not View Transitions or CSS
   `allow-discrete`/`overlay`.** `getAnimations()` is Baseline Widely Available
   (since ~2020) and is the only option that satisfies the library's
   all-current-browsers constraint. View Transitions are rejected as the baseline
   (Section 8). CSS `transition-behavior: allow-discrete` / the `overlay` property are
   not yet reliable across current browsers (the `overlay` property is Chromium-only),
   so a CSS-only exit shows nothing on Firefox/Safari.
2. **Breadth: all seven overlays.** Animation is opt-in via CSS, so a component whose
   consumer authored no closing transition behaves exactly as today (empty animation
   set → synchronous finalize). The machinery is therefore zero-cost for non-animating
   consumers, which makes uniform adoption safe.
3. **Public surface: a public Foundations primitive.** `usePresence` is exported from
   the package root and documented, alongside `usePosition` / `useDismiss` /
   `useFocusReturn` / `useListNavigation` / `useControllableState`. Consumers can use it
   for their own custom mount/unmount overlays.
4. **API shape: `{ isPresent, status, ref }` (Radix-shaped).** The consumer gates
   rendering on `isPresent`, maps `status` to `data-state`, and attaches `ref` to the
   element carrying the transition. The two finalize modes (unmount for custom overlays,
   `close()` for the native dialog) collapse to a single hook via an `onExitComplete`
   option; no separate public variant.
5. **Entry animation is unchanged.** Entry stays pure CSS `@starting-style` on
   `[data-state="open"]` (no JS). `usePresence` governs the **exit/persistence** phase
   only.
6. **Standalone, no framework coupling.** `usePresence` lives in `@hono-preact/ui` and
   depends only on the platform + existing internal helpers (`mergeRefs`). It does not
   reach into `@hono-preact/iso`'s View Transitions toolkit.

## 3. Architecture

### 3.1 The primitive: `src/use-presence.ts`

A single hook backed by an internal phase state machine that runs the
`getAnimations()` timing logic. The public hook models the **mount/unmount** case
(the general one); the native-dialog **deferred-`close()`** case is expressed by the
caller via `onExitComplete`, so there is one hook, not two.

### 3.2 Two finalize shapes (confirmed against current code)

- **Custom overlays** (Popover, Tooltip, Menu, ContextMenu, Select, Combobox): the
  Positioner part is **mount-on-open** (`if (!ctx.open) return null`). Finalize =
  unmount. The hook's `isPresent` becomes the mount gate.
- **Dialog**: the native `<dialog>` element **stays mounted**; an effect toggles
  `showModal()` / `close()` off `ctx.open`. Finalize = `close()` (which the caller
  supplies through `onExitComplete`), keeping the element mounted. `isPresent` is not a
  mount gate here.

### 3.3 Dependencies

`getAnimations()`, `getComputedStyle()` / `offsetHeight` (forced reflow),
`matchMedia('(prefers-reduced-motion: reduce)')`, and the existing internal
`mergeRefs`. No new package dependency.

## 4. The state machine

### 4.1 Phases

`status` is one of:

- `"open"` — `present` is true and settled. `isPresent` is true.
- `"closing"` — `present` flipped to false and an exit animation is in flight. The
  element is still mounted (custom overlays) or still open (dialog). `isPresent` is
  still true.
- `"closed"` — finalized. `isPresent` is false; custom overlays unmount, the dialog has
  been `close()`d.

The DOM attribute stays **two-valued**: `closing` and `closed` both render
`data-state="closed"`, so authors write a single `[data-state="closed"]` rule. The
recommended mapping is `data-state={status === 'open' ? 'open' : 'closed'}`.

### 4.2 Transitions and the load-bearing details

These mirror Dialog spec §7 and must not be skipped:

1. **First mount / SSR: phase derived synchronously from `present`; never `"closing"`
   on the first render.** No exit animation on mount. (A first-run guard.)
2. **`present` → false:** enter `"closing"`, then **force a style flush**
   (`el.offsetHeight` or `getComputedStyle`) — never read animations synchronously in
   the same task, and never via `requestAnimationFrame` (throttled/paused in background
   tabs); otherwise the set is empty and the element closes instantly on every browser.
3. Read `el.getAnimations({ subtree: true })`, **filter out infinite-iteration
   animations** (`getComputedTiming().iterations === Infinity`), and `Promise.allSettled`
   the remaining `.finished` promises, **raced against a timeout** derived from the
   animations' end times with a hard cap (~3s). The timeout guarantees a stuck or
   under-reported animation can never leave a modal open and blocking the page.
4. **An empty animation set finalizes synchronously** (no exit). Never gate finalize on
   a `transitionend`/`animationend` event — it never fires in the empty case and hangs
   the element open.
5. **`{ subtree: true }`** so a transition on a child or `::backdrop` is awaited;
   pseudo-element coverage still varies across browsers, so key finalize timing off the
   target element and treat `::backdrop` as best-effort/cosmetic.
6. **Reopen mid-exit:** tag each exit with a **generation token**; a later
   `present` → true bumps the token so the in-flight finalize becomes a no-op, `status`
   returns to `"open"`, and the element is never torn down. A cancelled `.finished`
   rejects with `AbortError`, which is swallowed (`allSettled`), not thrown.
7. **Finalize order:** fire `onExitComplete` **before** flipping `isPresent`/`status` to
   closed. For Dialog this is where `close()` runs, so native focus return lands on the
   trigger before unmount.
8. **`prefers-reduced-motion: reduce`:** short-circuit to synchronous finalize (still
   fires `onExitComplete`). Examples also zero the transition under the media query.

## 5. Public API

```ts
export interface UsePresenceOptions {
  /** Fires when the exit animation has resolved, immediately before isPresent flips
   *  false. Used by Dialog to call close() (focus return) before unmount. */
  onExitComplete?: () => void;
  /** Hard cap (ms) on the exit timeout race. Defaults to ~3000. */
  timeoutCap?: number;
}

export interface UsePresenceResult {
  /** Mount gate: true while open OR exiting. Render the element while true. */
  isPresent: boolean;
  /** 'open' | 'closing' | 'closed'. Drives data-state (closing → "closed"). */
  status: PresenceStatus;
  /** Callback ref for the element carrying the transition. Merge with the
   *  component's own ref via mergeRefs. */
  ref: (node: Element | null) => void;
}

export type PresenceStatus = 'open' | 'closing' | 'closed';

export function usePresence(
  present: boolean,
  options?: UsePresenceOptions,
): UsePresenceResult;
```

Consumer pattern (custom overlay):

```tsx
const presence = usePresence(open);
if (!presence.isPresent) return null;
return (
  <div ref={presence.ref} data-state={presence.status === 'open' ? 'open' : 'closed'}>
    ...
  </div>
);
```

## 6. Component integration

### 6.1 Dialog

`usePresence(ctx.open, { onExitComplete: () => dialogRef.current?.close() })`.

- Keep the `showModal()` half of the open-effect; **remove the `close()` half** — the
  close now runs in `onExitComplete`.
- On close: the `<dialog>` stays open through the `"closing"` phase, so the top layer,
  `inert`, focus trap, Esc, and `::backdrop` are all retained while the exit animates.
- Merge `presence.ref` onto the `<dialog>` element so `getAnimations` reads it.
- **Intercept native Esc:** listen for the dialog `cancel` event, `preventDefault()`,
  and route through the controlled close (set `open` false) so Esc animates too.
- **Desync guard:** if `dialog.open` flips false externally (a `method="dialog"` submit,
  an external `close()`), finalize instantly rather than hang in `"closing"`.

### 6.2 The six custom overlays

Popover, Tooltip, Menu, ContextMenu, Select, Combobox Positioners each:

- add `const presence = usePresence(ctx.open)`,
- change the gate to `if (!presence.isPresent) return null`,
- merge `presence.ref` into the element ref,
- map `data-state={presence.status === 'open' ? 'open' : 'closed'}`.

**The load-bearing change: re-key the `showPopover()` effect from `[ctx.open]` to
`[presence.isPresent]`.** Today the effect's cleanup `hidePopover()` runs when `ctx.open`
flips false; left as-is it would pull the element out of the top layer mid-exit. Keyed on
`isPresent`, the element stays shown through `"closing"` and only hides on the finalizing
unmount.

Menu/ContextMenu **submenus** (which key on `sub.open`) get the same treatment:
`usePresence(sub.open)`, gate on `isPresent`, re-key `showPopover`.

### 6.3 Confirm during planning

- Whether any inner Dialog part (Backdrop, Content) is itself mount-on-open and needs
  the gate updated, or whether keying the whole exit off the `<dialog>` element suffices.
- That merging `presence.ref` does not disturb existing `useRender`/`mergeRefs` ref
  chains in each part.

## 7. Cross-cutting concerns

### 7.1 Data-attribute / CSS contract

- **Entry:** unchanged — CSS `@starting-style` on `[data-state="open"]`. Baseline Newly
  available; degrades to no entry animation.
- **Exit:** a `transition` on the animated element plus a single `[data-state="closed"]`
  rule (covers `closing` and `closed`).
- **Reduced motion:** examples zero the transition under
  `@media (prefers-reduced-motion: reduce)`; the hook also short-circuits.

### 7.2 SSR and hydration

`usePresence` reads `getAnimations()` only in the browser and only on a
`present` → false transition, which can only happen post-hydration. SSR and the initial
hydration render derive `status` synchronously from `present` (open → `"open"`,
isPresent true), so there is no server/client snapshot mismatch and no need for a
hydration flag. No `useSyncExternalStore`.

### 7.3 Documentation (apps/site)

- New Foundations page `/docs/components/use-presence` following the component-docs
  template: a live `## Demo`, `## Usage` (one full example + brief variations), and
  exactly one `## Styling` CodeTabs (CSS = class rules; Tailwind = markup stub). Add it
  to the Components nav under Foundations.
- Each of the seven component docs pages gains an exit transition in its examples (CSS
  tab adds the `[data-state="closed"]` rule + reduced-motion media query; the live demo
  shows it). Match each sibling page's existing section structure.

### 7.4 Size tracking

`usePresence` is used by all seven overlays, so add it to `UI_CORE_MODULES` in
`scripts/client-size-config.mjs` (alongside `useRender`/`mergeRefs`/`useControllableState`),
not to a single component's marginal. Config-only on the branch; do **not** regenerate or
commit `client-size-report.json` / history — the post-merge build-and-tag job does that.

### 7.5 Testing

- **Unit (happy-dom, `getAnimations()` mocked):** empty-set synchronous finalize;
  non-empty await → finalize; reopen-mid-exit generation token; reduced-motion
  short-circuit; timeout-vs-`.finished` race; no-exit-on-first-mount; `onExitComplete`
  fires before `isPresent` flips false; infinite-iteration animations filtered.
- **Component integration (happy-dom, mocked animations):** each overlay stays mounted
  through `"closing"` and unmounts on finalize; `data-state` flips open → closed;
  `showPopover`/`hidePopover` timing (shown through closing, hidden on unmount);
  Dialog `close()` deferred to `onExitComplete`; Esc `cancel` interception.
- **Manual-verification items (real browser, flagged in the plan; happy-dom cannot
  emulate `getAnimations()`/real transitions):** the actual exit animation per
  component, Dialog top-layer/`inert` retention during the deferred `close()`,
  `::backdrop` fade.

### 7.6 Accessibility

No new ARIA. The win is that Dialog retains its focus trap, `inert`, and focus-return
semantics across the exit (the `<dialog>` is genuinely open during `"closing"`), and Esc
still closes (now animated). Reduced-motion is honored.

## 8. Alternatives considered

### 8.1 View Transitions as the exit substrate (rejected)

Tempting because the framework already ships a View Transitions toolkit
(`@hono-preact/iso`: the route dispatcher, cold-nav coordinator,
`subscribeViewTransitionTypes`). Rejected for the standalone primitive for three
independent reasons:

1. **Browser-support constraint.** Same-document View Transitions are at best Baseline
   Newly available (Firefox shipped same-document VT only recently), so under the
   library's "Widely Available only; Newly available is progressive enhancement only"
   rule they cannot be the dependable substrate. `getAnimations()` has been Widely
   Available since ~2020.
2. **Document-global serialization, colliding with route VTs.** `startViewTransition`
   snapshots the whole document and only one runs at a time; a closing tooltip or
   dropdown would collide with an in-flight route VT — exactly the collision class the
   framework's cold-nav coordinator exists to manage. That coordinator lives in
   `@hono-preact/iso`; `@hono-preact/ui` is standalone (only `@floating-ui/dom`), so it
   has no coordinator and must not reintroduce the collisions.
3. **Styling model mismatch.** VT animates through document-global
   `::view-transition-old(name)` pseudo-elements keyed by `view-transition-name`, which
   fights the scoped, per-component `data-state` + local CSS transition contract the rest
   of the library uses.

Additionally, VT would not reduce the work: it relocates the await
(`transition.finished` instead of `getAnimations().finished`) while still requiring the
generation token, reopen handling, reduced-motion short-circuit, and SSR guard, and it
adds document-global coordination cost. VT's actual strength (snapshot-based morphs
between two layouts) is not what a one-sided overlay exit needs. If VT-for-overlays is
ever wanted, its home is **framework-side** (`@hono-preact/iso`, where the coordinator
lives), layered on top of this same `data-state` contract — not in the standalone
primitive.

### 8.2 CSS `transition-behavior: allow-discrete` / `overlay` (rejected)

Not reliable across current browsers; the `overlay` property is Chromium-only, so a
CSS-only exit animates nothing on Firefox/Safari and fails the all-browsers bar.

### 8.3 Event-based finalize (`transitionend`/`animationend`) (rejected)

Hangs forever in the empty-animation case and is fragile with multiple/child
animations. The `getAnimations().finished` + timeout race handles the empty case
synchronously and bounds the worst case.

## 9. Deferred / future work

- **`usePresence` as a framework-side View Transitions enhancement.** A future
  `@hono-preact/iso` layer could opt overlays into VT on top of the `data-state`
  contract, using the existing route coordinator. Not in this slice.
- **Entry animation via JS.** Stays CSS `@starting-style` only; no plan to move it into
  the hook.
- **Per-component exit-timing config / variants.** The styling-variant runtime helper
  (investigation §6.4 option 2) remains future-optional and separate.

## 10. Open items for the implementation plan

1. Exact timeout derivation (max animation end time vs a fixed default) and the hard cap
   value.
2. Whether any inner Dialog part needs its own gate, or keying the whole exit off the
   `<dialog>` element is sufficient (Section 6.3).
3. The precise `getAnimations()` mock shape for unit tests (a fake `Animation` with a
   controllable `.finished` and `getComputedTiming()`), and a shared test helper for it.
4. Whether submenus need a distinct generation scope from their parent menu, or share
   the same `usePresence` instance semantics cleanly.
5. Ordering of the build: land `use-presence.ts` + its unit tests first (the primitive),
   then integrate Dialog (the validating case), then the six custom overlays, then the
   docs sweep.
</content>
</invoke>
