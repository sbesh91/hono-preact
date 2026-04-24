# Mutation Pattern Design

**Date:** 2026-04-23  
**Status:** Approved

## Overview

A first-class mutation system for hono-preact that colocates actions with pages, uses an RPC transport, and provides `useAction` + `<Form>` primitives on the client. Mirrors the loader pattern so the mental model stays consistent.

---

## Architecture

Four parts:

1. **`serverActions` export** — named map in `.server.ts` files alongside `serverLoader`/`serverGuards`
2. **RPC transport** — single `POST /__actions` Hono route, body `{ module, action, payload }`
3. **Client stubs** — Vite plugin replaces `serverActions` in the client bundle with metadata objects `{ __module, __action }` so `useAction` can construct RPC calls without leaking server code
4. **`useAction` + `<Form>`** — client primitives in `@hono-preact/iso`

---

## Server-Side API

### Page action definition

Actions are defined using `defineAction`, exported from `@hono-preact/iso`. The generic parameters carry payload and result types through to the client without leaking any server code.

```ts
// src/pages/movies.server.ts
import { defineAction } from '@hono-preact/iso';

export const serverActions = {
  create: defineAction<{ title: string; year: number }, { ok: boolean }>(
    async (ctx, payload) => {
      await insertMovie(payload);
      return { ok: true };
    }
  ),
  delete: defineAction<{ id: string }, { ok: boolean }>(
    async (ctx, payload) => {
      await deleteMovie(payload.id);
      return { ok: true };
    }
  ),
};
```

`defineAction` is a no-op wrapper at runtime on the server — it returns the function unchanged. Its value is purely in the type system: it brands the return as `ActionStub<TPayload, TResult>`, which `useAction` uses to infer types on the client.

### Registration in `server.tsx`

```ts
import { actionsHandler } from '@hono-preact/server';

app.post(
  '/__actions',
  actionsHandler(import.meta.glob('./pages/*.server.ts'))
);
```

`actionsHandler` accepts either an eager or lazy glob result. When given lazy import functions, it resolves all modules immediately at initialization (before any requests) — since Workers bundle everything anyway, this is effectively synchronous. The module name is derived by stripping the path prefix and `.server.ts` suffix (`./pages/movies.server.ts` → `movies`). It then maps `{ module, action }` pairs to the unwrapped handler functions extracted from each module's `serverActions`.

**Request shape:**
```json
{ "module": "movies", "action": "create", "payload": { "title": "Dune", "year": 2021 } }
```

**Success response:** `200` with JSON return value of the action function.  
**Error response:** `4xx/5xx` with `{ "error": "<message>" }`.

---

## Vite Plugin Changes

The existing `serverOnlyPlugin` strips `.server.ts` imports in the client build. It gains one new transformation: instead of replacing `serverActions` with an empty stub, it replaces each `defineAction(...)` call with an RPC metadata object.

**Input (`movies.server.ts`):**
```ts
export const serverActions = {
  create: defineAction<{ title: string; year: number }, { ok: boolean }>(async (ctx, payload) => { ... }),
  delete: defineAction<{ id: string }, { ok: boolean }>(async (ctx, payload) => { ... }),
};
```

**Client bundle output:**
```ts
export const serverActions = {
  create: { __module: 'movies', __action: 'create' },
  delete: { __module: 'movies', __action: 'delete' },
};
```

The plugin targets `defineAction(...)` calls within `serverActions` object properties. Action names come from the property keys; module name comes from the filename. TypeScript sees the original source types (`ActionStub<TPayload, TResult>`) regardless of the runtime transform.

The `serverLoaderValidationPlugin` should be updated to allow `serverActions` as a valid named export (alongside `serverLoader` and `serverGuards`).

---

## Client-Side API

### `useAction` hook

```ts
const { mutate, pending, error, data } = useAction(serverActions.create, {
  invalidate: 'auto', // 'auto' | false
  onMutate: (payload) => {
    const snapshot = currentMovies;
    setMovies(prev => [...prev, { ...payload, id: 'optimistic' }]);
    return snapshot; // passed to onError for rollback
  },
  onError: (err, snapshot) => setMovies(snapshot),
  onSuccess: (data) => console.log('created', data),
});

await mutate({ title: 'Dune', year: 2021 });
```

**`mutate(payload, overrides?)`** — fires the RPC call. Never throws; errors surface via the `error` return value.

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `invalidate` | `'auto' \| false` | `'auto'` calls `reload()` after success. `false` skips automatic refetch. |
| `onMutate` | `(payload) => snapshot` | Called before request fires. Return value is passed to `onError`. |
| `onError` | `(err, snapshot) => void` | Called on failure. Use `snapshot` to roll back optimistic state. |
| `onSuccess` | `(data) => void` | Called on success before invalidation. |

**Return values:**

| Value | Type | Description |
|-------|------|-------------|
| `mutate` | `(payload: TPayload) => Promise<void>` | Fires the action |
| `pending` | `boolean` | True while request is in flight |
| `error` | `Error \| null` | Set on failure, cleared on next `mutate` call |
| `data` | `TResult \| null` | Last successful response |

### `<Form>` component

```tsx
<Form
  action={serverActions.create}
  invalidate="auto"
  onSuccess={(data) => navigate('/movies')}
  onError={(err) => console.error(err)}
>
  <input name="title" />
  <button type="submit">Add</button>
</Form>
```

Wraps `useAction` internally. On submit, serializes `FormData` to a plain object and calls `mutate`. Accepts the same `invalidate`, `onMutate`, `onError`, and `onSuccess` options as `useAction` via props.

---

## Error Handling

- `serverAction` throws → `actionsHandler` catches, returns `{ error: message }` with appropriate status
- `useAction` sets `error` state, calls `onError(err, snapshot)` if provided
- `mutate()` never throws — always resolves
- Optimistic rollback: if `onMutate` returned a snapshot, it is passed to `onError` for manual state restoration
- `<Form>` follows the same contract; submission errors are available via the `onError` prop

---

## Affected Packages

| Package | Change |
|---------|--------|
| `@hono-preact/iso` | Add `defineAction`, `useAction` hook, and `<Form>` component |
| `@hono-preact/server` | Add `actionsHandler` Hono middleware |
| `@hono-preact/vite` | Update `serverOnlyPlugin` to emit RPC stubs for `serverActions`; update `serverLoaderValidationPlugin` to allow `serverActions` export |
| `apps/app` | Register `actionsHandler` in `server.tsx`; add example usage in `movies` page |

---

## Out of Scope (POC)

These items are tracked in [docs/backlog.md](../../backlog.md) for future work:

- Cross-page cache invalidation (`string[]` invalidation targets)
- Streaming responses from actions
- File upload support
- Action middleware / guards (separate concern from loader guards)
