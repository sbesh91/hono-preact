// packages/ui/src/popover/popover.tsx
import {
  h,
  type ComponentChildren,
  type JSX,
  type RefObject,
  type VNode,
} from 'preact';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'preact/hooks';
import { useDescriptionRegistry } from '../use-description-registry.js';
import { useDismiss } from '../use-dismiss.js';
import { useFocusReturn } from '../use-focus-return.js';
import { renderElement, type RenderProp } from '../render-element.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositioningProps } from '../use-position.js';
import { Positioner } from '../positioner.js';
import { runViewTransition } from '../view-transition.js';
import { PopoverContext, usePopoverContext } from './context.js';

// How many microtask polls to wait for floating-ui to place the popup before
// capturing the View Transition's "after" snapshot. Placement resolves within a
// few microtasks (render -> position effect -> computePosition promise); this is
// only a runaway cap, so it is generous and cheap to exhaust.
const MAX_PLACEMENT_TICKS = 1000;

// Resolve once the just-opened popup is mounted and floating-ui has written its
// position (style.left), or after a tick cap so the transition never hangs. The
// popup is mount-on-open and positioned asynchronously, so the open transition
// awaits this before snapshotting, otherwise the panel would be captured at its
// pre-positioned origin.
//
// Polls on MICROTASKS, not requestAnimationFrame: this runs inside the
// startViewTransition update callback, during which the browser suppresses
// rendering (so rAF callbacks never fire and an rAF poll would hang until the
// transition times out). Microtasks keep running, and the mount, the position
// effect, and computePosition's promise all settle on microtasks, so a
// microtask poll observes the placement and lets the transition proceed.
function waitForPlacement(
  ref: RefObject<HTMLElement>
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let ticks = 0;
    const step = () => {
      const el = ref.current;
      if ((el && el.style.left !== '') || ticks >= MAX_PLACEMENT_TICKS) {
        resolve(el);
        return;
      }
      ticks++;
      queueMicrotask(step);
    };
    queueMicrotask(step);
  });
}

// hidePopover() throws if the element is not currently in the top layer; the
// goal state (not shown) is met either way, so swallow it.
function hidePopoverSafely(el: HTMLElement | null): void {
  if (!el) return;
  try {
    el.hidePopover();
  } catch {
    // already hidden / disconnected
  }
}

export interface PopoverRootProps extends PositioningProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Animate open/close with the View Transitions API: the popup morphs out of
  // the trigger and back, instead of the data-state CSS enter/exit. Pass a
  // string to set the popup's view-transition-name (a CSS-targetable handle,
  // e.g. for ::view-transition-group(...) z-index); `true` auto-generates one.
  // Falls back to an instant open/close where unsupported. Default false.
  viewTransition?: boolean | string;
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
    viewTransition = false,
    children,
  } = props;

  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });
  const openRef = useRef(open);
  openRef.current = open;

  const anchorRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLElement>(null);

  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const popupId = `${baseId}-popup`;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  // The popup's view-transition-name: a provided string verbatim (a stable,
  // CSS-targetable handle), else a unique name derived from the base id.
  const panelName = useMemo(
    () =>
      typeof viewTransition === 'string'
        ? viewTransition
        : `hp-popover-${baseId.replace(/[^\w-]/g, '')}`,
    [viewTransition, baseId]
  );

  // viewTransition mode: route every open/close through a View Transition that
  // hands `panelName` between the trigger (anchor) and the popup, so the popup
  // morphs out of (and back into) the trigger. Opening waits for floating-ui to
  // place the mounted popup before the "after" snapshot; closing hides it from
  // the top layer immediately so the exit morph plays now rather than after
  // usePresence's exit delay (the later unmount is then invisible).
  const setOpenViewTransition = useCallback(
    (next: boolean) => {
      if (next === openRef.current) return;
      if (next) {
        runViewTransition(async () => {
          setOpen(true);
          const popup = await waitForPlacement(floatingRef);
          anchorRef.current?.style.removeProperty('view-transition-name');
          popup?.style.setProperty('view-transition-name', panelName);
        });
      } else {
        runViewTransition(() => {
          const popup = floatingRef.current;
          popup?.style.removeProperty('view-transition-name');
          anchorRef.current?.style.setProperty(
            'view-transition-name',
            panelName
          );
          hidePopoverSafely(popup);
          setOpen(false);
        });
      }
    },
    [setOpen, panelName]
  );

  const effectiveSetOpen = viewTransition ? setOpenViewTransition : setOpen;

  // Resting state: while closed in viewTransition mode the trigger carries the
  // name so the next open can morph out of it. While open the popup holds it
  // (set by the open transition above), so leave it alone.
  useLayoutEffect(() => {
    if (!viewTransition || open) return;
    anchorRef.current?.style.setProperty('view-transition-name', panelName);
  }, [viewTransition, open, panelName]);

  const { hasDescription, registerDescription } = useDescriptionRegistry();

  const ctx = useMemo(
    () => ({
      open,
      setOpen: effectiveSetOpen,
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
      effectiveSetOpen,
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
