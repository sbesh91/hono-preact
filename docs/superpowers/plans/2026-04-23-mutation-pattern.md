# Mutation Pattern Implementation Plan


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class mutation system (`defineAction`, `useAction`, `<Form>`, `actionsHandler`) to hono-preact, following the design in `docs/superpowers/specs/2026-04-23-mutation-pattern-design.md`.

**Architecture:** `defineAction` brands action functions with phantom types so `useAction` can infer payload/result types. The Vite `serverOnlyPlugin` replaces `serverActions` imports with Proxy stubs in client builds. A single `POST /__actions` route dispatched by `actionsHandler` handles all action calls.

**Tech Stack:** Preact, Hono, Vite (Babel AST + MagicString), Vitest, @testing-library/preact, TypeScript

---

## File Map

| Status | File | Purpose |
|--------|------|---------|
| Create | `packages/iso/src/action.ts` | `ActionStub` type, `defineAction`, `useAction`, option types |
| Create | `packages/iso/src/form.tsx` | `<Form>` component wrapping `useAction` |
| Create | `packages/iso/src/__tests__/action.test.ts` | Tests for `defineAction` and `useAction` |
| Create | `packages/iso/src/__tests__/form.test.tsx` | Tests for `<Form>` |
| Modify | `packages/iso/src/index.ts` | Export `defineAction`, `useAction`, `Form`, and types |
| Modify | `packages/iso/src/page.tsx:24` | Export `ReloadContext` so `useAction` can access it |
| Create | `packages/server/src/actions-handler.ts` | `actionsHandler` Hono middleware |
| Create | `packages/server/src/__tests__/actions-handler.test.ts` | Tests for `actionsHandler` |
| Modify | `packages/server/src/index.ts` | Export `actionsHandler` |
| Modify | `packages/vite/src/server-loader-validation.ts:49,56` | Allow `serverActions` export; relax default export requirement |
| Modify | `packages/vite/src/server-only.ts:22-54` | Detect and stub `serverActions` named import |
| Modify | `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts` | New validation tests |
| Modify | `packages/vite/src/__tests__/server-only-plugin.test.ts` | New stub tests |
| Modify | `apps/app/src/pages/movies.server.ts` | Add `serverActions` example |
| Modify | `apps/app/src/server.tsx` | Register `actionsHandler` |
| Modify | `apps/app/src/pages/movies.tsx` | Add `<Form>` example |

---

## Task 1: `ActionStub` type and `defineAction`

**Files:**
- Create: `packages/iso/src/action.ts`
- Create: `packages/iso/src/__tests__/action.test.ts`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/iso/src/__tests__/action.test.ts
import { describe, it, expect } from 'vitest';
import { defineAction } from '../action.js';

describe('defineAction', () => {
  it('returns the function unchanged at runtime', () => {
    const fn = async (_ctx: unknown, _payload: { name: string }) => ({ ok: true });
    const stub = defineAction(fn);
    expect(stub).toBe(fn as unknown);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "action.test"
```

Expected: FAIL — `Cannot find module '../action.js'`

- [ ] **Step 3: Create `action.ts` with `ActionStub` and `defineAction`**

```ts
// packages/iso/src/action.ts

export type ActionStub<TPayload, TResult> = {
  readonly __module: string;
  readonly __action: string;
  readonly __phantom?: readonly [TPayload, TResult];
};

export function defineAction<TPayload, TResult>(
  fn: (ctx: unknown, payload: TPayload) => Promise<TResult>
): ActionStub<TPayload, TResult> {
  // Runtime no-op: returns fn as-is. actionsHandler casts it back to a function.
  // The ActionStub type is enforced only by TypeScript and the Vite plugin.
  return fn as unknown as ActionStub<TPayload, TResult>;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "action.test"
```

Expected: PASS

- [ ] **Step 5: Export from `packages/iso/src/index.ts`**

Add at the end of the file:

```ts
export { defineAction, useAction } from './action.js';
export type { ActionStub, UseActionOptions, UseActionResult } from './action.js';
export { Form } from './form.js';
```

Note: `useAction` and `Form` don't exist yet — add the export line now; it will only error at build time if they're missing, not at test time since tests import directly.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/action.ts packages/iso/src/__tests__/action.test.ts packages/iso/src/index.ts
git commit -m "feat(iso): add ActionStub type and defineAction"
```

---

## Task 2: Export `ReloadContext` and add `useAction` hook

**Files:**
- Modify: `packages/iso/src/page.tsx:23`
- Modify: `packages/iso/src/action.ts`
- Modify: `packages/iso/src/__tests__/action.test.ts`

- [ ] **Step 1: Export `ReloadContext` from `page.tsx`**

In `packages/iso/src/page.tsx`, change line 24:

```ts
// Before:
const ReloadContext = createContext<ReloadContextValue | undefined>(undefined);

// After:
export const ReloadContext = createContext<ReloadContextValue | undefined>(undefined);
```

Note: `ReloadContextValue` (lines 18–22) now includes an `error` field:
```ts
type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
  error: Error | null;
};
```
All `ReloadContext.Provider` values in tests must include `error: null`.

- [ ] **Step 2: Write failing tests for `useAction`**

Append to `packages/iso/src/__tests__/action.test.ts`:

```ts
// @vitest-environment happy-dom
import { render, screen, act, cleanup } from '@testing-library/preact';
import { afterEach, beforeEach, vi } from 'vitest';
import { useAction } from '../action.js';
import { ReloadContext } from '../page.js';
import type { ActionStub } from '../action.js';
import { h } from 'preact';

const stub: ActionStub<{ title: string }, { ok: boolean }> = {
  __module: 'movies',
  __action: 'create',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useAction', () => {
  it('sets pending true during fetch and false after', async () => {
    let resolveFetch!: (v: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolveFetch = r;
          })
      )
    );

    let capturedPending: boolean[] = [];
    function TestComponent() {
      const { mutate, pending } = useAction(stub);
      capturedPending.push(pending);
      return (
        <button onClick={() => mutate({ title: 'Dune' })}>go</button>
      );
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });
    expect(capturedPending).toContain(true);

    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    });
    expect(capturedPending.at(-1)).toBe(false);
  });

  it('posts the correct JSON body to /__actions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    function TestComponent() {
      const { mutate } = useAction(stub);
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    expect(fetchMock).toHaveBeenCalledWith('/__actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'movies', action: 'create', payload: { title: 'Dune' } }),
    });
  });

  it('sets data on success and calls onSuccess', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    );
    const onSuccess = vi.fn();

    function TestComponent() {
      const { mutate, data } = useAction(stub, { onSuccess });
      return (
        <div>
          <button onClick={() => mutate({ title: 'Dune' })}>go</button>
          <span data-testid="data">{data ? 'has-data' : 'no-data'}</span>
        </div>
      );
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    expect(screen.getByTestId('data')).toHaveTextContent('has-data');
    expect(onSuccess).toHaveBeenCalledWith({ ok: true });
  });

  it('sets error on failure and calls onError with snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'DB error' }), { status: 500 })
      )
    );
    const onMutate = vi.fn(() => 'snapshot-value');
    const onError = vi.fn();

    function TestComponent() {
      const { mutate, error } = useAction(stub, { onMutate, onError });
      return (
        <div>
          <button onClick={() => mutate({ title: 'Dune' })}>go</button>
          <span data-testid="error">{error?.message ?? 'none'}</span>
        </div>
      );
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    expect(screen.getByTestId('error')).toHaveTextContent('DB error');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'snapshot-value');
  });

  it('calls reload when invalidate is "auto"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    );
    const reload = vi.fn();

    function TestComponent() {
      const { mutate } = useAction(stub, { invalidate: 'auto' });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(
      <ReloadContext.Provider value={{ reload, reloading: false, error: null }}>
        <TestComponent />
      </ReloadContext.Provider>
    );
    await act(async () => {
      screen.getByRole('button').click();
    });

    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not call reload when invalidate is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    );
    const reload = vi.fn();

    function TestComponent() {
      const { mutate } = useAction(stub, { invalidate: false });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(
      <ReloadContext.Provider value={{ reload, reloading: false, error: null }}>
        <TestComponent />
      </ReloadContext.Provider>
    );
    await act(async () => {
      screen.getByRole('button').click();
    });

    expect(reload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "useAction"
```

Expected: FAIL — `useAction is not a function`

- [ ] **Step 4: Add `useAction` to `action.ts`**

Replace the entire content of `packages/iso/src/action.ts` with:

```ts
import { useContext, useState } from 'preact/hooks';
import { ReloadContext } from './page.js';

export type ActionStub<TPayload, TResult> = {
  readonly __module: string;
  readonly __action: string;
  readonly __phantom?: readonly [TPayload, TResult];
};

export function defineAction<TPayload, TResult>(
  fn: (ctx: unknown, payload: TPayload) => Promise<TResult>
): ActionStub<TPayload, TResult> {
  return fn as unknown as ActionStub<TPayload, TResult>;
}

export type UseActionOptions<TPayload, TResult> = {
  invalidate?: 'auto' | false;
  onMutate?: (payload: TPayload) => unknown;
  onError?: (err: Error, snapshot: unknown) => void;
  onSuccess?: (data: TResult) => void;
};

export type UseActionResult<TPayload, TResult> = {
  mutate: (payload: TPayload) => Promise<void>;
  pending: boolean;
  error: Error | null;
  data: TResult | null;
};

export function useAction<TPayload, TResult>(
  stub: ActionStub<TPayload, TResult>,
  options?: UseActionOptions<TPayload, TResult>
): UseActionResult<TPayload, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TResult | null>(null);
  const reloadCtx = useContext(ReloadContext);

  const mutate = async (payload: TPayload) => {
    setPending(true);
    setError(null);

    let snapshot: unknown;
    if (options?.onMutate) {
      snapshot = options.onMutate(payload);
    }

    try {
      const response = await fetch('/__actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: (stub as unknown as { __module: string }).__module,
          action: (stub as unknown as { __action: string }).__action,
          payload,
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `Action failed with status ${response.status}`);
      }

      const result = (await response.json()) as TResult;
      setData(result);
      options?.onSuccess?.(result);

      if (options?.invalidate === 'auto') {
        reloadCtx?.reload();
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      options?.onError?.(e, snapshot);
    } finally {
      setPending(false);
    }
  };

  return { mutate, pending, error, data };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "action.test"
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/action.ts packages/iso/src/page.tsx packages/iso/src/__tests__/action.test.ts
git commit -m "feat(iso): add useAction hook with pending/error/data state and reload integration"
```

---

## Task 3: `<Form>` component

**Files:**
- Create: `packages/iso/src/form.tsx`
- Create: `packages/iso/src/__tests__/form.test.tsx`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Write failing tests**

```tsx
// packages/iso/src/__tests__/form.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/preact';
import { Form } from '../form.js';
import type { ActionStub } from '../action.js';

const stub: ActionStub<{ title: string }, { ok: boolean }> = {
  __module: 'movies',
  __action: 'create',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Form', () => {
  it('serializes FormData to object and posts to /__actions on submit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Form action={stub}>
        <input name="title" defaultValue="Dune" />
        <button type="submit">Submit</button>
      </Form>
    );

    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    expect(fetchMock).toHaveBeenCalledWith('/__actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'movies', action: 'create', payload: { title: 'Dune' } }),
    });
  });

  it('disables submit button while pending', async () => {
    let resolveFetch!: (v: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolveFetch = r;
          })
      )
    );

    render(
      <Form action={stub}>
        <input name="title" defaultValue="Dune" />
        <button type="submit">Submit</button>
      </Form>
    );

    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    expect(screen.getByRole('button')).toBeDisabled();

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('calls onSuccess after successful submission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    );
    const onSuccess = vi.fn();

    render(
      <Form action={stub} onSuccess={onSuccess}>
        <input name="title" defaultValue="Dune" />
        <button type="submit">Submit</button>
      </Form>
    );

    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    expect(onSuccess).toHaveBeenCalledWith({ ok: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "form.test"
```

Expected: FAIL — `Cannot find module '../form.js'`

- [ ] **Step 3: Create `form.tsx`**

```tsx
// packages/iso/src/form.tsx
import type { JSX, ComponentChildren } from 'preact';
import { useAction } from './action.js';
import type { ActionStub, UseActionOptions } from './action.js';

type FormProps<TPayload extends Record<string, unknown>, TResult> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'action' | 'onSubmit'
> & UseActionOptions<TPayload, TResult> & {
  action: ActionStub<TPayload, TResult>;
  children?: ComponentChildren;
};

export function Form<TPayload extends Record<string, unknown>, TResult>({
  action,
  invalidate,
  onMutate,
  onError,
  onSuccess,
  children,
  ...rest
}: FormProps<TPayload, TResult>) {
  const { mutate, pending } = useAction(action, {
    invalidate,
    onMutate,
    onError,
    onSuccess,
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const payload = Object.fromEntries(formData.entries()) as TPayload;
    await mutate(payload);
  };

  return (
    <form {...rest} onSubmit={handleSubmit}>
      {typeof children === 'function'
        ? (children as (ctx: { pending: boolean }) => ComponentChildren)({ pending })
        : children}
    </form>
  );
}
```

Note: the `children` function overload allows `{({ pending }) => <button disabled={pending}>Submit</button>}` but the default is plain children — buttons are disabled via the internal `pending` state (handled below). Actually for simplicity of the POC, the `<Form>` disables buttons internally by finding them; keep it simple and just pass pending to children via render prop. But since the test uses plain `<button>`, let's apply `disabled` to child buttons via a simpler approach.

Actually, re-read the test: the test expects `screen.getByRole('button')` to be disabled while pending. To do this without a render prop, the component needs to clone children and inject `disabled`. That's complex. Let's instead use the render prop pattern in `children` and update the test:

Replace the `form.tsx` above with this simpler version that passes `pending` as a data attribute on the form, letting consumers use CSS or context. But the test specifically checks `toBeDisabled()` on the button.

The cleanest approach for the POC: `<Form>` wraps a `<fieldset disabled={pending}>` internally:

```tsx
// packages/iso/src/form.tsx
import type { JSX, ComponentChildren } from 'preact';
import { useAction } from './action.js';
import type { ActionStub, UseActionOptions } from './action.js';

type FormProps<TPayload extends Record<string, unknown>, TResult> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'action' | 'onSubmit'
> & UseActionOptions<TPayload, TResult> & {
  action: ActionStub<TPayload, TResult>;
  children?: ComponentChildren;
};

export function Form<TPayload extends Record<string, unknown>, TResult>({
  action,
  invalidate,
  onMutate,
  onError,
  onSuccess,
  children,
  ...rest
}: FormProps<TPayload, TResult>) {
  const { mutate, pending } = useAction(action, {
    invalidate,
    onMutate,
    onError,
    onSuccess,
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const payload = Object.fromEntries(formData.entries()) as TPayload;
    await mutate(payload);
  };

  return (
    <form {...rest} onSubmit={handleSubmit}>
      <fieldset disabled={pending} style={{ border: 'none', padding: 0, margin: 0 }}>
        {children}
      </fieldset>
    </form>
  );
}
```

Update the test for step 1 to query the button correctly (fieldset disabled propagates to children in the browser):

```tsx
// The test for "disables submit button while pending" should remain the same —
// fieldset[disabled] causes button to be disabled in DOM via form-associated elements.
// happy-dom supports this.
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "form.test"
```

Expected: all PASS

- [ ] **Step 5: Update `index.ts` — the export line was already added in Task 1 Step 5**

Verify `packages/iso/src/index.ts` ends with:

```ts
export { defineAction, useAction } from './action.js';
export type { ActionStub, UseActionOptions, UseActionResult } from './action.js';
export { Form } from './form.js';
```

If not present, add it.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/form.tsx packages/iso/src/__tests__/form.test.tsx packages/iso/src/index.ts
git commit -m "feat(iso): add Form component with fieldset-based pending state"
```

---

## Task 4: `actionsHandler`

**Files:**
- Create: `packages/server/src/actions-handler.ts`
- Create: `packages/server/src/__tests__/actions-handler.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/server/src/__tests__/actions-handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { actionsHandler } from '../actions-handler.js';

type AnyGlob = Record<string, unknown>;

function makeApp(glob: AnyGlob) {
  const app = new Hono();
  app.post('/__actions', actionsHandler(glob as any));
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request('http://localhost/__actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('actionsHandler', () => {
  it('calls the matching action with the Hono context and payload', async () => {
    const createFn = vi.fn().mockResolvedValue({ id: 1 });
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { create: createFn } },
    });

    const res = await post(app, {
      module: 'movies',
      action: 'create',
      payload: { title: 'Dune' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1 });
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ req: expect.anything() }),
      { title: 'Dune' }
    );
  });

  it('returns 404 when the module is not found', async () => {
    const res = await post(makeApp({}), {
      module: 'missing',
      action: 'create',
      payload: {},
    });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toContain("Module 'missing' not found");
  });

  it('returns 404 when the action is not found in the module', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { create: vi.fn() } },
    });
    const res = await post(app, { module: 'movies', action: 'destroy', payload: {} });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toContain("Action 'destroy' not found");
  });

  it('returns 500 when the action throws', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        serverActions: {
          create: async () => {
            throw new Error('DB error');
          },
        },
      },
    });
    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(500);
    expect((await res.json() as { error: string }).error).toBe('DB error');
  });

  it('resolves lazy glob modules before handling requests', async () => {
    const createFn = vi.fn().mockResolvedValue({ ok: true });
    const lazyGlob = {
      './pages/movies.server.ts': () =>
        Promise.resolve({ serverActions: { create: createFn } }),
    };
    const app = makeApp(lazyGlob);

    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(200);
    expect(createFn).toHaveBeenCalled();
  });

  it('ignores modules without serverActions', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { serverLoader: async () => ({}) },
    });
    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(404);
  });

  it('derives module name by stripping path and .server.* extension', async () => {
    const createFn = vi.fn().mockResolvedValue({ ok: true });
    const app = makeApp({
      './src/pages/movies.server.tsx': { serverActions: { create: createFn } },
    });
    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "actions-handler"
```

Expected: FAIL — `Cannot find module '../actions-handler.js'`

- [ ] **Step 3: Create `actions-handler.ts`**

```ts
// packages/server/src/actions-handler.ts
import type { MiddlewareHandler } from 'hono';

type GlobModule = { serverActions?: Record<string, unknown> };
type LazyGlob = Record<string, () => Promise<GlobModule>>;
type EagerGlob = Record<string, GlobModule>;

function moduleNameFromPath(filePath: string): string {
  return filePath
    .split('/')
    .pop()!
    .replace(/\.server\.[jt]sx?$/, '')
    .replace(/\.js$/, '');
}

async function buildActionsMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, Record<string, unknown>>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [filePath, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    if (mod.serverActions) {
      result[moduleNameFromPath(filePath)] = mod.serverActions as Record<string, unknown>;
    }
  }
  return result;
}

export function actionsHandler(glob: LazyGlob | EagerGlob): MiddlewareHandler {
  let actionsMapPromise: Promise<Record<string, Record<string, unknown>>> | null = null;

  return async (c) => {
    if (!actionsMapPromise) {
      actionsMapPromise = buildActionsMap(glob);
    }
    const actionsMap = await actionsMapPromise;

    let body: { module: string; action: string; payload: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { module, action, payload } = body;
    const moduleActions = actionsMap[module];

    if (!moduleActions) {
      return c.json({ error: `Module '${module}' not found` }, 404);
    }

    const fn = moduleActions[action];
    if (typeof fn !== 'function') {
      return c.json({ error: `Action '${action}' not found in module '${module}'` }, 404);
    }

    try {
      const result = await (fn as (ctx: unknown, payload: unknown) => Promise<unknown>)(
        c,
        payload
      );
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "actions-handler"
```

Expected: all PASS

- [ ] **Step 5: Export from `packages/server/src/index.ts`**

```ts
// packages/server/src/index.ts
export { HonoContext, useHonoContext } from './context.js';
export { location } from './middleware/location.js';
export { renderPage } from './render.js';
export { actionsHandler } from './actions-handler.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/actions-handler.ts packages/server/src/__tests__/actions-handler.test.ts packages/server/src/index.ts
git commit -m "feat(server): add actionsHandler RPC middleware"
```

---

## Task 5: Vite — allow `serverActions` in validation plugin

**Files:**
- Modify: `packages/vite/src/server-loader-validation.ts`
- Modify: `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`

- [ ] **Step 1: Write failing tests**

Insert inside the `describe` block in `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`, before the closing `});` on line 82:

```ts
  it('passes a *.server.* file with default + serverActions named export', () => {
    const code = [
      "import { defineAction } from '@hono-preact/iso';",
      'export const serverActions = {',
      '  create: defineAction(async (_ctx, payload) => ({ ok: true })),',
      '};',
      'export default async function serverLoader() { return {}; }',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toBeNull();
  });

  it('passes a *.server.* file with only serverActions (no default export)', () => {
    const code = [
      "import { defineAction } from '@hono-preact/iso';",
      'export const serverActions = {',
      '  create: defineAction(async (_ctx, payload) => ({ ok: true })),',
      '};',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toBeNull();
  });

  it('still fails when a *.server.* file has no default export and no serverActions', () => {
    const code = `export const serverGuards = [];`;
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('must have a default export');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "server-loader-validation"
```

Expected: 2 new tests FAIL

- [ ] **Step 3: Update `server-loader-validation.ts`**

Replace lines 54–66 of `packages/vite/src/server-loader-validation.ts` (the two filter-and-push blocks). The current file uses an `errors` array accumulated throughout, with `this.error(errors.join('\n'))` at lines 68–70 — preserve that pattern:

```ts
      const disallowedExports = namedExports.filter(
        (n) => n !== 'serverGuards' && n !== 'serverActions'
      );
      if (disallowedExports.length > 0) {
        errors.push(
          `${id}: .server files may only export 'serverGuards' or 'serverActions' as named exports (found: ${disallowedExports.join(', ')}). ` +
            `Export the server loader as the default export only.`
        );
      }
      if (!hasDefault && !namedExports.includes('serverActions')) {
        errors.push(
          `${id}: .server files must have a default export. ` +
            `Export the server loader as: export default async function serverLoader(...) { ... }`
        );
      }
```

Leave the `if (errors.length > 0) { this.error(errors.join('\n')); }` block at lines 68–70 unchanged.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "server-loader-validation"
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-loader-validation.ts packages/vite/src/__tests__/server-loader-validation-plugin.test.ts
git commit -m "feat(vite): allow serverActions as a valid named export in .server files"
```

---

## Task 6: Vite — stub `serverActions` import in client bundle

**Files:**
- Modify: `packages/vite/src/server-only.ts`
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`

- [ ] **Step 1: Write failing tests**

Insert inside the `describe('serverOnlyPlugin')` block in `packages/vite/src/__tests__/server-only-plugin.test.ts`, before the closing `});` on line 67:

```ts
  it('replaces serverActions named import with a Proxy stub using module name from filename', () => {
    const code = `import { serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain("__module: 'movies'");
    expect(result?.code).toContain('__action: String(action)');
  });

  it('handles serverActions alongside default import in the same statement', () => {
    const code = `import serverLoader, { serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverLoader = async () => ({});');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain("__module: 'movies'");
  });

  it('handles serverActions alongside serverGuards in the same statement', () => {
    const code = `import { serverGuards, serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverGuards = [];');
    expect(result?.code).toContain('const serverActions = new Proxy(');
  });

  it('derives module name from nested path correctly', () => {
    const code = `import { serverActions } from '../../pages/profile.server.ts';`;
    const result = transform(code, '/src/components/nav.tsx');
    expect(result?.code).toContain("__module: 'profile'");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "server-only-plugin"
```

Expected: 4 new tests FAIL

- [ ] **Step 3: Update `server-only.ts`**

Replace the entire content of `packages/vite/src/server-only.ts`. The current file already uses a `filter` + reverse loop to handle multiple server imports — preserve that structure, adding `serverActions` support:

```ts
import { parse } from '@babel/parser';
import type { ImportDeclaration } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

function moduleNameFromSource(importSource: string): string {
  return importSource
    .split('/')
    .pop()!
    .replace(/\.server(\.[jt]sx?)?$/, '')
    .replace(/\.js$/, '');
}

export function serverOnlyPlugin(): Plugin {
  return {
    name: 'server-only',
    enforce: 'pre',
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (options?.ssr) return;
      if (!/\.[jt]sx?$/.test(id)) return;
      if (/\.server\.[jt]sx?$/.test(id)) return;
      if (!code.includes('.server')) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
        errorRecovery: true,
      });

      const isServerImport = (node: unknown): node is ImportDeclaration =>
        (node as ImportDeclaration).type === 'ImportDeclaration' &&
        /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value) &&
        (node as ImportDeclaration).specifiers.some(
          (s) =>
            s.type === 'ImportDefaultSpecifier' ||
            (s.type === 'ImportSpecifier' &&
              s.imported.type === 'Identifier' &&
              (s.imported.name === 'serverGuards' ||
                s.imported.name === 'serverActions'))
        );

      const serverImports = ast.program.body.filter(isServerImport);
      if (serverImports.length === 0) return;

      const s = new MagicString(code);

      // Process in reverse order to preserve character offsets
      for (const serverImport of [...serverImports].reverse()) {
        const moduleName = moduleNameFromSource(serverImport.source.value);
        const stubs: string[] = [];

        for (const specifier of serverImport.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier') {
            stubs.push(`const ${specifier.local.name} = async () => ({});`);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverGuards'
          ) {
            stubs.push(`const ${specifier.local.name} = [];`);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverActions'
          ) {
            stubs.push(
              `const ${specifier.local.name} = new Proxy({}, { get(_, action) { return { __module: '${moduleName}', __action: String(action) }; } });`
            );
          }
        }

        if (stubs.length > 0) {
          s.overwrite(serverImport.start!, serverImport.end!, stubs.join('\n'));
        }
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
pnpm test --reporter=verbose
```

Expected: all existing + new tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-only.ts packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "feat(vite): stub serverActions named import with RPC Proxy in client builds"
```

---

## Task 7: App integration

**Files:**
- Modify: `apps/app/src/pages/movies.server.ts`
- Modify: `apps/app/src/server.tsx`
- Modify: `apps/app/src/pages/movies.tsx`

- [ ] **Step 1: Add `serverActions` to `movies.server.ts`**

Replace `apps/app/src/pages/movies.server.ts` with:

```ts
import { getMovies } from '@/server/movies.js';
import { defineAction, type Loader } from '@hono-preact/iso';
import type { MoviesData } from '@/server/data/movies.js';

const serverLoader: Loader<{ movies: MoviesData }> = async () => {
  const movies = await getMovies();
  return { movies };
};

export default serverLoader;

export const serverActions = {
  addMovie: defineAction<{ title: string; year: string }, { ok: boolean }>(
    async (_ctx, payload) => {
      console.log('addMovie called with:', payload);
      return { ok: true };
    }
  ),
};
```

- [ ] **Step 2: Register `actionsHandler` in `server.tsx`**

Replace `apps/app/src/server.tsx` with:

```tsx
import { Hono } from 'hono';
import { env } from '@hono-preact/iso';
import { Layout } from './server/layout.js';
import { actionsHandler, location, renderPage } from '@hono-preact/server';
import { getMovie, getMovies } from './server/movies.js';

const dev = process.env.NODE_ENV === 'development';
if (dev) {
  const { default: dot } = await import('dotenv');
  dot.config({ debug: true });
}
export const app = new Hono();

env.current = 'server';

app
  .post('/__actions', actionsHandler(import.meta.glob('./pages/*.server.ts')))
  .get('/api/movies', async (c) => {
    const movies = await getMovies();
    return c.json(movies);
  })
  .get('/api/movies/:id', async (c) => {
    const movie = await getMovie(c.req.param('id'));
    return c.json(movie);
  })
  .use(location)
  .get('*', (c) =>
    renderPage(c, <Layout context={c} />, { defaultTitle: 'hono-preact' })
  );

export default app;
```

- [ ] **Step 3: Add `<Form>` example to `movies.tsx`**

Replace `apps/app/src/pages/movies.tsx` with:

```tsx
import { getLoaderData, type LoaderData, createCache, Form } from '@hono-preact/iso';
import type { FunctionalComponent } from 'preact';
import { lazy, Route, Router, RouteHook } from 'preact-iso';
import type { MovieSummary, MoviesData } from '@/server/data/movies.js';
import serverLoader, { serverActions } from './movies.server.js';
import Noop from './noop.js';

const cache = createCache<{ movies: MoviesData }>();

const clientLoader = cache.wrap(async ({}: { location: RouteHook }) => {
  const movies = await fetch('/api/movies').then(
    (res) => res.json() as Promise<MoviesData>
  );
  return { movies };
});

const Movie = lazy(() => import('./movie.js'));

const Movies: FunctionalComponent = (props: LoaderData<{ movies: MoviesData }>) => {
  return (
    <section class="p-1">
      <a href="/" class="bg-amber-200">
        home
      </a>
      {props.loaderData?.movies.results.map((m: MovieSummary) => (
        <a
          href={`/movies/${m.id}`}
          class="border-2 m-1 p-1 inline-block"
          key={m.id}
        >
          {m.title}
        </a>
      ))}

      <Form action={serverActions.addMovie} invalidate="auto" class="mt-4 flex gap-2">
        <input name="title" placeholder="Title" class="border p-1" />
        <input name="year" placeholder="Year" class="border p-1 w-20" />
        <button type="submit" class="bg-blue-500 text-white px-3 py-1">
          Add Movie
        </button>
      </Form>

      <Router>
        <Route path="/:id" component={Movie} />
        <Noop />
      </Router>
    </section>
  );
};
Movies.displayName = 'Movies';
Movies.defaultProps = { route: '/movies' };

export default getLoaderData(Movies, {
  serverLoader,
  clientLoader,
  cache,
});
```

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test
```

Expected: all PASS

- [ ] **Step 5: Build to verify no type errors**

```bash
pnpm -r build 2>&1 | tail -20
```

Expected: build completes with no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/pages/movies.server.ts apps/app/src/server.tsx apps/app/src/pages/movies.tsx
git commit -m "feat(app): wire up actionsHandler and add addMovie action example with Form"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `defineAction` with phantom types → Task 1
- ✅ `useAction` with `pending`, `error`, `data`, `onMutate`, `onError`, `onSuccess` → Task 2
- ✅ `invalidate: 'auto' | false` → Task 2
- ✅ Optimistic updates via `onMutate` snapshot → Task 2
- ✅ `<Form>` wrapping `useAction`, serializes FormData → Task 3
- ✅ `actionsHandler` with lazy/eager glob, module name derivation → Task 4
- ✅ `serverLoaderValidationPlugin` allows `serverActions`, relaxes default export → Task 5
- ✅ `serverOnlyPlugin` stubs `serverActions` with Proxy → Task 6
- ✅ App integration with real example → Task 7

**Type consistency:** `ActionStub<TPayload, TResult>` used consistently across `defineAction`, `useAction`, `Form`. `actionsHandler` casts stub back to `function` at runtime. `ReloadContext` exported from `page.tsx` and consumed via `useContext` in `useAction`.

**No placeholders:** All steps contain complete code.
