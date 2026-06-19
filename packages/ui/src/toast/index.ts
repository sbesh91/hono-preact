export { toast } from './toast.js';
export { Toaster, type ToasterProps } from './toaster.js';
export {
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
  type ToastRootProps,
  type ToastTitleProps,
  type ToastDescriptionProps,
  type ToastActionProps,
  type ToastCloseProps,
} from './toast-parts.js';
export {
  type ToastRecord,
  type ToastOptions,
  type ToastType,
  type ToastPosition,
  type ToastAction as ToastActionData,
} from './toast-store.js';

import {
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
} from './toast-parts.js';

export const Toast = {
  Root: ToastRoot,
  Title: ToastTitle,
  Description: ToastDescription,
  Action: ToastAction,
  Close: ToastClose,
};
