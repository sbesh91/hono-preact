import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ToastPosition, ToastRecord } from './toast-store.js';

export interface ToasterContextValue {
  position: ToastPosition;
  gap: number;
  visibleToasts: number;
  expanded: boolean;
  paused: boolean;
  // Ordered ids of currently-rendered toasts (newest first). Used by an item to
  // find how many toasts sit in front of it.
  orderedIds: (string | number)[];
  // Measured heights keyed by id (px), populated by each Toast.Root on mount.
  heights: Map<string | number, number>;
  // Register or update a toast's measured height in px.
  registerHeight: (id: string | number, height: number) => void;
}

export const ToasterContext = createContext<ToasterContextValue | null>(null);

export function useToasterContext(part: string): ToasterContextValue {
  const ctx = useContext(ToasterContext);
  if (!ctx) {
    throw new Error(`<Toast.${part}> must be used within <Toaster>`);
  }
  return ctx;
}

export interface ToastItemContextValue {
  record: ToastRecord;
}

export const ToastItemContext = createContext<ToastItemContextValue | null>(
  null
);

export function useToastItemContext(part: string): ToastItemContextValue {
  const ctx = useContext(ToastItemContext);
  if (!ctx) {
    throw new Error(`<Toast.${part}> must be used within <Toast.Root>`);
  }
  return ctx;
}
