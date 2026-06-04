// packages/ui/src/tooltip/tooltip.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { useCallback, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositionState } from '../use-position.js';
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
