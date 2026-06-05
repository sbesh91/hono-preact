// packages/ui/src/context-menu/context-menu.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { useCallback, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositionState } from '../use-position.js';
import { MenuContext, useMenuContext } from '../menu/context.js';

export interface ContextMenuRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side; // default 'bottom'
  align?: Align; // default 'start'
  offset?: number; // default 0
  loop?: boolean;
  typeahead?: boolean;
  children?: ComponentChildren;
}

export function ContextMenuRoot(props: ContextMenuRootProps) {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'start',
    offset = 0,
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
  const pointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
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

  // Virtual anchor: a zero-size rect at the captured pointer.
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
      getAnchorRect,
      openAt,
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
      getAnchorRect,
      openAt,
    ]
  );

  return h(MenuContext.Provider, { value: ctx }, children);
}

export type ContextMenuTriggerProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ContextMenuTrigger(props: ContextMenuTriggerProps): VNode {
  const { render, children, onContextMenu, ...rest } = props;
  const ctx = useMenuContext('Trigger');

  const handleContextMenu = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onContextMenu?.(event);
    event.preventDefault(); // suppress the native context menu
    ctx.openAt?.(event.clientX, event.clientY);
  };

  return useRender({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      'data-state': ctx.open ? 'open' : 'closed',
      onContextMenu: handleContextMenu,
    },
    children,
  });
}
