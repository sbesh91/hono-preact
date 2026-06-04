// packages/ui/src/tooltip/tooltip.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import { usePosition, type Side, type Align, type PositionState } from '../use-position.js';
import { useDismiss } from '../use-dismiss.js';
import { TooltipContext, useTooltipContext } from './context.js';

export interface TooltipRootProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delay?: number; // open delay (ms), default 600
  closeDelay?: number; // close delay (ms), default 300
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
    delay = 600,
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
  const arrowRef = useRef<HTMLElement>(null);
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
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [cancelPending, setOpen, delay]);
  const scheduleClose = useCallback(() => {
    cancelPending();
    timer.current = setTimeout(() => setOpen(false), closeDelay);
  }, [cancelPending, setOpen, closeDelay]);

  const [position, setPosition] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  const ctx = useMemo(
    () => ({
      open,
      scheduleOpen,
      scheduleClose,
      setOpenImmediate,
      cancelPending,
      anchorRef,
      floatingRef,
      arrowRef,
      popupId,
      side,
      align,
      offset,
      position,
      setPosition,
    }),
    [
      open,
      scheduleOpen,
      scheduleClose,
      setOpenImmediate,
      cancelPending,
      popupId,
      side,
      align,
      offset,
      position,
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
    ctx.scheduleClose();
  };
  const handleFocus = (event: JSX.TargetedFocusEvent<HTMLButtonElement>) => {
    onFocus?.(event);
    ctx.setOpenImmediate(true);
  };
  const handleBlur = (event: JSX.TargetedFocusEvent<HTMLButtonElement>) => {
    onBlur?.(event);
    ctx.setOpenImmediate(false);
  };

  return useRender<{ open: boolean }>({
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

function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
}

export type TooltipPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function TooltipPositioner(
  props: TooltipPositionerProps
): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = useTooltipContext('Positioner');

  const position = usePosition({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
  });

  useLayoutEffect(() => {
    ctx.setPosition(position);
  }, [position.side, position.align, position.arrowX, position.arrowY]);

  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    // Runs when open flips true and the element has mounted (refs are assigned
    // before layout effects). Empty deps would never re-run, so showPopover
    // would never fire on a mount-on-open element.
    if (!ctx.open || !el || !supportsPopover(el)) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      el.hidePopover();
      el.removeAttribute('popover');
    };
  }, [ctx.open]);

  if (!ctx.open) return null;

  return useRender<{ side: Side; align: Align }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.floatingRef,
      'data-side': position.side,
      'data-align': position.align,
      style: { position: 'fixed' },
    },
    state: { side: position.side, align: position.align },
    children,
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

  // Hoverable (WCAG 1.4.13): moving onto the popup keeps it open; leaving it
  // re-schedules the close.
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
    ctx.scheduleClose();
  };

  // No ref here: the Positioner holds floatingRef, and the dismiss layer's
  // "inside" check already covers this child Popup.
  return useRender<{ open: boolean }>({
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

export type TooltipArrowProps = {
  render?: RenderProp<{ side: Side }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function TooltipArrow(props: TooltipArrowProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useTooltipContext('Arrow');
  const { side, arrowX, arrowY } = ctx.position;
  return useRender<{ side: Side }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.arrowRef,
      'data-side': side,
      style: {
        position: 'absolute',
        left: arrowX != null ? `${arrowX}px` : undefined,
        top: arrowY != null ? `${arrowY}px` : undefined,
      },
    },
    state: { side },
    children,
  });
}
