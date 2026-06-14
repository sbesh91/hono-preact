// packages/ui/src/popover/popover.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { useId, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { useDescriptionRegistry } from '../use-description-registry.js';
import { useDismiss } from '../use-dismiss.js';
import { useFocusReturn } from '../use-focus-return.js';
import { renderElement, type RenderProp } from '../render-element.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align } from '../use-position.js';
import { Positioner } from '../positioner.js';
import { PopoverContext, usePopoverContext } from './context.js';

export interface PopoverRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side; // default 'bottom'
  align?: Align; // default 'center'
  offset?: number; // default 8
  children?: ComponentChildren;
}

export function PopoverRoot(props: PopoverRootProps) {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    side = 'bottom',
    align = 'center',
    offset = 8,
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

  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const popupId = `${baseId}-popup`;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const { hasDescription, registerDescription } = useDescriptionRegistry();

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      anchorRef,
      floatingRef,
      popupRef,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      hasDescription,
      registerDescription,
      side,
      align,
      offset,
    }),
    [
      open,
      setOpen,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      hasDescription,
      registerDescription,
      side,
      align,
      offset,
    ]
  );

  return h(PopoverContext.Provider, { value: ctx }, children);
}

export type PopoverTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function PopoverTrigger(props: PopoverTriggerProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const ctx = usePopoverContext('Trigger');

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    ctx.setOpen(!ctx.open);
  };

  return renderElement<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': ctx.open,
      // The popup is mount-on-open, so only reference it while it exists;
      // a dangling aria-controls points at no element when closed.
      'aria-controls': ctx.open ? ctx.popupId : undefined,
      id: ctx.triggerId,
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: handleClick,
    },
    state: { open: ctx.open },
    children,
  });
}

export type PopoverAnchorProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLSpanElement>, 'children'>;

// Optional: positions the popover relative to this element instead of the
// Trigger. Sets the shared anchorRef, overriding the Trigger's ref (last write
// wins; render Anchor when you want a non-trigger anchor).
export function PopoverAnchor(props: PopoverAnchorProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Anchor');
  return renderElement({
    render,
    defaultTag: 'span',
    props: { ...rest, ref: ctx.anchorRef },
    children,
  });
}

export type PopoverPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function PopoverPositioner(props: PopoverPositionerProps) {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Positioner');
  return h(Positioner, {
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    mount: 'unmount',
    render,
    children,
    ...rest,
  });
}

export type PopoverPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  'aria-label'?: string; // alternative to a Title
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function PopoverPopup(props: PopoverPopupProps): VNode {
  const { render, children, 'aria-label': ariaLabel, ...rest } = props;
  const ctx = usePopoverContext('Popup');

  useDismiss({
    enabled: ctx.open,
    refs: [ctx.floatingRef, ctx.anchorRef],
    onDismiss: () => ctx.setOpen(false),
  });

  useFocusReturn({ open: ctx.open, popupRef: ctx.popupRef });

  return renderElement<{ open: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.popupRef,
      role: 'dialog',
      id: ctx.popupId,
      tabIndex: -1,
      'data-state': ctx.open ? 'open' : 'closed',
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabel ? undefined : ctx.titleId,
      'aria-describedby': ctx.hasDescription ? ctx.descriptionId : undefined,
    },
    state: { open: ctx.open },
    children,
  });
}

export {
  Arrow as PopoverArrow,
  type ArrowProps as PopoverArrowProps,
} from '../arrow.js';

export type PopoverTitleProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLHeadingElement>, 'children'>;

export function PopoverTitle(props: PopoverTitleProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Title');
  return renderElement({
    render,
    defaultTag: 'h2',
    props: { ...rest, id: ctx.titleId },
    children,
  });
}

export type PopoverDescriptionProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLParagraphElement>, 'children'>;

export function PopoverDescription(props: PopoverDescriptionProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Description');
  useLayoutEffect(() => ctx.registerDescription(), [ctx.registerDescription]);
  return renderElement({
    render,
    defaultTag: 'p',
    props: { ...rest, id: ctx.descriptionId },
    children,
  });
}

export type PopoverCloseProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function PopoverClose(props: PopoverCloseProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const ctx = usePopoverContext('Close');
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    ctx.setOpen(false);
  };
  return renderElement<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      type: 'button',
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: handleClick,
    },
    state: { open: ctx.open },
    children,
  });
}
