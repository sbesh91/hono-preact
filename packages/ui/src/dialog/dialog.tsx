import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
import { DialogContext, useDialogContext } from './context.js';

export interface DialogRootProps {
  open?: boolean; // controlled
  defaultOpen?: boolean; // uncontrolled (default false)
  onOpenChange?: (open: boolean) => void;
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
  const { open: openProp, defaultOpen, onOpenChange, children } = props;
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

  // Reference-counted description presence so the Popup wires aria-describedby
  // only when a Description is actually rendered.
  const [descriptionCount, setDescriptionCount] = useState(0);
  const registerDescription = useCallback(() => {
    setDescriptionCount((c) => c + 1);
    return () => setDescriptionCount((c) => c - 1);
  }, []);

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      dialogRef,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      hasDescription: descriptionCount > 0,
      registerDescription,
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

  return useRender<{ open: boolean }>({
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
  return useRender({
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

  // Track the live open-state for the close listener. Updated during render so
  // it is already false by the time our own el.close() (in the layout effect
  // below) fires the close event, letting that listener skip the redundant
  // state sync that would otherwise fire onOpenChange(false) twice.
  const openRef = useRef(ctx.open);
  openRef.current = ctx.open;

  const presence = usePresence(ctx.open, {
    onExitComplete: () => ctx.dialogRef.current?.close(),
  });

  // Open imperatively; the close is deferred to the exit animation
  // (usePresence.onExitComplete), so the dialog stays in the top layer with
  // inert/focus-trap/::backdrop intact while it animates out.
  useLayoutEffect(() => {
    const el = ctx.dialogRef.current;
    if (!el) return;
    if (ctx.open && !el.open) el.showModal();
  }, [ctx.open]);

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

  return useRender<{ open: boolean }>({
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
  return useRender({
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

export const Dialog = {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
};
