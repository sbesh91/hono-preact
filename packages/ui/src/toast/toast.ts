import type { ComponentChildren, VNode } from 'preact';
import {
  toastStore,
  type ToastOptions,
  type ToastType,
} from './toast-store.js';

type Message = ComponentChildren;

function create(type: ToastType, message: Message, opts: ToastOptions = {}) {
  return toastStore.add({
    ...opts,
    type,
    title: message,
    important: opts.important ?? type === 'error',
  });
}

function toastFn(message: Message, opts?: ToastOptions) {
  return create('default', message, opts);
}

const toast = Object.assign(toastFn, {
  success: (message: Message, opts?: ToastOptions) =>
    create('success', message, opts),
  error: (message: Message, opts?: ToastOptions) =>
    create('error', message, opts),
  info: (message: Message, opts?: ToastOptions) =>
    create('info', message, opts),
  warning: (message: Message, opts?: ToastOptions) =>
    create('warning', message, opts),
  loading: (message: Message, opts?: ToastOptions) =>
    create('loading', message, opts),
  custom: (render: (id: string | number) => VNode, opts: ToastOptions = {}) =>
    toastStore.add({ ...opts, type: 'custom', jsx: render }),
  dismiss: (id?: string | number) => toastStore.dismiss(id, 'user'),
});

export { toast };
