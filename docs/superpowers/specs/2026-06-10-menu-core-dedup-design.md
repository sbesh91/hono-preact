# `useMenuCore` Root dedup

**Date:** 2026-06-10
**Status:** Approved (brainstorming) — ready for implementation plan
**Scope:** `@hono-preact/ui` (unreleased, `0.0.0`/private)

## Motivation

`MenuRoot`, `SubmenuRoot`, and `ContextMenuRoot` each hand-build the same
`MenuContextValue` (~22 fields) plus the same setup before it: `useControllableState`
for open/setOpen, five refs (`anchorRef`/`floatingRef`/`popupRef`/`arrowRef`/
`pendingEdgeRef`), `baseId` → `triggerId`/`popupId`, `activeId` state, and `position`
state. That is ~60 lines repeated three times, differing only in a handful of fields.
Every cross-cutting change to menu context shape is a three-file edit.

This is the second of the two structural dedups (the Positioner dedup, PR #83, was the
first). It extracts the shared setup + context assembly into one internal hook,
`useMenuCore`, and collapses each Root to a thin wrapper. Pure dedup; no behavior change.

## Goals

- One `useMenuCore` hook owns: `useControllableState`, the five refs, the ids,
  `activeId`/`position` state, the `closeAll` default, the ContextMenu pointer-anchor
  machinery, and the assembled `MenuContextValue`.
- Each Root collapses to a thin wrapper that resolves its own prop defaults and calls
  the hook.
- Behavior-preserving. No public API change. `menu/context.ts` (`MenuContextValue`)
  unchanged.

## Non-goals

- The Submenu hover open-timer (`scheduleOpen`/`cancelOpen`) and `SubmenuContextValue`
  stay in `SubmenuRoot` (submenu-specific).
- ContextMenu's `contextmenu`-event Trigger stays in `context-menu.tsx`.
- No change to `MenuPositioner`/`MenuPopup`/items or any non-Root part.
- No `index.ts` export change (the hook is internal).

## Design

### The hook: `packages/ui/src/menu/use-menu-core.ts`

Menu-specific (returns a `MenuContextValue`), so it lives in `menu/`. `context-menu.tsx`
imports it via `../menu/use-menu-core.js` (it already imports `../menu/context.js`).
Not exported from `index.ts`.

```ts
export interface UseMenuCoreOptions {
  // Controllable open state (each Root forwards its own public props).
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Resolved values — each Root applies its own prop defaults before calling.
  side: Side;
  align: Align;
  offset: number;
  loop: boolean;
  typeahead: boolean;
  // Default: a hook-owned `() => setOpen(false)`. SubmenuRoot passes parent.closeAll
  // so activating a nested item collapses the whole tree.
  closeAll?: () => void;
  // Default: null. SubmenuRoot passes parent.dismissId to link the dismiss tree.
  parentDismissId?: string | null;
  // ContextMenu only (default false): position against a captured pointer via a
  // virtual anchor, and expose `openAt(x, y)`.
  pointerAnchored?: boolean;
}

export interface MenuCore {
  menuCtx: MenuContextValue; // fully assembled
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  popupRef: RefObject<HTMLElement>;
  arrowRef: RefObject<HTMLElement>;
  pendingEdgeRef: RefObject<'first' | 'last'>;
  baseId: string;
  triggerId: string;
  popupId: string;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  position: PositionState;
  setPosition: (p: PositionState) => void;
}

export function useMenuCore(opts: UseMenuCoreOptions): MenuCore;
```

**Internals:**

1. `const [open, setOpen] = useControllableState<boolean>({ value: opts.open, defaultValue: opts.defaultOpen ?? false, onChange: opts.onOpenChange })`.
2. The five refs; `baseId = useId()`; `triggerId = ` `${baseId}-trigger` `; popupId = ` `${baseId}-popup` `.
3. `const [activeId, setActiveId] = useState<string | null>(null)`.
4. `const [position, setPosition] = useState<PositionState>({ side: opts.side, align: opts.align, arrowX: null, arrowY: null })`.
5. `const ownCloseAll = useCallback(() => setOpen(false), [setOpen]); const closeAll = opts.closeAll ?? ownCloseAll;` (always create `ownCloseAll`; pick per opt — never a conditional hook).
6. Pointer-anchor machinery, **always created** (hook rules forbid conditional hooks), only wired into `menuCtx` when `pointerAnchored`:
   ```ts
   const pointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
   const getAnchorRect = useCallback(() => {
     const { x, y } = pointRef.current;
     return { width: 0, height: 0, x, y, top: y, left: x, right: x, bottom: y };
   }, []);
   const openAt = useCallback((x: number, y: number) => {
     pointRef.current = { x, y };
     pendingEdgeRef.current = 'first';
     setOpen(true);
   }, [setOpen]);
   ```
7. Assemble the one `menuCtx = useMemo<MenuContextValue>(() => ({ open, setOpen, closeAll, dismissId: baseId, parentDismissId: opts.parentDismissId ?? null, anchorRef, floatingRef, popupRef, arrowRef, triggerId, popupId, activeId, setActiveId, pendingEdgeRef, side: opts.side, align: opts.align, offset: opts.offset, loop: opts.loop, typeahead: opts.typeahead, position, setPosition, getAnchorRect: opts.pointerAnchored ? getAnchorRect : undefined, openAt: opts.pointerAnchored ? openAt : undefined }), [open, setOpen, closeAll, baseId, opts.parentDismissId, activeId, opts.side, opts.align, opts.offset, opts.loop, opts.typeahead, position, opts.pointerAnchored, getAnchorRect, openAt])`. (`getAnchorRect`/`openAt` are stable `useCallback`s, safe in deps.)
8. Return `menuCtx` plus the raw pieces (`open`, `setOpen`, the four refs + `pendingEdgeRef`, `baseId`, `triggerId`, `popupId`, `activeId`, `setActiveId`, `position`, `setPosition`).

Note: the pre-PR `MenuRoot`/`ContextMenuRoot` set `openAt`/`getAnchorRect` to `undefined`
or omit them; reading `ctx.openAt` yields `undefined` either way, so setting
`openAt: undefined` for non-pointer menus is behavior-equivalent.

### Each Root

**`MenuRoot`** (defaults side `bottom`/align `start`/offset `8`):

```tsx
export function MenuRoot(props: MenuRootProps) {
  const { open, defaultOpen, onOpenChange, side = 'bottom', align = 'start',
    offset = 8, loop = true, typeahead = true, children } = props;
  const core = useMenuCore({ open, defaultOpen, onOpenChange, side, align, offset, loop, typeahead });
  return h(MenuContext.Provider, { value: core.menuCtx }, children);
}
```

**`ContextMenuRoot`** (defaults side `bottom`/align `start`/offset `0`): identical shape,
plus `pointerAnchored: true`. The `pointRef`/`getAnchorRect`/`openAt` move into the hook;
the Root no longer builds them.

```tsx
const core = useMenuCore({ open, defaultOpen, onOpenChange, side, align, offset,
  loop, typeahead, pointerAnchored: true });
return h(MenuContext.Provider, { value: core.menuCtx }, children);
```

**`SubmenuRoot`** (defaults side `right`/align `start`/offset `0`): calls the hook with
the parent-derived variant fields, then keeps its submenu-only machinery.

```tsx
const parent = useMenuContext('SubmenuRoot');
const core = useMenuCore({ open, defaultOpen, onOpenChange, side, align, offset,
  loop: parent.loop, typeahead: parent.typeahead,
  closeAll: parent.closeAll, parentDismissId: parent.dismissId });
// hover open-timer (unchanged): openTimer ref + cancelOpen + scheduleOpen + the
// `useEffect(() => cancelOpen, [cancelOpen])` cleanup, using core.setOpen.
// submenuCtx (unchanged shape) built from core.menuCtx + core.{open,setOpen,
// triggerId,popupId,anchorRef,floatingRef,pendingEdgeRef} + scheduleOpen/cancelOpen/closeDelay.
return h(SubmenuContext.Provider, { value: submenuCtx }, children);
```

`SubmenuRoot` does not render `MenuContext.Provider` itself; `core.menuCtx` rides inside
`submenuCtx.menuCtx` exactly as today.

### Per-Root variation mapping (what each passes)

| Root | `closeAll` | `parentDismissId` | `loop`/`typeahead` | `pointerAnchored` | side/align/offset |
|---|---|---|---|---|---|
| MenuRoot | default | default (null) | props | false (default) | bottom/start/8 |
| ContextMenuRoot | default | default (null) | props | **true** | bottom/start/0 |
| SubmenuRoot | `parent.closeAll` | `parent.dismissId` | `parent.*` | false (default) | right/start/0 |

## Testing

Behavior-preserving: the existing suites are the safety net and must stay green at each
step, `menu-structure`, `menu-navigation-dom`, `menu-trigger`, `menu-item`,
`menu-checkable`, `menu-submenu`, `menu-submenu-safe-area`, `menu-presence`, `menu-ssr`,
and `context-menu`.

Add a focused `__tests__/use-menu-core.test.tsx` for the branching the hook now centralizes:
- `closeAll` default invokes `setOpen(false)`; an injected `closeAll` is used instead.
- `parentDismissId` passthrough (default `null`; a passed value appears on `menuCtx`).
- `pointerAnchored: true` → `menuCtx.openAt(x, y)` sets the point, sets `pendingEdgeRef`
  to `'first'`, and opens; `menuCtx.getAnchorRect()` returns the captured-point rect.
- `pointerAnchored: false` (default) → `menuCtx.getAnchorRect` and `menuCtx.openAt` are
  both `undefined`.

## Files

- **New:** `packages/ui/src/menu/use-menu-core.ts`, `packages/ui/src/__tests__/use-menu-core.test.tsx`
- **Modified:** `packages/ui/src/menu/menu.tsx` (MenuRoot), `packages/ui/src/menu/submenu.tsx`
  (SubmenuRoot), `packages/ui/src/context-menu/context-menu.tsx` (ContextMenuRoot)
- No `index.ts` / `scripts/client-size-config.mjs` changes.

## Open questions

Resolved during brainstorming:
- Core depth → **fat core** (returns the fully-assembled `MenuContextValue`).
- The ordering wrinkle → the hook owns `setOpen`/`pendingEdgeRef`/`pointRef`, so it builds
  `openAt`/`getAnchorRect` itself, gated by `pointerAnchored`.
- The hook owns `useControllableState`, and the pointer callbacks are always created but
  only wired in when `pointerAnchored`. **Approved.**

None remaining.
