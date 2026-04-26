# Optimistic UI Updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compositional optimistic UI layer (`useOptimistic` primitive + `useOptimisticAction` wrapper) and refactor `<Form>` to compose with `useAction.mutate` instead of duplicating fetch logic.

**Architecture:** A new queue-based `useOptimistic` hook layers pending payloads over a base value via a reducer; entries can be `settle`d (linger until base changes) or `revert`ed (remove immediately). `useOptimisticAction` wires this into `useAction` with automatic settle/revert on mutation completion. `<Form>` becomes a thin wrapper that takes a pre-built `mutate` and `pending` instead of owning its own fetch lifecycle.

**Tech Stack:** Preact + preact/hooks, Vitest + @testing-library/preact, TypeScript (workspace `@hono-preact/iso`).

**Spec:** [`docs/superpowers/specs/2026-04-26-optimistic-ui-updates-design.md`](../specs/2026-04-26-optimistic-ui-updates-design.md)

---

## Commit policy

This project's global rule: never commit without explicit user permission. Each task ends with a commit step. **Pause before running `git commit` and ask the user for approval first.** The provided commit messages are defaults the user can accept or override.

## File map

| File | Status | Responsibility |
|---|---|---|
| `packages/iso/src/action.ts` | modify | Add `TSnapshot` generic; pass snapshot to `onSuccess` |
| `packages/iso/src/optimistic.ts` | create | Primitive `useOptimistic` hook; `OptimisticHandle` type |
| `packages/iso/src/optimistic-action.ts` | create | Wrapper `useOptimisticAction` hook + option/result types |
| `packages/iso/src/form.tsx` | rewrite | Thin wrapper accepting `mutate` and `pending` |
| `packages/iso/src/index.ts` | modify | Export new hooks and types |
| `packages/iso/src/__tests__/action.test.tsx` | modify | Add test: `onSuccess` receives snapshot |
| `packages/iso/src/__tests__/optimistic.test.ts` | create | Primitive hook tests |
| `packages/iso/src/__tests__/optimistic-action.test.tsx` | create | Wrapper hook tests |
| `packages/iso/src/__tests__/form.test.tsx` | rewrite | Tests for new `<Form>` shape |
| `apps/app/src/pages/movie.tsx` | modify | Migrate two `<Form>` usages to new shape |
| `apps/app/src/pages/docs/actions.mdx` | modify | Update `<Form>` examples and prose |
| `apps/app/src/pages/docs/quick-start.mdx` | modify | Update `<Form>` example |
| `apps/app/src/pages/docs/optimistic-ui.mdx` | create | New docs page for optimistic UI |
| `apps/app/src/pages/docs/nav.ts` | modify | Add optimistic-ui nav entry |

---

## Task 1: Extend `useAction` with `TSnapshot` generic

**Files:**
- Modify: `packages/iso/src/action.ts:19-25,120`
- Test: `packages/iso/src/__tests__/action.test.tsx`

The current `onSuccess(data)` signature drops the snapshot returned from `onMutate`. The optimistic primitive needs `onSuccess` to receive the snapshot so it can call `handle.settle()` from the success path. Add a `TSnapshot` generic (defaulted to `unknown` for back-compat) and pass `snapshot` through to `onSuccess`.

- [ ] **Step 1: Add a failing test for snapshot in onSuccess**

Append to `packages/iso/src/__tests__/action.test.tsx` inside the existing `describe('useAction', ...)` block (before the `'sets error on failure...'` test):

```tsx
  it('passes snapshot from onMutate to onSuccess', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    );
    const onMutate = vi.fn(() => 'snap-success');
    const onSuccess = vi.fn();

    function TestComponent() {
      const { mutate } = useAction(stub, { onMutate, onSuccess });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({ ok: true }, 'snap-success')
    );
  });
```

- [ ] **Step 2: Run the new test — verify it FAILS**

```bash
pnpm test packages/iso/src/__tests__/action.test.tsx -- -t "passes snapshot from onMutate to onSuccess"
```

Expected: FAIL — `onSuccess` is called with one arg, not two.

- [ ] **Step 3: Update `UseActionOptions` type with `TSnapshot` generic**

In `packages/iso/src/action.ts`, replace lines 19–25:

```ts
export type UseActionOptions<TPayload, TResult, TSnapshot = unknown> = {
  invalidate?: 'auto' | false | string[];
  onMutate?: (payload: TPayload) => TSnapshot;
  onError?: (err: Error, snapshot: TSnapshot) => void;
  onSuccess?: (data: TResult, snapshot: TSnapshot) => void;
  onChunk?: (chunk: string) => void;
};
```

- [ ] **Step 4: Add `TSnapshot` to `useAction` signature**

Replace the `useAction` function signature (around line 40):

```ts
export function useAction<TPayload, TResult, TSnapshot = unknown>(
  stub: ActionStub<TPayload, TResult>,
  options?: UseActionOptions<TPayload, TResult, TSnapshot>
): UseActionResult<TPayload, TResult> {
```

- [ ] **Step 5: Pass snapshot to onSuccess at the call site**

Find the line `currentOptions?.onSuccess?.(result);` (currently line ~120) and change to:

```ts
        currentOptions?.onSuccess?.(result, snapshot as TSnapshot);
```

Also find the streaming branch's `currentOptions?.onSuccess?.(undefined as unknown as TResult);` (around line 116) and change to:

```ts
        currentOptions?.onSuccess?.(undefined as unknown as TResult, snapshot as TSnapshot);
```

- [ ] **Step 6: Run all `useAction` tests — verify all PASS**

```bash
pnpm test packages/iso/src/__tests__/action.test.tsx
```

Expected: all tests pass, including the new "passes snapshot from onMutate to onSuccess" and the existing "sets data on success and calls onSuccess" (which calls `onSuccess` with `({ ok: true })` — Vitest's `toHaveBeenCalledWith({ ok: true })` matches the first argument; existing test passes since the second arg is `undefined`).

- [ ] **Step 7: Run typecheck across the monorepo**

```bash
pnpm build
```

Expected: build succeeds. The `TSnapshot = unknown` default keeps existing callers working without explicit type args.

- [ ] **Step 8: Commit (gated on user approval)**

```bash
git add packages/iso/src/action.ts packages/iso/src/__tests__/action.test.tsx
git commit -m "feat(iso): pass onMutate snapshot through to useAction onSuccess

Adds a TSnapshot generic to UseActionOptions/useAction (defaulted to
unknown for back-compat) and threads the snapshot returned from
onMutate through to onSuccess. Required by the upcoming useOptimistic
hook so the success path can settle optimistic queue entries."
```

---

## Task 2: Implement `useOptimistic` primitive (TDD)

**Files:**
- Create: `packages/iso/src/optimistic.ts`
- Create: `packages/iso/src/__tests__/optimistic.test.ts`

Implements the queue-based primitive with active/ready entry states and base-ref-change eviction.

- [ ] **Step 1: Create the test file with the first failing test**

Create `packages/iso/src/__tests__/optimistic.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/preact';
import { useOptimistic } from '../optimistic.js';

afterEach(() => {
  cleanup();
});

describe('useOptimistic', () => {
  it('returns base value when no entries are queued', () => {
    const { result } = renderHook(() =>
      useOptimistic([1, 2, 3], (current: number[], p: number) => [...current, p])
    );
    expect(result.current[0]).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
pnpm test packages/iso/src/__tests__/optimistic.test.ts
```

Expected: FAIL — `optimistic.js` does not exist.

- [ ] **Step 3: Create the minimal implementation to pass the first test**

Create `packages/iso/src/optimistic.ts`:

```ts
import { useCallback, useReducer, useRef } from 'preact/hooks';

type Status = 'active' | 'ready';
type Entry<TPayload> = { id: number; payload: TPayload; status: Status };

export type OptimisticHandle = {
  settle: () => void;
  revert: () => void;
};

export function useOptimistic<TBase, TPayload>(
  base: TBase,
  reducer: (current: TBase, payload: TPayload) => TBase
): [TBase, (payload: TPayload) => OptimisticHandle] {
  const queueRef = useRef<Entry<TPayload>[]>([]);
  const lastBaseRef = useRef(base);
  const idRef = useRef(0);
  const [, forceRender] = useReducer((c: number) => c + 1, 0);

  if (!Object.is(lastBaseRef.current, base)) {
    queueRef.current = queueRef.current.filter((e) => e.status !== 'ready');
    lastBaseRef.current = base;
  }

  const value = queueRef.current.reduce(
    (acc, e) => reducer(acc, e.payload),
    base
  );

  const addOptimistic = useCallback((payload: TPayload): OptimisticHandle => {
    const id = ++idRef.current;
    queueRef.current = [...queueRef.current, { id, payload, status: 'active' }];
    forceRender();
    return {
      settle: () => {
        const entry = queueRef.current.find((e) => e.id === id);
        if (entry && entry.status === 'active') {
          entry.status = 'ready';
          forceRender();
        }
      },
      revert: () => {
        queueRef.current = queueRef.current.filter((e) => e.id !== id);
        forceRender();
      },
    };
  }, []);

  return [value, addOptimistic];
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
pnpm test packages/iso/src/__tests__/optimistic.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Add tests for add / settle / revert / base-change eviction**

Append to `packages/iso/src/__tests__/optimistic.test.ts` inside the `describe('useOptimistic', ...)` block:

```ts
  it('addOptimistic appends an entry; reducer applies it to value', () => {
    const { result } = renderHook(() =>
      useOptimistic([1, 2], (current: number[], p: number) => [...current, p])
    );
    act(() => {
      result.current[1](3);
    });
    expect(result.current[0]).toEqual([1, 2, 3]);
  });

  it('handle.revert() removes the entry immediately', () => {
    const { result } = renderHook(() =>
      useOptimistic([1, 2], (current: number[], p: number) => [...current, p])
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](99);
    });
    expect(result.current[0]).toEqual([1, 2, 99]);
    act(() => {
      handle.revert();
    });
    expect(result.current[0]).toEqual([1, 2]);
  });

  it('handle.settle() keeps entry visible until base ref changes', () => {
    const { result, rerender } = renderHook(
      ({ base }: { base: number[] }) =>
        useOptimistic(base, (current: number[], p: number) => [...current, p]),
      { initialProps: { base: [1, 2] } }
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](99);
    });
    expect(result.current[0]).toEqual([1, 2, 99]);

    // settle does not remove immediately
    act(() => {
      handle.settle();
    });
    expect(result.current[0]).toEqual([1, 2, 99]);

    // new base reference evicts the ready entry
    rerender({ base: [1, 2, 99] });
    expect(result.current[0]).toEqual([1, 2, 99]);
    // and the queue is empty — confirm by adding another entry that the reducer applies on the new base
    act(() => {
      result.current[1](100);
    });
    expect(result.current[0]).toEqual([1, 2, 99, 100]);
  });

  it('settling one of two leaves active entries intact through base change', () => {
    const { result, rerender } = renderHook(
      ({ base }: { base: number[] }) =>
        useOptimistic(base, (current: number[], p: number) => [...current, p]),
      { initialProps: { base: [1] } }
    );
    let handleA!: { settle: () => void; revert: () => void };
    let handleB!: { settle: () => void; revert: () => void };
    act(() => {
      handleA = result.current[1](2);
    });
    act(() => {
      handleB = result.current[1](3);
    });
    expect(result.current[0]).toEqual([1, 2, 3]);

    // A settles (server confirmed); B still active
    act(() => {
      handleA.settle();
    });

    // base updates to reflect A's confirmed state — A:ready evicted; B:active remains
    rerender({ base: [1, 2] });
    expect(result.current[0]).toEqual([1, 2, 3]);

    // B then completes
    act(() => {
      handleB.settle();
    });
    rerender({ base: [1, 2, 3] });
    expect(result.current[0]).toEqual([1, 2, 3]);

    // Confirm queue is fully drained
    act(() => {
      result.current[1](4);
    });
    expect(result.current[0]).toEqual([1, 2, 3, 4]);
    // Avoid leaving the last entry in flight in the test
    void handleB;
  });

  it('base ref change with no ready entries leaves queue intact', () => {
    const { result, rerender } = renderHook(
      ({ base }: { base: number[] }) =>
        useOptimistic(base, (current: number[], p: number) => [...current, p]),
      { initialProps: { base: [1] } }
    );
    act(() => {
      result.current[1](99); // active entry, not settled
    });
    rerender({ base: [1, 2] });
    expect(result.current[0]).toEqual([1, 2, 99]);
  });

  it('multiple entries reduce in insertion order', () => {
    const { result } = renderHook(() =>
      useOptimistic('', (current: string, p: string) => current + p)
    );
    act(() => {
      result.current[1]('a');
    });
    act(() => {
      result.current[1]('b');
    });
    act(() => {
      result.current[1]('c');
    });
    expect(result.current[0]).toBe('abc');
  });

  it('revert is idempotent', () => {
    const { result } = renderHook(() =>
      useOptimistic([0], (current: number[], p: number) => [...current, p])
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](1);
    });
    act(() => {
      handle.revert();
    });
    act(() => {
      handle.revert();
    });
    expect(result.current[0]).toEqual([0]);
  });

  it('settle then revert removes the entry', () => {
    const { result } = renderHook(() =>
      useOptimistic([0], (current: number[], p: number) => [...current, p])
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](1);
    });
    act(() => {
      handle.settle();
    });
    act(() => {
      handle.revert();
    });
    expect(result.current[0]).toEqual([0]);
  });

  it('revert then settle is a no-op for the second call', () => {
    const { result } = renderHook(() =>
      useOptimistic([0], (current: number[], p: number) => [...current, p])
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](1);
    });
    act(() => {
      handle.revert();
    });
    act(() => {
      handle.settle();
    });
    expect(result.current[0]).toEqual([0]);
  });

  it('works with primitive base via Object.is equality', () => {
    const { result, rerender } = renderHook(
      ({ base }: { base: number }) =>
        useOptimistic(base, (current: number, p: number) => current + p),
      { initialProps: { base: 10 } }
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](5);
    });
    expect(result.current[0]).toBe(15);
    act(() => {
      handle.settle();
    });
    rerender({ base: 15 }); // new "base" reference (primitive, but Object.is(10, 15) is false)
    expect(result.current[0]).toBe(15);
  });
```

- [ ] **Step 6: Run all primitive tests — verify all PASS**

```bash
pnpm test packages/iso/src/__tests__/optimistic.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 7: Commit (gated on user approval)**

```bash
git add packages/iso/src/optimistic.ts packages/iso/src/__tests__/optimistic.test.ts
git commit -m "feat(iso): add useOptimistic primitive

Queue-based optimistic state primitive. Entries can be settled (linger
until base ref changes) or reverted (remove immediately). Composes
with useAction via onMutate/onSuccess/onError."
```

---

## Task 3: Implement `useOptimisticAction` wrapper (TDD)

**Files:**
- Create: `packages/iso/src/optimistic-action.ts`
- Create: `packages/iso/src/__tests__/optimistic-action.test.tsx`

Wraps `useAction` + `useOptimistic`, automatically settling/reverting around the mutation lifecycle.

- [ ] **Step 1: Create the test file with the first failing test**

Create `packages/iso/src/__tests__/optimistic-action.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/preact';
import { useOptimisticAction } from '../optimistic-action.js';
import { ReloadContext } from '../page.js';
import type { ActionStub } from '../action.js';
import { cacheRegistry } from '../cache-registry.js';

const stub: ActionStub<{ title: string }, { id: number; title: string }> = {
  __module: 'movies',
  __action: 'create',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  cacheRegistry.clear();
});

describe('useOptimisticAction', () => {
  it('shows optimistic value while mutation is in flight', async () => {
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

    function TestComponent({ base }: { base: string[] }) {
      const { mutate, value } = useOptimisticAction(stub, {
        base,
        apply: (current, payload) => [...current, payload.title],
        invalidate: 'auto',
      });
      return (
        <div>
          <button onClick={() => mutate({ title: 'Dune' })}>go</button>
          <ul data-testid="list">
            {value.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      );
    }

    render(<TestComponent base={['Alien']} />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    expect(screen.getByTestId('list')).toHaveTextContent('Alien');
    expect(screen.getByTestId('list')).toHaveTextContent('Dune');

    // Cleanup the in-flight fetch so the test can finish
    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ id: 1, title: 'Dune' }), { status: 200 })
      );
    });
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
pnpm test packages/iso/src/__tests__/optimistic-action.test.tsx
```

Expected: FAIL — `optimistic-action.js` does not exist.

- [ ] **Step 3: Create the implementation**

Create `packages/iso/src/optimistic-action.ts`:

```ts
import {
  useAction,
  type UseActionOptions,
  type UseActionResult,
  type ActionStub,
} from './action.js';
import { useOptimistic, type OptimisticHandle } from './optimistic.js';

export type UseOptimisticActionOptions<TPayload, TResult, TBase> = Omit<
  UseActionOptions<TPayload, TResult>,
  'invalidate' | 'onMutate' | 'onError' | 'onSuccess'
> & {
  base: TBase;
  apply: (current: TBase, payload: TPayload) => TBase;
  invalidate?: 'auto' | string[];
  onSuccess?: (data: TResult) => void;
  onError?: (err: Error) => void;
};

export type UseOptimisticActionResult<TPayload, TResult, TBase> =
  UseActionResult<TPayload, TResult> & { value: TBase };

export function useOptimisticAction<TPayload, TResult, TBase>(
  stub: ActionStub<TPayload, TResult>,
  options: UseOptimisticActionOptions<TPayload, TResult, TBase>
): UseOptimisticActionResult<TPayload, TResult, TBase> {
  const { base, apply, onSuccess, onError, ...actionOpts } = options;
  const [value, addOptimistic] = useOptimistic(base, apply);

  const action = useAction<TPayload, TResult, OptimisticHandle>(stub, {
    ...actionOpts,
    onMutate: (payload) => addOptimistic(payload),
    onSuccess: (data, handle) => {
      handle.settle();
      onSuccess?.(data);
    },
    onError: (err, handle) => {
      handle.revert();
      onError?.(err);
    },
  });

  return { ...action, value };
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
pnpm test packages/iso/src/__tests__/optimistic-action.test.tsx
```

Expected: PASS (1 test).

- [ ] **Step 5: Add the success / error / spam-click / user-callback tests**

Append to `packages/iso/src/__tests__/optimistic-action.test.tsx` inside the `describe('useOptimisticAction', ...)` block:

```tsx
  it('reverts to base on mutation failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'DB error' }), { status: 500 })
      )
    );

    function TestComponent() {
      const { mutate, value, error } = useOptimisticAction(stub, {
        base: ['Alien'],
        apply: (current, payload) => [...current, payload.title],
        invalidate: 'auto',
      });
      return (
        <div>
          <button onClick={() => mutate({ title: 'Dune' })}>go</button>
          <ul data-testid="list">
            {value.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <span data-testid="err">{error?.message ?? 'none'}</span>
        </div>
      );
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    await screen.findByText('DB error');
    expect(screen.getByTestId('list')).toHaveTextContent('Alien');
    expect(screen.getByTestId('list')).not.toHaveTextContent('Dune');
  });

  it('calls user-supplied onSuccess(data) without exposing snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 1, title: 'Dune' }), { status: 200 })
      )
    );
    const onSuccess = vi.fn();

    function TestComponent() {
      const { mutate } = useOptimisticAction(stub, {
        base: ['Alien'],
        apply: (current, payload) => [...current, payload.title],
        invalidate: 'auto',
        onSuccess,
      });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(
      <ReloadContext.Provider value={{ reload: vi.fn(), reloading: false, error: null }}>
        <TestComponent />
      </ReloadContext.Provider>
    );
    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith({ id: 1, title: 'Dune' });
    // Verify only one argument was passed (no snapshot leak)
    expect(onSuccess.mock.calls[0]).toHaveLength(1);
  });

  it('calls user-supplied onError(err) without exposing snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'DB error' }), { status: 500 })
      )
    );
    const onError = vi.fn();

    function TestComponent() {
      const { mutate } = useOptimisticAction(stub, {
        base: ['Alien'],
        apply: (current, payload) => [...current, payload.title],
        invalidate: 'auto',
        onError,
      });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0]).toHaveLength(1);
  });

  it('handles concurrent mutations: first settles, second still optimistic', async () => {
    const resolvers: Array<(v: Response) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolvers.push(r);
          })
      )
    );

    function TestComponent({ base }: { base: string[] }) {
      const { mutate, value } = useOptimisticAction(stub, {
        base,
        apply: (current, payload) => [...current, payload.title],
        invalidate: 'auto',
      });
      return (
        <div>
          <button data-testid="add-a" onClick={() => mutate({ title: 'A' })}>
            A
          </button>
          <button data-testid="add-b" onClick={() => mutate({ title: 'B' })}>
            B
          </button>
          <ul data-testid="list">
            {value.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      );
    }

    const { rerender } = render(<TestComponent base={['Alien']} />);

    await act(async () => {
      screen.getByTestId('add-a').click();
    });
    await act(async () => {
      screen.getByTestId('add-b').click();
    });

    // Both optimistic
    expect(screen.getByTestId('list')).toHaveTextContent('Alien');
    expect(screen.getByTestId('list')).toHaveTextContent('A');
    expect(screen.getByTestId('list')).toHaveTextContent('B');

    // Resolve A
    await act(async () => {
      resolvers[0]!(
        new Response(JSON.stringify({ id: 1, title: 'A' }), { status: 200 })
      );
    });

    // Simulate the loader refetch by rerendering with a new base reference (A confirmed)
    rerender(<TestComponent base={['Alien', 'A']} />);

    // A is now from base (server-confirmed); B is still optimistic
    expect(screen.getByTestId('list')).toHaveTextContent('Alien');
    expect(screen.getByTestId('list')).toHaveTextContent('A');
    expect(screen.getByTestId('list')).toHaveTextContent('B');

    // Resolve B
    await act(async () => {
      resolvers[1]!(
        new Response(JSON.stringify({ id: 2, title: 'B' }), { status: 200 })
      );
    });

    // Refetch reflects both
    rerender(<TestComponent base={['Alien', 'A', 'B']} />);
    expect(screen.getByTestId('list')).toHaveTextContent('Alien');
    expect(screen.getByTestId('list')).toHaveTextContent('A');
    expect(screen.getByTestId('list')).toHaveTextContent('B');
  });
```

- [ ] **Step 6: Run all wrapper tests — verify all PASS**

```bash
pnpm test packages/iso/src/__tests__/optimistic-action.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 7: Commit (gated on user approval)**

```bash
git add packages/iso/src/optimistic-action.ts packages/iso/src/__tests__/optimistic-action.test.tsx
git commit -m "feat(iso): add useOptimisticAction wrapper

Composes useAction + useOptimistic. Wires up addOptimistic/settle/revert
around the mutation lifecycle. Excludes invalidate: false and onMutate
from the wrapper's accepted options — drop to the primitive for those."
```

---

## Task 4: Export new hooks from `@hono-preact/iso`

**Files:**
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Add exports**

Append to `packages/iso/src/index.ts` (after the existing `Form` export):

```ts
export { useOptimistic } from './optimistic.js';
export type { OptimisticHandle } from './optimistic.js';
export { useOptimisticAction } from './optimistic-action.js';
export type {
  UseOptimisticActionOptions,
  UseOptimisticActionResult,
} from './optimistic-action.js';
```

- [ ] **Step 2: Build and run all iso tests**

```bash
pnpm build
pnpm test packages/iso
```

Expected: build succeeds; all `@hono-preact/iso` tests pass.

- [ ] **Step 3: Commit (gated on user approval)**

```bash
git add packages/iso/src/index.ts
git commit -m "feat(iso): export useOptimistic and useOptimisticAction"
```

---

## Task 5: Refactor `<Form>` (breaking change)

**Files:**
- Rewrite: `packages/iso/src/form.tsx`
- Rewrite: `packages/iso/src/__tests__/form.test.tsx`

The new `<Form>` accepts `mutate` (from `useAction` or `useOptimisticAction`) and `pending` (for fieldset disabling). It no longer takes an action stub or any action-related options. This deletes ~50 lines of duplicated fetch logic and incidentally fixes the streaming bug (`docs/design-concerns-2026-04-25.md` #1) and the inline-style bug (#2).

- [ ] **Step 1: Replace the test file**

Overwrite `packages/iso/src/__tests__/form.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/preact';
import { Form } from '../form.js';

afterEach(() => {
  cleanup();
});

describe('Form', () => {
  it('serializes FormData to a plain object and calls mutate on submit', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);

    render(
      <Form mutate={mutate}>
        <input name="title" defaultValue="Dune" />
        <input name="year" defaultValue="2021" />
        <button type="submit">Submit</button>
      </Form>
    );

    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    expect(mutate).toHaveBeenCalledWith({ title: 'Dune', year: '2021' });
  });

  it('passes File values through unchanged in the payload', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    const file = new File(['data'], 'poster.jpg', { type: 'image/jpeg' });

    function TestForm() {
      return (
        <Form mutate={mutate}>
          <input type="file" name="poster" />
          <button type="submit">Submit</button>
        </Form>
      );
    }

    render(<TestForm />);
    const input = screen.getByRole('button').closest('form')!.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });

    await act(async () => {
      fireEvent.submit(screen.getByRole('button').closest('form')!);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    const payload = mutate.mock.calls[0][0] as { poster: File };
    expect(payload.poster).toBeInstanceOf(File);
    expect(payload.poster.name).toBe('poster.jpg');
  });

  it('disables the fieldset when pending is true', () => {
    const mutate = vi.fn();
    render(
      <Form mutate={mutate} pending={true}>
        <input name="title" />
        <button type="submit">Submit</button>
      </Form>
    );
    const fieldset = screen.getByRole('button').closest('fieldset');
    expect(fieldset).toBeDisabled();
  });

  it('does not disable the fieldset when pending is false or absent', () => {
    const mutate = vi.fn();
    const { rerender } = render(
      <Form mutate={mutate} pending={false}>
        <input name="title" />
        <button type="submit">Submit</button>
      </Form>
    );
    expect(screen.getByRole('button').closest('fieldset')).not.toBeDisabled();

    rerender(
      <Form mutate={mutate}>
        <input name="title" />
        <button type="submit">Submit</button>
      </Form>
    );
    expect(screen.getByRole('button').closest('fieldset')).not.toBeDisabled();
  });

  it('forwards arbitrary HTML form attributes to the <form> element', () => {
    const mutate = vi.fn();
    render(
      <Form mutate={mutate} class="my-form" data-testid="theform">
        <button type="submit">Submit</button>
      </Form>
    );
    const formEl = screen.getByTestId('theform');
    expect(formEl.tagName).toBe('FORM');
    expect(formEl).toHaveClass('my-form');
  });

  it('prevents default form submission', () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    render(
      <Form mutate={mutate}>
        <button type="submit">Submit</button>
      </Form>
    );
    const formEl = screen.getByRole('button').closest('form')!;
    const submitEvent = new Event('submit', { cancelable: true, bubbles: true });
    formEl.dispatchEvent(submitEvent);
    expect(submitEvent.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify FAIL (existing form.tsx is incompatible)**

```bash
pnpm test packages/iso/src/__tests__/form.test.tsx
```

Expected: FAIL — type errors / runtime errors because old `<Form>` requires `action`.

- [ ] **Step 3: Rewrite `form.tsx`**

Overwrite `packages/iso/src/form.tsx` with:

```tsx
import type { JSX, ComponentChildren } from 'preact';

export type FormProps<TPayload extends Record<string, unknown>> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'onSubmit'
> & {
  mutate: (payload: TPayload) => Promise<void> | void;
  pending?: boolean;
  children?: ComponentChildren;
};

export function Form<TPayload extends Record<string, unknown>>({
  mutate,
  pending,
  children,
  ...rest
}: FormProps<TPayload>) {
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const formEl = e.currentTarget as HTMLFormElement;
    const formData = new FormData(formEl);
    const payload = Object.fromEntries(formData.entries()) as TPayload;
    void mutate(payload);
  };

  return (
    <form {...rest} onSubmit={handleSubmit}>
      <fieldset disabled={pending} class="hp-form-fieldset">
        {children}
      </fieldset>
    </form>
  );
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
pnpm test packages/iso/src/__tests__/form.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 5: Build to verify type-correctness across the workspace**

```bash
pnpm build
```

Expected: build will FAIL — `apps/app/src/pages/movie.tsx` still uses the old `<Form action={...}>` API. That's fixed in Task 5b. Continue to the next step regardless.

- [ ] **Step 6: Migrate `apps/app/src/pages/movie.tsx`**

Open `apps/app/src/pages/movie.tsx`. The file currently has two `<Form>` usages (lines ~73 and ~105) using the old `action`/`invalidate`/`onSuccess` props.

Replace lines 71–94 (the Notes section) with:

```tsx
      <section>
        <h2 class="font-semibold">Notes</h2>
        <NotesForm
          movieIdStr={movieIdStr}
          defaultNotes={watched?.notes ?? ''}
          movieKey={movie.id}
        />
      </section>
```

Replace lines 96–120 (the Memory photo section) with:

```tsx
      <section>
        <h2 class="font-semibold">Memory photo</h2>
        {watched?.photo && (
          <img
            src={`/api/watched/${movie.id}/photo`}
            alt="memory"
            class="max-w-xs my-2"
          />
        )}
        <PhotoForm movieIdStr={movieIdStr} />
      </section>
```

Add these two component definitions above the `MovieDetail` component (after the imports, before line 18):

```tsx
const NotesForm: FunctionComponent<{
  movieIdStr: string;
  defaultNotes: string;
  movieKey: number;
}> = ({ movieIdStr, defaultNotes, movieKey }) => {
  const { mutate, pending } = useAction(serverActions.setNotes, {
    invalidate: 'auto',
    onSuccess: () => cacheRegistry.invalidate('watched'),
  });
  return (
    <Form mutate={mutate} pending={pending} class="flex flex-col gap-2 mt-1">
      <input type="hidden" name="movieId" value={movieIdStr} />
      <textarea
        key={movieKey}
        name="notes"
        class="border p-1 w-full"
        rows={3}
        defaultValue={defaultNotes}
      />
      <button
        type="submit"
        class="bg-blue-500 text-white px-3 py-1 self-start"
      >
        Save notes
      </button>
    </Form>
  );
};

const PhotoForm: FunctionComponent<{ movieIdStr: string }> = ({ movieIdStr }) => {
  const { mutate, pending } = useAction(serverActions.setPhoto, {
    invalidate: 'auto',
    onSuccess: () => cacheRegistry.invalidate('watched'),
  });
  return (
    <Form mutate={mutate} pending={pending} class="flex flex-col gap-2 mt-1">
      <input type="hidden" name="movieId" value={movieIdStr} />
      <input type="file" name="photo" accept="image/*" />
      <button
        type="submit"
        class="bg-blue-500 text-white px-3 py-1 self-start"
      >
        Upload photo
      </button>
    </Form>
  );
};
```

Note: The reason these are extracted to sub-components is that `useAction` must be called from within a component body, and pulling them out keeps the migration clean (each form has its own `pending` state, independent of the existing `useAction(serverActions.toggleWatched, ...)` call already in `MovieDetail`).

- [ ] **Step 7: Run all tests and build**

```bash
pnpm test
pnpm build
```

Expected: all tests pass; build succeeds.

- [ ] **Step 8: Verify the app boots and the forms work in the browser**

```bash
pnpm dev
```

Open `http://localhost:5173/movies/1` in a browser. Verify:
- "Save notes" submits and the notes persist after refresh
- "Upload photo" submits with a file selected; image appears after upload
- During submission, both fieldsets visibly disable

Stop the dev server (Ctrl-C) when done.

- [ ] **Step 9: Update `apps/app/src/pages/docs/actions.mdx`**

Find and replace the `<Form>` example at line ~108–117:

```mdx
import { Form } from '@hono-preact/iso';
import { serverActions } from './movies.server.js';

const AddMovieForm = () => {
  const { mutate, pending } = useAction(serverActions.addMovie, { invalidate: 'auto' });
  return (
    <Form mutate={mutate} pending={pending}>
      <input name="title" placeholder="Title" />
      <button type="submit">Add Movie</button>
    </Form>
  );
};
```

Note: that example also needs `useAction` imported — update the import line:

```mdx
import { Form, useAction } from '@hono-preact/iso';
```

Update the prose at line ~106 from:

> `<Form>` wraps `useAction` and handles FormData serialization. It disables all its inputs while the action is pending.

to:

> `<Form>` is a thin wrapper around a native `<form>` that serializes the submission to a payload object and calls a `mutate` function you provide (typically from `useAction` or `useOptimisticAction`). When you pass `pending`, the wrapping `<fieldset>` is disabled while the mutation is in flight.

Update the prose at line ~120 from:

> `<Form>` accepts the same `invalidate`, `onMutate`, `onSuccess`, and `onError` options as `useAction`, plus any HTML `<form>` attribute except `action` and `onSubmit`.

to:

> `<Form>` accepts any HTML `<form>` attribute (except `onSubmit`, which it owns), plus `mutate` (required) and `pending` (optional). All action-related options live on the `useAction` call, not on `<Form>`.

Update the file upload example at lines ~169–175 from:

```mdx
<Form action={serverActions.uploadPoster} onSuccess={({ url }) => setPosterUrl(url)}>
  <input type="hidden" name="movieId" value={movie.id} />
  <input type="file" name="poster" accept="image/*" />
  <button type="submit">Upload Poster</button>
</Form>
```

to:

```mdx
const UploadPosterForm = ({ movieId, setPosterUrl }) => {
  const { mutate, pending } = useAction(serverActions.uploadPoster, {
    onSuccess: ({ url }) => setPosterUrl(url),
  });
  return (
    <Form mutate={mutate} pending={pending}>
      <input type="hidden" name="movieId" value={movieId} />
      <input type="file" name="poster" accept="image/*" />
      <button type="submit">Upload Poster</button>
    </Form>
  );
};
```

Update the prose at line ~159 from:

> `invalidate` accepts an array so you can clear multiple caches in one shot: `invalidate: ['movies', 'ratings']`. `<Form>` accepts the same option.

to:

> `invalidate` accepts an array so you can clear multiple caches in one shot: `invalidate: ['movies', 'ratings']`. Pass it to `useAction`; `<Form>` itself has no `invalidate` prop.

Update the prose at line ~165 from:

> `<Form>` and `useAction` automatically switch to `multipart/form-data` when the payload contains `File` objects, so you can accept file uploads in your action without any extra configuration.

to:

> `useAction` automatically switches to `multipart/form-data` when the payload contains `File` objects. Since `<Form>` serializes file inputs as `File` instances in the payload, file uploads work transparently when you pair it with `useAction`.

Update line ~167 from:

> **With `<Form>`** — add a file input; `<Form>` detects it and sends FormData:

to:

> **With `<Form>`** — add a file input; `useAction` detects the `File` value in the payload and sends FormData:

Update line ~38 from:

> `defineAction` is a no-op at runtime — it just returns the function unchanged. Its only job is to brand the function with phantom types so `useAction` and `<Form>` can infer the payload and result types without codegen.

to:

> `defineAction` is a no-op at runtime — it just returns the function unchanged. Its only job is to brand the function with phantom types so `useAction` can infer the payload and result types without codegen.

Update line ~104 (heading) from:

> ## Calling actions with `<Form>`

to:

> ## Submitting with `<Form>`

- [ ] **Step 10: Update `apps/app/src/pages/docs/quick-start.mdx`**

Find the example at line ~138–155 and replace:

```mdx
import type { FunctionComponent } from 'preact';
import { Form, getLoaderData, type LoaderData } from '@hono-preact/iso';
import serverLoader, { serverActions, type Movie } from './movies.server.js';

const Movies: FunctionComponent<LoaderData<{ movies: Movie[] }>> = ({ loaderData }) => {
  return (
    <main>
      <h1>Movies</h1>
      <Form action={serverActions.addMovie} invalidate="auto">
        <input name="title" placeholder="Movie title" required />
        <button type="submit">Add</button>
      </Form>
```

with:

```mdx
import type { FunctionComponent } from 'preact';
import { Form, getLoaderData, type LoaderData, useAction } from '@hono-preact/iso';
import serverLoader, { serverActions, type Movie } from './movies.server.js';

const AddMovieForm: FunctionComponent = () => {
  const { mutate, pending } = useAction(serverActions.addMovie, { invalidate: 'auto' });
  return (
    <Form mutate={mutate} pending={pending}>
      <input name="title" placeholder="Movie title" required />
      <button type="submit">Add</button>
    </Form>
  );
};

const Movies: FunctionComponent<LoaderData<{ movies: Movie[] }>> = ({ loaderData }) => {
  return (
    <main>
      <h1>Movies</h1>
      <AddMovieForm />
```

(Keep the rest of the example unchanged — only the imports, the new `AddMovieForm` block, and the `<Form>` element itself change.)

- [ ] **Step 11: Run full test suite and build**

```bash
pnpm test
pnpm build
```

Expected: all tests pass; build succeeds.

- [ ] **Step 12: Commit (gated on user approval)**

```bash
git add packages/iso/src/form.tsx packages/iso/src/__tests__/form.test.tsx \
  apps/app/src/pages/movie.tsx \
  apps/app/src/pages/docs/actions.mdx \
  apps/app/src/pages/docs/quick-start.mdx
git commit -m "refactor(iso): <Form> composes with useAction.mutate

<Form> no longer owns its own fetch lifecycle. It now accepts a
pre-built mutate (from useAction / useOptimisticAction) and an
optional pending flag. Removes ~50 lines of duplicated fetch logic;
incidentally fixes streaming-action and inline-style issues from the
2026-04-25 design review.

BREAKING: <Form action={stub}> shape removed. Migrate to:
  const { mutate, pending } = useAction(stub, opts);
  <Form mutate={mutate} pending={pending}>...</Form>"
```

---

## Task 6: Add docs page for optimistic UI

**Files:**
- Create: `apps/app/src/pages/docs/optimistic-ui.mdx`
- Modify: `apps/app/src/pages/docs/nav.ts`

Per `.claude/skills/add-docs-page.md`, two files: the MDX page and a nav entry.

- [ ] **Step 1: Create the MDX page**

Create `apps/app/src/pages/docs/optimistic-ui.mdx`:

````mdx
# Optimistic UI Updates

`useOptimistic` and `useOptimisticAction` let you show the result of a mutation in the UI before the server confirms it, then automatically reconcile when the server responds. They compose with the existing `useAction` hook — no changes to your loaders or actions are required.

## Why two hooks?

- **`useOptimistic`** is a primitive: it maintains a queue of pending changes layered over a base value. You hold the queue handles and decide when to settle (success) or revert (error) each entry. Use it directly when you need full control or when one piece of optimistic state is fed by multiple actions.
- **`useOptimisticAction`** is a wrapper around `useAction` + `useOptimistic` for the common single-action case. It owns the queue lifecycle for you.

Start with `useOptimisticAction`. Drop down to the primitive if you outgrow it.

## `useOptimisticAction`

```tsx
import { useOptimisticAction } from '@hono-preact/iso';
import { serverActions } from './movies.server.js';

const Movies = ({ loaderData }) => {
  const { mutate, pending, value: movies } = useOptimisticAction(
    serverActions.create,
    {
      base: loaderData.movies,
      apply: (current, payload) => [...current, payload],
      invalidate: 'auto',
      onSuccess: (data) => console.log('created', data),
      onError: (err) => console.error(err),
    }
  );

  return (
    <ul>
      {movies.map((m) => <li key={m.id}>{m.title}</li>)}
    </ul>
  );
};
```

`value` is the projection: `base` with all in-flight payloads applied via `apply`. While the mutation is in flight, `value` includes the optimistic entry; after the server responds and the loader refetches (`invalidate: 'auto'`), `value` reflects real server data with no visual gap.

### Options

| Option | Type | Description |
|---|---|---|
| `base` | `TBase` | The base value (typically loader data) the projection layers over |
| `apply` | `(current, payload) => TBase` | Reducer that produces the next projection |
| `invalidate` | `'auto' \| string[]` | Refetch trigger after mutation succeeds. `false` is intentionally not allowed — see below. |
| `onSuccess` | `(data) => void` | Called after a successful mutation. Snapshot is internal; not exposed here. |
| `onError` | `(err) => void` | Called after a failed mutation. The optimistic entry is reverted automatically before this fires. |

Other `useAction` options (`onChunk`) pass through.

### Why no `invalidate: false`?

The optimistic entry settles into `'ready'` state on success and waits for the base to update before evicting. Without an invalidation that refetches, the base never changes, the entry lingers, and the UI gets stuck. Use `useOptimistic` directly if you have a use case where base updates by another path.

## `useOptimistic` (primitive)

```tsx
import { useOptimistic, useAction } from '@hono-preact/iso';

const Movies = ({ loaderData }) => {
  const [movies, addOptimistic] = useOptimistic(
    loaderData.movies,
    (current, payload) => [...current, payload]
  );

  const { mutate } = useAction(serverActions.create, {
    invalidate: 'auto',
    onMutate: (payload) => addOptimistic(payload),
    onSuccess: (_data, handle) => handle.settle(),
    onError: (_err, handle) => handle.revert(),
  });

  return <ul>{movies.map((m) => <li key={m.id}>{m.title}</li>)}</ul>;
};
```

`addOptimistic(payload)` appends a queue entry and returns an `OptimisticHandle`:

```ts
type OptimisticHandle = {
  settle: () => void;  // success: linger until base ref changes
  revert: () => void;  // error: remove immediately
};
```

The handle becomes the snapshot in `useAction`'s `onMutate`/`onSuccess`/`onError` chain.

## Concurrent mutations

Both APIs handle concurrent mutations correctly. If a user fires two mutations and the first completes before the second, the second's optimistic entry survives the first's settle-and-refetch:

```
queue=[A:active, B:active]
  → A succeeds, A.settle()
queue=[A:ready, B:active]
  → loader refetches, base updates (A confirmed)
  → A:ready evicted (base ref changed), B:active stays
queue=[B:active]
  → UI shows server-confirmed A + optimistic B
```

No special configuration needed.

## Composing with `<Form>`

`<Form>` accepts the `mutate`/`pending` from `useOptimisticAction` directly:

```tsx
const NotesForm = ({ defaultNotes }) => {
  const { mutate, pending, value: notes } = useOptimisticAction(
    serverActions.setNotes,
    {
      base: defaultNotes,
      apply: (_current, payload) => payload.notes,
      invalidate: 'auto',
    }
  );

  return (
    <>
      <p>Current: {notes}</p>
      <Form mutate={mutate} pending={pending}>
        <textarea name="notes" defaultValue={notes} />
        <button>Save</button>
      </Form>
    </>
  );
};
```
````

- [ ] **Step 2: Add nav entry**

In `apps/app/src/pages/docs/nav.ts`, update the `Mutations` section. Replace:

```ts
  {
    heading: 'Mutations',
    entries: [
      { title: 'Server Actions', route: '/docs/actions' },
      { title: 'Action Guards', route: '/docs/action-guards' },
    ],
  },
```

with:

```ts
  {
    heading: 'Mutations',
    entries: [
      { title: 'Server Actions', route: '/docs/actions' },
      { title: 'Action Guards', route: '/docs/action-guards' },
      { title: 'Optimistic UI', route: '/docs/optimistic-ui' },
    ],
  },
```

- [ ] **Step 3: Build and verify the docs page renders**

```bash
pnpm build
pnpm dev
```

Open `http://localhost:5173/docs/optimistic-ui` in a browser. Verify the page renders, the sidebar shows the new entry under Mutations, and the code blocks display correctly.

Stop the dev server when done.

- [ ] **Step 4: Commit (gated on user approval)**

```bash
git add apps/app/src/pages/docs/optimistic-ui.mdx apps/app/src/pages/docs/nav.ts
git commit -m "docs: add optimistic UI page

Covers useOptimisticAction (recommended) and the useOptimistic
primitive, including the concurrent mutation pattern and composition
with <Form>."
```

---

## Verification

After all six tasks are committed, run a full sweep:

```bash
pnpm test
pnpm build
```

Both must pass. The new exports (`useOptimistic`, `useOptimisticAction`, `OptimisticHandle`, `UseOptimisticActionOptions`, `UseOptimisticActionResult`) should be importable from `@hono-preact/iso`. The new docs page should appear at `/docs/optimistic-ui`. The two `<Form>` usages in `movie.tsx` should still work end-to-end (verified in Task 5 step 8).
