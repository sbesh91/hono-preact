import type { Loader } from './loader.js';

export interface LoaderCache<T> {
  get(): T | null;
  set(value: T): void;
  has(): boolean;
  wrap(loader: Loader<T>): Loader<T>;
  invalidate(): void;
}

export function createCache<T>(): LoaderCache<T> {
  let store: T | null = null;
  return {
    get: () => store,
    set: (value) => {
      store = value;
    },
    has: () => store !== null,
    wrap(loader) {
      return async (props) => {
        if (store !== null) return store;
        const result = await loader(props);
        store = result;
        return result;
      };
    },
    invalidate() {
      store = null;
    },
  };
}
