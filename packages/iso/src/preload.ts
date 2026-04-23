import { isBrowser } from './is-browser';

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
  } finally {
    deletePreloadedData(id);
  }
}

export function deletePreloadedData(id: string) {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }

  delete el.dataset.loader;
}
