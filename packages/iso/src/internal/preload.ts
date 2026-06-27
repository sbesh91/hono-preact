import { isBrowser } from '../is-browser.js';
import type { SyncValue } from '../loader-state.js';

/**
 * Pure read of the SSR'd preload payload for a loader. Safe to call during
 * render: no DOM mutation, no side effects. The caller is responsible for
 * scheduling `deletePreloadedData` in a useEffect after consuming the
 * value so the attribute is cleared before a future re-mount could read
 * a stale payload.
 *
 * Returns a present/absent discriminant rather than `T | null`: a baked value of
 * `null` (a loader that legitimately SSR'd `null`/`undefined`) is `{ present:
 * true, value: null }`, distinct from the absent case `{ present: false }`. The
 * old `T | null` return collapsed the two, so a baked `null` was mistaken for
 * "no preload" and the client refetched (skeleton flash on hydration).
 *
 * (Previously this function deleted the attribute synchronously via a
 * `finally` block during render. That was a real DOM mutation in the
 * render phase, which Preact's reconciliation does not formally support
 * and which broke determinism if the component re-rendered before the
 * effect that consumed the value ran.)
 */
export function getPreloadedData<T>(id: string): SyncValue<T> {
  if (!isBrowser()) {
    return { present: false };
  }

  const el = document.getElementById(id);
  if (!el || !('loader' in el.dataset)) {
    return { present: false };
  }

  try {
    // Untrusted SSR payload: parsing JSON is the sanctioned cast boundary.
    return {
      present: true,
      value: JSON.parse(el.dataset.loader ?? 'null') as T,
    };
  } catch {
    return { present: false };
  }
}

export function deletePreloadedData(id: string) {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }

  delete el.dataset.loader;
}
