import { isBrowser } from "./is-browser";

export function getPreloadedData<T>(id: string) {
  const defaultValue = {} as T;
  if (!isBrowser()) {
    return defaultValue;
  }

  const el = document.getElementById(id);
  if (!el) {
    return defaultValue;
  }

  try {
    return JSON.parse(el.dataset.loader ?? "{}") as T;
  } catch (error) {
    return defaultValue;
  } finally {
    delete el.dataset.loader;
  }
}
