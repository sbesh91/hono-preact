# Single Guards List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `definePage`'s parallel `serverGuards` / `clientGuards` arrays with a single ordered `guards` list. Each guard is built by `defineServerGuard(fn)` or `defineClientGuard(fn)`. The Vite plugin statically rewrites these calls in opposite-env bundles so server-only guard bodies (and helpers referenced only there) tree-shake out. Same PR tightens `ActionGuardError.status` to Hono's `ContentfulStatusCode`.

**Architecture:** Two layers of change. (1) `@hono-preact/iso` runtime: `GuardFn` becomes a `{ runs, fn }` record built by `defineServerGuard` / `defineClientGuard`. `Guards` filters by env, `runGuards` calls `g.fn`. `definePage`'s `PageBindings` collapses to a single `guards?: GuardFn[]`. (2) `@hono-preact/vite` plugin: a new `guardStripPlugin` runs on both client and server passes. Client pass rewrites `defineServerGuard(...)` → `defineServerGuard(__$guardNoop_hpiso)`; server pass does the symmetric rewrite for `defineClientGuard`. Recognition is import-name tracking with alias support. Bundle-content tests pin the tree-shake behavior so regressions are loud.

**Tech Stack:** TypeScript, Preact, preact-iso, Vite (plugins), @babel/parser + magic-string (AST transforms), vitest + happy-dom, pnpm workspace, Hono (server).

**Spec:** `docs/superpowers/specs/2026-05-13-single-guards-list-design.md`

---

## File Structure

### Files modified

- `packages/iso/src/guard.ts`; `GuardFn` becomes a record `{ runs, fn }`; replace `createGuard` with `defineServerGuard` and `defineClientGuard`; `runGuards` calls `g.fn`.
- `packages/iso/src/internal/guards.tsx`; single `guards?: GuardFn[]` prop; filter `g.runs === env`.
- `packages/iso/src/page.tsx`; `PageProps.guards` replaces `serverGuards` / `clientGuards`; forwards to `<Guards>`.
- `packages/iso/src/define-page.tsx`; `PageBindings.guards` replaces the two old props.
- `packages/iso/src/internal.ts`; export internal `__$guardNoop_hpiso` for the plugin to import.
- `packages/iso/src/index.ts`; export `defineServerGuard`, `defineClientGuard`, `type GuardRunsOn`; re-export `type ContentfulStatusCode` from `hono/utils/http-status`; drop `createGuard` export.
- `packages/iso/src/action.ts`; narrow `ActionGuardError.status` constructor type to `ContentfulStatusCode`.
- `packages/server/src/actions-handler.ts`; drop the narrow status cast.
- `packages/vite/src/server-loader-validation.ts`; remove `serverGuards` from the allowlist.
- `packages/vite/src/server-only.ts`; remove the `serverGuards`-named-import stubbing branch (keep `actionGuards`).
- `packages/vite/src/hono-preact.ts`; register the new `guardStripPlugin` in the plugin pipeline.
- `packages/vite/src/index.ts`; export `guardStripPlugin`.
- `packages/iso/src/__tests__/page.test.tsx`; migrate guard tests to the single-list shape.
- `packages/iso/src/__tests__/define-page.test.tsx`; migrate `PageBindings` tests.
- `packages/vite/src/__tests__/server-only-plugin.test.ts`; drop the `serverGuards` stubbing test.
- `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`; update allowlist tests.
- `apps/app/src/pages/docs/guards.mdx`; rewrite for the new surface.
- `apps/app/src/pages/docs/structure.mdx`; update `definePage` bindings line and the `.server.*` allowlist callout.
- `apps/app/src/pages/docs/loaders.mdx`; update the bindings line.
- `apps/app/src/pages/docs/loading-states.mdx`; update the bindings callout.
- `apps/app/src/pages/docs/action-guards.mdx`; update `ActionGuardError` constructor signature and `ContentfulStatusCode` import note.
- `docs/superpowers/specs/2026-05-09-v0.1-framework-direction.md`; replace section 7 sketch with the final design.

### Files created

- `packages/iso/src/internal/guard-noop.ts`; exports `__$guardNoop_hpiso`, a passthrough guard body.
- `packages/vite/src/guard-strip.ts`; the new `guardStripPlugin`.
- `packages/vite/src/__tests__/guard-strip-plugin.test.ts`; transform-level tests for the rewrite.
- `packages/vite/src/__tests__/guards-bundle.test.ts`; end-to-end `vite build` bundle-content tests.
- `packages/vite/src/__tests__/fixtures/guards-treeshake/`; small fixture for the bundle test.

---

## Phase 1: Runtime API (no plugin work)

### Task 1: Switch `GuardFn` to record shape; add `defineServerGuard` and `defineClientGuard`

**Files:**
- Modify: `packages/iso/src/guard.ts`
- Test: `packages/iso/src/__tests__/guard.test.ts` (create)

- [ ] **Step 1: Write failing tests for the new factory shape**

Create `packages/iso/src/__tests__/guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { RouteHook } from 'preact-iso';
import {
  defineServerGuard,
  defineClientGuard,
  runGuards,
  type GuardFn,
} from '../guard.js';

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

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
});

describe('runGuards composes records via .fn', () => {
  it('threads next() through each guard in order', async () => {
    const calls: string[] = [];
    const a: GuardFn = defineServerGuard(async (_c, next) => {
      calls.push('a:before');
      const r = await next();
      calls.push('a:after');
      return r;
    });
    const b: GuardFn = defineServerGuard(async (_c, next) => {
      calls.push('b');
      return next();
    });
    const result = await runGuards([a, b], { location: loc });
    expect(result).toBeUndefined();
    expect(calls).toEqual(['a:before', 'b', 'a:after']);
  });

  it('short-circuits on the first non-void return', async () => {
    const a = defineServerGuard(async (_c, next) => next());
    const b = defineServerGuard(async () => ({ redirect: '/login' }));
    const c = defineServerGuard(async (_c, next) => {
      throw new Error('should not run');
    });
    const result = await runGuards([a, b, c], { location: loc });
    expect(result).toEqual({ redirect: '/login' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/iso vitest run src/__tests__/guard.test.ts`
Expected: FAIL with module-resolution errors (`defineServerGuard` / `defineClientGuard` not exported).

- [ ] **Step 3: Replace `packages/iso/src/guard.ts` with the new shape**

Replace the entire file contents with:

```ts
// src/iso/guard.ts
import { type FunctionComponent } from 'preact';
import { type RouteHook } from 'preact-iso';

export type GuardRunsOn = 'server' | 'client';

export type GuardResult =
  | { redirect: string }
  | { render: FunctionComponent }
  | void;

export type GuardContext = {
  location: RouteHook;
};

export type GuardFn = {
  readonly runs: GuardRunsOn;
  readonly fn: (
    ctx: GuardContext,
    next: () => Promise<GuardResult>,
  ) => Promise<GuardResult>;
};

export const defineServerGuard = (fn: GuardFn['fn']): GuardFn => ({
  runs: 'server',
  fn,
});

export const defineClientGuard = (fn: GuardFn['fn']): GuardFn => ({
  runs: 'client',
  fn,
});

export const runGuards = async (
  guards: GuardFn[],
  ctx: GuardContext,
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/iso vitest run src/__tests__/guard.test.ts`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/guard.ts packages/iso/src/__tests__/guard.test.ts
git commit -m "feat(iso): replace createGuard with defineServerGuard/defineClientGuard record shape"
```

---

### Task 2: Create internal `__$guardNoop_hpiso` and re-export from `internal.ts`

**Files:**
- Create: `packages/iso/src/internal/guard-noop.ts`
- Modify: `packages/iso/src/internal.ts`

- [ ] **Step 1: Write the new file**

Create `packages/iso/src/internal/guard-noop.ts`:

```ts
import type { GuardResult } from '../guard.js';

/**
 * Passthrough guard body used by the Vite `guardStripPlugin` to replace
 * opposite-env guard bodies at build time. Importing this in user code is
 * supported but unnecessary; the plugin handles the substitution.
 */
export const __$guardNoop_hpiso = (
  _ctx: unknown,
  next: () => Promise<GuardResult>,
): Promise<GuardResult> => next();
```

- [ ] **Step 2: Re-export from `internal.ts`**

Open `packages/iso/src/internal.ts` and append:

```ts
export { __$guardNoop_hpiso } from './internal/guard-noop.js';
```

- [ ] **Step 3: Verify the iso package still builds**

Run: `pnpm --filter @hono-preact/iso build`
Expected: clean build, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/internal/guard-noop.ts packages/iso/src/internal.ts
git commit -m "feat(iso): add __\$guardNoop_hpiso for plugin-driven body stripping"
```

---

### Task 3: Update `<Guards>` to take a single `guards` prop and filter by env

**Files:**
- Modify: `packages/iso/src/internal/guards.tsx`
- Test: `packages/iso/src/__tests__/guards-filter.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/guards-filter.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import {
  defineServerGuard,
  defineClientGuard,
  type GuardFn,
} from '../guard.js';
import { Guards } from '../internal/guards.js';
import { env } from '../is-browser.js';

vi.mock('preact-iso', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useLocation: () => ({ route: () => {} }) };
});

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const originalEnv = env.current;
afterEach(() => {
  env.current = originalEnv;
  cleanup();
});

describe('Guards env filter', () => {
  it('runs server guards on the server, skips client guards', async () => {
    env.current = 'server';
    const calls: string[] = [];
    const sg = defineServerGuard(async (_c, next) => {
      calls.push('server');
      return next();
    });
    const cg = defineClientGuard(async (_c, next) => {
      calls.push('client');
      return next();
    });
    render(
      <LocationProvider>
        <Guards guards={[sg, cg]} location={loc}>
          <div data-testid="page">ok</div>
        </Guards>
      </LocationProvider>,
    );
    await screen.findByTestId('page');
    expect(calls).toEqual(['server']);
  });

  it('runs client guards on the client, skips server guards', async () => {
    env.current = 'browser';
    const calls: string[] = [];
    const sg = defineServerGuard(async (_c, next) => {
      calls.push('server');
      return next();
    });
    const cg = defineClientGuard(async (_c, next) => {
      calls.push('client');
      return next();
    });
    render(
      <LocationProvider>
        <Guards guards={[sg, cg]} location={loc}>
          <div data-testid="page">ok</div>
        </Guards>
      </LocationProvider>,
    );
    await screen.findByTestId('page');
    expect(calls).toEqual(['client']);
  });

  it('preserves array order across env filter', async () => {
    env.current = 'browser';
    const calls: string[] = [];
    const a = defineClientGuard(async (_c, next) => {
      calls.push('a');
      return next();
    });
    const b = defineServerGuard(async (_c, next) => {
      calls.push('b-server');
      return next();
    });
    const c = defineClientGuard(async (_c, next) => {
      calls.push('c');
      return next();
    });
    render(
      <LocationProvider>
        <Guards guards={[a, b, c]} location={loc}>
          <div data-testid="page">ok</div>
        </Guards>
      </LocationProvider>,
    );
    await screen.findByTestId('page');
    expect(calls).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/iso vitest run src/__tests__/guards-filter.test.tsx`
Expected: FAIL with a type error (the `<Guards>` prop is `server`/`client`, not `guards`).

- [ ] **Step 3: Replace `packages/iso/src/internal/guards.tsx` content**

Replace the file with:

```tsx
import type { ComponentChildren, FunctionComponent, JSX } from 'preact';
import { type RouteHook, useLocation } from 'preact-iso';
import { Suspense } from 'preact/compat';
import { useContext, useRef } from 'preact/hooks';
import {
  type GuardFn,
  type GuardRunsOn,
  GuardRedirect,
  type GuardResult,
  runGuards,
} from '../guard.js';
import { isBrowser } from '../is-browser.js';
import wrapPromise from './wrap-promise.js';
import { GuardResultContext } from './contexts.js';

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

export const Guards: FunctionComponent<{
  guards?: GuardFn[];
  location: RouteHook;
  fallback?: JSX.Element;
  children: ComponentChildren;
}> = ({ guards = [], location, fallback, children }) => {
  const env: GuardRunsOn = isBrowser() ? 'client' : 'server';
  const active = guards.filter((g) => g.runs === env);
  const prevPath = useRef(location.path);
  const guardRef = useRef(wrapPromise(runGuards(active, { location })));
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    guardRef.current = wrapPromise(runGuards(active, { location }));
  }
  return (
    <Suspense fallback={fallback}>
      <GuardConsumer guardRef={guardRef}>{children}</GuardConsumer>
    </Suspense>
  );
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/iso vitest run src/__tests__/guards-filter.test.tsx`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/guards.tsx packages/iso/src/__tests__/guards-filter.test.tsx
git commit -m "feat(iso): Guards filters by env using GuardFn.runs"
```

---

### Task 4: Update `<Page>` and `definePage` bindings

**Files:**
- Modify: `packages/iso/src/page.tsx`
- Modify: `packages/iso/src/define-page.tsx`
- Modify: `packages/iso/src/__tests__/page.test.tsx`
- Modify: `packages/iso/src/__tests__/define-page.test.tsx`

- [ ] **Step 1: Update `packages/iso/src/page.tsx`**

Replace the file with:

```tsx
import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useId } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import type { GuardFn } from './guard.js';
import { Guards } from './internal/guards.js';
import { RouteBoundary } from './internal/route-boundary.js';

export type WrapperProps = {
  id: string;
  'data-loader': string;
  children: ComponentChildren;
};

const DefaultWrapper: FunctionComponent<WrapperProps> = (props) => (
  <section {...props} />
);

export type PageProps = {
  location: RouteHook;
  guards?: GuardFn[];
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  Wrapper?: ComponentType<WrapperProps>;
  children: ComponentChildren;
};

export function Page({
  location,
  guards,
  errorFallback,
  Wrapper,
  children,
}: PageProps): JSX.Element {
  const id = useId();
  const W = Wrapper ?? DefaultWrapper;
  return (
    <RouteBoundary errorFallback={errorFallback}>
      <Guards guards={guards} location={location}>
        <W id={id} data-loader="null">
          {children}
        </W>
      </Guards>
    </RouteBoundary>
  );
}
```

- [ ] **Step 2: Update `packages/iso/src/define-page.tsx`**

Replace the file with:

```tsx
import type { ComponentType, FunctionComponent, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import type { GuardFn } from './guard.js';
import { Page, type WrapperProps } from './page.js';

export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  guards?: GuardFn[];
};

export function definePage(
  Component: ComponentType,
  bindings?: PageBindings,
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = (location) => (
    <Page
      Wrapper={bindings?.Wrapper}
      errorFallback={bindings?.errorFallback}
      guards={bindings?.guards}
      location={location}
    >
      <Component />
    </Page>
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
```

- [ ] **Step 3: Migrate existing guard tests in `page.test.tsx`**

Open `packages/iso/src/__tests__/page.test.tsx`. Replace `import { createGuard, GuardRedirect, runGuards } from '../guard.js';` with `import { defineServerGuard, defineClientGuard, GuardRedirect, runGuards } from '../guard.js';`. Replace every `createGuard(...)` with either `defineServerGuard(...)` or `defineClientGuard(...)` to match the test's intent:

- Tests that pass `clientGuards={[guard]}` → use `defineClientGuard` and pass via `guards={[guard]}`.
- Tests that operate purely on `runGuards(...)` (no env coupling) → use either; `defineServerGuard` is fine.

Update each `<Page ... clientGuards={[guard]}>` to `<Page ... guards={[guard]}>` and remove the `clientGuards` prop. Same for any `serverGuards`.

- [ ] **Step 4: Migrate `define-page.test.tsx`**

Open `packages/iso/src/__tests__/define-page.test.tsx`. Find the two test blocks that mention `serverGuards`/`clientGuards`. Replace:

```tsx
const guard: GuardFn = async (_ctx, next) => next();
const bindings: PageBindings = {
  errorFallback: (err, reset) => <button onClick={reset}>{err.message}</button>,
  serverGuards: [guard],
  clientGuards: [guard],
};
```

with:

```tsx
import { defineServerGuard, defineClientGuard } from '../guard.js';
const sg = defineServerGuard(async (_ctx, next) => next());
const cg = defineClientGuard(async (_ctx, next) => next());
const bindings: PageBindings = {
  errorFallback: (err, reset) => <button onClick={reset}>{err.message}</button>,
  guards: [sg, cg],
};
```

The second test block (`'accepts errorFallback, serverGuards, clientGuards on the bindings type'`) becomes:

```tsx
it('accepts errorFallback and guards on the bindings type', () => {
  const guard = defineServerGuard(async (_ctx, next) => next());
  const bindings: PageBindings = {
    errorFallback: (err, reset) => <button onClick={reset}>{err.message}</button>,
    guards: [guard],
  };
  expectTypeOf(bindings.errorFallback).toMatchTypeOf<
    JSX.Element | ((error: Error, reset: () => void) => JSX.Element) | undefined
  >();
  expectTypeOf(bindings.guards).toEqualTypeOf<GuardFn[] | undefined>();
});
```

Drop the unused `import type { GuardFn }` if no longer needed, or keep it for the `expectTypeOf` line.

- [ ] **Step 5: Run both test files**

Run: `pnpm --filter @hono-preact/iso vitest run src/__tests__/page.test.tsx src/__tests__/define-page.test.tsx`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/page.tsx packages/iso/src/define-page.tsx packages/iso/src/__tests__/page.test.tsx packages/iso/src/__tests__/define-page.test.tsx
git commit -m "feat(iso): unify definePage guards binding; drop serverGuards/clientGuards props"
```

---

### Task 5: Update iso package exports; drop `createGuard`; add the new factories

**Files:**
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Edit the Guards section of `packages/iso/src/index.ts`**

Replace:

```ts
// Guards.
export { createGuard, GuardRedirect } from './guard.js';
export type { GuardFn, GuardResult, GuardContext } from './guard.js';
```

with:

```ts
// Guards.
export {
  defineServerGuard,
  defineClientGuard,
  GuardRedirect,
} from './guard.js';
export type {
  GuardFn,
  GuardResult,
  GuardContext,
  GuardRunsOn,
} from './guard.js';
```

- [ ] **Step 2: Add `ContentfulStatusCode` re-export**

In `packages/iso/src/index.ts`, find the action-guards export block:

```ts
export { ActionGuardError, defineActionGuard } from './action.js';
```

Append directly below:

```ts
export type { ContentfulStatusCode } from 'hono/utils/http-status';
```

- [ ] **Step 3: Build iso to verify exports compile**

Run: `pnpm --filter @hono-preact/iso build`
Expected: clean build.

- [ ] **Step 4: Search the monorepo for stale `createGuard` references**

Run: `grep -rn "createGuard" packages/ apps/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules`
Expected: only matches inside `apps/app/src/pages/docs/*.mdx` (handled in Phase 5) and possibly historical spec/plan files under `docs/superpowers/` (leave those untouched).

If any code-side hit appears outside the docs/specs, update it now.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/index.ts
git commit -m "feat(iso): export defineServerGuard/defineClientGuard; re-export ContentfulStatusCode"
```

---

## Phase 2: ActionGuardError status type fix

### Task 6: Narrow `ActionGuardError.status` to `ContentfulStatusCode`

**Files:**
- Modify: `packages/iso/src/action.ts`
- Modify: `packages/server/src/actions-handler.ts`

- [ ] **Step 1: Tighten the constructor**

Open `packages/iso/src/action.ts`. At the top of the file, add an import:

```ts
import type { ContentfulStatusCode } from 'hono/utils/http-status';
```

Replace the `ActionGuardError` class with:

```ts
export class ActionGuardError extends Error {
  constructor(
    message: string,
    public readonly status: ContentfulStatusCode = 403,
  ) {
    super(message);
    this.name = 'ActionGuardError';
  }
}
```

- [ ] **Step 2: Drop the response cast in `actions-handler.ts`**

Open `packages/server/src/actions-handler.ts`. Find the line:

```ts
return c.json({ error: err.message }, err.status as 400 | 401 | 403 | 404 | 429 | 500);
```

Replace with:

```ts
return c.json({ error: err.message }, err.status);
```

- [ ] **Step 3: Build both packages**

Run: `pnpm --filter @hono-preact/iso build && pnpm --filter @hono-preact/server build`
Expected: clean builds.

- [ ] **Step 4: Run the actions-handler test suite to confirm runtime behavior is unchanged**

Run: `pnpm --filter @hono-preact/server vitest run src/__tests__/actions-handler.test.ts`
Expected: PASS, no test changes required.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/action.ts packages/server/src/actions-handler.ts
git commit -m "fix(iso,server): narrow ActionGuardError.status to ContentfulStatusCode"
```

---

## Phase 3: Drop the obsolete `serverGuards` plugin handling

### Task 7: Remove `serverGuards` from the `.server.*` allowlist

**Files:**
- Modify: `packages/vite/src/server-loader-validation.ts`
- Modify: `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`

- [ ] **Step 1: Update the allowlist**

Open `packages/vite/src/server-loader-validation.ts`. Change:

```ts
const ALLOWED_NAMED_EXPORTS = new Set(['serverGuards', 'serverActions', 'actionGuards', 'serverLoaders']);
```

to:

```ts
const ALLOWED_NAMED_EXPORTS = new Set(['serverActions', 'actionGuards', 'serverLoaders']);
```

- [ ] **Step 2: Update existing tests in `server-loader-validation-plugin.test.ts`**

Open the test file. Search for any test referencing `serverGuards`. Either remove the test (if its sole purpose was asserting allowlist membership for `serverGuards`) or rewrite it to assert that `serverGuards` is now REJECTED:

```ts
it('rejects serverGuards named export (removed from allowlist)', () => {
  const plugin = serverLoaderValidationPlugin() as Plugin & {
    transform: (code: string, id: string) => unknown;
  };
  const code = `
    export const serverGuards = [];
    export const serverLoaders = { default: () => ({}) };
  `;
  let captured = '';
  const ctx = { error: (msg: string) => { captured = msg; throw new Error(msg); } };
  expect(() => plugin.transform.call(ctx as any, code, '/x/foo.server.ts')).toThrow();
  expect(captured).toContain("'serverActions'");
  expect(captured).toContain("'actionGuards'");
  expect(captured).toContain("'serverLoaders'");
  expect(captured).toContain('serverGuards');  // mentioned in the disallowed list
});
```

- [ ] **Step 3: Run the validation-plugin tests**

Run: `pnpm --filter @hono-preact/vite vitest run src/__tests__/server-loader-validation-plugin.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/vite/src/server-loader-validation.ts packages/vite/src/__tests__/server-loader-validation-plugin.test.ts
git commit -m "feat(vite): drop serverGuards from .server.* allowlist"
```

---

### Task 8: Remove the `serverGuards` stubbing branch in `serverOnlyPlugin`

**Files:**
- Modify: `packages/vite/src/server-only.ts`
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`

- [ ] **Step 1: Update `server-only.ts`**

Open `packages/vite/src/server-only.ts`. Find the branch handling `serverGuards`/`actionGuards`:

```ts
} else if (
  specifier.type === 'ImportSpecifier' &&
  specifier.imported.type === 'Identifier' &&
  (specifier.imported.name === 'serverGuards' ||
    specifier.imported.name === 'actionGuards')
) {
  stubs.push(`const ${specifier.local.name} = [];`);
}
```

Replace with (keep `actionGuards` only):

```ts
} else if (
  specifier.type === 'ImportSpecifier' &&
  specifier.imported.type === 'Identifier' &&
  specifier.imported.name === 'actionGuards'
) {
  stubs.push(`const ${specifier.local.name} = [];`);
}
```

Also update the error message at the end of the same `for` loop (around the `throw new Error` for unrecognized exports). Currently:

```ts
throw new Error(
  `${id}: \`${importedName}\` is not a recognized export from a *.server.* module. ` +
  `Allowed: serverLoaders, serverGuards, serverActions, actionGuards.`
);
```

Change to:

```ts
throw new Error(
  `${id}: \`${importedName}\` is not a recognized export from a *.server.* module. ` +
  `Allowed: serverLoaders, serverActions, actionGuards.`
);
```

- [ ] **Step 2: Update `server-only-plugin.test.ts`**

Open `packages/vite/src/__tests__/server-only-plugin.test.ts`. Remove the test:

```ts
it('replaces serverGuards named import with an empty array stub', () => { ... });
```

Add a new test that ensures the unrecognized-import error now lists `serverGuards`:

```ts
it('throws on serverGuards named import (no longer recognized)', () => {
  const code = `import { serverGuards } from './movies.server.js';`;
  expect(() => transform(code, '/Users/me/repo/src/pages/movies.tsx')).toThrow(
    /is not a recognized export from a \*\.server\.\* module/,
  );
});
```

- [ ] **Step 3: Run the plugin tests**

Run: `pnpm --filter @hono-preact/vite vitest run src/__tests__/server-only-plugin.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/vite/src/server-only.ts packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "feat(vite): drop serverGuards stubbing from serverOnlyPlugin"
```

---

## Phase 4: New `guardStripPlugin`

### Task 9: Scaffold the plugin file with import-name tracking

**Files:**
- Create: `packages/vite/src/guard-strip.ts`
- Create: `packages/vite/src/__tests__/guard-strip-plugin.test.ts`

- [ ] **Step 1: Write the first failing test (client-pass rewrite)**

Create `packages/vite/src/__tests__/guard-strip-plugin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { guardStripPlugin } from '../guard-strip.js';
import type { Plugin } from 'vite';

type TransformFn = (
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => { code: string; map: unknown } | undefined;

function transform(
  code: string,
  id: string,
  options: { ssr?: boolean } = {},
): { code: string; map: unknown } | undefined {
  const plugin = guardStripPlugin() as Plugin & { transform: TransformFn };
  const { ssr } = options;
  return plugin.transform.call({} as any, code, id, ssr ? { ssr } : {});
}

describe('guardStripPlugin: client pass (non-ssr)', () => {
  it('replaces defineServerGuard call arg with the noop import', () => {
    const code = `
      import { defineServerGuard } from '@hono-preact/iso';
      const g = defineServerGuard(async (ctx, next) => {
        const x = await secret();
        return next();
      });
    `;
    const result = transform(code, '/src/pages/admin.tsx');
    expect(result?.code).toContain(
      "import { __\$guardNoop_hpiso } from '@hono-preact/iso/internal';",
    );
    expect(result?.code).toContain('defineServerGuard(__$guardNoop_hpiso)');
    expect(result?.code).not.toContain('await secret()');
  });

  it('does not touch defineClientGuard calls in client pass', () => {
    const code = `
      import { defineClientGuard } from '@hono-preact/iso';
      const g = defineClientGuard(async (ctx, next) => {
        await onClient();
        return next();
      });
    `;
    const result = transform(code, '/src/pages/admin.tsx');
    expect(result?.code ?? code).toContain('await onClient()');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (module missing)**

Run: `pnpm --filter @hono-preact/vite vitest run src/__tests__/guard-strip-plugin.test.ts`
Expected: FAIL with "Cannot find module '../guard-strip.js'".

- [ ] **Step 3: Create `packages/vite/src/guard-strip.ts` with the minimum to pass**

```ts
import { parse } from '@babel/parser';
import type {
  CallExpression,
  Identifier,
  ImportDeclaration,
} from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

const ISO_PACKAGE_SOURCES = new Set(['@hono-preact/iso', 'hono-preact']);
const NOOP_IMPORT_SOURCE = '@hono-preact/iso/internal';
const NOOP_LOCAL_NAME = '__$guardNoop_hpiso';

type GuardFactory = 'defineServerGuard' | 'defineClientGuard';

function collectLocalBindings(
  ast: ReturnType<typeof parse>,
  targets: Set<GuardFactory>,
): Map<string, GuardFactory> {
  const bindings = new Map<string, GuardFactory>();
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const imp = node as ImportDeclaration;
    if (!ISO_PACKAGE_SOURCES.has(imp.source.value)) continue;
    for (const spec of imp.specifiers) {
      if (spec.type !== 'ImportSpecifier') continue;
      if (spec.imported.type !== 'Identifier') continue;
      const name = spec.imported.name;
      if (name === 'defineServerGuard' || name === 'defineClientGuard') {
        if (targets.has(name)) {
          bindings.set(spec.local.name, name);
        }
      }
    }
  }
  return bindings;
}

function findCallsByLocalName(
  node: unknown,
  bindings: Map<string, GuardFactory>,
  hits: Array<{ start: number; end: number; argStart: number; argEnd: number }>,
): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) findCallsByLocalName(child, bindings, hits);
    return;
  }
  const n = node as {
    type?: string;
    callee?: Identifier & { type?: string; name?: string };
    arguments?: CallExpression['arguments'];
    start?: number;
    end?: number;
  };
  if (
    n.type === 'CallExpression' &&
    n.callee?.type === 'Identifier' &&
    n.callee.name &&
    bindings.has(n.callee.name) &&
    n.arguments &&
    n.arguments.length >= 1 &&
    n.arguments[0].start !== undefined &&
    n.arguments[0].end !== undefined
  ) {
    hits.push({
      start: n.start!,
      end: n.end!,
      argStart: n.arguments[0].start!,
      argEnd: n.arguments[0].end!,
    });
  }
  for (const key of Object.keys(node as object)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    findCallsByLocalName((node as Record<string, unknown>)[key], bindings, hits);
  }
}

export function guardStripPlugin(): Plugin {
  return {
    name: 'hono-preact:guard-strip',
    enforce: 'pre',
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (!/\.[jt]sx?$/.test(id)) return;
      if (/\.server\.[jt]sx?$/.test(id)) return;
      const stripping: GuardFactory = options?.ssr
        ? 'defineClientGuard'
        : 'defineServerGuard';
      if (!code.includes(stripping)) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
        errorRecovery: true,
      });

      const bindings = collectLocalBindings(ast, new Set([stripping]));
      if (bindings.size === 0) return;

      const hits: Array<{ start: number; end: number; argStart: number; argEnd: number }> = [];
      findCallsByLocalName(ast.program, bindings, hits);
      if (hits.length === 0) return;

      const s = new MagicString(code);
      for (const hit of [...hits].reverse()) {
        s.overwrite(hit.argStart, hit.argEnd, NOOP_LOCAL_NAME);
      }
      s.prepend(`import { ${NOOP_LOCAL_NAME} } from '${NOOP_IMPORT_SOURCE}';\n`);
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/vite vitest run src/__tests__/guard-strip-plugin.test.ts`
Expected: PASS, both initial cases.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/guard-strip.ts packages/vite/src/__tests__/guard-strip-plugin.test.ts
git commit -m "feat(vite): guardStripPlugin rewrites defineServerGuard in client bundles"
```

---

### Task 10: Add server-pass rewrite and second-arg pass-through tests

**Files:**
- Modify: `packages/vite/src/__tests__/guard-strip-plugin.test.ts`

- [ ] **Step 1: Append the server-pass and alias tests**

Add to `packages/vite/src/__tests__/guard-strip-plugin.test.ts`:

```ts
describe('guardStripPlugin: server pass (ssr=true)', () => {
  it('replaces defineClientGuard call arg with the noop import', () => {
    const code = `
      import { defineClientGuard } from '@hono-preact/iso';
      const g = defineClientGuard(async (ctx, next) => {
        await fetchFromBrowser();
        return next();
      });
    `;
    const result = transform(code, '/src/pages/admin.tsx', { ssr: true });
    expect(result?.code).toContain("import { __\$guardNoop_hpiso } from '@hono-preact/iso/internal';");
    expect(result?.code).toContain('defineClientGuard(__$guardNoop_hpiso)');
    expect(result?.code).not.toContain('await fetchFromBrowser()');
  });

  it('does not touch defineServerGuard calls in server pass', () => {
    const code = `
      import { defineServerGuard } from '@hono-preact/iso';
      const g = defineServerGuard(async (ctx, next) => {
        await onServer();
        return next();
      });
    `;
    const result = transform(code, '/src/pages/admin.tsx', { ssr: true });
    expect(result?.code ?? code).toContain('await onServer()');
  });
});

describe('guardStripPlugin: aliasing', () => {
  it('handles import alias for defineServerGuard', () => {
    const code = `
      import { defineServerGuard as dsg } from '@hono-preact/iso';
      const g = dsg(async (ctx, next) => {
        await secret();
        return next();
      });
    `;
    const result = transform(code, '/src/pages/admin.tsx');
    expect(result?.code).toContain('dsg(__$guardNoop_hpiso)');
    expect(result?.code).not.toContain('await secret()');
  });

  it('handles import from the umbrella hono-preact source', () => {
    const code = `
      import { defineServerGuard } from 'hono-preact';
      const g = defineServerGuard(async () => undefined);
    `;
    const result = transform(code, '/src/pages/admin.tsx');
    expect(result?.code).toContain('defineServerGuard(__$guardNoop_hpiso)');
  });

  it('rewrites a call whose argument is a named function reference', () => {
    const code = `
      import { defineServerGuard } from '@hono-preact/iso';
      async function checkAdmin(ctx, next) { await db(); return next(); }
      const g = defineServerGuard(checkAdmin);
    `;
    const result = transform(code, '/src/pages/admin.tsx');
    expect(result?.code).toContain('defineServerGuard(__$guardNoop_hpiso)');
  });
});

describe('guardStripPlugin: leaves unaffected code alone', () => {
  it('returns undefined when no defineServerGuard or defineClientGuard is imported', () => {
    const code = `import { Something } from './x.js'; const y = Something();`;
    expect(transform(code, '/src/x.tsx')).toBeUndefined();
    expect(transform(code, '/src/x.tsx', { ssr: true })).toBeUndefined();
  });

  it('returns undefined when defineServerGuard is imported but unused in this file', () => {
    const code = `import { defineServerGuard } from '@hono-preact/iso';`;
    const result = transform(code, '/src/x.tsx');
    expect(result).toBeUndefined();
  });

  it('does not transform .server.* files themselves', () => {
    const code = `
      import { defineServerGuard } from '@hono-preact/iso';
      export const x = defineServerGuard(async () => undefined);
    `;
    expect(transform(code, '/src/pages/admin.server.ts')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to confirm all 8 new cases pass**

Run: `pnpm --filter @hono-preact/vite vitest run src/__tests__/guard-strip-plugin.test.ts`
Expected: PASS, total of 10 cases (2 from Task 9 plus 8 new).

- [ ] **Step 3: Commit**

```bash
git add packages/vite/src/__tests__/guard-strip-plugin.test.ts
git commit -m "test(vite): cover guardStripPlugin server pass, aliasing, and bail conditions"
```

---

### Task 11: Register `guardStripPlugin` in `honoPreact()` and export from `index.ts`

**Files:**
- Modify: `packages/vite/src/hono-preact.ts`
- Modify: `packages/vite/src/index.ts`

- [ ] **Step 1: Add the export to `packages/vite/src/index.ts`**

Append:

```ts
export { guardStripPlugin } from './guard-strip.js';
```

- [ ] **Step 2: Register the plugin in `packages/vite/src/hono-preact.ts`**

At the top of the file, add:

```ts
import { guardStripPlugin } from './guard-strip.js';
```

In the return array of `honoPreact()`, find where `serverOnlyPlugin()` is added and add `guardStripPlugin()` adjacent to it. The exact location depends on the existing pipeline shape; place it directly after `serverOnlyPlugin()` (both are `enforce: 'pre'`, both transform application source). If you cannot find `serverOnlyPlugin()` in the return array, search for the function body's return statement and add the new plugin in the same position as today's other custom plugins.

- [ ] **Step 3: Build the vite package**

Run: `pnpm --filter @hono-preact/vite build`
Expected: clean build.

- [ ] **Step 4: Run the full vite package test suite**

Run: `pnpm --filter @hono-preact/vite vitest run`
Expected: all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/hono-preact.ts packages/vite/src/index.ts
git commit -m "feat(vite): register guardStripPlugin in honoPreact() pipeline"
```

---

## Phase 5: Bundle-content tree-shake tests

### Task 12: Create the fixture app for bundle tests

**Files:**
- Create: `packages/vite/src/__tests__/fixtures/guards-treeshake/package.json`
- Create: `packages/vite/src/__tests__/fixtures/guards-treeshake/src/page.tsx`
- Create: `packages/vite/src/__tests__/fixtures/guards-treeshake/src/server-secrets.ts`
- Create: `packages/vite/src/__tests__/fixtures/guards-treeshake/src/client-state.ts`

- [ ] **Step 1: Create the fixture package.json**

`packages/vite/src/__tests__/fixtures/guards-treeshake/package.json`:

```json
{
  "name": "guards-treeshake-fixture",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: Create the fixture page**

`packages/vite/src/__tests__/fixtures/guards-treeshake/src/page.tsx`:

```tsx
import { defineServerGuard, defineClientGuard } from '@hono-preact/iso';
import { SECRET_SERVER_TOKEN } from './server-secrets.js';
import { CLIENT_USER_KEY } from './client-state.js';

const adminGuard = defineServerGuard(async (_ctx, next) => {
  if (SECRET_SERVER_TOKEN !== 'expected') return { redirect: '/forbidden' };
  return next();
});

const scrollRestore = defineClientGuard(async (_ctx, next) => {
  if (typeof window !== 'undefined') {
    void CLIENT_USER_KEY;
  }
  return next();
});

export const guards = [adminGuard, scrollRestore];
```

- [ ] **Step 3: Create the two helper modules**

`packages/vite/src/__tests__/fixtures/guards-treeshake/src/server-secrets.ts`:

```ts
export const SECRET_SERVER_TOKEN = 'BUNDLE_MARKER_SERVER_TOKEN_VALUE';
```

`packages/vite/src/__tests__/fixtures/guards-treeshake/src/client-state.ts`:

```ts
export const CLIENT_USER_KEY = 'BUNDLE_MARKER_CLIENT_USER_KEY_VALUE';
```

The two marker strings are chosen for uniqueness; the bundle-content test asserts against them directly.

- [ ] **Step 4: Verify the fixture compiles as a sanity check**

Run: `pnpm --filter @hono-preact/vite exec tsc --noEmit --jsx react-jsx --moduleResolution bundler --module esnext --target esnext --skipLibCheck src/__tests__/fixtures/guards-treeshake/src/page.tsx`
Expected: no type errors (the import resolution may fail since the fixture is not in a real package layout; if so, skip this step — the bundle-build test in Task 13 is the real verification).

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/__tests__/fixtures/guards-treeshake/
git commit -m "test(vite): add fixture app for guards bundle-content tests"
```

---

### Task 13: Bundle-content test asserts tree-shake in both directions

**Files:**
- Create: `packages/vite/src/__tests__/guards-bundle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/vite/src/__tests__/guards-bundle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { build, type InlineConfig, type Rollup } from 'vite';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { guardStripPlugin } from '../guard-strip.js';

const fixtureDir = path.dirname(
  fileURLToPath(new URL('./fixtures/guards-treeshake/src/page.tsx', import.meta.url)),
);

async function bundleFor(ssr: boolean): Promise<string> {
  const config: InlineConfig = {
    root: fixtureDir,
    logLevel: 'error',
    configFile: false,
    plugins: [guardStripPlugin()],
    build: {
      write: false,
      ssr: ssr || undefined,
      rollupOptions: {
        input: path.join(fixtureDir, 'page.tsx'),
        external: ['@hono-preact/iso', '@hono-preact/iso/internal'],
      },
      minify: false,
      target: 'esnext',
    },
  };
  const out = (await build(config)) as Rollup.RollupOutput;
  const chunks = Array.isArray(out) ? out : [out];
  const chunk = chunks[0].output.find((o) => o.type === 'chunk') as Rollup.OutputChunk;
  return chunk.code;
}

describe('guards tree-shake', () => {
  it('client bundle does NOT contain the server-only marker', async () => {
    const code = await bundleFor(false);
    expect(code).not.toContain('BUNDLE_MARKER_SERVER_TOKEN_VALUE');
  });

  it('client bundle DOES contain the client-only marker', async () => {
    const code = await bundleFor(false);
    expect(code).toContain('BUNDLE_MARKER_CLIENT_USER_KEY_VALUE');
  });

  it('server bundle does NOT contain the client-only marker', async () => {
    const code = await bundleFor(true);
    expect(code).not.toContain('BUNDLE_MARKER_CLIENT_USER_KEY_VALUE');
  });

  it('server bundle DOES contain the server-only marker', async () => {
    const code = await bundleFor(true);
    expect(code).toContain('BUNDLE_MARKER_SERVER_TOKEN_VALUE');
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/vite vitest run src/__tests__/guards-bundle.test.ts`
Expected: PASS, all 4 cases.

If any assertion fails, do NOT proceed. The test failing means tree-shake is not actually happening; debug by:
1. Inspecting the rendered bundle (add `console.log(code)` temporarily) to see whether the marker string is present.
2. Confirming the `guardStripPlugin` is invoked (add a `console.log` in its `transform` to verify).
3. Confirming the noop substitution is in the output; if not, the import-name tracking missed the binding.

Only commit when all 4 cases pass.

- [ ] **Step 3: Commit**

```bash
git add packages/vite/src/__tests__/guards-bundle.test.ts
git commit -m "test(vite): bundle-content test pins guards tree-shake in both passes"
```

---

## Phase 6: Docs and spec edits

### Task 14: Rewrite `apps/app/src/pages/docs/guards.mdx`

**Files:**
- Modify: `apps/app/src/pages/docs/guards.mdx`

- [ ] **Step 1: Replace the file with the new content**

Replace the entire `apps/app/src/pages/docs/guards.mdx` with:

````mdx
# Route Guards

Pages can be protected by an ordered list of guards: middleware-style functions that run before the page renders. Each guard either passes control downstream by calling `next()`, redirects, or renders a fallback. Guards are environment-aware: each is built by `defineServerGuard` or `defineClientGuard`, and the framework runs only the matching ones for the current environment.

## How it works

A page declares its guards as a single ordered array:

```tsx
import {
  defineServerGuard,
  defineClientGuard,
  definePage,
} from '@hono-preact/iso';
import { checkAdminFromDb } from './admin.server.js';

const adminGuard = defineServerGuard(async (ctx, next) => {
  const role = await checkAdminFromDb(ctx);
  if (role !== 'admin') return { redirect: '/forbidden' };
  return next();
});

const scrollRestore = defineClientGuard(async ({ location }, next) => {
  restoreScroll(location.path);
  return next();
});

export default definePage(Admin, { guards: [adminGuard, scrollRestore] });
```

At runtime, the framework filters the list by environment and composes the survivors via `next()`. On the server, only `defineServerGuard` entries run. On the client, only `defineClientGuard` entries run. Array order is preserved across both environments.

## The factories

```ts
import { defineServerGuard, defineClientGuard } from '@hono-preact/iso';

// Runs during SSR (initial load) and after server-side navigation.
const guard = defineServerGuard(async ({ location }, next) => {
  // location: the current RouteHook (path, params, searchParams)
  // next(): return this to pass control downstream
  return next();
});

// Runs during client-side navigation.
const clientGuard = defineClientGuard(async ({ location }, next) => next());
```

A guard returns one of:
- `{ redirect: '/some/path' }` to redirect.
- `{ render: FallbackComponent }` to render a component in place of the page (e.g. a 403 page).
- `return next()` to pass through.

## Order semantics

Guards execute in array order. The first to return a non-void result short-circuits the rest. The order is preserved regardless of which environment the page is rendering in — opposite-env guards are filtered out, surviving guards run in the same relative order.

```ts
guards: [
  defineServerGuard(checkSession),     // 1st on server
  defineClientGuard(restoreScroll),    // 1st on client
  defineServerGuard(checkRole),        // 2nd on server
]
```

On the server: `checkSession → checkRole`. On the client: `restoreScroll`.

## Bundle stripping

The Vite plugin rewrites every `defineServerGuard(fn)` call to a passthrough stub in the client bundle, and every `defineClientGuard(fn)` call to a passthrough stub in the server bundle. The original function body is eliminated from the opposite-env bundle, and any helpers referenced only inside it tree-shake out.

This means a `defineServerGuard` body can safely call server-only helpers (database queries, secrets, Node-only imports) without leaking to the browser:

```tsx
import { defineServerGuard } from '@hono-preact/iso';
import { db } from './db.server.js';

const adminGuard = defineServerGuard(async (ctx, next) => {
  const user = await db.query(...);   // server-only — stripped from client bundle
  if (!user) return { redirect: '/login' };
  return next();
});
```

The rewrite recognizes calls to `defineServerGuard` / `defineClientGuard` imported directly from `@hono-preact/iso` or `hono-preact` (including via `import as` aliases). For the stripping guarantee to apply, **use the factories** — don't construct guard records manually, and don't re-export the factories through an intermediate module.

## The `GuardContext`

Both factories take a function that receives:

- `location`: the current `RouteHook` (`path`, `pathParams`, `searchParams`).
- `next()`: call and **return** this to pass control downstream (`return next()`, not `await next()`).

There is no Hono context (`c`) on this surface. Server-side guards that need cookies or headers should obtain them via the helper they call (e.g. through `hono/context-storage`), keeping the guard body small and the helper server-only.

## Same logic in both environments

A guard whose body works identically in both environments lives in both factories:

```ts
const checkFlag = (ctx, next) => /* env-agnostic logic */;
guards: [defineServerGuard(checkFlag), defineClientGuard(checkFlag)],
```

The function body is shared; the array is explicit about where it runs. `defineGuard` and a `runs: 'both'` option are deliberately not part of the surface — each guard call site is one place the bundler can rewrite, and one place a reader can see which environment it targets.

## `runGuards`

Internal helper, exported for advanced use. Composes a `GuardFn[]` with `next()`-chaining and returns the first non-void result. Most users do not need to call this directly.

```ts
import { runGuards } from '@hono-preact/iso';
const result = await runGuards(guards, { location });
```

## Build conventions

`serverLoaderValidationPlugin` enforces the `.server.*` named-export allowlist: `serverLoaders`, `serverActions`, `actionGuards`. Guards do not live in `.server.*` files; they live with the page and are stripped from opposite-env bundles by `guardStripPlugin`.

`guardStripPlugin` is registered in `honoPreact()` by default. Both passes (client and server) run during a `vite build`; you do not need to wire it manually.

## Example: protected admin page

```tsx
// src/pages/admin.tsx
import { defineServerGuard, definePage } from '@hono-preact/iso';
import { getCurrentUser } from './admin.server.js';

const requireAdmin = defineServerGuard(async (_ctx, next) => {
  const user = await getCurrentUser();
  if (!user) return { redirect: '/login' };
  if (user.role !== 'admin') return { redirect: '/forbidden' };
  return next();
});

function Admin() {
  return <section>Admin dashboard</section>;
}

export default definePage(Admin, { guards: [requireAdmin] });
```

```ts
// src/pages/admin.server.ts
import { defineLoader } from '@hono-preact/iso';
import { db } from '@/server/db.js';

export async function getCurrentUser() {
  return await db.user.fromSession();
}

export const serverLoaders = {
  default: defineLoader(async () => ({ stats: await db.adminStats() })),
};
```

The admin helper lives in `.server.ts` and gets stubbed in the client bundle (default-export and named exports follow the existing `serverOnlyPlugin` rules). The guard body imports it directly; when the client bundle is built, the entire guard body is stripped to a passthrough, so the unstubbed reference never materializes in the browser.

## Composing guards

Guards are plain values, so compose them however you like:

```ts
const requireAuth = defineServerGuard(async (_ctx, next) => {
  const user = await getCurrentUser();
  if (!user) return { redirect: '/login' };
  return next();
});

const requireRole = (role: string) =>
  defineServerGuard(async (_ctx, next) => {
    const user = await getCurrentUser();
    if (user?.role !== role) return { redirect: '/forbidden' };
    return next();
  });

guards: [requireAuth, requireRole('editor')];
```
````

- [ ] **Step 2: Build the docs app to verify the MDX renders**

Run: `pnpm --filter app build`
Expected: clean build with no MDX parse errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/docs/guards.mdx
git commit -m "docs: rewrite guards page for defineServerGuard/defineClientGuard surface"
```

---

### Task 15: Update remaining doc pages

**Files:**
- Modify: `apps/app/src/pages/docs/structure.mdx`
- Modify: `apps/app/src/pages/docs/loaders.mdx`
- Modify: `apps/app/src/pages/docs/loading-states.mdx`
- Modify: `apps/app/src/pages/docs/action-guards.mdx`

- [ ] **Step 1: Update `structure.mdx`**

Open `apps/app/src/pages/docs/structure.mdx`. At line ~60, replace:

```
- **Page bindings**: `definePage(Component, { errorFallback, serverGuards, clientGuards, Wrapper })` factory plus `<Page>`, `WrapperProps`. ...
```

with:

```
- **Page bindings**: `definePage(Component, { errorFallback, guards, Wrapper })` factory plus `<Page>`, `WrapperProps`. Guards are built via `defineServerGuard` / `defineClientGuard`. Loader and fallback bindings live on `serverLoaders.name.View()` inside the page's JSX.
```

At line ~83, replace:

```
- **`serverLoaderValidationPlugin`** fails the build if a `.server.*` file has named exports other than `serverLoaders`, `serverGuards`, `serverActions`, or `actionGuards`.
```

with:

```
- **`serverLoaderValidationPlugin`** fails the build if a `.server.*` file has named exports other than `serverLoaders`, `serverActions`, or `actionGuards`.
```

Also search the file for any other `serverGuards` mentions and remove them.

- [ ] **Step 2: Update `loaders.mdx`**

Open `apps/app/src/pages/docs/loaders.mdx`. At line ~384, replace:

```
Per-page concerns (Wrapper, errorFallback, serverGuards, clientGuards) live with the page component, not with the route declaration. `definePage` captures them:
```

with:

```
Per-page concerns (Wrapper, errorFallback, guards) live with the page component, not with the route declaration. `definePage` captures them:
```

Search the file for any other `serverGuards`/`clientGuards`/`createGuard` mentions and update them to the new API.

- [ ] **Step 3: Update `loading-states.mdx`**

Open `apps/app/src/pages/docs/loading-states.mdx`. At line ~83, replace:

```
`definePage` accepts more than just `loader`/`fallback`. See [Route Guards](/docs/guards) for `serverGuards`/`clientGuards`, and [Project Structure](/docs/structure) for the full bindings list (including `Wrapper`).
```

with:

```
`definePage` accepts more than just `loader`/`fallback`. See [Route Guards](/docs/guards) for the `guards` binding, and [Project Structure](/docs/structure) for the full bindings list (including `Wrapper`).
```

- [ ] **Step 4: Update `action-guards.mdx`**

Open `apps/app/src/pages/docs/action-guards.mdx`. Find the `ActionGuardError` section. Replace examples that show `new ActionGuardError('msg', 401)` with examples that import the type when annotating dynamically:

```ts
import { ActionGuardError, type ContentfulStatusCode } from '@hono-preact/iso';

throw new ActionGuardError('Unauthorized', 401);             // literal: still ok
const status: ContentfulStatusCode = pickStatus();
throw new ActionGuardError('Nope', status);                  // dynamic: import the type
```

Add a one-line note: "The `status` argument is typed as `ContentfulStatusCode` (Hono's union of status codes that may carry a body). Literal codes like `401`, `403`, `429` are accepted directly; if you compute the code at runtime, annotate the variable with `ContentfulStatusCode`."

- [ ] **Step 5: Run the demo app build to confirm MDX still parses**

Run: `pnpm --filter app build`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/pages/docs/structure.mdx apps/app/src/pages/docs/loaders.mdx apps/app/src/pages/docs/loading-states.mdx apps/app/src/pages/docs/action-guards.mdx
git commit -m "docs: update structure/loaders/loading-states/action-guards for new guards surface"
```

---

### Task 16: Replace v0.1 spec section 7 with the final design

**Files:**
- Modify: `docs/superpowers/specs/2026-05-09-v0.1-framework-direction.md`

- [ ] **Step 1: Replace section 7**

Open `docs/superpowers/specs/2026-05-09-v0.1-framework-direction.md`. Find the section starting at line 356 (the `## 7. Single guards list with `runs` flag` heading) and ending just before `## 8. One published package, three subpaths`.

Replace the entire section with:

```markdown
## 7. Single guards list + ActionGuardError status type fix

`definePage` collapses `serverGuards` and `clientGuards` into one ordered `guards` list. Each guard is built by an env-specific factory:

```ts
import {
  defineServerGuard,
  defineClientGuard,
  definePage,
} from 'hono-preact';

const adminGuard = defineServerGuard(async (ctx, next) => {
  if (!await isAdmin(ctx)) return { redirect: '/forbidden' };
  return next();
});

const scrollRestore = defineClientGuard(async (_, next) => next());

definePage(Admin, { guards: [adminGuard, scrollRestore] });
```

There is no unified `defineGuard` and no `runs: 'both'`. A user who needs the same body on both sides writes `[defineServerGuard(fn), defineClientGuard(fn)]`.

The Vite plugin (`guardStripPlugin`) rewrites `defineServerGuard(...)` to a passthrough stub in the client bundle, and `defineClientGuard(...)` to a passthrough stub in the server bundle. Server-only helpers referenced only inside a stripped body tree-shake out. The runtime ALSO filters opposite-env guards out of the execution chain, so the stub never runs anyway. Double safety: bundle stripping at build time, chain filtering at runtime.

`ActionGuardError`'s constructor status type tightens from `number` to Hono's `ContentfulStatusCode`. The narrow cast at the response boundary (`as 400 | 401 | 403 | 404 | 429 | 500`) goes away. `ContentfulStatusCode` is re-exported from `hono-preact` for ergonomics.

The full design lives at `docs/superpowers/specs/2026-05-13-single-guards-list-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-09-v0.1-framework-direction.md
git commit -m "docs(spec): replace v0.1 section 7 sketch with the final guards design"
```

---

## Phase 7: Final validation

### Task 17: Run the full monorepo test suite

- [ ] **Step 1: Run all tests**

Run: `pnpm -r test`
Expected: every package's tests PASS.

If any test fails, do not proceed. Diagnose the failure and fix the underlying issue.

- [ ] **Step 2: Build everything**

Run: `pnpm -r build`
Expected: clean builds across `@hono-preact/iso`, `@hono-preact/server`, `@hono-preact/vite`, `hono-preact`, `app`.

- [ ] **Step 3: Type-check the demo app**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Smoke-test the dev server**

Run: `pnpm --filter app dev` in one terminal. In another, `curl -s http://localhost:5173/ | head -20` to confirm the server responds with HTML.

Stop the dev server.

- [ ] **Step 5: Smoke-test the production build**

Run: `pnpm --filter app build`. Inspect the produced `dist/` directory for the presence of a client bundle. If the demo app has any guard call sites (unlikely; demo did not use guards before this work), grep the client bundle for any server-only helper symbol the guard body references to confirm stripping. If the demo has no guards, this step is satisfied by Phase 5's bundle-content tests.

- [ ] **Step 6: No commit; this is validation only**

If steps 1–5 all pass, the work is done. The PR is ready for review.

---

## Self-Review

Run this checklist after writing the plan with fresh eyes:

**Spec coverage (skim section by section of `docs/superpowers/specs/2026-05-13-single-guards-list-design.md`):**

- TL;DR — covered by Tasks 1, 3, 4 (API surface) + Tasks 9–11 (plugin).
- API Surface (factories, GuardFn record, PageBindings) — Tasks 1, 4.
- Order semantics — Task 3 (third sub-test).
- Runtime (`Guards`, `runGuards`) — Tasks 1, 3.
- Plugin rewrite (`guardStripPlugin`) — Tasks 9, 10, 11.
- `ActionGuardError` status type fix — Task 6.
- Migration code table — Tasks 1, 3, 4, 5, 6, 7, 8, 11.
- Migration tests:
  - Runtime/API — Tasks 1, 3, 4.
  - Action guard — Task 6.
  - Plugin rewrite — Tasks 9, 10.
  - Bundle-content tests — Tasks 12, 13.
- Docs — Tasks 14, 15.
- Spec edit — Task 16.
- Out of scope — explicitly NOT in the plan (action-guards architecture untouched; layout-level guards not addressed).

**Placeholder scan:** No "TBD", "implement later", "similar to Task N", or vague "handle edge cases" steps. Every code step has the actual code.

**Type consistency:**
- `GuardFn` is `{ runs: GuardRunsOn; fn: ... }` — same shape in Tasks 1, 3, 4.
- `defineServerGuard` / `defineClientGuard` return `GuardFn` — same signature in Tasks 1, 3, 5.
- `__$guardNoop_hpiso` is the noop local name — same in Task 2, Task 9, Task 10.
- Plugin import path is `@hono-preact/iso/internal` — same in Task 2 (re-export) and Tasks 9/13 (consumer).
- `PageBindings.guards` is `GuardFn[]` — same in Task 4 (definition) and Task 5 (export check).
- Bundle markers `BUNDLE_MARKER_SERVER_TOKEN_VALUE` and `BUNDLE_MARKER_CLIENT_USER_KEY_VALUE` — defined in Task 12, asserted in Task 13.
