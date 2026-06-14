// packages/ui/src/context-menu/context-menu.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { renderElement, type RenderProp } from '../render-element.js';
import type { Side, Align } from '../use-position.js';
import { MenuContext, useMenuContext } from '../menu/context.js';
import { useMenuCore } from '../menu/use-menu-core.js';

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
    open,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'start',
    offset = 0,
    loop = true,
    typeahead = true,
    children,
  } = props;
  const core = useMenuCore({
    open,
    defaultOpen,
    onOpenChange,
    side,
    align,
    offset,
    loop,
    typeahead,
    pointerAnchored: true,
  });
  return h(MenuContext.Provider, { value: core.menuCtx }, children);
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

  return renderElement({
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
