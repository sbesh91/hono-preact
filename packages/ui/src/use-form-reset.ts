import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * Resets a controlled field when its enclosing `<form>` is reset. On mount,
 * resolves the form via `ref.current?.closest('form')` and listens for the
 * native cancelable `reset` event; on reset (unless `defaultPrevented`) calls
 * `onReset`. `onReset` is read through a ref so a changing handler identity
 * does not resubscribe the listener. Generic over the element type so a
 * `RefObject<HTMLInputElement>` (or any `HTMLElement` ref) passes without a
 * cast.
 */
export function useFormReset<T extends HTMLElement>(
  ref: RefObject<T>,
  onReset: () => void
): void {
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const handler = (e: Event) => {
      if (!e.defaultPrevented) onResetRef.current();
    };
    form.addEventListener('reset', handler);
    return () => form.removeEventListener('reset', handler);
  }, [ref]);
}
