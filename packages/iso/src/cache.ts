import type { Loader } from './define-loader.js';
import { isBrowser } from './is-browser.js';

export interface LoaderCache<T> {
  get(locKey?: string): T | null;
  set(value: T, locKey?: string): void;
  has(locKey?: string): boolean;
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

const HONO_CONTEXT_KEY = Symbol('@hono-preact/iso/honoContext');

export function getRequestStore(): RequestStore | undefined {
  return alsInstance?.getStore();
}

export function getRequestHonoContext<T = unknown>(): T | undefined {
  return getRequestStore()?.get(HONO_CONTEXT_KEY) as T | undefined;
}

export function runRequestScope<R>(
  fn: () => R | Promise<R>,
  initial?: { honoContext?: unknown }
): R | Promise<R> {
  if (!alsInstance) return fn();
  const store: RequestStore = new Map();
  if (initial?.honoContext !== undefined) {
    store.set(HONO_CONTEXT_KEY, initial.honoContext);
  }
  return alsInstance.run(store, fn);
}

type CacheEntry<T> = { value: T; locKey: string | null };

export function createCache<T>(): LoaderCache<T> {
  const key = Symbol('cache');
  let fallbackStore: CacheEntry<T> | null = null;

  function readEntry(): CacheEntry<T> | null {
    if (!isBrowser()) {
      const reqStore = getRequestStore();
      if (reqStore) {
        return (reqStore.get(key) as CacheEntry<T> | undefined) ?? null;
      }
    }
    return fallbackStore;
  }

  function writeEntry(entry: CacheEntry<T> | null): void {
    if (!isBrowser()) {
      const reqStore = getRequestStore();
      if (reqStore) {
        if (entry === null) reqStore.delete(key);
        else reqStore.set(key, entry);
        return;
      }
    }
    fallbackStore = entry;
  }

  function entryMatches(entry: CacheEntry<T>, locKey?: string): boolean {
    // A null locKey on the entry means "matches any caller locKey" (back-compat).
    return entry.locKey === null || entry.locKey === locKey;
  }

  return {
    get(locKey) {
      const entry = readEntry();
      if (entry === null || !entryMatches(entry, locKey)) return null;
      return entry.value;
    },
    set(value, locKey) {
      writeEntry({ value, locKey: locKey ?? null });
    },
    has(locKey) {
      const entry = readEntry();
      return entry !== null && entryMatches(entry, locKey);
    },
    wrap(loader) {
      // Cast to Promise<T>: Task 11 will add a runtime adapter for generators/streams.
      // wrap() writes without a locKey so existing callers remain back-compat.
      return async (props) => {
        const entry = readEntry();
        if (entry !== null) return entry.value;
        const result = await (loader(props) as Promise<T>);
        writeEntry({ value: result, locKey: null });
        return result;
      };
    },
    invalidate() {
      writeEntry(null);
    },
  };
}
