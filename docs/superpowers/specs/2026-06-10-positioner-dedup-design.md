# Positioner dedup via `usePositioner`

**Date:** 2026-06-10
**Status:** Approved (brainstorming) — ready for implementation plan
**Scope:** `@hono-preact/ui` (unreleased, `0.0.0`/private)

## Motivation

The five popup-bearing components (Popover, Tooltip, Menu, Select, Combobox) each
define an `XPositioner` part: the framework-owned layout wrapper that computes the
floating position, promotes the element into the top layer, and renders a
neutralized `<div>` around the consumer's Popup. All five are ~50 lines of nearly
identical mechanism. The duplication is a realized maintenance cost, not a
hypothetical: the recent `hidePopover` guard and the PR #81 `usePresence` rollout
each required editing the same block in all five files, and the neutralize-`style`
/ top-layer code is exactly the kind of subtle popup mechanics where a single
stale copy fails silently in production (and is invisible to happy-dom).

This effort extracts the shared mechanism into one internal hook and collapses each
`XPositioner` to a thin, explicit wrapper. It also folds in a policy change agreed
during brainstorming: the Popover API becomes a hard dependency for these
components (it was previously gated as progressive enhancement in four of the five).

This is the first of two independent dedups; the `useMenuCore` Root dedup is a
separate, later effort and is out of scope here.

## Goals

- One shared `usePositioner` hook owns: `usePresence`, `usePosition`, the
  `setPosition` publish effect, the top-layer promotion effect, and the neutralize
  `style`.
- Each `XPositioner` becomes a ~12-line named, typed function that reads its own
  context and passes a thin slice to the hook. Real stack frames preserved.
- Remove the `supportsPopover` gate and the four copy-pasted helper functions; the
  top-layer effect runs unconditionally (Popover API required).
- Behavior-preserving for everything except the gate removal. No public API change.

## Non-goals

- The `useMenuCore` Root dedup (separate effort).
- Dialog (uses native `<dialog>`/`showModal`, no Positioner, unaffected).
- Any change to `usePosition`, `usePresence`, or `useRender` internals.
- A factory/HOC approach (explicitly rejected in favor of the explicit hook).

## Design

### The hook: `packages/ui/src/use-positioner.ts`

Internal module (one hook per file, matching `use-position.ts` / `use-presence.ts`
/ `use-safe-area.ts`). **Not** exported from `index.ts`.

```ts
export interface UsePositionerOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;   // usePosition anchor (inputRef for Combobox)
  floatingRef: RefObject<HTMLElement>;
  arrowRef: RefObject<HTMLElement>;
  side: Side;
  align: Align;
  offset: number;
  getAnchorRect?: ClientRectGetter;    // undefined | ctx.getAnchorRect | local
  setPosition: (p: PositionState) => void; // publish resolved position for Arrow
  mount: 'unmount' | 'hidden';
}

export interface UsePositionerResult {
  // Raw presence value. Unmount-mode components branch on this (`return null`);
  // hidden-mode components ignore it (the hook bakes `hidden` into the props).
  isPresent: boolean;
  positionerProps: {
    ref: (node: Element | null) => void;
    hidden?: true; // set only in 'hidden' mode while !isPresent
    'data-side': Side;
    'data-align': Align;
    style: JSX.CSSProperties; // the shared neutralize block (stable constant)
  };
  state: { side: Side; align: Align };
}

export function usePositioner(opts: UsePositionerOptions): UsePositionerResult;
```

Internals (each step lifted verbatim from the current Positioners):

1. `const presence = usePresence(opts.open)`
2. `const position = usePosition({ open: presence.isPresent, anchorRef, floatingRef, arrowRef, side, align, offset, getAnchorRect })`
3. Publish effect: `useLayoutEffect(() => opts.setPosition(position), [position.side, position.align, position.arrowX, position.arrowY])` — deps unchanged; `setPosition` intentionally omitted from deps (stable `useState` setter), as today.
4. Top-layer promotion effect, **unconditional** (no `supportsPopover` gate):
   ```ts
   useLayoutEffect(() => {
     const el = opts.floatingRef.current;
     if (!presence.isPresent || !el) return;
     el.setAttribute('popover', 'manual');
     el.showPopover();
     return () => {
       try { el.hidePopover(); } catch { /* already hidden / disconnected */ }
       el.removeAttribute('popover');
     };
   }, [presence.isPresent]);
   ```
5. Return: `isPresent`, the `positionerProps` (with `hidden = opts.mount === 'hidden' && !presence.isPresent ? true : undefined`, `ref = mergeRefs(opts.floatingRef, presence.ref)`, `data-*` from `position`, `style = POSITIONER_STYLE`), and `state = { side: position.side, align: position.align }`.

`POSITIONER_STYLE` is a module-level constant carrying the neutralize block
(`position:fixed; inset:auto; margin:0; overflow:visible; border:0; padding:0;
background:transparent`) and its explanatory comment (neutralizes the UA
`[popover]` rule so `overflow:auto` doesn't clip the popup box-shadow and
`inset:0` doesn't fight the computed left/top). Using one stable reference instead
of an inline per-render object is behavior-equivalent (identical CSS) and a minor
render win.

### The per-component wrappers

Each `XPositioner` stays an explicit, named, typed function. The control-flow
difference between mount modes is honest and preserved:

- **`unmount`** (Popover, Tooltip, Menu): keep the `if (!isPresent) return null`
  line; return type `VNode | null`.
- **`hidden`** (Select, Combobox): no guard (the listbox stays mounted-but-`hidden`
  so options keep registering their labels); return type `VNode`.

```tsx
// hidden-mode example (Select)
export function SelectPositioner(props: SelectPositionerProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useSelectContext('Positioner');
  const { positionerProps, state } = usePositioner({
    open: ctx.open, anchorRef: ctx.anchorRef, floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef, side: ctx.side, align: ctx.align, offset: ctx.offset,
    setPosition: ctx.setPosition, mount: 'hidden',
  });
  return useRender<{ side: Side; align: Align }>({
    render, defaultTag: 'div', props: { ...rest, ...positionerProps }, state, children,
  });
}

// unmount-mode example (Popover)
export function PopoverPositioner(props: PopoverPositionerProps): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Positioner');
  const { isPresent, positionerProps, state } = usePositioner({
    open: ctx.open, anchorRef: ctx.anchorRef, floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef, side: ctx.side, align: ctx.align, offset: ctx.offset,
    setPosition: ctx.setPosition, mount: 'unmount',
  });
  if (!isPresent) return null;
  return useRender<{ side: Side; align: Align }>({
    render, defaultTag: 'div', props: { ...rest, ...positionerProps }, state, children,
  });
}
```

### Per-component variation mapping

| Component | `anchorRef` | `getAnchorRect` | `mount` |
|---|---|---|---|
| Popover | `ctx.anchorRef` | — | `unmount` |
| Tooltip | `ctx.anchorRef` | — | `unmount` |
| Menu | `ctx.anchorRef` | `ctx.getAnchorRect` (ContextMenu pointer anchor) | `unmount` |
| Select | `ctx.anchorRef` | — | `hidden` |
| Combobox | `ctx.inputRef` | local `useCallback` (`anchorRef ?? inputRef`) | `hidden` |

Combobox computes its local `getAnchorRect` in the component (it closes over
`ctx.anchorRef`/`ctx.inputRef`) and passes it in. Every other variation is a plain
opt value. `useRender` is hook-free (verified), so the conditional call after
`return null` in unmount mode is safe.

### Popover API now required

- Delete the `supportsPopover` helper from `popover.tsx`, `tooltip.tsx`,
  `menu.tsx`, `select.tsx` (Combobox has none). Confirm no other consumer exists
  (current grep: Positioner-only).
- The hook's top-layer effect is unconditional. On a browser without the Popover
  API, `el.showPopover()` throws a `TypeError` inside the layout effect, the
  explicit "required" contract, parity with today's Combobox. No soft fallback.
- **Docs:** add one concise "Requires the Popover API" note in a single shared
  location (the Components-area overview / a Foundations "Browser support" note),
  not duplicated across five pages. Phrased as what-is, per the docs philosophy.
- **Memory:** update `project_browser_support_constraint` post-merge to record that
  the Popover API is now a hard dependency for the popup components (CSS anchor
  positioning remains unused; positioning is `@floating-ui/dom`).

## Testing

Behavior-preserving refactor: the existing suite is the primary safety net. Every
Positioner / SSR / presence / nav / dismiss test for all five components must stay
green throughout (keep-green-at-each-step). The gate removal is verified by the
fact that the previously-gated components run their top-layer path in happy-dom
(which implements `showPopover`, since Combobox already relies on it); confirm
during implementation. No existing test exercises the no-Popover-API fallback (SSR
tests render to string with no layout effects; happy-dom has the API), so removing
the gate breaks nothing.

Add a focused `__tests__/use-positioner.test.tsx` (per the per-primitive
convention, `use-position`/`use-presence`/`use-safe-area`/etc. each have a direct
test) covering:

- `mount: 'unmount'` reports `isPresent` correctly (false when closed) and emits no
  `hidden`.
- `mount: 'hidden'` always reports `isPresent`-driven `hidden` (`true` when closed,
  absent when open) and never asks the component to unmount.
- `getAnchorRect` is forwarded to `usePosition`.
- `setPosition` is published with the resolved `side`/`align`.
- `data-side`/`data-align`/`style` are present on `positionerProps`.

## Files

- **New:** `packages/ui/src/use-positioner.ts`, `packages/ui/src/__tests__/use-positioner.test.tsx`
- **Modified:** `popover/popover.tsx`, `tooltip/tooltip.tsx`, `menu/menu.tsx`,
  `select/select.tsx`, `combobox/combobox.tsx` (Positioner bodies replaced,
  `supportsPopover` helpers removed)
- **Docs:** one shared Popover-API-requirement note
- **Memory (post-merge):** `project_browser_support_constraint`

## Open questions

Resolved during brainstorming:
- Unsupported-browser behavior → **throw** (parity with Combobox), no soft no-op.
- Hook location → **new `use-positioner.ts`** module.
- Factoring style → **explicit hook**, not a factory.
- Docs note → **single shared note**, not per-page.

None remaining.
