// packages/ui/src/popover/popover.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { usePosition } from '../use-position.js';
import { useDismiss } from '../use-dismiss.js';
import { useFocusReturn } from '../use-focus-return.js';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositionState } from '../use-position.js';
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
  const arrowRef = useRef<HTMLElement>(null);

  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const popupId = `${baseId}-popup`;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const [descriptionCount, setDescriptionCount] = useState(0);
  const registerDescription = useCallback(() => {
    setDescriptionCount((c) => c + 1);
    return () => setDescriptionCount((c) => c - 1);
  }, []);

  const [position, setPosition] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      anchorRef,
      floatingRef,
      popupRef,
      arrowRef,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      hasDescription: descriptionCount > 0,
      registerDescription,
      side,
      align,
      offset,
      position,
      setPosition,
    }),
    [
      open,
      setOpen,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      descriptionCount,
      registerDescription,
      side,
      align,
      offset,
      position,
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

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': ctx.open,
      'aria-controls': ctx.popupId,
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
  return useRender({
    render,
    defaultTag: 'span',
    props: { ...rest, ref: ctx.anchorRef },
    children,
  });
}

function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
}

export type PopoverPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function PopoverPositioner(
  props: PopoverPositionerProps
): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Positioner');

  const position = usePosition({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
  });

  // Publish the resolved position so Arrow (and any consumer) can read it.
  useLayoutEffect(() => {
    ctx.setPosition(position);
  }, [position.side, position.align, position.arrowX, position.arrowY]);

  // Promote to the native top layer where supported (progressive enhancement).
  // Applied imperatively so there is no SSR/hydration attribute mismatch.
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
      // The Positioner is a framework-owned layout wrapper: style it via class
      // (z-index etc.), not the style prop, which is reserved for positioning.
      style: { position: 'fixed' },
    },
    state: { side: position.side, align: position.align },
    children,
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

  return useRender<{ open: boolean }>({
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

export type PopoverArrowProps = {
  render?: RenderProp<{ side: Side }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function PopoverArrow(props: PopoverArrowProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Arrow');
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

export type PopoverTitleProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLHeadingElement>, 'children'>;

export function PopoverTitle(props: PopoverTitleProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = usePopoverContext('Title');
  return useRender({
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
  return useRender({
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
  return useRender<{ open: boolean }>({
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
