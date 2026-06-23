import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'preact/hooks';
import { renderElement, type RenderProp } from '../render-element.js';
import { useControllableState } from '../use-controllable-state.js';
import { useDescriptionRegistry } from '../use-description-registry.js';
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
import { runViewTransition } from '../view-transition.js';
import { DialogContext, useDialogContext } from './context.js';

export interface DialogRootProps {
  open?: boolean; // controlled
  defaultOpen?: boolean; // uncontrolled (default false)
  onOpenChange?: (open: boolean) => void;
  // Animate open/close with the View Transitions API: the panel morphs out of
  // the trigger and back. Replaces the data-state CSS enter/exit animation, so
  // style the panel without @starting-style / data-state=closed keyframes and
  // tune the motion through ::view-transition-group(...) instead. Falls back to
  // an instant open/close where View Transitions are unsupported.
  //
  // Pass a string to set the panel's view-transition-name explicitly (a stable,
  // CSS-targetable handle, e.g. to give ::view-transition-group(name) a z-index
  // so the panel stays above the backdrop); `true` auto-generates a unique name.
  // Default false (off).
  viewTransition?: boolean | string;
  children?: ComponentChildren;
}

export type DialogTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

// Return type is inferred: rendering a typed context Provider yields a
// VNode<ProviderProps> that does not unify with the bare `VNode` the other
// parts return. Matches the repo's provider components, which also infer.
export function DialogRoot(props: DialogRootProps) {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    viewTransition = false,
    children,
  } = props;
  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });

  const dialogRef = useRef<HTMLDialogElement>(null);
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
      viewTransition,
      dialogRef,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      hasDescription,
      registerDescription,
    }),
    [
      open,
      setOpen,
      viewTransition,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      hasDescription,
      registerDescription,
    ]
  );

  return h(DialogContext.Provider, { value: ctx }, children);
}

export function DialogTrigger(props: DialogTriggerProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const ctx = useDialogContext('Trigger');

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    ctx.setOpen(true);
  };

  return renderElement<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
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

export type DialogTitleProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLHeadingElement>, 'children'>;

export function DialogTitle(props: DialogTitleProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useDialogContext('Title');
  return renderElement({
    render,
    defaultTag: 'h2',
    props: { ...rest, id: ctx.titleId },
    children,
  });
}

export type DialogPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  'aria-label'?: string; // alternative to a Title
  closeOnBackdropClick?: boolean; // default true
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDialogElement>, 'children'>;

export function DialogPopup(props: DialogPopupProps): VNode {
  const {
    render,
    children,
    closeOnBackdropClick = true,
    'aria-label': ariaLabel,
    onClick,
    ...rest
  } = props;
  const ctx = useDialogContext('Popup');

  // The panel's view-transition-name. A string viewTransition is used verbatim
  // (a stable, CSS-targetable handle); otherwise a unique, CSS-ident-safe name
  // is derived from the popup id. Only used in viewTransition mode; the trigger
  // and the dialog take turns holding it.
  const panelName = useMemo(
    () =>
      typeof ctx.viewTransition === 'string'
        ? ctx.viewTransition
        : `hp-dialog-${ctx.popupId.replace(/[^\w-]/g, '')}`,
    [ctx.viewTransition, ctx.popupId]
  );

  // Track the live open-state for the close listener. Updated during render so
  // it is already false by the time our own el.close() (in the layout effect
  // below) fires the close event, letting that listener skip the redundant
  // state sync that would otherwise fire onOpenChange(false) twice.
  const openRef = useRef(ctx.open);
  openRef.current = ctx.open;

  const presence = usePresence(ctx.open, {
    // viewTransition mode closes inside the transition (in the effect below),
    // so the presence-driven deferred close must not also fire here.
    onExitComplete: () => {
      if (!ctx.viewTransition) ctx.dialogRef.current?.close();
    },
  });

  // Drive the native dialog's open/close imperatively.
  //
  // Legacy (CSS) mode: open immediately, and defer close() to the exit
  // animation (usePresence.onExitComplete) so the dialog stays in the top layer
  // with inert/focus-trap/::backdrop intact while it animates out.
  //
  // viewTransition mode: wrap each open/close DOM change in a View Transition so
  // the browser tweens the before/after snapshots. The trigger and the dialog
  // hand the panel's view-transition-name back and forth — the holder of the
  // name in the "before" snapshot morphs into the holder in the "after" — so the
  // panel grows out of the trigger on open and shrinks back into it on close.
  // The element not yet rendered visually (a closed <dialog> is display:none)
  // must NOT also carry the name, or the duplicate would abort the transition.
  useLayoutEffect(() => {
    const el = ctx.dialogRef.current;
    if (!el) return;

    if (!ctx.viewTransition) {
      if (ctx.open && !el.open) el.showModal();
      return;
    }

    const trigger = el.ownerDocument.getElementById(ctx.triggerId);
    const nameOnTrigger = () => {
      el.style.removeProperty('view-transition-name');
      trigger?.style.setProperty('view-transition-name', panelName);
    };
    const nameOnDialog = () => {
      trigger?.style.removeProperty('view-transition-name');
      el.style.setProperty('view-transition-name', panelName);
    };

    if (ctx.open && !el.open) {
      runViewTransition(() => {
        nameOnDialog();
        el.showModal();
      });
    } else if (!ctx.open && el.open) {
      runViewTransition(() => {
        nameOnTrigger();
        el.close();
      });
    } else if (!ctx.open && !el.open) {
      // Resting closed state (initial mount, or after the close settles): the
      // trigger carries the name so the next open can morph out of it.
      nameOnTrigger();
    }
  }, [ctx.open, ctx.viewTransition, ctx.triggerId, panelName]);

  // Native dismissal (Escape, programmatic close()) fires `close`; mirror it
  // back into open-state so the two never desync. Guard on openRef so a close
  // we initiated ourselves (state -> layout effect -> el.close()) does not
  // re-enter and double-fire onOpenChange.
  useEffect(() => {
    const el = ctx.dialogRef.current;
    if (!el) return;
    const onClose = () => {
      if (openRef.current) ctx.setOpen(false);
    };
    el.addEventListener('close', onClose);
    return () => el.removeEventListener('close', onClose);
  }, [ctx.setOpen]);

  // Esc fires `cancel` then natively closes instantly. Intercept it and route
  // through state so the close animates like every other close path.
  useEffect(() => {
    const el = ctx.dialogRef.current;
    if (!el) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      ctx.setOpen(false);
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [ctx.setOpen]);

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDialogElement>) => {
    onClick?.(event);
    // A modal <dialog> reports backdrop clicks as targeting the element itself.
    if (closeOnBackdropClick && event.target === ctx.dialogRef.current) {
      ctx.setOpen(false);
    }
  };

  return renderElement<{ open: boolean }>({
    render,
    defaultTag: 'dialog',
    props: {
      ...rest,
      ref: mergeRefs(ctx.dialogRef, presence.ref),
      id: ctx.popupId,
      'data-state': ctx.open ? 'open' : 'closed',
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabel ? undefined : ctx.titleId,
      'aria-describedby': ctx.hasDescription ? ctx.descriptionId : undefined,
      onClick: handleClick,
    },
    state: { open: ctx.open },
    children,
  });
}

export type DialogDescriptionProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLParagraphElement>, 'children'>;

export function DialogDescription(props: DialogDescriptionProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useDialogContext('Description');
  // Register presence so the Popup wires aria-describedby; deregister on
  // unmount (registerDescription returns its own cleanup).
  useLayoutEffect(() => ctx.registerDescription(), [ctx.registerDescription]);
  return renderElement({
    render,
    defaultTag: 'p',
    props: { ...rest, id: ctx.descriptionId },
    children,
  });
}

export type DialogCloseProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function DialogClose(props: DialogCloseProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const ctx = useDialogContext('Close');

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

export const Dialog = {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
};
