import type { ComponentChildren, VNode } from 'preact';
import {
  toastStore,
  DEFAULT_DURATION,
  type ToastOptions,
  type ToastType,
} from './toast-store.js';

type Message = ComponentChildren;

// A message that may be static or computed from a value:
type LazyMessage<T> = ComponentChildren | ((value: T) => ComponentChildren);

interface PromiseMessages<T> {
  loading: ComponentChildren;
  success: LazyMessage<T>;
  error: LazyMessage<unknown>;
}

function resolveMessage<T>(m: LazyMessage<T>, value: T): ComponentChildren {
  return typeof m === 'function'
    ? (m as (value: T) => ComponentChildren)(value)
    : m;
}

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
  promise: <T>(promise: Promise<T>, msgs: PromiseMessages<T>) => {
    const id = toastStore.add({
      type: 'loading',
      title: msgs.loading,
      duration: Infinity,
    });
    promise.then(
      (value) =>
        toastStore.update(id, {
          type: 'success',
          title: resolveMessage(msgs.success, value),
          important: false,
          duration: DEFAULT_DURATION,
        }),
      (error: unknown) =>
        toastStore.update(id, {
          type: 'error',
          title: resolveMessage(msgs.error, error),
          important: true,
          duration: DEFAULT_DURATION,
        })
    );
    return id;
  },
});

export { toast };
