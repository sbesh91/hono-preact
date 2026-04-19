# Imperative Loader Reload Design

**Date:** 2026-04-17  
**Status:** Approved

## Overview

Expose a `useReload()` hook that lets developers imperatively re-run the client loader from within a page component — for example, after adding a record to a table. The reload is a background refresh: current content stays visible while new data is fetched, and a `reloading` flag is exposed for the developer to reflect loading state in the UI.

Cache invalidation is the developer's responsibility — `reload()` only re-runs the loader.

## Architecture

The solution is entirely additive to the existing Suspense-based loader path. The initial load flow (`wrapPromise` → Suspense → `Helper`) is unchanged. Reload is a separate state path layered on top of `GuardedPage`.

### Data Flow

1. `GuardedPage` gains two local state values: `reloading: boolean` (initially `false`) and `overrideData: T | undefined` (initially `undefined`).
2. On initial render, these are unset and the component behaves exactly as today.
3. When `reload()` is called:
   - `reloading` flips to `true`
   - `clientLoader({ location })` is called directly (no Suspense wrapping)
   - If `reloading` is already `true`, the call is a no-op (concurrent reloads are ignored)
   - On resolution, `overrideData` is set to the result and `reloading` flips to `false`
4. `Helper` renders with `overrideData` when set, bypassing `loader.read()` entirely.

### Context

A `ReloadContext` is created in `page.tsx` and provided by `GuardedPage`. It holds:

```ts
type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
};
```

`GuardedPage` constructs the `reload` callback with a stable reference (`useCallback`) and provides both values via context.

### Hook

`useReload` is exported from `loader.tsx` alongside `getLoaderData`:

```ts
export function useReload(): { reload: () => void; reloading: boolean }
```

It reads from `ReloadContext` and throws a descriptive error if called outside a page context (i.e., context value is `undefined`).

### `Helper` Changes

`Helper` gains an optional `overrideData?: T` prop. When set, it skips `loader.read()` and uses `overrideData` directly:

```ts
const loaderData = overrideData !== undefined ? overrideData : loader.read();
```

Because `overrideData` is synchronous state, `Helper` renders without entering Suspense — current content stays visible throughout the reload.

## API

```tsx
import { useReload } from '../iso/loader';

export function MyPage({ loaderData }) {
  const { reload, reloading } = useReload();

  const handleAdd = async () => {
    await addRecord(...);
    cache.invalidate('/my-path'); // developer's responsibility
    reload();
  };

  return <button disabled={reloading}>Add Record</button>;
}
```

## Files Changed

- `src/iso/page.tsx` — add `ReloadContext`, `reloading`/`overrideData` state to `GuardedPage`, update `Helper` to accept `overrideData`
- `src/iso/loader.tsx` — export `useReload` hook

## Out of Scope

- Automatic cache invalidation on reload
- Server-side reload (client-only)
- Reload from outside the component tree
- `reloadKey`/remount-based approach (would reset guard state and show Suspense fallback)
