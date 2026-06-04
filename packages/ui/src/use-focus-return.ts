// packages/ui/src/use-focus-return.ts
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface UseFocusReturnOptions {
  open: boolean;
  popupRef: RefObject<HTMLElement>;
  // Optional element to focus first; defaults to the first focusable, then the
  // popup container itself.
  initialFocusRef?: RefObject<HTMLElement>;
}

export function useFocusReturn(opts: UseFocusReturnOptions): void {
  const { open, popupRef, initialFocusRef } = opts;
  const previousRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    previousRef.current = active instanceof HTMLElement ? active : null;

    const popup = popupRef.current;
    const target =
      initialFocusRef?.current ??
      popup?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      popup;
    target?.focus();

    return () => {
      previousRef.current?.focus();
    };
  }, [open]);
}
