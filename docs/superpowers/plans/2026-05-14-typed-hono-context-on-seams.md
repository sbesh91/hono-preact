# Typed Hono `Context` on Guards / Loaders / Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Hono request `Context` reachable, typed, and non-optional inside the framework's three programmatic seams (server guards, loaders, actions). Today server guards have no `c` at all, loaders are not given `c`, and actions receive `c: unknown`. After this plan, user auth code can call `getSignedCookie(ctx.c, …)`, `verify(token, secret)`, etc. without casts. This is the prerequisite for the launch-ready auth recipe (issue #35).

**Architecture:** Two layers.

1. **`@hono-preact/iso` types:** `GuardContext` splits into a discriminated union — `ServerGuardContext { c: Context; location }` for `defineServerGuard`-built guards, `ClientGuardContext { location }` for `defineClientGuard`-built guards. `LoaderCtx` gains `c: Context`. `ActionCtx.c` and `ActionGuardContext.c` tighten from `unknown` to `Context`. `runGuards` becomes two functions: `runServerGuards` and `runClientGuards`. The single union `GuardFn` is preserved for the public API; the discrimination happens at the runner.
2. **`@hono-preact/server` runtime:** `loadersHandler` passes `c` into the `LoaderCtx` it constructs. `renderPage` wraps the prerendered tree in `<HonoContext.Provider value={{ context: c }}>`. The `<Guards>` component reads `useContext(HonoContext)` and dispatches to `runServerGuards` with `{ c, location }` server-side, `runClientGuards` with `{ location }` client-side.

The Hono `Context` type is parameterised on `Env` (bindings) and the path. We re-export it as `HonoContextType` from `@hono-preact/iso` (renamed to avoid collision with the existing `HonoContext` Preact context) and accept the broadest shape (`Context`) at the seam — users can narrow at their guard/loader bodies via `ctx.c.var.X` once they've typed their app.

**Tech Stack:** TypeScript, Preact, preact-iso, Hono, Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-05-09-v0.1-framework-direction.md` (sequencing item 8 unblocker).

---

## File Structure

### Files modified

- `packages/iso/src/action.ts`; tighten `ActionCtx.c` and `ActionGuardContext.c` from `unknown` to `Context`; import `Context` from `hono`.
- `packages/iso/src/define-loader.ts`; add `c: Context` to `LoaderCtx`.
- `packages/iso/src/guard.ts`; split `GuardContext` into `ServerGuardContext` + `ClientGuardContext`; replace single `runGuards` with `runServerGuards` and `runClientGuards`; keep `GuardFn` as discriminated union; type `defineServerGuard.fn` against `ServerGuardContext` and `defineClientGuard.fn` against `ClientGuardContext`.
- `packages/iso/src/index.ts`; export `ServerGuardContext`, `ClientGuardContext`, `runServerGuards`, `runClientGuards`; remove `runGuards` export and `GuardContext` type export (replaced by the two split types).
- `packages/iso/src/internal/guards.tsx`; read `useContext(HonoContext)` from `@hono-preact/server`; branch `runServerGuards` vs `runClientGuards` by env.
- `packages/iso/src/internal.ts`; drop `runGuards` re-export; add `runServerGuards`, `runClientGuards`, `HonoRequestContext`.
- `packages/iso/src/internal/contexts.ts`; declare `HonoRequestContext` here (moved out of server package).
- `packages/server/src/context.ts`; re-export `HonoRequestContext` as `HonoContext` instead of declaring it locally.
- `packages/hono-preact/__tests__/exports.test.ts`; replace `runGuards` assertion with `runServerGuards` + `runClientGuards`.
- `packages/iso/src/__tests__/guard.test.ts`; update existing two `runGuards` tests to call `runServerGuards` (with a fake `c`) and `runClientGuards`; add a test asserting `defineServerGuard` callback's `ctx.c` is typed as `Context`.
- `packages/server/src/loaders-handler.ts`; pass `c` into the loader call (via seeded `runRequestScope`); update internal `LoaderFn` type.
- `packages/iso/src/cache.ts`; extend `runRequestScope` to optionally seed the store with the Hono `Context`; add `getRequestHonoContext()` helper.
- `packages/iso/src/internal/loader-runner.ts`; in the direct-fn branch (line 65), read seeded `c` from the request store and pass it as part of `LoaderCtx`.
- `packages/server/src/render.tsx`; wrap the prerender tree in `<HonoContext.Provider value={{ context: c }}>`.
- `packages/server/src/__tests__/loaders-handler.test.ts`; update the "calls the matching serverLoader" test's `expect.objectContaining` to also expect `c`.
- `packages/server/src/__tests__/actions-handler.test.ts`; update the "passes ctx with c and signal" test to assert `ctx.c` is the Hono Context (has `req`, `var`, `header`, etc.).
- `apps/app/src/pages/docs/guards.mdx`; document `ctx.c` on server guards and the absence of `c` on client guards.
- `apps/app/src/pages/docs/loaders.mdx`; document `ctx.c`.
- `apps/app/src/pages/docs/actions.mdx`; note that `ctx.c` is now `Context` (was `unknown`).

### Files created

- `packages/server/src/__tests__/render-honocontext.test.tsx`; asserts `<HonoContext.Provider>` is set during prerender and that components inside the tree see the request's `c`.
- `packages/iso/src/__tests__/guards-honocontext.test.tsx`; asserts a server guard receives `ctx.c` end-to-end through `<Guards>` when a `<HonoContext.Provider>` wraps it.
- `packages/iso/src/__tests__/loader-runner-c.test.tsx`; asserts the SSR direct-fn loader path receives `c` via the seeded `runRequestScope`.
- `packages/server/src/__tests__/loader-sets-cookie.test.tsx`; V3 validation — RPC + SSR loader-path `setCookie` outcomes.

### Files deleted

None.

---

## Phase 1: Tighten action types (smallest, isolated)

### Task 1: `ActionCtx.c` and `ActionGuardContext.c` become `Context`

**Files:**
- Modify: `packages/iso/src/action.ts`
- Modify: `packages/server/src/__tests__/actions-handler.test.ts`

- [ ] **Step 1: Write failing test asserting `ctx.c` is the Hono Context shape**

In `packages/server/src/__tests__/actions-handler.test.ts`, add `import type { Context } from 'hono';` to the import block at the top of the file. Then replace the existing "passes ctx with c and signal to the action function" test (around line 480) with this stricter version:

```ts
  it('passes ctx with a typed Hono Context and signal to the action function', async () => {
    let observed: { hasReq: boolean; hasVar: boolean; hasHeader: boolean; hasSignal: boolean } = {
      hasReq: false,
      hasVar: false,
      hasHeader: false,
      hasSignal: false,
    };
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        serverActions: {
          probe: async (ctx: { c: Context; signal: AbortSignal }, _payload: unknown) => {
            observed = {
              hasReq: typeof ctx.c.req === 'object' && ctx.c.req !== null,
              hasVar: typeof ctx.c.var === 'object' && ctx.c.var !== null,
              hasHeader: typeof ctx.c.header === 'function',
              hasSignal: ctx.signal instanceof AbortSignal,
            };
            return { ok: true };
          },
        },
      },
    });

    await post(app, { module: 'x', action: 'probe', payload: {} });
    expect(observed.hasReq).toBe(true);
    expect(observed.hasVar).toBe(true);
    expect(observed.hasHeader).toBe(true);
    expect(observed.hasSignal).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/server test -- actions-handler --run`
Expected: FAIL — TypeScript will compile fine because runtime `c` already has these methods, but if the import fails on a different test the suite goes red. If it passes here, that's still acceptable; this test pins the runtime contract before we tighten types in step 3.

- [ ] **Step 3: Tighten the types in `packages/iso/src/action.ts`**

Add the import and change two type annotations:

```ts
import type { Context } from 'hono';
```

Then:

```ts
export type ActionCtx = {
  c: Context;
  signal: AbortSignal;
};
```

```ts
export type ActionGuardContext = {
  c: Context;
  module: string;
  action: string;
  payload: unknown;
};
```

- [ ] **Step 4: Run iso typecheck + tests**

Run: `pnpm --filter @hono-preact/iso build && pnpm --filter @hono-preact/iso test --run`
Expected: PASS for all iso tests; clean tsc.

- [ ] **Step 5: Run server tests**

Run: `pnpm --filter @hono-preact/server test --run`
Expected: PASS, including the new probe test.

- [ ] **Step 6: Update `apps/app/src/pages/docs/actions.mdx`**

Find the section that describes the action signature (search for `ActionCtx` or `ctx.c`). Replace any prose that says `c` is opaque or `unknown` with one sentence: "`ctx.c` is the request's Hono `Context`. Use it to read cookies (`getCookie`), set headers, or reach Hono `Bindings` via `ctx.c.env`."

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/action.ts packages/server/src/__tests__/actions-handler.test.ts apps/app/src/pages/docs/actions.mdx
git commit -m "feat(iso): type ActionCtx.c and ActionGuardContext.c as Hono Context"
```

---

## Phase 2: Loaders receive `c`

### Task 2: Add `c: Context` to `LoaderCtx` and thread through `loadersHandler`

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Modify: `packages/server/src/loaders-handler.ts`
- Modify: `packages/server/src/__tests__/loaders-handler.test.ts`
- Modify: `apps/app/src/pages/docs/loaders.mdx`

- [ ] **Step 1: Write failing test asserting the loader receives `c`**

In `packages/server/src/__tests__/loaders-handler.test.ts`, replace the existing "calls the matching serverLoader with the location and returns JSON" test (lines 22–38) with:

```ts
  it('calls the matching serverLoader with location, signal, and the Hono Context', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ movies: [] });
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverLoaders: { default: loaderFn },
      },
    });

    const res = await post(app, { module: 'pages/movies', loader: 'default', location: loc });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ movies: [] });
    expect(loaderFn).toHaveBeenCalledWith(
      expect.objectContaining({
        location: loc,
        signal: expect.any(AbortSignal),
        c: expect.objectContaining({
          req: expect.anything(),
          header: expect.any(Function),
        }),
      })
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/server test -- loaders-handler --run`
Expected: FAIL with "expected mock to have been called with object containing `c`" (the loader does not receive `c` today).

- [ ] **Step 3: Add `c` to `LoaderCtx`**

In `packages/iso/src/define-loader.ts`, add the import at the top:

```ts
import type { Context } from 'hono';
```

And change `LoaderCtx`:

```ts
export type LoaderCtx = {
  c: Context;
  location: RouteHook;
  signal: AbortSignal;
};
```

- [ ] **Step 4: Pass `c` through `loadersHandler`**

In `packages/server/src/loaders-handler.ts`:

Add the import at the top of the file (alongside the existing `MiddlewareHandler` import):

```ts
import type { Context, MiddlewareHandler } from 'hono';
```

Update the internal `LoaderFn` type (around line 23) to accept `c`:

```ts
type LoaderFn = (props: {
  c: Context;
  location: SerializedLocation;
  signal: AbortSignal;
}) => Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;
```

Then in the handler body (around line 128), add `c` to the loader call:

```ts
      const result = await runRequestScope(() =>
        Promise.resolve(loaderFn({ c, location: validatedLocation, signal }))
      );
```

- [ ] **Step 5: Run loaders-handler tests**

Run: `pnpm --filter @hono-preact/server test -- loaders-handler --run`
Expected: PASS, including the updated test that asserts `c` is on the call.

- [ ] **Step 6: Run iso build + tests to confirm typing is consistent**

Run: `pnpm --filter @hono-preact/iso build && pnpm --filter @hono-preact/iso test --run`
Expected: clean build, all tests pass. If `define-loader.test.ts` constructs a `LoaderCtx` literal anywhere without `c`, update those test fixtures to include a minimal `c: {} as any` (loader unit tests do not exercise the seam, only the LoaderRef plumbing, so the value can be anything).

- [ ] **Step 7: Update `apps/app/src/pages/docs/loaders.mdx`**

Find the section that describes the loader function signature. Add one paragraph after the existing `location` / `signal` description:

> `ctx.c` is the request's Hono `Context`. A server loader can read cookies (`getCookie(ctx.c, …)`), reach app `Bindings` (`ctx.c.env.MY_KV`), or set a response header before yielding. The shape is `Context`; users with typed `Bindings` can narrow inside the function body.

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/server/src/loaders-handler.ts packages/server/src/__tests__/loaders-handler.test.ts apps/app/src/pages/docs/loaders.mdx
git commit -m "feat: pass typed Hono Context into loader (RPC dispatcher path)"
```

---

## Phase 2b: SSR loader path also receives `c`

**Why this exists:** Loaders run via two distinct paths. The RPC dispatcher (`packages/server/src/loaders-handler.ts`, fixed in Phase 2) handles browser-initiated `fetch('/__loaders')` calls. The SSR direct-fn path (`packages/iso/src/internal/loader-runner.ts:65`) runs loaders in-process during prerender from `<LoaderHost>` inside the rendered tree. Phase 2 alone leaves SSR-time loaders with `c === undefined`. Threading mechanism: the existing `runRequestScope` AsyncLocalStorage already wraps both call sites, so we seed it with `c` and let the SSR runner read from the store. The RPC path also adopts this pattern for symmetry (one mechanism, not two).

### Task 2b: Seed `c` into `runRequestScope`; SSR runner reads it

**Files:**
- Modify: `packages/iso/src/cache.ts`
- Modify: `packages/iso/src/internal/loader-runner.ts`
- Modify: `packages/server/src/loaders-handler.ts` (switch to seeded form)
- Modify: `packages/server/src/render.tsx` (seed during prerender wrap; the `<HonoRequestContext.Provider>` install in Phase 5 stays — that one is for guard React context, this is for non-React loader code)
- Create: `packages/iso/src/__tests__/loader-runner-c.test.tsx`

- [ ] **Step 1: Write the failing SSR test**

Create `packages/iso/src/__tests__/loader-runner-c.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import { runRequestScope } from '../cache.js';
import { runLoader } from '../internal/loader-runner.js';
import { defineLoader } from '../define-loader.js';
import type { RouteHook } from 'preact-iso';

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

describe('runLoader direct-fn path receives Hono Context via runRequestScope', () => {
  it('passes seeded c into LoaderCtx during SSR-style invocation', async () => {
    let observedC: unknown = null;
    const ref = defineLoader(async (ctx) => {
      observedC = ctx.c;
      return { ok: true };
    });
    const fakeC = { req: {}, header: () => {}, var: {} } as unknown as Context;

    await runRequestScope(
      () =>
        runLoader(ref, loc, 'id1', new AbortController().signal, {
          onChunk: () => {},
          onError: () => {},
          onEnd: () => {},
        }),
      { honoContext: fakeC }
    );

    expect(observedC).toBe(fakeC);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/iso test -- loader-runner-c --run`
Expected: FAIL — `runRequestScope` does not accept a second argument; `runLoader` does not pass `c`.

- [ ] **Step 3: Extend `runRequestScope` and add `getRequestHonoContext()`**

In `packages/iso/src/cache.ts`, add a module-level symbol and modify `runRequestScope`:

```ts
const HONO_CONTEXT_KEY = Symbol('@hono-preact/iso/honoContext');

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
```

- [ ] **Step 4: Update `loader-runner.ts:65` to read `c` from the store**

In `packages/iso/src/internal/loader-runner.ts`, add the import:

```ts
import { getRequestHonoContext } from '../cache.js';
```

Then change the direct-fn invocation (currently `loaderRef.fn({ location, signal })`):

```ts
    const c = getRequestHonoContext();
    const result = await (loaderRef.fn({ c: c as any, location, signal }) as Promise<unknown>);
```

The `as any` is because `LoaderCtx.c` is typed `Context` but a stale browser caller (no scope seeded) would see `undefined`. In SSR — where this branch matters — the seed is always set by `loadersHandler` and `renderPage` (steps 5 + 6 below). Browser direct-fn calls (tests, unkeyed loaders) get `undefined` as `c`; that's acceptable since browser loaders never need `c` (no Hono request exists in the browser).

- [ ] **Step 5: Switch `loadersHandler` to the seeded form**

In `packages/server/src/loaders-handler.ts`, replace the `runRequestScope` call (currently around line 128):

```ts
      const result = await runRequestScope(
        () => Promise.resolve(loaderFn({ c, location: validatedLocation, signal })),
        { honoContext: c }
      );
```

The explicit `c` argument inside the loader call stays (Phase 2 step 4); the seeded form here means a loader that itself triggers a nested loader (via `<LoaderHost>` in some rendered fragment) would also see `c`. Belt-and-braces, no behavior regression.

- [ ] **Step 6: Seed during `renderPage` prerender**

In `packages/server/src/render.tsx`, change only the `runRequestScope` call site to pass the `{ honoContext: c }` seed (the body of the callback stays unchanged here — Phase 5 will add the `<HonoRequestContext.Provider>` inside the `prerender(...)` call):

```ts
    const result = await runRequestScope(
      async () => {
        const rendered = await prerender(<HoofdProvider value={dispatcher}>{node}</HoofdProvider>);
        const loaders = takeServerStreamingLoaders();
        return { html: rendered.html, streamingLoaders: loaders };
      },
      { honoContext: c }
    );
```

- [ ] **Step 7: Run the new test**

Run: `pnpm --filter @hono-preact/iso test -- loader-runner-c --run`
Expected: PASS.

- [ ] **Step 8: Run the full iso + server suites**

Run: `pnpm --filter @hono-preact/iso test --run && pnpm --filter @hono-preact/server test --run`
Expected: PASS. Existing `runRequestScope(fn)` callers (none outside the two we just edited) keep working because `initial` is optional.

- [ ] **Step 9: Add a SSR-path integration test**

Append to `packages/server/src/__tests__/render.test.tsx` (or create `packages/server/src/__tests__/render-loader-c.test.tsx` if you prefer isolation):

```tsx
import { defineLoader } from '@hono-preact/iso';

it('a loader invoked during SSR receives the request c', async () => {
  let observedHeader: string | undefined = undefined;
  const probe = defineLoader(async (ctx) => {
    observedHeader = ctx.c.req.header('x-probe');
    return { ok: true };
  });

  function Page() {
    return (
      <html>
        <body>
          <probe.Boundary>
            <probe.View>{() => <div>ok</div>}</probe.View>
          </probe.Boundary>
        </body>
      </html>
    );
  }

  const app = new Hono();
  app.get('*', (c) => renderPage(c, <Page />));
  await app.request('http://localhost/x', { headers: { 'x-probe': 'hi' } });
  expect(observedHeader).toBe('hi');
});
```

If `probe.View` requires more wiring than this in the current API (check by reading `define-loader.ts`), simplify by calling `runLoader` directly inside a small helper component; the assertion is the same — `ctx.c` is the request `c`.

- [ ] **Step 10: Commit**

```bash
git add packages/iso/src/cache.ts packages/iso/src/internal/loader-runner.ts packages/server/src/loaders-handler.ts packages/server/src/render.tsx packages/iso/src/__tests__/loader-runner-c.test.tsx packages/server/src/__tests__/render.test.tsx
git commit -m "feat: thread Hono Context into SSR loader path via runRequestScope seed"
```

---

## Phase 3: Split GuardContext

### Task 3: `ServerGuardContext` / `ClientGuardContext` + split runners

**Files:**
- Modify: `packages/iso/src/guard.ts`
- Modify: `packages/iso/src/index.ts`
- Modify: `packages/iso/src/__tests__/guard.test.ts`

- [ ] **Step 1: Write failing tests for the split shape**

Replace the contents of `packages/iso/src/__tests__/guard.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import type { RouteHook } from 'preact-iso';
import {
  defineServerGuard,
  defineClientGuard,
  runServerGuards,
  runClientGuards,
  type ServerGuardFn,
  type ClientGuardFn,
} from '../guard.js';

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const fakeC = {
  req: { header: () => undefined },
  header: () => {},
  var: {},
} as unknown as Context;

describe('defineServerGuard / defineClientGuard', () => {
  it('produces a record tagged with runs', () => {
    const g = defineServerGuard(async (_c, next) => next());
    expect(g.runs).toBe('server');
    expect(typeof g.fn).toBe('function');
  });

  it('defineClientGuard tags as client', () => {
    const g = defineClientGuard(async (_c, next) => next());
    expect(g.runs).toBe('client');
  });

  it('defineServerGuard callbacks receive a typed Hono Context as ctx.c', async () => {
    let observedC: unknown = undefined;
    const g = defineServerGuard(async (ctx, next) => {
      observedC = ctx.c;
      return next();
    });
    await runServerGuards([g], { c: fakeC, location: loc });
    expect(observedC).toBe(fakeC);
  });

  it('defineClientGuard callbacks have no c on their context', async () => {
    let keys: string[] = [];
    const g = defineClientGuard(async (ctx, next) => {
      keys = Object.keys(ctx);
      return next();
    });
    await runClientGuards([g], { location: loc });
    expect(keys).not.toContain('c');
    expect(keys).toContain('location');
  });
});

describe('runServerGuards composes records via .fn', () => {
  it('threads next() through each guard in order', async () => {
    const calls: string[] = [];
    const a: ServerGuardFn = defineServerGuard(async (_c, next) => {
      calls.push('a:before');
      const r = await next();
      calls.push('a:after');
      return r;
    });
    const b: ServerGuardFn = defineServerGuard(async (_c, next) => {
      calls.push('b');
      return next();
    });
    const result = await runServerGuards([a, b], { c: fakeC, location: loc });
    expect(result).toBeUndefined();
    expect(calls).toEqual(['a:before', 'b', 'a:after']);
  });

  it('short-circuits on the first non-void return', async () => {
    const a = defineServerGuard(async (_c, next) => next());
    const b = defineServerGuard(async () => ({ redirect: '/login' }));
    const c = defineServerGuard(async (_c, _next) => {
      throw new Error('should not run');
    });
    const result = await runServerGuards([a, b, c], { c: fakeC, location: loc });
    expect(result).toEqual({ redirect: '/login' });
  });
});

describe('runClientGuards composes records via .fn', () => {
  it('threads next() through each guard in order with no c', async () => {
    const calls: string[] = [];
    const a: ClientGuardFn = defineClientGuard(async (_ctx, next) => {
      calls.push('a:before');
      const r = await next();
      calls.push('a:after');
      return r;
    });
    const b: ClientGuardFn = defineClientGuard(async (_ctx, next) => {
      calls.push('b');
      return next();
    });
    const result = await runClientGuards([a, b], { location: loc });
    expect(result).toBeUndefined();
    expect(calls).toEqual(['a:before', 'b', 'a:after']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hono-preact/iso test -- guard --run`
Expected: FAIL with import errors (`runServerGuards`, `runClientGuards`, `ServerGuardFn`, `ClientGuardFn` do not exist yet).

- [ ] **Step 3: Replace `packages/iso/src/guard.ts` with the split implementation**

```ts
// src/iso/guard.ts
import { type FunctionComponent } from 'preact';
import type { Context } from 'hono';
import { type RouteHook } from 'preact-iso';

export type GuardRunsOn = 'server' | 'client';

export type GuardResult =
  | { redirect: string }
  | { render: FunctionComponent }
  | void;

export type ServerGuardContext = {
  c: Context;
  location: RouteHook;
};

export type ClientGuardContext = {
  location: RouteHook;
};

export type ServerGuardFn = {
  readonly runs: 'server';
  readonly fn: (
    ctx: ServerGuardContext,
    next: () => Promise<GuardResult>,
  ) => Promise<GuardResult>;
};

export type ClientGuardFn = {
  readonly runs: 'client';
  readonly fn: (
    ctx: ClientGuardContext,
    next: () => Promise<GuardResult>,
  ) => Promise<GuardResult>;
};

export type GuardFn = ServerGuardFn | ClientGuardFn;

export const defineServerGuard = (fn: ServerGuardFn['fn']): ServerGuardFn => ({
  runs: 'server',
  fn,
});

export const defineClientGuard = (fn: ClientGuardFn['fn']): ClientGuardFn => ({
  runs: 'client',
  fn,
});

export const runServerGuards = async (
  guards: ServerGuardFn[],
  ctx: ServerGuardContext,
): Promise<GuardResult> => {
  const run = async (index: number): Promise<GuardResult> => {
    if (index >= guards.length) return;
    return guards[index].fn(ctx, () => run(index + 1));
  };
  return run(0);
};

export const runClientGuards = async (
  guards: ClientGuardFn[],
  ctx: ClientGuardContext,
): Promise<GuardResult> => {
  const run = async (index: number): Promise<GuardResult> => {
    if (index >= guards.length) return;
    return guards[index].fn(ctx, () => run(index + 1));
  };
  return run(0);
};

export class GuardRedirect extends Error {
  constructor(public readonly location: string) {
    super(`Guard redirect to ${location}`);
    this.name = 'GuardRedirect';
  }
}
```

- [ ] **Step 4: Update exports in `packages/iso/src/index.ts`**

Find the existing guards export block (lines 56–68) and replace with:

```ts
// Guards.
export {
  defineServerGuard,
  defineClientGuard,
  GuardRedirect,
  runServerGuards,
  runClientGuards,
} from './guard.js';
export type {
  GuardFn,
  ServerGuardFn,
  ClientGuardFn,
  GuardResult,
  ServerGuardContext,
  ClientGuardContext,
  GuardRunsOn,
} from './guard.js';
```

- [ ] **Step 5: Run guard tests**

Run: `pnpm --filter @hono-preact/iso test -- guard.test --run`
Expected: PASS, all six tests in the new file.

- [ ] **Step 6: Run full iso test suite — `<Guards>` will fail**

Run: `pnpm --filter @hono-preact/iso test --run`
Expected: FAIL in `guards-filter.test.tsx` and `page.test.tsx` because `internal/guards.tsx` still calls the removed `runGuards` import. Do NOT fix in this task; the next task addresses it. Note the failures and proceed.

- [ ] **Step 7: Commit (work-in-progress checkpoint, intentional broken state in `<Guards>`)**

```bash
git add packages/iso/src/guard.ts packages/iso/src/index.ts packages/iso/src/__tests__/guard.test.ts
git commit -m "feat(iso): split GuardContext into ServerGuardContext/ClientGuardContext"
```

---

## Phase 4: Wire `<Guards>` to read HonoContext

### Task 4: `<Guards>` dispatches to env-specific runner with `c`

**Files:**
- Modify: `packages/iso/src/internal/guards.tsx`
- Modify: `packages/iso/src/__tests__/guards-filter.test.tsx`
- Create: `packages/iso/src/__tests__/guards-honocontext.test.tsx`

Note: `internal/guards.tsx` lives in `@hono-preact/iso` but needs `HonoContext` which lives in `@hono-preact/server`. To avoid a circular dep, declare the Preact context locally in iso (a parallel `HonoContext`) and have the server package re-export the same object. The shared symbol is what matters; the source location is just a packaging choice. Concretely: move the `HonoContext` declaration *into* `packages/iso/src/internal/contexts.ts` and have `packages/server/src/context.ts` re-export it. This keeps server's public API identical and lets iso reach the context without depending on server.

- [ ] **Step 1: Move `HonoContext` into iso**

In `packages/iso/src/internal/contexts.ts` (existing file), add:

```ts
import type { Context } from 'hono';
import { createContext } from 'preact';

export const HonoRequestContext = createContext<{ context?: Context }>({});
```

Use a distinct internal name (`HonoRequestContext`) to avoid confusion with the export name `HonoContext` that user code consumes from `@hono-preact/server`.

- [ ] **Step 2: Re-export from `packages/server/src/context.ts`**

Replace the file with:

```ts
import { HonoRequestContext } from '@hono-preact/iso/internal';
import { useContext } from 'preact/hooks';

export const HonoContext = HonoRequestContext;

export function useHonoContext() {
  return useContext(HonoContext);
}
```

- [ ] **Step 3: Update `@hono-preact/iso/internal` exports**

In `packages/iso/src/internal.ts`:

1. Remove the existing line `export { runGuards } from './guard.js';` (line 29).
2. Add the two split runners and the new internal context:

```ts
export { runServerGuards, runClientGuards } from './guard.js';
export { HonoRequestContext } from './internal/contexts.js';
```

(Other exports in the file are unchanged.)

- [ ] **Step 3b: Update `packages/hono-preact/__tests__/exports.test.ts`**

The "hono-preact/internal export" test (line 53) asserts `typeof m.runGuards === 'function'`. Replace that one line with two:

```ts
    expect(typeof m.runServerGuards).toBe('function');
    expect(typeof m.runClientGuards).toBe('function');
```

Also add (in the "hono-preact root export" test, after line 11) assertions for the new public types being absent (types are stripped at runtime, so no assertion is needed — but keep `defineServerGuard` / `defineClientGuard` checks unchanged).

- [ ] **Step 4: Write failing test for `<Guards>` consuming HonoContext**

Create `packages/iso/src/__tests__/guards-honocontext.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from 'preact-render-to-string';
import type { RouteHook } from 'preact-iso';
import type { Context } from 'hono';
import { HonoRequestContext } from '../internal/contexts.js';
import { Guards } from '../internal/guards.js';
import { defineServerGuard } from '../guard.js';

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

describe('<Guards> server-side', () => {
  it('passes HonoContext.context as ctx.c to server guards', async () => {
    let observed: unknown = null;
    const probe = defineServerGuard(async (ctx, next) => {
      observed = ctx.c;
      return next();
    });
    const fakeC = { req: {}, header: () => {}, var: {} } as unknown as Context;

    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <Guards guards={[probe]} location={loc}>
          <div>child</div>
        </Guards>
      </HonoRequestContext.Provider>
    );

    // Allow the wrapped promise to resolve.
    await new Promise((r) => setTimeout(r, 0));
    expect(observed).toBe(fakeC);
  });
});
```

- [ ] **Step 5: Run the new test to verify it fails**

Run: `pnpm --filter @hono-preact/iso test -- guards-honocontext --run`
Expected: FAIL — either `runGuards` import no longer resolves in `internal/guards.tsx`, or the guard receives `{location}` only.

- [ ] **Step 6: Update `packages/iso/src/internal/guards.tsx`**

Replace the file with:

```tsx
import type { ComponentChildren, FunctionComponent, JSX } from 'preact';
import type { Context } from 'hono';
import { type RouteHook, useLocation } from 'preact-iso';
import { Suspense } from 'preact/compat';
import { useContext, useRef } from 'preact/hooks';
import {
  type GuardFn,
  type ServerGuardFn,
  type ClientGuardFn,
  GuardRedirect,
  type GuardResult,
  runServerGuards,
  runClientGuards,
} from '../guard.js';
import { isBrowser } from '../is-browser.js';
import wrapPromise from './wrap-promise.js';
import { GuardResultContext, HonoRequestContext } from './contexts.js';

export function useGuardResult(): GuardResult | null {
  return useContext(GuardResultContext);
}

export const GuardGate: FunctionComponent<{
  result: GuardResult | null;
  children: ComponentChildren;
}> = ({ result, children }) => {
  const { route } = useLocation();
  if (result && 'redirect' in result) {
    if (isBrowser()) {
      route(result.redirect);
      return null;
    }
    throw new GuardRedirect(result.redirect);
  }
  if (result && 'render' in result) {
    const Fallback = result.render;
    return <Fallback />;
  }
  return <>{children}</>;
};

type GuardRefValue = {
  current: { read: () => GuardResult };
};

function GuardConsumer({
  guardRef,
  children,
}: {
  guardRef: GuardRefValue;
  children: ComponentChildren;
}) {
  const result = (guardRef.current.read() ?? null) as GuardResult | null;
  return (
    <GuardResultContext.Provider value={result}>
      <GuardGate result={result}>{children}</GuardGate>
    </GuardResultContext.Provider>
  );
}

function startGuardChain(
  guards: GuardFn[],
  location: RouteHook,
  honoCtx: Context | undefined,
): Promise<GuardResult> {
  if (isBrowser()) {
    const active = guards.filter(
      (g): g is ClientGuardFn => g.runs === 'client',
    );
    return runClientGuards(active, { location });
  }
  if (!honoCtx) {
    throw new Error(
      '<Guards> rendered server-side without a HonoContext.Provider. ' +
      'renderPage must wrap the prerendered tree in <HonoContext.Provider value={{ context: c }}>.',
    );
  }
  const active = guards.filter((g): g is ServerGuardFn => g.runs === 'server');
  return runServerGuards(active, { c: honoCtx, location });
}

export const Guards: FunctionComponent<{
  guards?: GuardFn[];
  location: RouteHook;
  fallback?: JSX.Element;
  children: ComponentChildren;
}> = ({ guards = [], location, fallback, children }) => {
  const honoCtx = useContext(HonoRequestContext).context;
  const prevPath = useRef(location.path);
  const guardRef = useRef(wrapPromise(startGuardChain(guards, location, honoCtx)));
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    guardRef.current = wrapPromise(startGuardChain(guards, location, honoCtx));
  }
  return (
    <Suspense fallback={fallback}>
      <GuardConsumer guardRef={guardRef}>{children}</GuardConsumer>
    </Suspense>
  );
};
```

- [ ] **Step 7: Update `packages/iso/src/__tests__/guards-filter.test.tsx` to wrap with the provider**

The existing filter test renders `<Guards>` directly in a happy-dom-ish environment. Server-mode tests that use `defineServerGuard` need to be wrapped in `<HonoRequestContext.Provider value={{ context: fakeC }}>`. Open the file and:

1. Add the imports:
   ```ts
   import type { Context } from 'hono';
   import { HonoRequestContext } from '../internal/contexts.js';
   ```
2. Define a fixture at the top of the test file: `const fakeC = {} as Context;`.
3. For each `render(<Guards ... />)` call that uses `defineServerGuard`, wrap it: `render(<HonoRequestContext.Provider value={{ context: fakeC }}><Guards ... /></HonoRequestContext.Provider>)`.

Client-mode renders (`isBrowser()` returning true) do not need the provider and should be left alone.

- [ ] **Step 8: Run iso test suite**

Run: `pnpm --filter @hono-preact/iso test --run`
Expected: PASS for all guard, guards-filter, guards-honocontext, page, and define-page tests. If `page.test.tsx` triggers the "rendered server-side without a HonoContext.Provider" error, wrap its server-mode renders the same way as guards-filter.

- [ ] **Step 9: Run server test suite**

Run: `pnpm --filter @hono-preact/server test --run`
Expected: PASS — `useHonoContext` still re-exports the same object, just from a new source.

- [ ] **Step 10: Commit**

```bash
git add packages/iso/src/internal/contexts.ts packages/iso/src/internal/guards.tsx packages/iso/src/internal.ts packages/iso/src/__tests__/guards-filter.test.tsx packages/iso/src/__tests__/guards-honocontext.test.tsx packages/server/src/context.ts
git commit -m "feat(iso): <Guards> reads HonoRequestContext and feeds c into server guards"
```

---

## Phase 5: renderPage installs the provider

### Task 5: Wrap prerender tree in `<HonoRequestContext.Provider>`

**Files:**
- Modify: `packages/server/src/render.tsx`
- Create: `packages/server/src/__tests__/render-honocontext.test.tsx`

- [ ] **Step 1: Write a failing test that asserts a server guard inside a prerendered tree receives `c`**

Create `packages/server/src/__tests__/render-honocontext.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { defineServerGuard, GuardRedirect } from '@hono-preact/iso';
import { Guards } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';
import { renderPage } from '../render.js';

const loc = {
  path: '/admin',
  url: 'http://localhost/admin',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

describe('renderPage installs HonoRequestContext.Provider', () => {
  it('a server guard inside the rendered tree receives the request c', async () => {
    let observedHeader: string | undefined = undefined;
    const probe = defineServerGuard(async (ctx, next) => {
      observedHeader = ctx.c.req.header('x-test');
      return next();
    });

    const Page = () => (
      <html>
        <body>
          <Guards guards={[probe]} location={loc}>
            <div>ok</div>
          </Guards>
        </body>
      </html>
    );

    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Page />));

    const res = await app.request('http://localhost/admin', {
      headers: { 'x-test': 'hello' },
    });
    expect(res.status).toBe(200);
    expect(observedHeader).toBe('hello');
  });

  it('a server guard can short-circuit by returning a redirect, surfaced by renderPage', async () => {
    const redirectGuard = defineServerGuard(async () => ({ redirect: '/login' }));

    const Page = () => (
      <html>
        <body>
          <Guards guards={[redirectGuard]} location={loc}>
            <div>protected</div>
          </Guards>
        </body>
      </html>
    );

    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Page />));

    const res = await app.request('http://localhost/admin');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/server test -- render-honocontext --run`
Expected: FAIL — `<Guards>` throws "rendered server-side without a HonoContext.Provider" because `renderPage` does not yet install the provider.

- [ ] **Step 3: Wrap the prerender tree in `<HonoRequestContext.Provider>`**

In `packages/server/src/render.tsx`, add the import (next to the existing iso imports):

```ts
import { HonoRequestContext } from '@hono-preact/iso/internal';
```

Then change the `prerender` invocation (currently around line 37):

```ts
      const rendered = await prerender(
        <HonoRequestContext.Provider value={{ context: c }}>
          <HoofdProvider value={dispatcher}>{node}</HoofdProvider>
        </HonoRequestContext.Provider>
      );
```

- [ ] **Step 4: Run the new test**

Run: `pnpm --filter @hono-preact/server test -- render-honocontext --run`
Expected: PASS, both cases (header observation + redirect propagation).

- [ ] **Step 5: Run the full server test suite**

Run: `pnpm --filter @hono-preact/server test --run`
Expected: PASS. The existing `render.test.tsx` `RedirectingPage` test still works because `GuardRedirect` propagates through the provider unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/render.tsx packages/server/src/__tests__/render-honocontext.test.tsx
git commit -m "feat(server): renderPage installs HonoRequestContext.Provider for server guards"
```

---

## Phase 6: End-to-end smoke + docs

### Task 6: Cookie smoke test through the full stack

**Files:**
- Create: `packages/server/src/__tests__/render-cookie-smoke.test.tsx`
- Modify: `apps/app/src/pages/docs/guards.mdx`

This task proves the seam works end-to-end with a real Hono helper (`getSignedCookie`). It is the nearest thing to "the auth recipe compiles" without writing the full recipe, which lives in a separate plan (issue #35).

- [ ] **Step 1: Write the smoke test**

Create `packages/server/src/__tests__/render-cookie-smoke.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { setSignedCookie, getSignedCookie } from 'hono/cookie';
import { defineServerGuard } from '@hono-preact/iso';
import { Guards } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';
import { renderPage } from '../render.js';

const loc = {
  path: '/protected',
  url: 'http://localhost/protected',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const SECRET = 'test-secret-do-not-use-in-prod';

describe('end-to-end cookie auth pattern', () => {
  it('a server guard reads a signed cookie via getSignedCookie(ctx.c, …)', async () => {
    let userObserved: string | null = null;

    const requireSignedSession = defineServerGuard(async (ctx, next) => {
      const user = await getSignedCookie(ctx.c, SECRET, 'session');
      if (!user) return { redirect: '/login' };
      userObserved = user;
      return next();
    });

    const ProtectedPage = () => (
      <html>
        <body>
          <Guards guards={[requireSignedSession]} location={loc}>
            <div>secret</div>
          </Guards>
        </body>
      </html>
    );

    const app = new Hono();
    app.get('/login-as/:user', async (c) => {
      await setSignedCookie(c, 'session', c.req.param('user'), SECRET);
      return c.text('ok');
    });
    app.get('/protected', (c) => renderPage(c, <ProtectedPage />));

    // Prime the cookie jar.
    const loginRes = await app.request('http://localhost/login-as/alice');
    const cookie = loginRes.headers.get('set-cookie');
    expect(cookie).toBeTruthy();

    // Hit the protected page with the signed cookie present.
    const okRes = await app.request('http://localhost/protected', {
      headers: { cookie: cookie! },
    });
    expect(okRes.status).toBe(200);
    expect(userObserved).toBe('alice');

    // Hit the protected page with no cookie -> redirect.
    const redirectRes = await app.request('http://localhost/protected');
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get('location')).toBe('/login');
  });
});
```

- [ ] **Step 2: Run the smoke test**

Run: `pnpm --filter @hono-preact/server test -- render-cookie-smoke --run`
Expected: PASS, both branches (authorised and redirected).

- [ ] **Step 3: Update `apps/app/src/pages/docs/guards.mdx`**

Find the section that defines `defineServerGuard`. Add a paragraph and code block:

> Server guards receive `ctx.c`, the request's Hono `Context`. That gives a guard everything it needs to enforce auth using Hono's helpers directly. Below: a guard that reads a signed cookie and redirects on failure.
>
> ```ts
> import { defineServerGuard } from 'hono-preact';
> import { getSignedCookie } from 'hono/cookie';
>
> export const requireSession = defineServerGuard(async (ctx, next) => {
>   const user = await getSignedCookie(ctx.c, process.env.SESSION_SECRET!, 'session');
>   if (!user) return { redirect: '/login' };
>   return next();
> });
> ```
>
> Client guards receive only `{ location }`; cookies, headers, and `Bindings` are server-only. A guard that needs both server- and client-side logic is two declarations: `defineServerGuard(...)` plus `defineClientGuard(...)` in the same `guards` list.

- [ ] **Step 4: Run the whole repo's test suite as a final check**

Run: `pnpm test`
Expected: PASS across iso, server, vite, hono-preact, and apps/app.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/__tests__/render-cookie-smoke.test.tsx apps/app/src/pages/docs/guards.mdx
git commit -m "test(server): end-to-end signed-cookie auth smoke through guards"
```

---

## Phase 7: Validation V3 — loader can set a response cookie

**Why:** The auth-investigation spec (`docs/superpowers/specs/2026-05-14-auth-investigation-design.md` §V3) flags an open question: if a loader calls `setCookie(c, …)`, does that header survive to the response? Plausible failure modes: response headers serialized before the loader runs (streaming SSR), or the dispatcher consumes the response shape in a way that drops user-set headers. Both paths (RPC + SSR) need the answer; if either is "no," that's a separate framework gap.

The spec also lists V1 (does user `app.use(csrf())` reach `/__actions` & `/__loaders`) and V2 (is `c.env` populated on Workers). V1 is folded into the recipe-authoring plan (issue #35) since it's most naturally tested as part of the CSRF section. V2 cannot be exercised in Vitest (needs `wrangler dev` against a real Worker); it is a manual check during the recipe plan, captured in this plan's self-review only.

### Task 7: Loader-sets-cookie tests (RPC + SSR paths)

**Files:**
- Create: `packages/server/src/__tests__/loader-sets-cookie.test.tsx`

- [ ] **Step 1: Write the test (RPC path)**

```tsx
import { describe, it, expect } from 'vitest';
import { Hono, type Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { loadersHandler } from '../loaders-handler.js';

describe('V3 — loader can set a response cookie', () => {
  it('RPC dispatcher path: setCookie(ctx.c, …) survives to the response', async () => {
    const setRotated = async (ctx: { c: Context }) => {
      setCookie(ctx.c, 'rotated', 'new-value', { httpOnly: true });
      return { ok: true };
    };

    const app = new Hono();
    app.post('/__loaders', loadersHandler({
      './x.server.ts': { __moduleKey: 'x', serverLoaders: { default: setRotated } },
    }));

    const res = await app.request('http://localhost/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'x',
        loader: 'default',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get('set-cookie');
    expect(setCookieHeader).toBeTruthy();
    expect(setCookieHeader).toContain('rotated=new-value');
    expect(setCookieHeader).toContain('HttpOnly');
  });
});
```

- [ ] **Step 2: Run the RPC test**

Run: `pnpm --filter @hono-preact/server test -- loader-sets-cookie --run`
Expected: PASS. If it fails, the framework has a real V3 gap — capture which header the dispatcher ate and open a separate issue. **Do not patch in this plan.**

- [ ] **Step 3: Write the test (SSR path)**

Append to the same file:

```tsx
import { defineLoader } from '@hono-preact/iso';
import { renderPage } from '../render.js';

it('SSR path: a loader rendered during prerender can set a response cookie', async () => {
  const ref = defineLoader(async (ctx) => {
    setCookie(ctx.c, 'rotated-ssr', 'ssr-value');
    return { ok: true };
  });

  function Page() {
    return (
      <html>
        <body>
          <ref.Boundary>
            <ref.View>{() => <div>ok</div>}</ref.View>
          </ref.Boundary>
        </body>
      </html>
    );
  }

  const app = new Hono();
  app.get('*', (c) => renderPage(c, <Page />));

  const res = await app.request('http://localhost/x');
  const setCookieHeader = res.headers.get('set-cookie');

  // Two acceptable outcomes:
  //   a) header present  -> V3 = "yes" for SSR; recipe says this works.
  //   b) header absent   -> V3 = "no" for SSR (likely streaming response
  //      headers are committed before the loader runs); recipe says
  //      "set cookies from an action, not a loader, when the page streams."
  // The test asserts the OBSERVED behavior so a future change is loud.
  if (setCookieHeader) {
    expect(setCookieHeader).toContain('rotated-ssr=ssr-value');
  } else {
    expect(setCookieHeader).toBeNull();
  }
});
```

- [ ] **Step 4: Run the SSR test and record the outcome**

Run: `pnpm --filter @hono-preact/server test -- loader-sets-cookie --run`

The test passes either way (it asserts the observed behavior, not the spec's preferred behavior). Record the result in the commit message and in the recipe plan's self-review:

- If header present → recipe Section 1 says "loaders can rotate sessions."
- If header absent → recipe Section 1 says "rotate sessions from an action; loaders are read-only on the response in v0.1."

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/__tests__/loader-sets-cookie.test.tsx
git commit -m "test(server): V3 validation — loader Set-Cookie behavior on RPC + SSR paths"
```

---

## Self-Review Notes

- **Spec alignment:** Cross-checked against `docs/superpowers/specs/2026-05-14-auth-investigation-design.md`. Differences worth flagging back to that spec:
  - **Action typing.** The spec lists action context as out-of-scope ("Actions already receive `{ c, signal }`; that stays"). At runtime that's true, but `ActionCtx.c` is statically typed `unknown`, so users still need `as Context` to call any Hono helper. Phase 1 of this plan tightens it. Recommend the spec author update §"Out of scope" to match.
  - **SSR loader path.** The spec correctly identifies two loader call sites (RPC dispatcher + `loader-runner.ts:65`) and defers the threading mechanism to planning. This plan picks ALS-via-`runRequestScope`-seed and does both sites (Phase 2 + Phase 2b).
  - **Validation tasks.** Spec lists V1, V2, V3. This plan covers V3 in Phase 7. V1 (does user `app.use(csrf())` reach `/__actions` & `/__loaders`) is deferred to the recipe-authoring plan since it's most natural as the CSRF section's integration test. V2 (`c.env` populated on Workers) cannot run in Vitest; flag it as a manual `wrangler dev` check during the recipe plan.
- **Type-coverage gaps:** Bare `Context` is `Context<any, any, {}>` via Hono's own defaults, so seam types use `Context` directly (no explicit generic args). Users with typed `Bindings` can cast `c.env as MyEnv` at the use site. Post-v0.1, the framework can grow generic factories (`defineServerGuard<Env>(…)`, `defineLoader<Env, T>(…)`) that thread `Env` through the seam types if real friction surfaces. Out of scope here.
- **Loader read-shape convention:** The spec asks the docs to note loaders are read-shaped (don't write response headers from a loader) without runtime enforcement. Phase 2 step 7's `loaders.mdx` edit should add one sentence: "By convention, loaders read; actions write. Setting cookies/headers from a loader is allowed but discouraged. See Phase 7 for the V3 outcome — `Set-Cookie` from a loader behaves consistently on the RPC path; SSR-path behavior depends on response timing."
- **No backwards-compatibility shims:** `runGuards` is removed (no users; commit 52d7c9b just landed the guards consolidation, no external code depends on it). `GuardContext` type alias is removed too. If a downstream lint or tsc pass surfaces a stray import, fix it inline rather than re-exporting.
- **HonoContext source-of-truth move:** Phase 4 moves the Preact context declaration from `packages/server/src/context.ts` into `packages/iso/src/internal/contexts.ts` to avoid an iso → server circular dep. The public export `HonoContext` (and `useHonoContext`) from `@hono-preact/server` is preserved as a re-export — user code is unchanged.
- **`runRequestScope` API extension is additive:** Phase 2b adds an optional `initial` parameter; existing single-arg callers keep working. The new `getRequestHonoContext()` export sits alongside `getRequestStore()` and is intended for framework-internal use only — not added to the public iso surface.
- **Test fixtures:** Several iso tests construct `LoaderCtx` / `GuardContext` literals. Phase 2 step 6 and Phase 4 step 7 explicitly call out updating those fixtures. If a test surface I missed fails, the fix is mechanical: add `c: {} as any` to the literal.
