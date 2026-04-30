import type { Loader } from './define-loader.js';
import { cacheRegistry } from './cache-registry.js';
import { isBrowser } from './is-browser.js';

export interface LoaderCache<T> {
  get(): T | null;
  set(value: T): void;
  has(): boolean;
  wrap(loader: Loader<T>): Loader<T>;
  invalidate(): void;
}

type RequestStore = Map<symbol, unknown>;

type ALSInstance = {
  getStore(): RequestStore | undefined;
  run<R>(store: RequestStore, fn: () => R): R;
};

// AsyncLocalStorage powers per-request isolation on the server. Available on
// Node and on Cloudflare Workers with `nodejs_compat`. We skip the import in
// a browser-like environment so client bundles don't try to resolve
// `node:async_hooks`.
let alsInstance: ALSInstance | null = null;
const looksLikeBrowser =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { window?: unknown }).window !== 'undefined' &&
  typeof (globalThis as { document?: unknown }).document !== 'undefined';
if (!looksLikeBrowser) {
  try {
    const moduleName = 'node:async_hooks';
    const mod = (await import(/* @vite-ignore */ moduleName)) as {
      AsyncLocalStorage: new () => ALSInstance;
    };
    alsInstance = new mod.AsyncLocalStorage();
  } catch {
    alsInstance = null;
  }
}

function getRequestStore(): RequestStore | undefined {
  return alsInstance?.getStore();
}

export function runRequestScope<R>(fn: () => R | Promise<R>): R | Promise<R> {
  if (!alsInstance) return fn();
  return alsInstance.run(new Map(), fn);
}

export function createCache<T>(name?: string): LoaderCache<T> {
  const key = Symbol(name ?? 'cache');
  let fallbackStore: T | null = null;

  function read(): T | null {
    if (!isBrowser()) {
      const reqStore = getRequestStore();
      if (reqStore) {
        return (reqStore.get(key) as T | undefined) ?? null;
      }
    }
    return fallbackStore;
  }

  function write(value: T | null): void {
    if (!isBrowser()) {
      const reqStore = getRequestStore();
      if (reqStore) {
        if (value === null) reqStore.delete(key);
        else reqStore.set(key, value);
        return;
      }
    }
    fallbackStore = value;
  }

  const cache: LoaderCache<T> = {
    get: () => read(),
    set: (value) => write(value),
    has: () => read() !== null,
    wrap(loader) {
      return async (props) => {
        const existing = read();
        if (existing !== null) return existing;
        const result = await loader(props);
        write(result);
        return result;
      };
    },
    invalidate() {
      write(null);
    },
  };
  if (name) {
    cacheRegistry.register(name, () => {
      write(null);
    });
  }
  return cache;
}
