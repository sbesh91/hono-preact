# Unified Loader Design

**Date:** 2026-04-24  
**Status:** Approved

## Problem

Pages currently require two loader functions: `serverLoader` (runs on the server during SSR) and `clientLoader` (runs in the browser during navigation). Users must write both, keep their return types in sync, and wire up `cache.wrap` manually on the client side. The separation is boilerplate — the client loader almost always fetches the same data as the server loader through an HTTP API.

## Goal

Eliminate `clientLoader`. A single `serverLoader` default export in `.server.ts` serves all three load cases: SSR, hydration, and client-side navigation. Navigation fetches go through a new `/__loaders` RPC endpoint, symmetric to the existing `/__actions` system.

## Data Flow

Three load cases — only case 3 changes:

1. **SSR**: `serverLoader` runs directly on the server. Its result is JSON-serialized into the `data-loader` attribute on the wrapper element. No change.
2. **Hydration (first load)**: Client reads `data-loader` from the DOM. No fetch fires. No change.
3. **Navigation** *(new)*: Browser calls the RPC stub — which POSTs `{ module, location }` to `/__loaders`. The server dispatches to the real `serverLoader` and returns JSON. Cache is checked before the RPC fires; on success the result is written to cache.

The Vite `serverOnlyPlugin` controls what the default export *is* in the browser build. `page.tsx` always calls `serverLoader` — it gets the right thing for the environment without any `isBrowser()` branching on the loader.

## Components

### 1. Vite Plugin — `serverOnlyPlugin`

**File:** `packages/vite/src/server-only.ts`

The stub for the default export changes from a dead no-op to a real fetch function. The module name is derived from the filename (strip path prefix and `.server.*` extension) — same logic already used in `actionsHandler`.

**Old stub:**
```ts
const serverLoader = async () => ({});
```

**New stub:**
```ts
const serverLoader = async ({ location }) => {
  const res = await fetch('/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: 'movies',
      location: { path: location.path, pathParams: location.pathParams, query: location.query },
    }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error ?? `Loader failed with status ${res.status}`);
  }
  return res.json();
};
```

`serverGuards` and `serverActions` stubs are unchanged.

### 2. New Server Middleware — `loadersHandler`

**File:** `packages/server/src/loaders-handler.ts`  
**Export:** added to `packages/server/src/index.ts`

Mirrors `actionsHandler`. Accepts a lazy or eager `import.meta.glob` result, builds a map of module name → default export (the serverLoader function), and dispatches POST requests.

```ts
export function loadersHandler(glob: LazyGlob | EagerGlob): MiddlewareHandler {
  let loadersMapPromise: Promise<Record<string, Loader<unknown>>> | null = null;

  return async (c) => {
    // build map lazily, same pattern as actionsHandler

    let body: { module: unknown; location: unknown };
    try { body = await c.req.json(); }
    catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const { module, location } = body;
    if (typeof module !== 'string') {
      return c.json({ error: 'Request body must include string field: module' }, 400);
    }

    const loader = loadersMap[module];
    if (!loader) return c.json({ error: `Module '${module}' not found` }, 404);

    try {
      const result = await loader({ location: location as RouteHook });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  };
}
```

The `location` object received from the client has `path`, `pathParams`, and `query` — the subset of `RouteHook` that `serverLoader` functions use. The existing `Loader<T>` type signature is compatible.

**Registration (user-facing):**
```ts
app
  .post('/__loaders', loadersHandler(import.meta.glob('./pages/*.server.ts')))
  .post('/__actions', actionsHandler(import.meta.glob('./pages/*.server.ts')))
  .use(location)
  .get('*', (c) => renderPage(c, <Layout context={c} />, { defaultTitle: 'my-app' }));
```

### 3. `loader.tsx` — Remove `clientLoader`

**File:** `packages/iso/src/loader.tsx`

Remove `clientLoader` from `LoaderProps` and from the `getLoaderData` options parameter. `serverGuards` and `clientGuards` are unchanged.

```ts
interface LoaderProps<T> {
  serverLoader?: Loader<T>;
  // clientLoader removed
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
  fallback?: JSX.Element;
  Wrapper?: FunctionComponent<WrapperProps>;
}
```

### 4. `page.tsx` — Unified Loader Call

**File:** `packages/iso/src/page.tsx`

Remove `clientLoader` from `PageProps` and `GuardedPageProps`. Remove the `clientLoader = serverLoader` default parameter. Replace the `isBrowser()` branch in the loader call:

**Old:**
```ts
const loaderRef = wrapPromise(
  isBrowser()
    ? clientLoader({ location }).then((r) => { cache?.set(r); return r; })
    : serverLoader({ location })
);
```

**New:**
```ts
const loaderRef = wrapPromise(
  serverLoader({ location }).then((r) => {
    if (isBrowser()) cache?.set(r);
    return r;
  })
);
```

The `reload` callback currently calls `clientLoaderRef`. Rename to `serverLoaderRef` — in the browser build this ref points to the RPC stub, so reload correctly re-fetches from the server.

## Public API Changes

| | Before | After |
|---|---|---|
| `getLoaderData` options | `{ serverLoader, clientLoader, cache, ... }` | `{ serverLoader, cache, ... }` |
| `LoaderProps` | includes `clientLoader` | `clientLoader` removed |
| `@hono-preact/server` exports | `actionsHandler, renderPage, ...` | adds `loadersHandler` |
| `/__loaders` endpoint | does not exist | `POST /__loaders` dispatches to serverLoader |

`Loader<T>` type is unchanged.

## Migration for Existing Apps

1. Remove `clientLoader` from every `getLoaderData` call.
2. Remove `cache.wrap(...)` — pass `cache` directly as before; the RPC stub writes to it on success.
3. Add `loadersHandler` to the Hono app: `.post('/__loaders', loadersHandler(import.meta.glob('./pages/*.server.ts')))`.
4. `.server.ts` files themselves do not change.

## Not Changing

- `serverLoaderValidationPlugin` — already requires a default export; contract is unchanged.
- `serverGuards` / `clientGuards` — separate concern, untouched.
- `serverActions` / `actionsHandler` / `useAction` / `Form` — untouched.
- Cache semantics — `createCache` and `LoaderCache` are unchanged; the RPC stub writes to cache on success, same as `clientLoader` did.
- Preload path (hydration) — untouched.
