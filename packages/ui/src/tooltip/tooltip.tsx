// packages/ui/src/tooltip/tooltip.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { useCallback, useEffect, useId, useMemo, useRef } from 'preact/hooks';
import { renderElement, type RenderProp } from '../render-element.js';
import { useControllableState } from '../use-controllable-state.js';
import { type Side, type Align } from '../use-position.js';
import { useDismiss } from '../use-dismiss.js';
import { useSafeArea } from '../use-safe-area.js';
import { Positioner } from '../positioner.js';
import { TooltipContext, useTooltipContext } from './context.js';

export interface TooltipRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  openDelay?: number; // open delay (ms), default 600
  closeDelay?: number; // grace before close after leaving the safe corridor (ms), default 300
  side?: Side; // default 'top'
  align?: Align; // default 'center'
  offset?: number; // default 8
  children?: ComponentChildren;
}

export function TooltipRoot(props: TooltipRootProps) {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    openDelay = 600,
    closeDelay = 300,
    side = 'top',
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
  const popupId = useId();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPending = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const setOpenImmediate = useCallback(
    (next: boolean) => {
      cancelPending();
      setOpen(next);
    },
    [cancelPending, setOpen]
  );
  const scheduleOpen = useCallback(() => {
    cancelPending();
    timer.current = setTimeout(() => setOpen(true), openDelay);
  }, [cancelPending, setOpen, openDelay]);

  // Clear any pending open/close timer if the Root unmounts mid-delay, so the
  // timer cannot fire setOpen after unmount.
  useEffect(() => cancelPending, [cancelPending]);

  const ctx = useMemo(
    () => ({
      open,
      scheduleOpen,
      setOpenImmediate,
      cancelPending,
      anchorRef,
      floatingRef,
      popupId,
      side,
      align,
      offset,
      closeDelay,
    }),
    [
      open,
      scheduleOpen,
      setOpenImmediate,
      cancelPending,
      popupId,
      side,
      align,
      offset,
      closeDelay,
    ]
  );

  return h(TooltipContext.Provider, { value: ctx }, children);
}

export type TooltipTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function TooltipTrigger(props: TooltipTriggerProps): VNode {
  const {
    render,
    children,
    onPointerEnter,
    onPointerLeave,
    onFocus,
    onBlur,
    ...rest
  } = props;
  const ctx = useTooltipContext('Trigger');

  const handlePointerEnter = (
    event: JSX.TargetedPointerEvent<HTMLButtonElement>
  ) => {
    onPointerEnter?.(event);
    // Tooltips are inaccessible on touch; do not open on a touch pointer.
    if (event.pointerType === 'touch') return;
    ctx.scheduleOpen();
  };
  const handlePointerLeave = (
    event: JSX.TargetedPointerEvent<HTMLButtonElement>
  ) => {
    onPointerLeave?.(event);
    if (event.pointerType === 'touch') return;
    // Cancel a pending open if the pointer leaves before the open delay fires.
    // While open, the safe corridor (useSafeArea in Popup) governs the close.
    ctx.cancelPending();
  };
  const handleFocus = (event: JSX.TargetedFocusEvent<HTMLButtonElement>) => {
    onFocus?.(event);
    ctx.setOpenImmediate(true);
  };
  const handleBlur = (event: JSX.TargetedFocusEvent<HTMLButtonElement>) => {
    onBlur?.(event);
    ctx.setOpenImmediate(false);
  };

  return renderElement<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      type: 'button',
      'aria-describedby': ctx.open ? ctx.popupId : undefined,
      'data-state': ctx.open ? 'open' : 'closed',
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave,
      onFocus: handleFocus,
      onBlur: handleBlur,
    },
    state: { open: ctx.open },
    children,
  });
}

export type TooltipPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function TooltipPositioner(props: TooltipPositionerProps) {
  const { render, children, ...rest } = props;
  const ctx = useTooltipContext('Positioner');
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

export type TooltipPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function TooltipPopup(props: TooltipPopupProps): VNode {
  const { render, children, onPointerEnter, onPointerLeave, ...rest } = props;
  const ctx = useTooltipContext('Popup');

  // Escape closes; no outside-press for a tooltip.
  useDismiss({
    enabled: ctx.open,
    refs: [ctx.floatingRef, ctx.anchorRef],
    escape: true,
    outsidePress: false,
    onDismiss: () => ctx.setOpenImmediate(false),
  });

  // While open, keep the tooltip open while the pointer rests over the trigger,
  // the popup, or the safe corridor between them; once it leaves that region,
  // close after the grace period (re-entering cancels the close).
  useSafeArea({
    enabled: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    onClose: () => ctx.setOpenImmediate(false),
    graceMs: ctx.closeDelay,
  });

  // Hoverable (WCAG 1.4.13): moving onto the popup keeps it open. The close is
  // governed by the safe corridor (useSafeArea), not a leave timer.
  const handlePointerEnter = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>
  ) => {
    onPointerEnter?.(event);
    ctx.cancelPending();
  };
  const handlePointerLeave = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>
  ) => {
    onPointerLeave?.(event);
  };

  // No ref here: the Positioner holds floatingRef, and the dismiss layer's
  // "inside" check already covers this child Popup.
  return renderElement<{ open: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      role: 'tooltip',
      id: ctx.popupId,
      'data-state': ctx.open ? 'open' : 'closed',
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave,
    },
    state: { open: ctx.open },
    children,
  });
}

export {
  Arrow as TooltipArrow,
  type ArrowProps as TooltipArrowProps,
} from '../arrow.js';
