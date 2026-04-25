# Cross-Page Cache Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `useAction` and `<Form>` to invalidate named caches on other pages via `invalidate: string[]`, so mutations on one page can mark other pages' data as stale.

**Architecture:** A module-level `cacheRegistry` singleton maps string names to `() => void` invalidate functions. `createCache(name?)` optionally registers with the registry. `useAction` and `Form` detect `string[]` invalidate and call `cacheRegistry.invalidate(name)` for each entry after a successful mutation.

**Tech Stack:** TypeScript, `@hono-preact/iso`, vitest

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `packages/iso/src/cache-registry.ts` | **Create** | Module-level singleton registry |
| `packages/iso/src/cache.ts` | **Modify** | Accept optional `name` param; register on creation |
| `packages/iso/src/action.ts` | **Modify** | `invalidate?: 'auto' \| false \| string[]`; call registry on string[] |
| `packages/iso/src/form.tsx` | **Modify** | Same `invalidate` handling |
| `packages/iso/src/index.ts` | **Modify** | Export `cacheRegistry` |
| `packages/iso/src/__tests__/cache-registry.test.ts` | **Create** | Unit tests for registry |
| `packages/iso/src/__tests__/cache.test.ts` | **Modify** | Add named-cache registration test |
| `apps/app/src/pages/movies.tsx` | **Modify** | Demo named cache |

---

### Task 1: Create `cache-registry.ts`

**Files:**
- Create: `packages/iso/src/cache-registry.ts`
- Create: `packages/iso/src/__tests__/cache-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/iso/src/__tests__/cache-registry.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cacheRegistry } from '../cache-registry.js';

beforeEach(() => {
  cacheRegistry.clear();
});

describe('cacheRegistry', () => {
  it('calls the registered invalidate function by name', () => {
    const fn = vi.fn();
    cacheRegistry.register('movies', fn);
    cacheRegistry.invalidate('movies');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('does nothing when invalidating an unregistered name', () => {
    expect(() => cacheRegistry.invalidate('unknown')).not.toThrow();
  });

  it('re-registering the same name replaces the previous function', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    cacheRegistry.register('movies', fn1);
    cacheRegistry.register('movies', fn2);
    cacheRegistry.invalidate('movies');
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it('clear() removes all registered entries', () => {
    const fn = vi.fn();
    cacheRegistry.register('movies', fn);
    cacheRegistry.clear();
    cacheRegistry.invalidate('movies');
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vitest run packages/iso/src/__tests__/cache-registry.test.ts
```

Expected: FAIL — `Cannot find module '../cache-registry.js'`

- [ ] **Step 3: Create the registry**

```ts
// packages/iso/src/cache-registry.ts
const registry = new Map<string, () => void>();

export const cacheRegistry = {
  register(name: string, invalidateFn: () => void): void {
    registry.set(name, invalidateFn);
  },
  invalidate(name: string): void {
    registry.get(name)?.();
  },
  clear(): void {
    registry.clear();
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
vitest run packages/iso/src/__tests__/cache-registry.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/cache-registry.ts packages/iso/src/__tests__/cache-registry.test.ts
git commit -m "feat(iso): add cacheRegistry for cross-page cache invalidation"
```

---

### Task 2: Named cache registration in `createCache`

**Files:**
- Modify: `packages/iso/src/cache.ts`
- Modify: `packages/iso/src/__tests__/cache.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/iso/src/__tests__/cache.test.ts`:

```ts
import { beforeEach } from 'vitest';
import { cacheRegistry } from '../cache-registry.js';

// Add to the top of the file, after existing imports:
beforeEach(() => {
  cacheRegistry.clear();
});

// Add this new test inside describe('createCache'):
it('registers with cacheRegistry when a name is provided', () => {
  const cache = createCache<{ val: number }>('test-cache');
  cache.set({ val: 42 });
  expect(cache.get()).toEqual({ val: 42 });
  cacheRegistry.invalidate('test-cache');
  expect(cache.get()).toBeNull();
});

it('does not register when no name is provided', () => {
  const fn = vi.fn();
  cacheRegistry.register('no-name', fn);
  createCache<{ val: number }>();
  // registry unchanged — creating an unnamed cache doesn't affect 'no-name'
  cacheRegistry.invalidate('no-name');
  expect(fn).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
vitest run packages/iso/src/__tests__/cache.test.ts
```

Expected: FAIL — `createCache` doesn't accept a name argument yet

- [ ] **Step 3: Modify `createCache` to accept a name**

```ts
// packages/iso/src/cache.ts
import type { Loader } from './loader.js';
import { cacheRegistry } from './cache-registry.js';

export interface LoaderCache<T> {
  get(): T | null;
  set(value: T): void;
  has(): boolean;
  wrap(loader: Loader<T>): Loader<T>;
  invalidate(): void;
}

export function createCache<T>(name?: string): LoaderCache<T> {
  let store: T | null = null;
  const cache: LoaderCache<T> = {
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
  if (name) {
    cacheRegistry.register(name, () => {
      store = null;
    });
  }
  return cache;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
vitest run packages/iso/src/__tests__/cache.test.ts
```

Expected: PASS (all existing + 2 new tests)

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/cache.ts packages/iso/src/__tests__/cache.test.ts
git commit -m "feat(iso): createCache accepts optional name to register with cacheRegistry"
```

---

### Task 3: `useAction` — handle `invalidate: string[]`

**Files:**
- Modify: `packages/iso/src/action.ts`

- [ ] **Step 1: Update `UseActionOptions` type and import registry**

Replace the `invalidate` field type and import `cacheRegistry` in `packages/iso/src/action.ts`:

```ts
// At top of file, add:
import { cacheRegistry } from './cache-registry.js';

// Change UseActionOptions.invalidate from:
//   invalidate?: 'auto' | false;
// to:
export type UseActionOptions<TPayload, TResult> = {
  invalidate?: 'auto' | false | string[];
  onMutate?: (payload: TPayload) => unknown;
  onError?: (err: Error, snapshot: unknown) => void;
  onSuccess?: (data: TResult) => void;
};
```

- [ ] **Step 2: Update the mutate callback — invalidation block**

Inside `useAction`'s `mutate` callback, replace:

```ts
if (currentOptions?.invalidate === 'auto') {
  reloadCtx?.reload();
}
```

with:

```ts
if (currentOptions?.invalidate === 'auto') {
  reloadCtx?.reload();
} else if (Array.isArray(currentOptions?.invalidate)) {
  for (const name of currentOptions.invalidate) {
    cacheRegistry.invalidate(name);
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @hono-preact/iso build
```

Expected: exit 0, no type errors

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/action.ts
git commit -m "feat(iso): useAction supports invalidate: string[] for cross-page cache invalidation"
```

---

### Task 4: `Form` — handle `invalidate: string[]`

**Files:**
- Modify: `packages/iso/src/form.tsx`

- [ ] **Step 1: Import `cacheRegistry` and update the invalidation block**

At top of `packages/iso/src/form.tsx`, add:

```ts
import { cacheRegistry } from './cache-registry.js';
```

Replace the existing invalidation block inside `.then(async (response) => { ... })`:

```ts
// Replace:
if (invalidate === 'auto') {
  reloadCtx?.reload();
}

// With:
if (invalidate === 'auto') {
  reloadCtx?.reload();
} else if (Array.isArray(invalidate)) {
  for (const name of invalidate) {
    cacheRegistry.invalidate(name);
  }
}
```

The `FormProps` type inherits `invalidate` from `UseActionOptions<TPayload, TResult>`, which was updated in Task 3, so no type change is needed here.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @hono-preact/iso build
```

Expected: exit 0, no type errors

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/form.tsx
git commit -m "feat(iso): Form supports invalidate: string[] for cross-page cache invalidation"
```

---

### Task 5: Export `cacheRegistry` from `@hono-preact/iso`

**Files:**
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Add export**

Add to `packages/iso/src/index.ts`:

```ts
export { cacheRegistry } from './cache-registry.js';
```

- [ ] **Step 2: Verify build**

```bash
pnpm --filter @hono-preact/iso build
```

Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/index.ts
git commit -m "feat(iso): export cacheRegistry"
```

---

### Task 6: Update example app to use named cache

**Files:**
- Modify: `apps/app/src/pages/movies.tsx`

- [ ] **Step 1: Name the cache so it can be invalidated from other pages**

In `apps/app/src/pages/movies.tsx`, change:

```ts
// From:
const cache = createCache<{ movies: MoviesData }>();

// To:
const cache = createCache<{ movies: MoviesData }>('movies');
```

- [ ] **Step 2: Verify the app builds**

```bash
pnpm build
```

Expected: exit 0

- [ ] **Step 3: Run the full test suite**

```bash
vitest run
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/pages/movies.tsx
git commit -m "feat(app): name movies cache for cross-page invalidation"
```
