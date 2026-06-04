import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import {
  useCallback,
  useId,
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

export function DialogRoot(props: DialogRootProps): VNode {
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
