# Imperative Loader Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a `useReload()` hook that lets developers imperatively re-run the client loader from within a page component, with a background refresh (no Suspense fallback shown during reload) and a `reloading` flag.

**Architecture:** `GuardedPage` gains `reloading` + `overrideData` state and provides a `ReloadContext`. Calling `reload()` fires `clientLoader` imperatively; on resolution `overrideData` is set and rendered by `Helper` synchronously. The initial Suspense/`wrapPromise` load path is untouched. `useReload()` is exported from `loader.tsx` and reads from the context, throwing if called outside a page.

**Tech Stack:** Preact, preact/compat (`createContext`, `useContext`, `useState`, `useCallback`), TypeScript

---

## File Map

- **Modify:** `src/iso/page.tsx` — add `ReloadContext`, reload state to `GuardedPage`, `overrideData` prop to `Helper`
- **Modify:** `src/iso/loader.tsx` — export `useReload` hook

---

### Task 1: Add `ReloadContext` to `page.tsx`

**Files:**
- Modify: `src/iso/page.tsx`

- [ ] **Step 1: Add the context definition**

Open `src/iso/page.tsx`. After the existing imports, add:

```tsx
import { createContext } from 'preact';
import { useCallback, useContext, useState } from 'preact/hooks';

type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
};

const ReloadContext = createContext<ReloadContextValue | undefined>(undefined);
```

Note: `preact/hooks` already imports `useRef` and `useId` in this file — add `useCallback`, `useContext`, and `useState` to that import instead of adding a new one. The existing import line is:

```tsx
import { useId, useRef } from 'preact/hooks';
```

Replace it with:

```tsx
import { useCallback, useContext, useId, useRef, useState } from 'preact/hooks';
```

- [ ] **Step 2: Commit**

```bash
git add src/iso/page.tsx
git commit -m "feat: add ReloadContext to page.tsx"
```

---

### Task 2: Add reload state and provider to `GuardedPage`

**Files:**
- Modify: `src/iso/page.tsx`

`GuardedPage` currently returns JSX directly. We need to:
1. Add `reloading` + `overrideData` state
2. Build a `reload` callback that fires `clientLoader` imperatively
3. Wrap the return in `ReloadContext.Provider`

- [ ] **Step 1: Add state and reload callback**

Inside `GuardedPage`, after the existing `const id = useId();` and `const { route } = useLocation();` lines, add:

```tsx
const [reloading, setReloading] = useState(false);
const [overrideData, setOverrideData] = useState<T | undefined>(undefined);

const reload = useCallback(() => {
  if (reloading) return;
  setReloading(true);
  clientLoader({ location }).then((result) => {
    setOverrideData(result);
    setReloading(false);
  });
}, [reloading, clientLoader, location]);
```

- [ ] **Step 2: Wrap the return in `ReloadContext.Provider`**

`GuardedPage` currently has two possible return paths after guard checks:

1. The guard-render fallback: `return <Fallback />;`
2. The main render (preloaded / cached / suspense paths)

Wrap **only the main render** (the three `return` statements after the guard checks) in the provider. The guard fallback (`return <Fallback />;`) should not be wrapped — guards that trigger a custom render don't need reload context.

Find this block (it's the last three return paths in `GuardedPage`):

```tsx
  const preloaded = getPreloadedData<T>(id);
  const isLoaded = Object.keys(preloaded).length > 0;

  if (isLoaded) {
    cache?.set(location.path, preloaded);
    return <Helper id={id} Child={Child} loader={{ read: () => preloaded }} />;
  }

  if (isBrowser() && cache?.has(location.path)) {
    const cached = cache.get(location.path)!;
    return <Helper id={id} Child={Child} loader={{ read: () => cached }} />;
  }

  const loaderRef = useRef(
    wrapPromise(
      isBrowser()
        ? clientLoader({ location }).then((r) => {
            cache?.set(location.path, r);
            return r;
          })
        : serverLoader({ location })
    )
  );

  return (
    <Suspense fallback={fallback ?? null}>
      <Helper id={id} Child={Child} loader={loaderRef.current} />
    </Suspense>
  );
```

Replace it with:

```tsx
  const preloaded = getPreloadedData<T>(id);
  const isLoaded = Object.keys(preloaded).length > 0;

  if (isLoaded) {
    cache?.set(location.path, preloaded);
    return (
      <ReloadContext.Provider value={{ reload, reloading }}>
        <Helper id={id} Child={Child} loader={{ read: () => preloaded }} overrideData={overrideData} />
      </ReloadContext.Provider>
    );
  }

  if (isBrowser() && cache?.has(location.path)) {
    const cached = cache.get(location.path)!;
    return (
      <ReloadContext.Provider value={{ reload, reloading }}>
        <Helper id={id} Child={Child} loader={{ read: () => cached }} overrideData={overrideData} />
      </ReloadContext.Provider>
    );
  }

  const loaderRef = useRef(
    wrapPromise(
      isBrowser()
        ? clientLoader({ location }).then((r) => {
            cache?.set(location.path, r);
            return r;
          })
        : serverLoader({ location })
    )
  );

  return (
    <ReloadContext.Provider value={{ reload, reloading }}>
      <Suspense fallback={fallback ?? null}>
        <Helper id={id} Child={Child} loader={loaderRef.current} overrideData={overrideData} />
      </Suspense>
    </ReloadContext.Provider>
  );
```

- [ ] **Step 3: Commit**

```bash
git add src/iso/page.tsx
git commit -m "feat: add reload state and ReloadContext.Provider to GuardedPage"
```

---

### Task 3: Update `Helper` to accept and use `overrideData`

**Files:**
- Modify: `src/iso/page.tsx`

`Helper` must skip `loader.read()` when `overrideData` is provided, so the component renders synchronously without re-entering Suspense.

- [ ] **Step 1: Update `HelperProps` and `Helper`**

Find the existing `HelperProps` type and `Helper` component:

```tsx
type HelperProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  loader: { read: () => T };
};
export const Helper = memo(function <T>({ id, Child, loader }: HelperProps<T>) {
  const loaderData = loader.read();
  const stringified = !isBrowser() ? JSON.stringify(loaderData) : '{}';

  return (
    <section id={id} data-page={true} data-loader={stringified}>
      <Child loaderData={loaderData} id={id} />
    </section>
  );
});
```

Replace it with:

```tsx
type HelperProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  loader: { read: () => T };
  overrideData?: T;
};
export const Helper = memo(function <T>({ id, Child, loader, overrideData }: HelperProps<T>) {
  const loaderData = overrideData !== undefined ? overrideData : loader.read();
  const stringified = !isBrowser() ? JSON.stringify(loaderData) : '{}';

  return (
    <section id={id} data-page={true} data-loader={stringified}>
      <Child loaderData={loaderData} id={id} />
    </section>
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add src/iso/page.tsx
git commit -m "feat: update Helper to accept overrideData for background reload"
```

---

### Task 4: Export `useReload` from `loader.tsx`

**Files:**
- Modify: `src/iso/loader.tsx`

`useReload` needs to import `useContext` from preact/hooks and read from `ReloadContext`, which is defined in `page.tsx`. Because `ReloadContext` is not currently exported, we need to export it.

- [ ] **Step 1: Export `ReloadContext` from `page.tsx`**

In `src/iso/page.tsx`, find:

```tsx
const ReloadContext = createContext<ReloadContextValue | undefined>(undefined);
```

Change it to:

```tsx
export const ReloadContext = createContext<ReloadContextValue | undefined>(undefined);
```

Also export the type so `loader.tsx` can use it if needed:

```tsx
export type { ReloadContextValue };
```

Add this line immediately after the `ReloadContext` line.

- [ ] **Step 2: Add `useReload` to `loader.tsx`**

Open `src/iso/loader.tsx`. Add the following import at the top:

```tsx
import { useContext } from 'preact/hooks';
import { ReloadContext } from './page.js';
```

Then add the `useReload` export after the existing `getLoaderData` export:

```tsx
export function useReload(): { reload: () => void; reloading: boolean } {
  const ctx = useContext(ReloadContext);
  if (ctx === undefined) {
    throw new Error('useReload must be called inside a component rendered by getLoaderData');
  }
  return ctx;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/iso/page.tsx src/iso/loader.tsx
git commit -m "feat: export useReload hook from loader.tsx"
```

---

### Task 5: Manual verification

**Files:** None (verification only)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Add `useReload` to an existing page**

Pick any page that uses `getLoaderData`. Import and use `useReload`:

```tsx
import { useReload } from '../../iso/loader';

// Inside the component:
const { reload, reloading } = useReload();
```

Add a button:

```tsx
<button onClick={reload} disabled={reloading}>
  {reloading ? 'Reloading...' : 'Reload'}
</button>
```

- [ ] **Step 3: Verify background refresh behavior**

1. Load the page — confirm initial data renders correctly
2. Click "Reload" — confirm the page content stays visible (no blank/suspense flash)
3. Confirm `reloading` flips to `true` while fetching (button shows "Reloading..." and is disabled)
4. Confirm the button returns to "Reload" when done and `loaderData` is updated

- [ ] **Step 4: Verify error thrown outside page context**

In a component that is NOT rendered by `getLoaderData`, call `useReload()`. Confirm the browser console shows:

```
Error: useReload must be called inside a component rendered by getLoaderData
```

- [ ] **Step 5: Verify concurrent reload guard**

Double-click the Reload button rapidly. Confirm only one fetch fires (network tab shows one request, not two).

- [ ] **Step 6: Clean up test code**

Remove the temporary button/import you added for verification.

```bash
git checkout -- <page-file-you-modified>
```
