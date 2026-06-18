import {
  h,
  type ComponentChildren,
  type JSX,
  type Ref,
  type VNode,
} from 'preact';
import { useMemo } from 'preact/hooks';
import { renderElement, type RenderProp } from '../render-element.js';
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
import { toastStore, type ToastRecord } from './toast-store.js';
import { ToastItemContext, useToastItemContext, useToasterContext } from './context.js';
import { useToastTimer } from './use-toast-timer.js';

export type ToastRootProps = {
  toast: ToastRecord;
  render?: RenderProp<{ type: string; open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLLIElement>, 'children'>;

// Return type is intentionally inferred: h(ToastItemContext.Provider, ...) yields
// a VNode with more specific props than VNode<{}>, same pattern as OptionGroup.
export function ToastRoot(props: ToastRootProps) {
  const { toast: record, render, children, ref: userRef, ...rest } = props;

  const present = !record.dismissed;
  const { status, ref: presenceRef } = usePresence(present, {
    onExitComplete: () => toastStore.remove(record.id),
  });
  const open = status === 'open';

  const toaster = useToasterContext('Root');
  // Pausing while already dismissed prevents a redundant timeout-dismiss during
  // the exit animation.
  useToastTimer({
    id: record.id,
    duration: record.duration,
    paused: toaster.paused || record.dismissed,
    onExpire: () => toastStore.dismiss(record.id, 'timeout'),
  });

  const itemCtx = useMemo(() => ({ record }), [record]);

  const body = record.jsx ? record.jsx(record.id) : children;

  return h(
    ToastItemContext.Provider,
    { value: itemCtx },
    renderElement<{ type: string; open: boolean }>({
      render,
      defaultTag: 'li',
      props: {
        ...rest,
        ref: mergeRefs<Element>(presenceRef, userRef as Ref<Element>),
        'data-type': record.type,
        'data-state': open ? 'open' : 'closed',
      },
      state: { type: record.type, open },
      children: body,
    })
  );
}

export type ToastTitleProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ToastTitle(props: ToastTitleProps): VNode {
  const { render, children, ...rest } = props;
  const { record } = useToastItemContext('Title');
  return renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, 'data-toast-title': '' },
    children: children ?? record.title,
  });
}

export type ToastDescriptionProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ToastDescription(props: ToastDescriptionProps): VNode | null {
  const { render, children, ...rest } = props;
  const { record } = useToastItemContext('Description');
  const content = children ?? record.description;
  if (content == null) return null;
  return renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, 'data-toast-description': '' },
    children: content,
  });
}

export type ToastActionProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function ToastAction(props: ToastActionProps): VNode | null {
  const { render, children, onClick, ...rest } = props;
  const { record } = useToastItemContext('Action');
  if (!record.action) return null;
  const action = record.action;
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    action.onClick(event as MouseEvent);
    toastStore.dismiss(record.id, 'user');
  };
  return renderElement({
    render,
    defaultTag: 'button',
    props: { ...rest, type: 'button', onClick: handleClick },
    children: children ?? action.label,
  });
}

export type ToastCloseProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function ToastClose(props: ToastCloseProps): VNode {
  const { render, children, onClick, 'aria-label': ariaLabel, ...rest } = props;
  const { record } = useToastItemContext('Close');
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    toastStore.dismiss(record.id, 'user');
  };
  return renderElement({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      type: 'button',
      'aria-label': ariaLabel ?? 'Close',
      onClick: handleClick,
    },
    children: children ?? null,
  });
}
