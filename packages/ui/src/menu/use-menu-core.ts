import type { RefObject } from 'preact';
import { useCallback, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositionState } from '../use-position.js';
import type { MenuContextValue } from './context.js';

export interface UseMenuCoreOptions {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Resolved values — each Root applies its own prop defaults before calling.
  side: Side;
  align: Align;
  offset: number;
  loop: boolean;
  typeahead: boolean;
  // Default: a hook-owned () => setOpen(false). SubmenuRoot passes parent.closeAll
  // so activating a nested item collapses the whole tree.
  closeAll?: () => void;
  // Default: null. SubmenuRoot passes parent.dismissId to link the dismiss tree.
  parentDismissId?: string | null;
  // ContextMenu only (default false): position against a captured pointer via a
  // virtual anchor and expose openAt(x, y).
  pointerAnchored?: boolean;
}

export interface MenuCore {
  menuCtx: MenuContextValue;
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

export function useMenuCore(opts: UseMenuCoreOptions): MenuCore {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    side,
    align,
    offset,
    loop,
    typeahead,
    closeAll: closeAllProp,
    parentDismissId = null,
    pointerAnchored = false,
  } = opts;

  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });

  const anchorRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLElement>(null);
  const arrowRef = useRef<HTMLElement>(null);
  const pendingEdgeRef = useRef<'first' | 'last'>('first');

  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const popupId = `${baseId}-popup`;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [position, setPosition] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  // closeAll defaults to closing this menu; a parent's closeAll is injected for
  // submenus. ownCloseAll is always created (hooks can't be conditional).
  const ownCloseAll = useCallback(() => setOpen(false), [setOpen]);
  const closeAll = closeAllProp ?? ownCloseAll;

  // Pointer-anchor machinery (ContextMenu): always created but only wired into
  // the context when pointerAnchored. The hook owns setOpen + pendingEdgeRef +
  // pointRef, so it can build openAt/getAnchorRect itself.
  const pointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const getAnchorRect = useCallback(() => {
    const { x, y } = pointRef.current;
    return { width: 0, height: 0, x, y, top: y, left: x, right: x, bottom: y };
  }, []);
  const openAt = useCallback(
    (x: number, y: number) => {
      pointRef.current = { x, y };
      pendingEdgeRef.current = 'first';
      setOpen(true);
    },
    [setOpen]
  );

  const menuCtx = useMemo<MenuContextValue>(
    () => ({
      open,
      setOpen,
      closeAll,
      dismissId: baseId,
      parentDismissId,
      anchorRef,
      floatingRef,
      popupRef,
      arrowRef,
      triggerId,
      popupId,
      activeId,
      setActiveId,
      pendingEdgeRef,
      side,
      align,
      offset,
      loop,
      typeahead,
      position,
      setPosition,
      getAnchorRect: pointerAnchored ? getAnchorRect : undefined,
      openAt: pointerAnchored ? openAt : undefined,
    }),
    [
      open,
      setOpen,
      closeAll,
      baseId,
      parentDismissId,
      activeId,
      side,
      align,
      offset,
      loop,
      typeahead,
      position,
      pointerAnchored,
      getAnchorRect,
      openAt,
    ]
  );

  return {
    menuCtx,
    open,
    setOpen,
    anchorRef,
    floatingRef,
    popupRef,
    arrowRef,
    pendingEdgeRef,
    baseId,
    triggerId,
    popupId,
    activeId,
    setActiveId,
    position,
    setPosition,
  };
}
