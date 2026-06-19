import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';

/**
 * Default delay (ms) before a loader's fallback mounts on a client navigation.
 * On a fast connection the data usually lands within this window, so the
 * fallback never paints and the user sees no flicker. Override per loader with
 * `defineLoader(fn, { fallbackDelay })`.
 */
export const DEFAULT_FALLBACK_DELAY_MS = 100;

/**
 * Wraps a Suspense `fallback` so it only mounts after `delay` ms. Suspense
 * mounts this component only while suspended and unmounts it on resolve, so a
 * response that arrives before `delay` unmounts us before the timer fires and
 * the fallback never appears.
 *
 * The delay applies in the browser only. On the server (`!isBrowser()`) and
 * when `delay <= 0`, the fallback renders immediately, so SSR and hydration
 * output is unchanged and `fallbackDelay: 0` is a clean per-loader opt-out.
 */
export function DelayedFallback({
  delay,
  children,
}: {
  delay: number;
  children: ComponentChildren;
}) {
  const immediate = !isBrowser() || delay <= 0;
  const [show, setShow] = useState(immediate);
  useEffect(() => {
    if (immediate) return;
    const timer = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(timer);
  }, [delay, immediate]);
  return show ? <>{children}</> : null;
}
