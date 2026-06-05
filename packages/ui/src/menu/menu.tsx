// packages/ui/src/menu/menu.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { useCallback, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositionState } from '../use-position.js';
import { MenuContext, useMenuContext } from './context.js';

export interface MenuRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side; // default 'bottom'
  align?: Align; // default 'start'
  offset?: number; // default 8
  loop?: boolean; // wrap arrow navigation, default true
  typeahead?: boolean; // type-to-focus, default true
  children?: ComponentChildren;
}

export function MenuRoot(props: MenuRootProps) {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'start',
    offset = 8,
    loop = true,
    typeahead = true,
    children,
  } = props;

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

  const closeAll = useCallback(() => setOpen(false), [setOpen]);

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      closeAll,
      dismissId: baseId,
      parentDismissId: null,
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
      getAnchorRect: undefined,
    }),
    [
      open,
      setOpen,
      closeAll,
      baseId,
      triggerId,
      popupId,
      activeId,
      side,
      align,
      offset,
      loop,
      typeahead,
      position,
    ]
  );

  return h(MenuContext.Provider, { value: ctx }, children);
}

export type MenuTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function MenuTrigger(props: MenuTriggerProps): VNode {
  const { render, children, onClick, onKeyDown, ...rest } = props;
  const ctx = useMenuContext('Trigger');

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    ctx.pendingEdgeRef.current = 'first';
    ctx.setOpen(!ctx.open);
  };
  const handleKeyDown = (
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>
  ) => {
    onKeyDown?.(event);
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      ctx.pendingEdgeRef.current = 'first';
      ctx.setOpen(true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      ctx.pendingEdgeRef.current = 'last';
      ctx.setOpen(true);
    }
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': ctx.open,
      'aria-controls': ctx.open ? ctx.popupId : undefined,
      id: ctx.triggerId,
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: handleClick,
      onKeyDown: handleKeyDown,
    },
    state: { open: ctx.open },
    children,
  });
}

export type MenuItemProps = {
  render?: RenderProp<{ disabled: boolean; highlighted: boolean }>;
  disabled?: boolean;
  // Activation handler. Call event.preventDefault() to keep the menu open.
  onSelect?: (event: Event) => void;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'onSelect'>;

export function MenuItem(props: MenuItemProps): VNode {
  const {
    render,
    children,
    disabled = false,
    onSelect,
    onClick,
    onPointerEnter,
    ...rest
  } = props;
  const ctx = useMenuContext('Item');
  const id = useId();
  const highlighted = ctx.activeId === id;

  const activate = () => {
    const event = new Event('menu-select', { cancelable: true });
    onSelect?.(event);
    if (!event.defaultPrevented) ctx.closeAll();
  };

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (disabled) return;
    activate();
  };
  const handlePointerEnter = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>
  ) => {
    onPointerEnter?.(event);
    if (disabled) return;
    ctx.setActiveId(id);
    event.currentTarget.focus();
  };

  return useRender<{ disabled: boolean; highlighted: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      id,
      role: 'menuitem',
      'data-menu-item': '',
      tabIndex: highlighted ? 0 : -1,
      'aria-disabled': disabled ? 'true' : undefined,
      'data-disabled': disabled ? '' : undefined,
      'data-highlighted': highlighted ? '' : undefined,
      onClick: handleClick,
      onPointerEnter: handlePointerEnter,
    },
    state: { disabled, highlighted },
    children,
  });
}
