# Demo board drag: lift cards into the top layer

## Problem

On the kanban demo board, dragging a card lifts it with an imperative `translate`
on the card element while it stays in normal flow. The board grid is
`overflow-x-auto` (`apps/site/src/components/demo/Board.tsx`), and `overflow-x: auto`
forces the box to clip on **both** axes. So a card dragged upward, or far enough
sideways, is clipped by the board's scroll box instead of floating freely over it.

## Goal

While a card is being dragged, render it in the **top layer** (via the Popover API)
so it escapes the `overflow` clip and any ancestor stacking-context or
containing-block traps, and floats above the whole board. No layout shift, no clip.

The Popover API is a **mandatory** dependency for this demo (it is Baseline). There
is no non-popover fallback path.

## Approach: dimmed source + clone ghost

The real card stays in its column slot, dimmed to ~50% opacity, holding its space so
the column does not reflow. A **clone** of the card is promoted to the top layer and
follows the cursor. The clone lives outside Preact's render tree (appended under
`document.body`), so it cannot perturb Preact's diff of the board.

This is the familiar Linear/Trello drag feel: the origin slot stays visible as a
faint placeholder while a full-opacity, lifted copy tracks the pointer.

## Mechanism

All of this lives in `apps/site/src/hooks/use-board-drag.ts`, building on the
already-in-flight window-listener refactor (window-level `pointermove`/`pointerup`/
`pointercancel`, unified `finish(commit, ev)` teardown, capture-phase synthetic-click
swallow). Board/Column stay as in that refactor. TaskCard keeps its in-flight
`draggable={false}` / `onDragStart` guard and grab/grabbing cursor.

### Start (drag threshold crossed)

1. Measure `card.getBoundingClientRect()`.
2. `createGhost(card, rect)`:
   - `cloneNode(true)` the card wrapper element.
   - Strip `view-transition-name` (and any `id`s) from the clone subtree, so the
     original and clone never share a VT name. Drag fires no view transition, so this
     is insurance against a navigation mid-drag, but it is cheap and correct.
   - Wrap the clone in a `<div popover="manual">`, append that to `document.body`,
     call `showPopover()` to promote it to the top layer.
   - Position the ghost `position: fixed` at the captured rect (`left`/`top`/`width`/
     `height`, `margin: 0`). Reset the UA `[popover]` defaults that would otherwise
     rebox it or clip its shadow: `border: 0`, `padding: 0`, `inset: auto`,
     `overflow: visible`, `background: transparent`.
   - `pointer-events: none` on the ghost so it never becomes an event target.
   - Apply the lift styling to the ghost: `scale: 1.03` and the elevated box-shadow,
     eased in via `transition: scale 140ms ease, box-shadow 140ms ease`.
3. Dim the real card: `el.style.opacity = '0.5'`.

### Move (each `pointermove`)

Set the ghost's `translate` to `${clientX - startX}px ${clientY - startY}px`, 1:1
with the pointer. `translate` is deliberately excluded from the ghost's `transition`
so it tracks the pointer exactly rather than lagging. The board does not re-render per
move; only the `overStatus` drop-target column highlight uses component state, as
today (`dropTargetFromPoint(getColumnRects(), clientX)`).

### Finish (`finish(commit, ev)`)

- On `pointerup` (`commit = true`): compute the drop target and call
  `onDrop(taskId, to)`.
- On `pointercancel` (`commit = false`): abort, no drop.
- Always: `hidePopover()` and remove the ghost node; restore the real card's opacity;
  tear down the three window listeners; reset `draggingId`/`overStatus`/`startedRef`.
- The existing capture-phase synthetic-click swallow (one-shot + `setTimeout(0)`
  fallback) stays, so the card's link never navigates at the end of a drag.

## What changes where

- `apps/site/src/hooks/use-board-drag.ts`: the lift work moves from the real card
  onto the ghost; the old `resetLift` becomes "restore opacity + tear down ghost". Add
  a `createGhost(card, rect)` helper. `dropTargetFromPoint` and the column-rect logic
  are unchanged.
- `apps/site/src/components/demo/TaskCard.tsx`: no lift classes on the wrapper beyond
  the grab/grabbing cursor; the dim is applied imperatively by the hook (which already
  holds the card `el`). In-flight `draggable={false}` / `onDragStart` guard stays.
- `apps/site/src/components/demo/Board.tsx`, `Column.tsx`: unchanged from the in-flight
  refactor (no `suppressClickRef`).

## Testing

jsdom does not implement the Popover API, the top layer, or real layout, so the ghost
lifecycle cannot be unit-tested meaningfully. The pure `dropTargetFromPoint` unit test
stays green and is the only automated coverage. The ghost behavior (lift, tracking,
escaping the overflow clip, teardown on commit/abort, no leaked click) is verified
**live in the browser**, consistent with the existing constraint that MCP static
screenshots cannot show drag or animation.

## Non-goals

- No non-popover fallback (Popover API is mandatory here).
- No change to the drop logic, optimistic patch, column-rect math, or the
  Menu/ContextMenu move paths.
- No board-level move/settle animation on drop (still deferred, as in the P2 polish).
