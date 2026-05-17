import { isBrowser } from '../is-browser.js';

/**
 * Pure read of the SSR'd preload payload for a loader. Safe to call during
 * render: no DOM mutation, no side effects. The caller is responsible for
 * scheduling `deletePreloadedData` in a useEffect after consuming the
 * value so the attribute is cleared before a future re-mount could read
 * a stale payload.
 *
 * (Previously this function deleted the attribute synchronously via a
 * `finally` block during render. That was a real DOM mutation in the
 * render phase, which Preact's reconciliation does not formally support
 * and which broke determinism if the component re-rendered before the
 * effect that consumed the value ran.)
 */
export function getPreloadedData<T>(id: string): T | null {
  if (!isBrowser()) {
    return null;
  }

  const el = document.getElementById(id);
  if (!el || !('loader' in el.dataset)) {
    return null;
  }

  try {
    return JSON.parse(el.dataset.loader ?? 'null') as T;
  } catch {
    return null;
  }
}

export function deletePreloadedData(id: string) {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }

  delete el.dataset.loader;
}
