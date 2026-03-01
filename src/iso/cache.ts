import type { LocationHook } from 'preact-iso';
import type { Loader } from './loader.js';

type KeyFn = (location: LocationHook) => string;

export interface LoaderCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  wrap(loader: Loader<T>, keyFn?: KeyFn | string): Loader<T>;
  invalidate(key?: string): void;
}

export function createCache<T>(): LoaderCache<T> {
  const store = new Map<string, T>();
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    has: (key) => store.has(key),
    wrap(loader, keyFn = ({ path }) => path) {
      return async (props) => {
        const key = typeof keyFn === 'string' ? keyFn : keyFn(props.location);
        if (store.has(key)) return store.get(key)!;
        const result = await loader(props);
        store.set(key, result);
        return result;
      };
    },
    invalidate(key) {
      if (key !== undefined) store.delete(key);
      else store.clear();
    },
  };
}
