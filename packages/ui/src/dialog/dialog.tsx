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

  // Drive the native element from open-state. showModal/close live in a
  // layout effect (client only), so the server never touches the DOM.
  useLayoutEffect(() => {
    const el = ctx.dialogRef.current;
    if (!el) return;
    if (ctx.open && !el.open) el.showModal();
    else if (!ctx.open && el.open) el.close();
  }, [ctx.open]);

  // Native dismissal (Escape, programmatic close()) fires `close`; mirror it
  // back into open-state so the two never desync.
  useEffect(() => {
    const el = ctx.dialogRef.current;
    if (!el) return;
    const onClose = () => ctx.setOpen(false);
    el.addEventListener('close', onClose);
    return () => el.removeEventListener('close', onClose);
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
      ref: ctx.dialogRef,
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
