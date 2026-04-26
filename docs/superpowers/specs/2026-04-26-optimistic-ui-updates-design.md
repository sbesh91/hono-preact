# Optimistic UI Updates — Design

**Date:** 2026-04-26
**Status:** Approved

## Purpose

A compositional layer on top of the existing `useAction` hook that makes optimistic UI updates ergonomic without changing the underlying cache or transport. Two new hooks ship in `@hono-preact/iso`:

- `useOptimistic` — primitive that maintains a queue of pending payloads layered over a base value via a reducer.
- `useOptimisticAction` — sugar that combines `useOptimistic` with `useAction` for the common single-mutation case.

The current `onMutate` / `onError` snapshot pattern stays available and unchanged for callers who don't want optimistic queue semantics.

## Background

Today, optimistic UI requires the developer to:

1. Maintain parallel local state alongside loader data.
2. Apply the optimistic projection in `onMutate`.
3. Capture a snapshot for rollback.
4. Restore the snapshot in `onError`.

Loader caches in `packages/iso/src/cache.ts` are not reactive — components consume loader data via the `loaderData` prop, not by subscribing. So mutating a cache wouldn't propagate to the UI even if we exposed it; reactive caches are out of scope for this work.

The compositional approach: introduce a primitive that *projects* base data plus a queue of in-flight changes, returning a value the component renders directly. No parallel state, no manual snapshot dance.

## API surface

### `useOptimistic` (primitive)

```ts
function useOptimistic<TBase, TPayload>(
  base: TBase,
  reducer: (current: TBase, payload: TPayload) => TBase
): [TBase, (payload: TPayload) => OptimisticHandle];

type OptimisticHandle = {
  settle: () => void;  // success path: mark "ready", linger until base ref changes
  revert: () => void;  // error path: remove entry immediately
};
```

Returns `[value, addOptimistic]`. `value` is computed each render as `queue.reduce(reducer, base)` over entries currently in the queue. `addOptimistic(payload)` appends an entry and returns a handle for resolving it.

Composes with the existing `useAction`:

```ts
const [movies, addOptimistic] = useOptimistic(
  loaderData.movies,
  (current, payload: Movie) => [...current, payload]
);

const { mutate } = useAction(serverActions.create, {
  invalidate: 'auto',
  onMutate: (payload) => addOptimistic(payload),  // returns OptimisticHandle (becomes snapshot)
  onSuccess: (_data, handle) => handle.settle(),
  onError: (_err, handle) => handle.revert(),
});
```

### `useOptimisticAction` (wrapper)

```ts
type UseOptimisticActionOptions<TPayload, TResult, TBase> =
  Omit<UseActionOptions<TPayload, TResult>, 'invalidate' | 'onMutate' | 'onError' | 'onSuccess'> & {
    base: TBase;
    apply: (current: TBase, payload: TPayload) => TBase;
    invalidate?: 'auto' | string[];   // 'false' intentionally omitted
    onSuccess?: (data: TResult) => void;
    onError?: (err: Error) => void;
  };

type UseOptimisticActionResult<TPayload, TResult, TBase> =
  UseActionResult<TPayload, TResult> & { value: TBase };

function useOptimisticAction<TPayload, TResult, TBase>(
  stub: ActionStub<TPayload, TResult>,
  options: UseOptimisticActionOptions<TPayload, TResult, TBase>
): UseOptimisticActionResult<TPayload, TResult, TBase>;
```

Internally calls `useAction` and `useOptimistic`; wires the optimistic handle through `onMutate` / `onSuccess` / `onError` so callers don't see it.

```ts
const { mutate, pending, value: movies } = useOptimisticAction(
  serverActions.create,
  {
    base: loaderData.movies,
    apply: (current, payload) => [...current, payload],
    invalidate: 'auto',
    onSuccess: (data) => navigate(`/movies/${data.id}`),
    onError: (err) => toast.error(err.message),
  }
);
```

### Restrictions on the wrapper

- `invalidate: false` is omitted from the type. With no refetch, base never changes, `ready` entries linger indefinitely. Callers needing this combination drop down to the primitive and accept that limit.
- `onMutate` is omitted from the type. The wrapper owns optimistic state internally; custom `onMutate` would conflict with that ownership. Callers needing custom pre-flight logic drop down to the primitive.

## Semantics & lifecycle

### Two-state queue

Each entry is `{ id, payload, status: 'active' | 'ready' }`. New entries start `active`. `handle.settle()` flips status to `ready`; `handle.revert()` removes the entry outright.

### Render rule

Each render:

1. If `Object.is(lastBase, base) === false`, evict all `ready` entries, then update `lastBase = base`.
2. Compute `value = queue.reduce(reducer, base)` over remaining entries (both `active` and `ready`).

`ready` entries continue to contribute to the projection until the new base arrives in the same render where eviction runs. This eliminates the visual gap between settle and refetch.

### Wrapper lifecycle

```
mutate(payload):
  onMutate     → handle = addOptimistic(payload)   // queue: [...prev, {payload, active}]
  fetch RPC...
  onSuccess    → handle.settle()                   // queue entry: active → ready
                 user's onSuccess(data)
                 invalidate triggers refetch
                 (eventually) new base arrives → ready entry evicted in next render
  onError      → handle.revert()                   // queue entry removed
                 user's onError(err)
```

Settle/revert run **before** the user's callback so any state reads inside the callback see a consistent queue.

### Concurrent mutation trace

```
t=0  click delete A → addOptimistic(A). queue=[A:active]
t=1  click delete B → addOptimistic(B). queue=[A:active, B:active]
t=2  A's mutation succeeds → handleA.settle(). queue=[A:ready, B:active]
     render: base unchanged → no eviction → reduce(oldBase, [A, B]). Both still optimistic.
t=3  refetch resolves with newBase (A removed).
     render: base ref changed → evict A:ready → queue=[B:active] → reduce(newBase, [B]).
     UI shows server-confirmed A removal + B still optimistic. No flash.
t=4  B's mutation succeeds → handleB.settle(). queue=[B:ready]
t=5  refetch resolves with newerBase. Evict B:ready → queue=[] → UI = newerBase.
```

If B fails at t=4 instead: `handleB.revert()` removes the entry immediately, UI reverts.

### Required change to `useAction`

Today, `onSuccess(data)` does not receive the snapshot returned from `onMutate`. The optimistic primitive needs it to call `handle.settle()` from the success path. Two changes to `packages/iso/src/action.ts`:

1. Add `TSnapshot` generic to `UseActionOptions`, defaulted to `unknown` for back-compat:

   ```ts
   export type UseActionOptions<TPayload, TResult, TSnapshot = unknown> = {
     invalidate?: 'auto' | false | string[];
     onMutate?: (payload: TPayload) => TSnapshot;
     onError?: (err: Error, snapshot: TSnapshot) => void;
     onSuccess?: (data: TResult, snapshot: TSnapshot) => void;
     onChunk?: (chunk: string) => void;
   };
   ```

2. At `action.ts:120`, change `currentOptions?.onSuccess?.(result)` to `currentOptions?.onSuccess?.(result, snapshot)`. The `snapshot` variable is already captured at line 60–63.

`useAction`'s function signature gains `TSnapshot = unknown` so existing callers without `onMutate` are unchanged. Callers providing `onMutate` get `TSnapshot` inferred from its return type.

## Implementation

### `packages/iso/src/optimistic.ts` (new)

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

### `packages/iso/src/optimistic-action.ts` (new)

```ts
import {
  useAction,
  type UseActionOptions,
  type UseActionResult,
  type ActionStub,
} from './action.js';
import { useOptimistic, type OptimisticHandle } from './optimistic.js';

export type UseOptimisticActionOptions<TPayload, TResult, TBase> =
  Omit<UseActionOptions<TPayload, TResult>, 'invalidate' | 'onMutate' | 'onError' | 'onSuccess'> & {
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

### `packages/iso/src/action.ts` (edit)

- Add `TSnapshot = unknown` generic to `UseActionOptions` and `useAction`.
- Pass `snapshot` to `onSuccess` at the existing call site.

### `packages/iso/src/index.ts` (edit)

Export `useOptimistic`, `useOptimisticAction`, and the supporting types.

## Edge cases

| Case | Behavior |
|---|---|
| Component unmounts mid-mutation | Hook state is gone; `handle.settle/revert` no-op against an unreachable ref. No leak. |
| `addOptimistic` called outside an action context | Allowed — primitive is independent of `useAction`. Caller owns the handle. |
| Reducer throws | Render fails; surface the error rather than swallowing it. User code bug. |
| `base` is a primitive (number, string) | Works — `Object.is` handles primitives. |
| New `base` reference-equal but deeply different | Won't trigger eviction. Loader caches don't mutate in place; new fetches return new references, so this case shouldn't occur. Documented assumption. |
| Inline reducer (new function each render) | Fine — reducer is read fresh each render and only used to compute `value`. |
| Two `useOptimisticAction` instances over overlapping data | Each instance has its own queue/base; no coordination. Acceptable for v1. |
| `invalidate: 'auto'` with server returning identical data | Refetch produces a new array/object reference; `Object.is` returns false; eviction still runs. |
| `revert()` called twice | Idempotent. |
| `settle()` then `revert()` | Entry removed (revert filters by id regardless of status). |
| `revert()` then `settle()` | Settle finds no matching entry; no-op. |

## Testing

Unit tests live in `packages/iso/src/__tests__/`. Use `@testing-library/preact` (existing devDep).

### `optimistic.test.ts`

- `addOptimistic` adds an entry; `value` reflects reducer output
- `handle.settle()` keeps entry visible until base ref changes
- `handle.revert()` removes entry immediately
- Multiple concurrent entries reduce in insertion order
- Settle one of two; subsequent base change evicts only the settled one
- Base ref change with no `ready` entries leaves queue intact
- Idempotency: double settle, double revert, settle-then-revert, revert-then-settle
- `Object.is` equality for primitive base values

### `optimistic-action.test.ts`

- Mock `fetch` per existing pattern in `__tests__/action.test.ts`
- Successful mutation: `value` shows optimistic during in-flight, then real data after invalidate-triggered refetch — no flash
- Failed mutation: `value` reverts to base
- User's `onSuccess(data)` and `onError(err)` are called with correct args (no snapshot exposed)
- Spam-click: two concurrent mutations, first settles, second still optimistic, base reflects only first
- Type-level test: `onSuccess` user callback types as `(data) => void`, not `(data, snapshot) => void`

### `action.test.ts` updates

- New: `onSuccess` receives the `snapshot` returned from `onMutate`
- Existing tests pass unchanged via `TSnapshot = unknown` default

## `<Form>` refactor — composition with mutate

Today `<Form>` re-implements the same fetch/RPC logic as `useAction` (multipart branching, JSON branching, snapshot capture, invalidate handling). This duplicates ~50 lines and means streaming actions don't work with `<Form>` at all (open issue: `docs/design-concerns-2026-04-25.md` #1).

Refactor `<Form>` so it stops calling `useAction` internally. Instead, it accepts a pre-built `mutate` (from `useAction` or `useOptimisticAction`) and a `pending` flag:

### New `<Form>` signature

```tsx
type FormProps<TPayload extends Record<string, unknown>> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'onSubmit'
> & {
  mutate: (payload: TPayload) => Promise<void>;
  pending?: boolean;
  children?: ComponentChildren;
};
```

### New `<Form>` body (essentially complete)

```tsx
export function Form<TPayload extends Record<string, unknown>>({
  mutate,
  pending,
  children,
  ...rest
}: FormProps<TPayload>) {
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const formEl = e.target as HTMLFormElement;
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

### Usage

```tsx
const { mutate, pending } = useAction(serverActions.setNotes, {
  invalidate: 'auto',
  onSuccess: () => cacheRegistry.invalidate('watched'),
});

return (
  <Form mutate={mutate} pending={pending} class="flex flex-col gap-2">
    <input type="hidden" name="movieId" value={movieIdStr} />
    <textarea name="notes" defaultValue={watched?.notes ?? ''} />
    <button type="submit">Save</button>
  </Form>
);
```

Composes naturally with optimistic UI:

```tsx
const { mutate, pending, value: notes } = useOptimisticAction(serverActions.setNotes, {
  base: watched?.notes ?? '',
  apply: (_current, payload) => payload.notes,
  invalidate: 'auto',
});

return (
  <>
    <p>{notes}</p>
    <Form mutate={mutate} pending={pending}>
      <input name="notes" defaultValue={notes} />
      <button>Save</button>
    </Form>
  </>
);
```

### What this fixes incidentally

- **Code duplication**: `<Form>` no longer re-implements multipart/JSON branching or the fetch lifecycle. Single source of truth in `useAction`.
- **Design concern #1 (streaming)**: `<Form>` now works with streaming actions because `useAction.mutate` handles `text/event-stream` already.
- **Design concern #2 (inline fieldset style)**: replaced with a class (`hp-form-fieldset`) that consumers can override or restyle.
- **Reactive disabled state**: `<fieldset disabled={pending}>` is reactive; today's imperative `fieldsetRef.current.disabled = true` is replaced.

### Breaking change & migration

The old `<Form action={stub}>` shape is removed (no overload). Two call sites need updating:

| File | Change |
|---|---|
| `apps/app/src/pages/movie.tsx` | Two `<Form>` usages (`setNotes`, `setPhoto`) — wrap with a local `useAction` call, pass `mutate`/`pending` |
| `apps/app/src/pages/docs/actions.mdx` | Update example code to new shape |
| `apps/app/src/pages/docs/quick-start.mdx` | Update example code to new shape |
| `packages/iso/src/__tests__/form.test.tsx` | Tests now mock `mutate` directly; no fetch mocking needed |

`@hono-preact/iso`'s `index.ts` continues to export `Form`; the import path and component name don't change.

## Documentation

Add a new MDX page under `apps/app/src/docs/` per the local `add-docs-page` skill. Covers:

- The primitive `useOptimistic` and the `OptimisticHandle` API
- The wrapping `useOptimisticAction`
- The concurrent mutation pattern
- The `invalidate: false` / no-refetch limit and the recommended workaround (drop to the primitive)
- The new `<Form>` shape (composes with both `useAction` and `useOptimisticAction`)

Also update the existing `actions.mdx` and `quick-start.mdx` to reflect the new `<Form>` shape.

## Out of scope

- Reactive loader caches (would let optimistic updates flow through cache directly without parallel state) — separate, larger initiative
- Cross-instance coordination (multiple hooks projecting the same data)
- A `commit(newBase)` helper for the no-refetch path

## Affected packages

| Package | Change |
|---|---|
| `@hono-preact/iso` | New `optimistic.ts`, new `optimistic-action.ts`, generic + one-line edit in `action.ts`, refactored `form.tsx`, updated exports in `index.ts` |
| `apps/app` | New docs MDX page; migrate `movie.tsx` to new `<Form>` shape; update `actions.mdx` and `quick-start.mdx` examples |
