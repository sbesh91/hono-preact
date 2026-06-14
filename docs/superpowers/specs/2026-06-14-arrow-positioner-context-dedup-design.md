# Arrow + PositionerContext dedup design

**Section:** Primitives DX review, Section E ("UI: move the dedup trigger from fifth copy to second copy"), Group 1, first slice.

**Source:** `docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md` (Section 3 residue: "Arrow part byte-near-identical x5"; "Position-state plumbing through 6 Roots solely so Arrow can read it"; "Hand-maintained context memo dep arrays").

## Goal

Collapse the five byte-identical `Arrow` parts into one shared component, and eliminate the position-state round-trip that exists only so the Arrow can read the resolved position. Behavior-preserving for every real usage.

## Background: the current shape

The Arrow part is duplicated in five files (`popover.tsx`, `tooltip.tsx`, `menu.tsx`, `select.tsx`, `combobox.tsx`). Each body is identical except for which context hook it calls:

```tsx
export function PopoverArrow(props: PopoverArrowProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Arrow');
  const { side, arrowX, arrowY } = ctx.position;
  return renderElement<{ side: Side }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.arrowRef,
      'data-side': side,
      style: {
        position: 'absolute',
        left: arrowX != null ? `${arrowX}px` : undefined,
        top: arrowY != null ? `${arrowY}px` : undefined,
      },
    },
    state: { side },
    children,
  });
}
```

The position it reads gets there by a round-trip that exists for no other reason:

1. `usePosition` (inside the Positioner part, via `usePositioner`) computes and holds the live `PositionState` (`side`, `align`, `arrowX`, `arrowY`).
2. `usePositioner` re-publishes it to the Root with a `useLayoutEffect` calling `ctx.setPosition(position)`.
3. The Root stores it in `useState<PositionState>` and puts `position` (plus `setPosition` and `arrowRef`) into the main context value and its memo dependency array.
4. The Arrow, always a descendant of the Positioner, reads `ctx.position` back down.

Verified facts that make this safe to collapse:

- **Only the Arrow reads `ctx.position`** (5 sites). Nothing else.
- **Only the Positioner part calls `ctx.setPosition`** (5 sites, passed into `usePositioner`).
- **`arrowRef` has exactly three roles**: declared in the Root / `useMenuCore`, passed into `usePositioner` by the Positioner, attached by the Arrow. No other readers.
- **The Arrow is always a descendant of the Positioner** in every demo and docs example (`Positioner > Popup > Arrow`). The position only exists while open, which is exactly when the Positioner is mounted.
- **`floatingRef` is also read by `useDismiss`** (in the Popup), so it stays in the main context. Only `position` / `setPosition` / `arrowRef` leave.
- **Position-state is declared in five sites**, not six: the four standalone Roots (popover, tooltip, select, combobox) plus `useMenuCore`, which already centralizes it for the Menu / ContextMenu / Submenu trio.
- **The submenu reuses `MenuPositioner`**, so it gets its own nested PositionerContext automatically.

## Approach

The Positioner owns the position and provides it through a small shared `PositionerContext`; one shared `Arrow` component consumes it. `usePositioner` returns the resolved position (it already computes it) and owns `arrowRef` internally instead of receiving it. The `setPosition` round-trip is deleted outright.

This mirrors the existing `SelectOptionGroupContext` pattern: a small sibling context provided by one part and consumed by another.

### New unit: `packages/ui/src/positioner-context.ts`

```ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type { PositionState } from './use-position.js';

export interface PositionerContextValue {
  position: PositionState;
  arrowRef: RefObject<HTMLElement>;
}

export const PositionerContext = createContext<PositionerContextValue | null>(
  null
);

export function usePositionerContext(): PositionerContextValue {
  const ctx = useContext(PositionerContext);
  if (!ctx) {
    throw new Error('<Arrow> must be rendered inside a Positioner');
  }
  return ctx;
}
```

### New unit: `packages/ui/src/arrow.tsx`

The body is lifted verbatim from the five copies; the only change is sourcing `position` and `arrowRef` from `usePositionerContext()` instead of a per-component context.

```tsx
import { type ComponentChildren, type JSX, type VNode } from 'preact';
import { renderElement, type RenderProp } from './use-render.js';
import type { Side } from './use-position.js';
import { usePositionerContext } from './positioner-context.js';

export type ArrowProps = {
  render?: RenderProp<{ side: Side }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function Arrow(props: ArrowProps): VNode {
  const { render, children, ...rest } = props;
  const { position, arrowRef } = usePositionerContext();
  const { side, arrowX, arrowY } = position;
  return renderElement<{ side: Side }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: arrowRef,
      'data-side': side,
      style: {
        position: 'absolute',
        left: arrowX != null ? `${arrowX}px` : undefined,
        top: arrowY != null ? `${arrowY}px` : undefined,
      },
    },
    state: { side },
    children,
  });
}
```

### Changed unit: `packages/ui/src/use-positioner.ts`

- Drop `setPosition` and `arrowRef` from `UsePositionerOptions`.
- Create `arrowRef` internally (`const arrowRef = useRef<HTMLElement>(null)`).
- Delete the `useLayoutEffect` that calls `opts.setPosition(position)`.
- Return `position` (the full `PositionState`) and `arrowRef` in `UsePositionerResult`, keeping `isPresent`, `positionerProps`, and `state`.

`positionerProps.ref` continues to merge `floatingRef` and the presence ref; `floatingRef` stays an option (the Popup's `useDismiss` reads it from the main context, and the Positioner element is still `floatingRef`).

### Per-component cleanup (five components)

For each of popover, tooltip, select, combobox Roots **and** `useMenuCore`:

- Delete the `arrowRef` `useRef` and the `useState<PositionState>`.
- Remove `arrowRef`, `position`, `setPosition` from the `*ContextValue` interface (and `MenuContextValue`), the assembled context object, and the memo dependency array. For `useMenuCore`, also remove them from the `MenuCore` result type and return object (they are only consumed via the context, confirmed at plan time).

For each of the five Positioner parts:

- Call the new `usePositioner` without `arrowRef` / `setPosition` arguments; destructure `position` and `arrowRef` from the result.
- Wrap the rendered output in `<PositionerContext.Provider value={{ position, arrowRef }}>`. The early `if (!isPresent) return null` stays.

For each of the five Arrow exports:

- Delete the per-component `*Arrow` function and `*ArrowProps` type from the component file.
- Re-export the shared `Arrow` / `ArrowProps` under the namespace so `Popover.Arrow`, `Tooltip.Arrow`, `Menu.Arrow`, `Select.Arrow`, `Combobox.Arrow` (and `ContextMenu.Arrow`, which aliases `Menu.Arrow`) keep working.

Nested submenus get the correct (nearest) PositionerContext automatically, because `SubmenuPositioner` renders `MenuPositioner`, which provides its own PositionerContext.

## Behavior notes

- **Steady-state output is identical**: same `data-side`, same absolute `left`/`top` offsets, same `render` / `state` contract.
- **One incidental improvement**: today the Arrow's `data-side` lags the Positioner's by one commit (the `setPosition` -> setState -> re-render cycle). After this change both read the same source, so they are synchronized. Not a regression.
- **One contract tightening**: an Arrow rendered *outside* a Positioner now throws instead of rendering a default-position arrow. True in zero real usages, matches the universal convention, and is free since `@hono-preact/ui` is private and unpublished (version `0.0.0`).

## Testing

- **Rewrite `use-positioner` test** for the new signature: it no longer takes `setPosition` / `arrowRef`; assert it returns the resolved `position` and owns an `arrowRef`. The existing "publishes the resolved position via setPosition" case becomes "returns the resolved position".
- **Existing per-component Arrow tests should pass unchanged** (identical rendered output). Fix any that render an Arrow without a Positioner ancestor (they would now throw) by nesting them under the component's Positioner.
- **Add tests** (in a shared `arrow.test.tsx` or extending an existing file):
  - The shared `Arrow` renders `data-side` and the absolute offset from its enclosing Positioner's resolved position.
  - An `Arrow` rendered outside any Positioner throws the guard error.
  - If the submenu renders an Arrow, a nested Arrow reads the submenu's Positioner, not the parent menu's.
- **Verify `exports.test.ts`** still sees `.Arrow` on every namespace.
- **Full six-step CI** before push (`build`, `format:check`, `typecheck`, `test:coverage`, `test:integration`, `site build`).

## Scope boundaries

In scope: the Arrow part dedup and the position-state plumbing removal described above.

Explicitly out of scope (separate slices, noted for the record):

- The Positioner *body* boilerplate (`if (!isPresent) return null; renderElement(...)`) is also five-times duplicated; deduping it is a separate slice.
- The group-label context (x3) and description-registration (x2) dedups, which are the rest of Section E Group 1.
- All of Section E Group 2 (contract standardization: delay vocabulary, `data-checked`, `Value` model, shared `PositioningProps` / `SelectionProps`, `ComboboxValueState` erasure leak).
