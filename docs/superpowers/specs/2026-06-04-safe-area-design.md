# `useSafeArea` — pointer-grace primitive (safe area)

- **Date:** 2026-06-04
- **Status:** Approved (brainstorm complete, ready for implementation plan)
- **Package:** `@hono-preact/ui`
- **Slice:** Phase 3 of the headless-components effort (machinery primitive + Tooltip rewire)

## Problem

When a floating element (tooltip, hover card, submenu) opens on hover, the user
must move the pointer across an empty gap to reach it. A diagonal move leaves the
trigger before entering the floating element, firing `pointerleave`, and naive
hover logic closes the element before the user arrives. Today `Tooltip` papers
over this with a 300ms `closeDelay` timer, which is a race, not a fix: move too
slowly and it closes anyway; the gap is never actually "safe."

The fix is the well-known "safe area" / "safe triangle" technique: while the
pointer is inside a wedge aimed from the trigger at the floating element, treat
the motion as intent-to-reach and suppress the close, even though the pointer is
technically over neither element.

Reference: Smashing Magazine, "Better Context Menus With Safe Triangles"
(2023-08).

## Locked decisions

These were settled during brainstorming and are not open questions for the plan:

1. **Generic primitive, not menu-specific.** Build standalone machinery (a hook,
   sibling to `usePosition` / `useDismiss`) that knows nothing about menus or
   tooltips. Validate it against the existing `Tooltip` now; `Menu`/`Popover`
   consume it later for free.
2. **Fidelity = polygon + grace timeout + directionality.** The bare polygon test
   is the floor; the grace-expiry timeout (kills the "dead zone" where a parked
   cursor holds the element open forever) and directionality (only honor motion
   toward the floating element) are what make it feel high-fidelity. All three
   are in scope.
3. **Manager-hook API.** Mirror `useDismiss`: the hook owns the global pointer
   listener and the grace timer and calls back `onClose`. Consumers wire ~one
   thing. The pure geometry core stays internal (unit-tested directly, not
   re-exported); it can be promoted to public later if a power user needs it.
4. **Point-in-polygon math, no injected DOM.** Reject the SVG-overlay approach
   (it injects a fixed node that intercepts events under the wedge, fights
   stacking contexts and the Popover-API top layer, and is not unit-testable
   without a real pointer). Compute the polygon from live rects and run a pure
   `pointInPolygon` test on each `pointermove`. This fits the framework's
   portal-free, minimal-DOM grain and leaves everything under the wedge
   interactive.
5. **The shape is a quad (source-rect), not a point-apex triangle.** The quad's
   base is the whole trigger edge rather than a single cursor exit point, so it
   absorbs the small perpendicular wobble most pointers (especially trackpads)
   make at the start of a gesture. It feels more natural to the broadest set of
   users; its only downside (slightly less crisp instant dismiss by a sideways
   flick within the corridor) is bounded by the grace timeout. Bonus: the quad
   is a pure function of the two element rects, so the hook needs no per-point
   apex tracking at all.
6. **Docs page now.** Ship a Foundations primitive page for `useSafeArea` in this
   slice; extend it with menu-specific guidance when `Menu` lands.
7. **Rewire Tooltip now.** Make the safe-area corridor the sole hover-close
   authority in `Tooltip` in this slice (remove the two `scheduleClose`-on-leave
   paths), rather than landing the primitive standalone and rewiring later. Goal:
   a small library of high-quality, composable, modular tools.

## Architecture

Two new modules, mirroring the existing `dismiss-stack.ts` (pure core) +
`use-dismiss.ts` (hook wrapper) split:

- **`packages/ui/src/safe-area.ts`** — pure geometry. No DOM, no Preact imports.
- **`packages/ui/src/use-safe-area.ts`** — the manager hook, structured exactly
  like `use-dismiss.ts` (latest-callback ref, `enabled`-guarded `useLayoutEffect`,
  returns nothing).

### Pure geometry core (`safe-area.ts`)

```ts
export interface Point {
  x: number;
  y: number;
}

// Even-odd ray cast. ~10 lines, no dependencies.
export function pointInPolygon(point: Point, polygon: Point[]): boolean;

// Pick the floating element's "near" side from live rects, so a usePosition
// flip is honored on the next pointer read. Dominant axis of center separation.
// Reuses the Side type from use-position.ts (no new direction vocabulary).
export function sideFromRects(anchor: DOMRect, floating: DOMRect): Side;

// The safe quad: the trigger's near edge joined to the floating element's near
// edge. `side` selects which edges are "near" (right -> anchor right edge +
// floating left edge; bottom -> anchor bottom edge + floating top edge; etc.).
export function buildSafePolygon(
  anchor: DOMRect,
  floating: DOMRect,
  side: Side,
): Point[];
```

`buildSafePolygon` returns four points (a convex quad spanning the gap corridor).
There is no triangle/apex variant; the quad is the shape.

### Manager hook (`use-safe-area.ts`)

```ts
export interface UseSafeAreaOptions {
  enabled: boolean; // typically the open state of a hover-driven element
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  onClose: () => void; // invoked when intent is abandoned or grace expires
  graceMs?: number; // default 300
}

export function useSafeArea(opts: UseSafeAreaOptions): void;
```

**Lifecycle.** A `useLayoutEffect` (matching `useDismiss`) runs while `enabled`
and both refs are populated. It attaches one `document` `pointermove` listener
and keeps two values in refs: `engaged` (boolean) and `graceTimer`. The latest
`onClose` is held in a ref so the listener never re-subscribes on callback
identity. On each move with point `P`:

1. **`P` is over the anchor rect or the floating rect** (a "reference") -> set
   `engaged = true`, clear the grace timer, do nothing else. (Safely parked;
   stay open.)
2. **`engaged` is still false** -> ignore the move entirely. No hover session has
   started (e.g. the element was opened by keyboard focus), so mouse movement
   must never close it.
3. **`P` is in the gap and `engaged` is true** -> build the quad from the live
   anchor + floating rects (`side` via `sideFromRects`, so flips are honored):
   - `P` inside the quad -> in transit toward the target. Start the `graceMs`
     countdown if it is not already running; do not close.
   - `P` outside the quad -> intent abandoned. Clean up and call `onClose`
     immediately (no wait).
4. **The grace timer fires** (entered the corridor but dwelled `graceMs` without
   reaching the floating element) -> call `onClose`.

Teardown removes the listener and clears the timer. Touch pointers
(`event.pointerType === 'touch'`) are ignored throughout.

The three fidelity behaviors fall out of this: **(1) polygon** suppresses the
close while heading for the target; **(2) expiry** bounds how long the corridor
is honored; **(3) directionality** is implicit, since moving away from the
floating element exits the corridor and closes immediately.

## Tooltip integration (proof consumer)

`useSafeArea` mounts in `TooltipPopup` (which renders only when open and already
holds both refs and the close action via context):

```ts
useSafeArea({
  enabled: ctx.open,
  anchorRef: ctx.anchorRef,
  floatingRef: ctx.floatingRef,
  onClose: () => ctx.setOpenImmediate(false),
  graceMs: closeDelay,
});
```

`onClose` closes immediately because the corridor already provided the dwell
tolerance via its own grace timer. The corridor becomes the single hover-close
authority:

- **Trigger `onPointerLeave`** keeps `cancelPending()` only, so a pending *open*
  (the 600ms open delay) is still cancelled if the pointer leaves before the
  tooltip opens. Its old `scheduleClose` is removed.
- **Popup `onPointerLeave`**: its `scheduleClose` is removed; the safe area
  governs the close.
- **`onPointerEnter` handlers** (`cancelPending`) stay. **Focus/blur** and
  **`useDismiss`** (Escape) are untouched.

Net behavior change: leaving the trigger *toward* the popup keeps it open via the
corridor instead of racing the 300ms timer; leaving *away* closes promptly.
`closeDelay` now feeds the grace dwell rather than the leave timer (similar
magnitude, so the prop keeps its meaning for consumers).

`Popover` and `Menu` are future consumers and are out of scope for this slice.

## Edge cases

- **Touch** pointers are ignored; tooltips already do not open via touch hover.
- **Focus / keyboard sessions** are unaffected: the `engaged` gate means mouse
  movement never closes a focus-opened element; blur still closes it.
- **SSR-safe:** `document` is touched only inside the effect, exactly like
  `useDismiss`.
- **Scroll / resize / flip during transit:** rects are read live on each move, so
  the corridor follows the elements. This is 1-2 `getBoundingClientRect` calls
  per move, and only while the element is open. Acceptable; throttling is
  premature optimization and is not in scope.
- **Degenerate / zero-gap corridor** (e.g. `offset` 0, elements touching): the
  quad has near-zero area, so `pointInPolygon` reports outside and the behavior
  degrades to immediate close. Correct: there is no gap to protect.

## Testing

Everything is synthetic events + stubbed rects, because a real pointer cannot be
driven through MCP and jsdom does no layout.

- **`safe-area.test.ts`** (pure): `pointInPolygon` (inside, outside, on-edge,
  on-vertex); `buildSafePolygon` for each `side` (asserts the four corners);
  `sideFromRects` (each dominant-axis case).
- **`use-safe-area.test.tsx`**: a harness with `getBoundingClientRect` stubbed on
  the anchor and floating elements. Dispatch `document` `pointermove` events with
  `clientX`/`clientY` and assert: `onClose` fires when the point is outside the
  corridor; does not fire when inside; the `engaged` gate (a move in the gap
  before ever touching a reference does not close); grace expiry via fake timers
  (move into the corridor, advance `graceMs`, expect `onClose`). All event
  dispatch is `act()`-flushed (raw events in Preact tests must be flushed
  through `act()`).
- **`tooltip-*.test.tsx`**: leave-toward-popup keeps open; leave-away closes;
  reach-popup keeps open.
- **`exports.test.ts`**: add `useSafeArea` to the expected public exports.

## Documentation

- New Foundations primitive page **`apps/site/src/pages/docs/components/use-safe-area.mdx`**,
  registered in `apps/site/src/pages/docs/nav.ts`, authored by following the
  local `.claude/skills/add-docs-page.md` skill. Describes what the corridor is,
  the `useSafeArea` API, and the quad behavior. Per repo convention, the page
  describes what *is*, with no migration/breadcrumb language. Menu-specific
  guidance is deferred to when `Menu` ships.
- A line in **`apps/site/src/pages/docs/components/tooltip.mdx`** noting that the
  Tooltip keeps itself open while the pointer travels the safe corridor toward
  the popup.

## Public surface

`packages/ui/src/index.ts` gains exactly:

```ts
export { useSafeArea, type UseSafeAreaOptions } from './use-safe-area.js';
```

The geometry core (`safe-area.ts`) is not re-exported.

## Out of scope / future

- `Popover` and `Menu` consumers.
- Exposing the geometry core publicly.
- Throttling the per-move rect reads.
- A point-apex triangle shape (explicitly rejected in favor of the quad).

## Verification before push

Run CI's six steps locally, in order: framework build, `pnpm format:check`,
`pnpm typecheck`, `pnpm test:coverage`, `pnpm test:integration`,
`pnpm --filter site build`. Update the committed client-size baseline (the new
hook is small and tree-shakeable).
