// packages/ui/src/menu/menu.tsx
import {
  h,
  createContext,
  type ComponentChildren,
  type JSX,
  type VNode,
} from 'preact';
import { useContext, useId, useLayoutEffect, useMemo } from 'preact/hooks';
import { renderElement, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align } from '../use-position.js';
import { useMenuCore } from './use-menu-core.js';
import { useDismiss } from '../use-dismiss.js';
import { useFocusReturn } from '../use-focus-return.js';
import { useListNavigation } from '../list-navigation.js';
import { usePositioner } from '../use-positioner.js';
import {
  MenuContext,
  useMenuContext,
  MenuRadioGroupContext,
  useMenuRadioGroupContext,
} from './context.js';
import { PositionerContext } from '../positioner-context.js';

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
    open,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'start',
    offset = 8,
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
  });
  return h(MenuContext.Provider, { value: core.menuCtx }, children);
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
    if (
      event.key === 'ArrowDown' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
      ctx.pendingEdgeRef.current = 'first';
      ctx.setOpen(true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      ctx.pendingEdgeRef.current = 'last';
      ctx.setOpen(true);
    }
  };

  return renderElement<{ open: boolean }>({
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

  return renderElement<{ disabled: boolean; highlighted: boolean }>({
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

export type MenuPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function MenuPositioner(props: MenuPositionerProps) {
  const { render, children, ...rest } = props;
  const ctx = useMenuContext('Positioner');
  const { isPresent, positionerProps, state, position, arrowRef } =
    usePositioner({
      open: ctx.open,
      anchorRef: ctx.anchorRef,
      floatingRef: ctx.floatingRef,
      side: ctx.side,
      align: ctx.align,
      offset: ctx.offset,
      getAnchorRect: ctx.getAnchorRect,
      mount: 'unmount',
    });
  const positionerValue = useMemo(() => ({ position, arrowRef }), [position]);
  if (!isPresent) return null;
  return h(
    PositionerContext.Provider,
    { value: positionerValue },
    renderElement<{ side: Side; align: Align }>({
      render,
      defaultTag: 'div',
      props: { ...rest, ...positionerProps },
      state,
      children,
    })
  );
}

export type MenuPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  'aria-label'?: string;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function MenuPopup(props: MenuPopupProps): VNode {
  const {
    render,
    children,
    'aria-label': ariaLabel,
    onKeyDown,
    ...rest
  } = props;
  const ctx = useMenuContext('Popup');

  const nav = useListNavigation({
    enabled: ctx.open,
    containerRef: ctx.popupRef,
    itemSelector: '[data-menu-item]:not([aria-disabled="true"])',
    scopeSelector: '[role="menu"]',
    activeId: ctx.activeId,
    setActiveId: ctx.setActiveId,
    mode: 'roving',
    loop: ctx.loop,
    typeahead: ctx.typeahead,
  });

  useDismiss({
    enabled: ctx.open,
    refs: [ctx.floatingRef, ctx.anchorRef],
    escape: true,
    outsidePress: true,
    onDismiss: () => ctx.setOpen(false),
    id: ctx.dismissId,
    parentId: ctx.parentDismissId,
  });

  useFocusReturn({ open: ctx.open, popupRef: ctx.popupRef });

  // On open, focus the first (or last, on ArrowUp open) enabled item.
  useLayoutEffect(() => {
    if (!ctx.open) return;
    const list = nav.getItems();
    if (list.length === 0) return;
    nav.setActiveItem(
      ctx.pendingEdgeRef.current === 'last' ? list.length - 1 : 0
    );
  }, [ctx.open]);

  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    nav.onKeyDown(event);
    if (event.defaultPrevented) return;
    const list = nav.getItems();
    const current = list.findIndex((el) => el.id === ctx.activeId);
    if (event.key === 'Tab') {
      ctx.setOpen(false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (current >= 0) list[current].click();
    }
  };

  return renderElement<{ open: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.popupRef,
      role: 'menu',
      id: ctx.popupId,
      tabIndex: -1,
      'aria-orientation': 'vertical',
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabel ? undefined : ctx.triggerId,
      'data-state': ctx.open ? 'open' : 'closed',
      onKeyDown: handleKeyDown,
    },
    state: { open: ctx.open },
    children,
  });
}

export type MenuCheckboxItemProps = {
  render?: RenderProp<{
    checked: boolean;
    disabled: boolean;
    highlighted: boolean;
  }>;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
  children?: ComponentChildren;
} & Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  'children' | 'onSelect' | 'checked'
>;

export function MenuCheckboxItem(props: MenuCheckboxItemProps): VNode {
  const {
    render,
    children,
    checked: checkedProp,
    defaultChecked,
    onCheckedChange,
    disabled = false,
    onSelect,
    onClick,
    onPointerEnter,
    ...rest
  } = props;
  const ctx = useMenuContext('CheckboxItem');
  const id = useId();
  const highlighted = ctx.activeId === id;
  const [checked, setChecked] = useControllableState<boolean>({
    value: checkedProp,
    defaultValue: defaultChecked ?? false,
    onChange: onCheckedChange,
  });

  const activate = () => {
    setChecked(!checked);
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

  return renderElement<{
    checked: boolean;
    disabled: boolean;
    highlighted: boolean;
  }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      id,
      role: 'menuitemcheckbox',
      'data-menu-item': '',
      tabIndex: highlighted ? 0 : -1,
      'aria-checked': checked,
      'aria-disabled': disabled ? 'true' : undefined,
      'data-state': checked ? 'checked' : 'unchecked',
      'data-disabled': disabled ? '' : undefined,
      'data-highlighted': highlighted ? '' : undefined,
      onClick: handleClick,
      onPointerEnter: handlePointerEnter,
    },
    state: { checked, disabled, highlighted },
    children,
  });
}

export type MenuRadioGroupProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'value'>;

export function MenuRadioGroup(props: MenuRadioGroupProps) {
  const {
    value: valueProp,
    defaultValue,
    onValueChange,
    render,
    children,
    ...rest
  } = props;
  const [value, setValue] = useControllableState<string | undefined>({
    value: valueProp,
    defaultValue: defaultValue,
    onChange: (v) => v !== undefined && onValueChange?.(v),
  });
  const groupCtx = useMemo(
    () => ({ value, setValue: (v: string) => setValue(v) }),
    [value, setValue]
  );
  const node = renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'group' },
    children,
  });
  return h(MenuRadioGroupContext.Provider, { value: groupCtx }, node);
}

export type MenuRadioItemProps = {
  value: string;
  render?: RenderProp<{
    checked: boolean;
    disabled: boolean;
    highlighted: boolean;
  }>;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'onSelect'>;

export function MenuRadioItem(props: MenuRadioItemProps): VNode {
  const {
    value,
    render,
    children,
    disabled = false,
    onSelect,
    onClick,
    onPointerEnter,
    ...rest
  } = props;
  const ctx = useMenuContext('RadioItem');
  const group = useMenuRadioGroupContext();
  const id = useId();
  const highlighted = ctx.activeId === id;
  const checked = group.value === value;

  const activate = () => {
    group.setValue(value);
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

  return renderElement<{
    checked: boolean;
    disabled: boolean;
    highlighted: boolean;
  }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      id,
      role: 'menuitemradio',
      'data-menu-item': '',
      tabIndex: highlighted ? 0 : -1,
      'aria-checked': checked,
      'aria-disabled': disabled ? 'true' : undefined,
      'data-state': checked ? 'checked' : 'unchecked',
      'data-disabled': disabled ? '' : undefined,
      'data-highlighted': highlighted ? '' : undefined,
      onClick: handleClick,
      onPointerEnter: handlePointerEnter,
    },
    state: { checked, disabled, highlighted },
    children,
  });
}

// MenuGroup context: carries the label id from MenuGroup down to MenuGroupLabel.
const MenuGroupContext = createContext<{ labelId: string } | null>(null);

export type MenuGroupProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function MenuGroup(props: MenuGroupProps) {
  const { render, children, ...rest } = props;
  const labelId = useId();
  const node = renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'group', 'aria-labelledby': labelId },
    children,
  });
  return h(MenuGroupContext.Provider, { value: { labelId } }, node);
}

export type MenuGroupLabelProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function MenuGroupLabel(props: MenuGroupLabelProps): VNode {
  const { render, children, ...rest } = props;
  const group = useContext(MenuGroupContext);
  // Presentational: not focusable, no item role. Wires its id to the Group's
  // aria-labelledby.
  return renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, id: group?.labelId },
    children,
  });
}

export type MenuSeparatorProps = {
  render?: RenderProp;
} & JSX.HTMLAttributes<HTMLDivElement>;

export function MenuSeparator(props: MenuSeparatorProps): VNode {
  const { render, ...rest } = props;
  return renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'separator', 'aria-orientation': 'horizontal' },
  });
}

export {
  Arrow as MenuArrow,
  type ArrowProps as MenuArrowProps,
} from '../arrow.js';
