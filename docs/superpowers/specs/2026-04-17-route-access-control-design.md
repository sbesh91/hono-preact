# Route Access Control Design

**Date:** 2026-04-17

## Overview

A middleware-inspired guard system for protecting SSR page routes. Guards run on both the server (initial page load) and the client (client-side navigation), covering both execution paths through the existing loader architecture. The API is intentionally modeled after Hono's `createMiddleware` pattern.

---

## Core Types

**File:** `src/iso/guard.ts`

```ts
export type GuardResult =
  | { redirect: string }
  | { render: FunctionComponent }
  | void

export type GuardContext = {
  location: RouteHook
}

export type GuardFn = (
  ctx: GuardContext,
  next: () => Promise<GuardResult>
) => Promise<GuardResult>

export const createGuard = (fn: GuardFn): GuardFn => fn

export const runGuards = async (
  guards: GuardFn[],
  ctx: GuardContext
): Promise<GuardResult> => {
  const run = async (index: number): Promise<GuardResult> => {
    if (index >= guards.length) return
    return guards[index](ctx, () => run(index + 1))
  }
  return run(0)
}
```

`createGuard` is a thin typed factory — mirrors `createMiddleware` from `hono/factory`. Guards are chained via `next()`: the first guard to return a non-void result short-circuits the rest. If all guards call `next()`, the page renders normally.

`GuardResult` has three states:
- `{ redirect: string }` — redirect to a URL
- `{ render: FunctionComponent }` — render a fallback component (e.g. a 403 page)
- `void` — pass through to the next guard or the loader

`getCurrentUser` is **not** a framework concern. Guard functions call it themselves. The framework only provides `location` via `GuardContext`.

---

## Consumer API

Guards are plain functions the consumer defines. They call `getCurrentUser()` themselves and return a `GuardResult`:

```ts
import { createGuard } from '~/iso/guard'
import { getCurrentUser } from '~/auth'

export const authenticated = createGuard(async ({ location }, next) => {
  const user = await getCurrentUser()
  if (!user) return { redirect: '/login' }
  return next()
})

export const hasRole = (role: string) =>
  createGuard(async ({ location }, next) => {
    const user = await getCurrentUser()
    if (!user?.roles.includes(role)) return { redirect: '/forbidden' }
    return next()
  })
```

---

## Integration with `getLoaderData`

**File:** `src/iso/loader.tsx`

`LoaderProps` gains two optional arrays:

```ts
interface LoaderProps<T> {
  serverLoader?: Loader<T>;
  clientLoader?: Loader<T>;
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
}
```

Usage at the page level mirrors the existing loader pattern:

```ts
// admin.server.ts
import { authenticated, hasRole } from '~/guards'
export const serverGuards = [authenticated, hasRole('admin')]
export default serverLoader

// admin.tsx
import serverLoader, { serverGuards } from './admin.server'
const clientGuards = [authenticated, hasRole('admin')]

export default getLoaderData(AdminPage, {
  serverLoader,
  clientLoader,
  cache,
  serverGuards,
  clientGuards,
})
```

---

## Execution in `page.tsx`

Guards run as a separate `wrapPromise` step before the loader. Suspense naturally sequences them — guards resolve first, loader runs only if guards pass.

```ts
// In Page component:
const { route } = useLocation()

const guardRef = useRef(wrapPromise(
  runGuards(isBrowser() ? clientGuards : serverGuards, { location })
))

const guardResult = guardRef.current.read()  // throws promise until resolved

if (guardResult?.redirect) {
  if (isBrowser()) {
    route(guardResult.redirect)
    return null
  } else {
    throw new GuardRedirect(guardResult.redirect)
  }
}

if (guardResult?.render) {
  const Fallback = guardResult.render
  return <Fallback />
}

// existing loader logic unchanged below
```

`GuardRedirect` is a typed class used to signal a server-side redirect from within SSR rendering:

```ts
export class GuardRedirect {
  constructor(public readonly location: string) {}
}
```

---

## Server-Side Redirect Handling

**File:** `src/server.tsx`

The Hono catch-all handler is updated to catch `GuardRedirect` thrown during SSR and convert it to an HTTP redirect response:

```ts
try {
  const html = await prerender(<Layout />)
  return c.html(html)
} catch (e) {
  if (e instanceof GuardRedirect) return c.redirect(e.location)
  throw e
}
```

---

## Convention Enforcement (Vite Plugins)

**File:** `vite-plugin-server-only.ts`

Two existing plugins are updated to accommodate `serverGuards` as a permitted named export from `.server.ts` files.

### `serverLoaderValidationPlugin`

Currently errors on any named export from `.server.*` files. Updated to allow `serverGuards` specifically — any other named export still throws a build error:

```
Allowed in .server.ts files:
  export default serverLoader        ← required
  export const serverGuards = [...]  ← only permitted named export
```

### `serverOnlyPlugin`

Currently stubs only the default import in client builds. Updated to also detect and stub `serverGuards` named imports:

```ts
// Input (.tsx file importing from .server.ts):
import serverLoader, { serverGuards } from './admin.server'

// Client build output:
const serverLoader = async () => ({});
const serverGuards = [];
```

The stub for `serverGuards` is `[]` — an empty array is the correct no-op value (no guards = pass through). The stub for `serverLoader` remains `async () => ({})` unchanged.

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `src/iso/guard.ts` | New file — `GuardFn`, `GuardResult`, `GuardContext`, `createGuard`, `runGuards`, `GuardRedirect` |
| `src/iso/loader.tsx` | Add `serverGuards` and `clientGuards` to `LoaderProps` |
| `src/iso/page.tsx` | Add guard execution step before loader; import `useLocation` |
| `src/server.tsx` | Catch `GuardRedirect` in SSR handler |
| `vite-plugin-server-only.ts` | Allow `serverGuards` named export; stub it in client builds |
