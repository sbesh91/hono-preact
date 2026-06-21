import type { ActionResolution } from './internal/action-envelope.js';
import { isBrowser } from './is-browser.js';

export interface LoaderCache<T> {
  get(locKey?: string): T | null;
  set(value: T, locKey?: string): void;
  has(locKey?: string): boolean;
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
const ACTION_RESULT_KEY = Symbol('@hono-preact/iso/actionResult');

export function getRequestStore(): RequestStore | undefined {
  return alsInstance?.getStore();
}

// Returns the seeded value from the active runRequestScope, or undefined when no scope
// is active (browser / happy-dom: node:async_hooks is unavailable). Throws when a scope
// IS active but was never seeded with { honoContext } (framework bug, surfaces loud).
// The `as T` is a typed Map-read, not a value cast.
export function getRequestHonoContext<T = unknown>(): T | undefined {
  const store = getRequestStore();
  if (!store) return undefined;
  const ctx = store.get(HONO_CONTEXT_KEY);
  if (ctx === undefined) {
    throw new Error(
      'runRequestScope is active but was not seeded with { honoContext }. ' +
        'The framework must pass { honoContext: c } when entering the scope.'
    );
  }
  return ctx as T;
}

export type ActionResultSlot = {
  module: string;
  action: string;
  resolution: ActionResolution;
  submittedPayload: unknown;
};

export function getActionResultSlot(): ActionResultSlot | null {
  const store = getRequestStore();
  if (!store) return null;
  const slot = store.get(ACTION_RESULT_KEY);
  return (slot ?? null) as ActionResultSlot | null;
}

export function setActionResultSlot(slot: ActionResultSlot): void {
  const store = getRequestStore();
  if (!store) {
    throw new Error(
      'setActionResultSlot must be called inside runRequestScope'
    );
  }
  store.set(ACTION_RESULT_KEY, slot);
}

export function runRequestScope<R>(
  fn: () => R | Promise<R>,
  initial?: { honoContext?: unknown }
): R | Promise<R> {
  if (!alsInstance) return fn();
  const existing = alsInstance.getStore();
  if (existing) {
    // Nested call: inherit the parent store. Seeded values are written
    // additively so the inner caller's overrides take effect without
    // wiping the parent's per-request state (e.g. the action-result
    // slot set by pageActionHandler before it invokes renderPage).
    if (initial?.honoContext !== undefined) {
      existing.set(HONO_CONTEXT_KEY, initial.honoContext);
    }
    return fn();
  }
  const store: RequestStore = new Map();
  if (initial?.honoContext !== undefined) {
    store.set(HONO_CONTEXT_KEY, initial.honoContext);
  }
  return alsInstance.run(store, fn);
}

// Capture the active request scope so work scheduled later (e.g. a
// `ReadableStream.start` callback that fires after the outer `runRequestScope`
// frame has already returned) can re-enter the same per-request store.
// Returns a binder; in a non-ALS environment, the binder runs `fn` directly.
// Generators that yield and then resume from outside the scope lose ALS
// propagation on V8; binding their drain restores it.
export function captureRequestScope(): <R>(
  fn: () => R | Promise<R>
) => R | Promise<R> {
  if (!alsInstance) return (fn) => fn();
  const store = alsInstance.getStore();
  if (!store) return (fn) => fn();
  const als = alsInstance;
  return (fn) => als.run(store, fn);
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
    invalidate() {
      writeEntry(null);
    },
  };
}
