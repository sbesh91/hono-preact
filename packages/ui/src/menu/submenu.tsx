// packages/ui/src/menu/submenu.tsx
import {
  h,
  createContext,
  type RefObject,
  type ComponentChildren,
  type JSX,
  type VNode,
} from 'preact';
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import { useSafeArea } from '../use-safe-area.js';
import type { Side, Align, PositionState } from '../use-position.js';
import {
  MenuContext,
  useMenuContext,
  type MenuContextValue,
} from './context.js';
import { MenuPositioner, MenuPopup, type MenuPopupProps } from './menu.js';

// Carries the submenu's open-control + its own MenuContext value to the
// SubmenuTrigger (which itself reads the PARENT MenuContext for roving).
interface SubmenuContextValue {
  menuCtx: MenuContextValue;
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerId: string;
  popupId: string;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  pendingEdgeRef: RefObject<'first' | 'last'>;
  scheduleOpen: () => void;
  cancelOpen: () => void;
  closeDelay: number;
}

const SubmenuContext = createContext<SubmenuContextValue | null>(null);
function useSubmenuContext(part: string): SubmenuContextValue {
  const ctx = useContext(SubmenuContext);
  if (!ctx) {
    throw new Error(`<Menu.${part}> must be used within <Menu.SubmenuRoot>`);
  }
  return ctx;
}

export interface SubmenuRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side; // default 'right'
  align?: Align; // default 'start'
  offset?: number; // default 0
  openDelay?: number; // hover open delay (ms), default 100
  closeDelay?: number; // safe-area grace (ms), default 300
  children?: ComponentChildren;
}

export function SubmenuRoot(props: SubmenuRootProps) {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    side = 'right',
    align = 'start',
    offset = 0,
    openDelay = 100,
    closeDelay = 300,
    children,
  } = props;
  const parent = useMenuContext('SubmenuRoot');

  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });

  const anchorRef = useRef<HTMLElement>(null); // the SubmenuTrigger element
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

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelOpen = useCallback(() => {
    if (openTimer.current != null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }, []);
  const scheduleOpen = useCallback(() => {
    cancelOpen();
    openTimer.current = setTimeout(() => setOpen(true), openDelay);
  }, [cancelOpen, setOpen, openDelay]);
  // Clear a pending open if the SubmenuRoot unmounts mid-delay.
  useEffect(() => cancelOpen, [cancelOpen]);

  // The submenu's own MenuContext: parentDismissId links it into the dismiss
  // tree; closeAll is the parent's so activating a nested item collapses the
  // whole tree.
  const menuCtx = useMemo<MenuContextValue>(
    () => ({
      open,
      setOpen,
      closeAll: parent.closeAll,
      dismissId: baseId,
      parentDismissId: parent.dismissId,
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
      loop: parent.loop,
      typeahead: parent.typeahead,
      position,
      setPosition,
      getAnchorRect: undefined,
    }),
    [
      open,
      setOpen,
      parent.closeAll,
      parent.dismissId,
      parent.loop,
      parent.typeahead,
      baseId,
      triggerId,
      popupId,
      activeId,
      side,
      align,
      offset,
      position,
    ]
  );

  const submenuCtx = useMemo<SubmenuContextValue>(
    () => ({
      menuCtx,
      open,
      setOpen,
      triggerId,
      popupId,
      anchorRef,
      floatingRef,
      pendingEdgeRef,
      scheduleOpen,
      cancelOpen,
      closeDelay,
    }),
    [
      menuCtx,
      open,
      setOpen,
      triggerId,
      popupId,
      scheduleOpen,
      cancelOpen,
      closeDelay,
    ]
  );

  return h(SubmenuContext.Provider, { value: submenuCtx }, children);
}

export type SubmenuTriggerProps = {
  render?: RenderProp<{ open: boolean; highlighted: boolean }>;
  disabled?: boolean;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function SubmenuTrigger(props: SubmenuTriggerProps): VNode {
  const {
    render,
    children,
    disabled = false,
    onPointerEnter,
    onPointerLeave,
    onKeyDown,
    onClick,
    ...rest
  } = props;
  const parent = useMenuContext('SubmenuTrigger'); // roving in the PARENT menu
  const sub = useSubmenuContext('SubmenuTrigger'); // opens the submenu
  // The trigger's element id is the submenu's triggerId: it is both the
  // parent's roving target and the submenu Popup's aria-labelledby source.
  const id = sub.triggerId;
  const highlighted = parent.activeId === id;

  // Safe-area corridor keeps the submenu open while the pointer travels
  // diagonally from the trigger toward the open submenu.
  useSafeArea({
    enabled: sub.open,
    anchorRef: sub.anchorRef,
    floatingRef: sub.floatingRef,
    onClose: () => sub.setOpen(false),
    graceMs: sub.closeDelay,
  });

  const handlePointerEnter = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>
  ) => {
    onPointerEnter?.(event);
    if (disabled || event.pointerType === 'touch') return;
    parent.setActiveId(id);
    event.currentTarget.focus();
    sub.scheduleOpen();
  };
  const handlePointerLeave = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>
  ) => {
    onPointerLeave?.(event);
    if (event.pointerType === 'touch') return;
    // Cancel a pending open; while open the safe corridor governs the close.
    sub.cancelOpen();
  };
  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (disabled) return;
    if (
      event.key === 'ArrowRight' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
      event.stopPropagation(); // do not let the parent Popup also handle it
      // Focus the trigger before opening so the submenu Popup's focus-return
      // captures the trigger as the restore target (ArrowLeft / dismiss return
      // focus here, not to whichever parent item happened to be focused).
      parent.setActiveId(id);
      event.currentTarget.focus();
      sub.pendingEdgeRef.current = 'first';
      sub.setOpen(true);
    }
  };
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (disabled) return;
    // Same focus-before-open sequencing as handleKeyDown: the focus must land
    // on the trigger before setOpen so the submenu's focus-return restores here.
    parent.setActiveId(id);
    event.currentTarget.focus();
    sub.pendingEdgeRef.current = 'first';
    sub.setOpen(true);
  };

  return useRender<{ open: boolean; highlighted: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: sub.anchorRef,
      id,
      role: 'menuitem',
      'data-menu-item': '',
      tabIndex: highlighted ? 0 : -1,
      'aria-haspopup': 'menu',
      'aria-expanded': sub.open,
      'aria-controls': sub.open ? sub.popupId : undefined,
      'aria-disabled': disabled ? 'true' : undefined,
      'data-highlighted': highlighted ? '' : undefined,
      'data-state': sub.open ? 'open' : 'closed',
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave,
      onKeyDown: handleKeyDown,
      onClick: handleClick,
    },
    state: { open: sub.open, highlighted },
    children,
  });
}

export type SubmenuPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

// The submenu surface reuses the generic Menu Positioner/Popup against the
// submenu's MenuContext (provided here, not by SubmenuRoot).
export function SubmenuPositioner(props: SubmenuPositionerProps) {
  const sub = useSubmenuContext('SubmenuPositioner');
  return h(
    MenuContext.Provider,
    { value: sub.menuCtx },
    h(MenuPositioner, props)
  );
}

export type SubmenuPopupProps = MenuPopupProps;

export function SubmenuPopup(props: SubmenuPopupProps) {
  const { onKeyDown, ...rest } = props;
  const ctx = useMenuContext('SubmenuPopup'); // submenu MenuContext (provided by SubmenuPositioner)
  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      ctx.setOpen(false);
      ctx.anchorRef.current?.focus();
    }
  };
  // Name the props object as MenuPopupProps so the inferred return type stays
  // portable (an inline object literal here surfaces an unnamable Booleanish).
  const popupProps: MenuPopupProps = { ...rest, onKeyDown: handleKeyDown };
  return h(MenuPopup, popupProps);
}
