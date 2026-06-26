# Loader state ADT + v0.9 review-fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the PR #191 `max`-review fixes into a discriminated-union loader-consumption API: an internal `LoaderPhase` ADT in the runner, public `LoaderState<T>` / `StreamState<T>` unions for `.View` / `useData`, a `HydrationAnchor` descriptor for SSR serialization, and a faithful `useStoreSnapshot`.

**Architecture:** The runner (`use-loader-runner.tsx`) owns one ADT as its single source of truth; `ViewRenderer` projects loader-context state into a public discriminated union the consumer `switch`es on; `Envelope` becomes a dumb renderer of an explicit anchor descriptor. Cold errors (no data) keep routing through `errorFallback`/`ErrorBoundary`; the unions never carry an error without data.

**Tech Stack:** TypeScript, Preact + preact/hooks, preact-iso, Vitest + @testing-library/preact (happy-dom), MDX docs under `apps/site`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-25-loader-state-adt-design.md`. Every task below traces to it.
- **No em-dashes** in prose, comments, or commit messages (user-global rule). Use comma/semicolon/colon/parentheses.
- **No `enum` keyword**; use string-literal-union discriminants (bundle-size: this framework tracks client JS).
- **No `as T` casts** for variant coercion; reshape the type (repo `CLAUDE.md` Type-casts rule). Acceptable cast boundaries unchanged (untrusted JSON, FormData, user-module structural reads).
- **No code change** for finding #4 (`reactAliasesEnabled: false`) or #6 (`fallbackDelay` removal); both are documented intent.
- Work happens in the existing worktree `.claude/worktrees/loader-loading-state` on branch `worktree-loader-loading-state`. It is already built (deps + `packages/iso/dist` + `.env` present). Use worktree-prefixed absolute paths; Serena is unavailable here, use rg/Read/Edit.
- Test runner from `packages/iso`: `pnpm vitest run <file>` for unit, `pnpm vitest --typecheck run <file>` for `*.test-d.ts`.
- Do **not** push or open/update the PR. Commit locally only.

---

## Phase A: Independent fixes (each green on its own, no dependency on the union)

### Task 1: `useForceUpdate()` helper (#14)

**Files:**
- Create: `packages/iso/src/internal/use-force-update.ts`
- Test: `packages/iso/src/internal/__tests__/use-force-update.test.tsx`
- Modify (later steps): `packages/iso/src/optimistic.ts:29`

**Interfaces:**
- Produces: `useForceUpdate(): () => void`: returns a stable callback that schedules a re-render of the calling component.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { useForceUpdate } from '../use-force-update.js';

describe('useForceUpdate', () => {
  it('returns a stable callback that triggers a re-render', () => {
    let renders = 0;
    let force!: () => void;
    function Probe() {
      renders++;
      force = useForceUpdate();
      return null;
    }
    render(<Probe />);
    expect(renders).toBe(1);
    const first = force;
    act(() => force());
    expect(renders).toBe(2);
    expect(force).toBe(first); // stable identity across renders
    cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/use-force-update.test.tsx`
Expected: FAIL, cannot find module `../use-force-update.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/iso/src/internal/use-force-update.ts
import { useReducer } from 'preact/hooks';

/**
 * Returns a stable callback that schedules a re-render of the calling
 * component. Wraps the `useReducer` counter idiom so the framework has one
 * force-update primitive (used by `useStoreSnapshot` and `useOptimistic`).
 */
export function useForceUpdate(): () => void {
  const [, force] = useReducer((n: number, _action: void) => n + 1, 0);
  return force;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/use-force-update.test.tsx`
Expected: PASS.

- [ ] **Step 5: Adopt it in `optimistic.ts`**

In `packages/iso/src/optimistic.ts`, add the import and replace line 29.

Add to imports (top of file):
```ts
import { useForceUpdate } from './internal/use-force-update.js';
```
Replace:
```ts
  const [, forceRender] = useReducer<number, void>((c) => c + 1, 0);
```
with:
```ts
  const forceRender = useForceUpdate();
```
If `useReducer` is now unused in `optimistic.ts`, drop it from the `preact/hooks` import.

- [ ] **Step 6: Run optimistic suite + commit**

Run: `cd packages/iso && pnpm vitest run src/__tests__/optimistic-action.test.tsx src/internal/__tests__/use-force-update.test.tsx`
Expected: PASS.

```bash
git add packages/iso/src/internal/use-force-update.ts packages/iso/src/internal/__tests__/use-force-update.test.tsx packages/iso/src/optimistic.ts
git commit -m "feat(iso): shared useForceUpdate() primitive (review #14)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Faithful `useStoreSnapshot` (#7/#11 re-render storm, #12 tear window)

**Files:**
- Modify: `packages/iso/src/internal/use-store-snapshot.ts`
- Test: `packages/iso/src/internal/__tests__/use-store-snapshot.test.tsx` (extend existing)

**Interfaces:**
- Consumes: `useForceUpdate` (Task 1).
- Produces: `useStoreSnapshot<T>(subscribe, getSnapshot): T`: re-renders only when the snapshot changes by `Object.is`, and re-reads at subscribe time.

- [ ] **Step 1: Write the failing tests**

Append to `packages/iso/src/internal/__tests__/use-store-snapshot.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { useStoreSnapshot } from '../use-store-snapshot.js';

describe('useStoreSnapshot equality bailout + tear window', () => {
  it('does not re-render when the snapshot is unchanged (Object.is bailout)', () => {
    const listeners = new Set<() => void>();
    const subscribe = (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    };
    const broadcast = () => listeners.forEach((l) => l());

    let renders = 0;
    function Probe() {
      renders++;
      useStoreSnapshot(subscribe, () => 'constant');
      return null;
    }
    render(<Probe />);
    expect(renders).toBe(1);
    act(() => broadcast()); // snapshot unchanged -> no re-render
    expect(renders).toBe(1);
    cleanup();
  });

  it('re-reads the snapshot at subscribe time (commit->effect tear window)', () => {
    let snapshot = 'a';
    const listeners = new Set<() => void>();
    const subscribe = (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    };
    // Mutate the store DURING render, before the subscribe effect runs.
    let mutatedOnce = false;
    function Probe() {
      const v = useStoreSnapshot(subscribe, () => snapshot);
      if (!mutatedOnce) {
        mutatedOnce = true;
        snapshot = 'b'; // write lands in the render->effect window
      }
      return <span>{v}</span>;
    }
    const { container } = render(<Probe />);
    // The subscribe-time re-read must catch the 'b' write and re-render.
    expect(container.textContent).toBe('b');
    cleanup();
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/use-store-snapshot.test.tsx`
Expected: the bailout test FAILS (renders === 2) and/or the tear-window test FAILS (textContent === 'a'), against the current force-on-every-notification implementation.

- [ ] **Step 3: Rewrite the hook**

Replace the body of `packages/iso/src/internal/use-store-snapshot.ts`:

```ts
import { useEffect, useRef } from 'preact/hooks';
import { useForceUpdate } from './use-force-update.js';

/**
 * Compat-free `useSyncExternalStore(subscribe, getSnapshot)`. Hand-rolled so the
 * framework never imports preact/compat (which installs global options patches).
 * Faithful to useSyncExternalStore: re-renders only when the snapshot changes by
 * Object.is, and re-reads at subscribe time to close the commit->effect tear
 * window. `subscribe` must be a stable reference (both callers pass module-level
 * functions); `getSnapshot` may be an inline closure (kept in a ref, out of the
 * effect deps).
 */
export function useStoreSnapshot<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T
): T {
  const value = getSnapshot();
  const valueRef = useRef(value);
  const getSnapshotRef = useRef(getSnapshot);
  valueRef.current = value;
  getSnapshotRef.current = getSnapshot;
  const forceUpdate = useForceUpdate();

  useEffect(() => {
    const check = () => {
      const next = getSnapshotRef.current();
      if (!Object.is(next, valueRef.current)) {
        valueRef.current = next;
        forceUpdate();
      }
    };
    check(); // subscribe-time re-read closes the commit->effect tear window
    return subscribe(check);
  }, [subscribe]);

  return value;
}
```

- [ ] **Step 4: Run the store-snapshot + consumer suites**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/use-store-snapshot.test.tsx src/__tests__/action.test.tsx`
Expected: PASS (incl. `useFormStatus` / `useActionResult` consumers via `action.test.tsx`).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/use-store-snapshot.ts packages/iso/src/internal/__tests__/use-store-snapshot.test.tsx
git commit -m "fix(iso): useStoreSnapshot Object.is bailout + subscribe-time re-read (review #7,#12)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Hydration anchor descriptor (#3 live-SSR serialize crash)

**Files:**
- Modify: `packages/iso/src/internal/envelope.tsx`
- Modify: `packages/iso/src/internal/loader.tsx` (`DataReader`, `LoaderHost` client branch)
- Test: `packages/iso/src/internal/__tests__/loader-streaming.test.tsx` (add an SSR case) and `packages/iso/src/internal/__tests__/view-renderer.test.tsx` if it renders `Envelope`.

**Interfaces:**
- Produces: `type HydrationAnchor = { kind: 'none' } | { kind: 'data'; value: unknown }`. `Envelope` gains a required `anchor: HydrationAnchor` prop and no longer reads `LoaderDataContext.data` for serialization or branches on `isBrowser()`.

- [ ] **Step 1: Write the failing test (live SSR must not serialize a non-serializable seed)**

Add to `packages/iso/src/internal/__tests__/loader-streaming.test.tsx` (follow the file's existing SSR render helper; the assertion is the contract):

```tsx
it('live SSR anchors data-loader="null" and does not serialize accumulate.initial', async () => {
  // initial carries a BigInt: JSON.stringify would throw. A live loader must
  // emit data-loader="null" on SSR (no baked data; the client connects).
  const live = defineLoader<{ n: number }>(
    async function* () { yield { n: 1 }; },
    { live: true }
  );
  const View = live.View<{ total: bigint }>(
    (s) => (s.status === 'connecting' ? <p>connecting</p> : <p>open</p>),
    { initial: { total: 0n }, reduce: (acc) => acc }
  );
  // renderToStringAsync must not throw, and the shell anchors "null".
  const html = await renderViewToString(View); // file's existing SSR helper
  expect(html).toContain('data-loader="null"');
  expect(html).toContain('connecting');
});
```

> If `loader-streaming.test.tsx` has no reusable SSR helper, place this test in `packages/iso/src/__tests__/define-loader-live-ssr.test.tsx` (which already renders live loaders to string) and reuse its harness.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/loader-streaming.test.tsx`
Expected: FAIL, currently throws `TypeError: Do not know how to serialize a BigInt`, or emits `data-loader="[]"`/`"{}"` instead of `"null"`.

- [ ] **Step 3: Make `Envelope` a dumb renderer of an anchor**

Rewrite `packages/iso/src/internal/envelope.tsx`:

```tsx
import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { useContext } from 'preact/hooks';
import type { WrapperProps } from '../page.js';
import { LoaderIdContext } from './contexts.js';

/** What the `data-loader` hydration attribute carries. Discriminated + extensible. */
export type HydrationAnchor =
  | { kind: 'none' }
  | { kind: 'data'; value: unknown };

type EnvelopeProps = {
  as?: ComponentType<WrapperProps> | keyof JSX.IntrinsicElements;
  anchor: HydrationAnchor;
  children: ComponentChildren;
};

export const Envelope: FunctionComponent<EnvelopeProps> = ({
  as = 'section',
  anchor,
  children,
}) => {
  const id = useContext(LoaderIdContext);
  if (!id) throw new Error('<Envelope> must be inside a <Loader>');

  // Coerce undefined -> null so JSON.stringify(undefined) never reaches the wire.
  const dataLoader =
    anchor.kind === 'data' ? JSON.stringify(anchor.value ?? null) : 'null';

  if (typeof as === 'string') {
    const Tag = as;
    return (
      <Tag id={id} data-loader={dataLoader}>
        {children}
      </Tag>
    );
  }
  const Wrapper = as;
  return (
    <Wrapper id={id} data-loader={dataLoader}>
      {children}
    </Wrapper>
  );
};
```

- [ ] **Step 4: Construct the anchor at the call sites in `loader.tsx`**

In `packages/iso/src/internal/loader.tsx`:

`DataReader` (server): anchor is `none` for live, `data` for single-value. Replace the `accumulate.initial` coercion + `<Envelope>` usage (lines ~60-66):
```tsx
  const anchor: HydrationAnchor = accumulate
    ? { kind: 'none' }
    : { kind: 'data', value: raw };
  return (
    <LoaderDataContext.Provider value={{ data: raw, loading: false }}>
      <Envelope anchor={anchor}>{children}</Envelope>
    </LoaderDataContext.Provider>
  );
```
Note: `data: raw` (no `accumulate.initial` coercion); the live render fn's `connecting` arm needs no data (Task 6/7 unions). Drop the now-unused `accumulate` destructure if nothing else uses it; keep the `reader.read()` call.

`LoaderHost` client branch (line ~143-146): the client never bakes data, so anchor is always `none`:
```tsx
  const content = isBrowser() ? (
    <LoaderDataContext.Provider value={{ data: viewData, loading }}>
      <Envelope anchor={{ kind: 'none' }}>{children}</Envelope>
    </LoaderDataContext.Provider>
  ) : (
    <DataReader reader={reader} accumulate={accumulate}>
      {children}
    </DataReader>
  );
```
Add `import type { HydrationAnchor } from './envelope.js';` and ensure `Envelope` import stays.

- [ ] **Step 5: Run the streaming + loader suites**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/loader-streaming.test.tsx src/internal/__tests__/loader.test.tsx src/__tests__/define-loader-live-ssr.test.tsx`
Expected: PASS. (The existing live-ssr test that asserted `data-loader="[]"` must be updated to `"null"` here, since that assertion was the bug.)

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/envelope.tsx packages/iso/src/internal/loader.tsx packages/iso/src/internal/__tests__/loader-streaming.test.tsx packages/iso/src/__tests__/define-loader-live-ssr.test.tsx
git commit -m "fix(iso): HydrationAnchor descriptor; live SSR anchors null, no seed serialize (review #3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase B: The discriminated-union redesign (lands cohesively; green at the end of Task 8)

> Phase B changes a public type shape. The union type-flip (Task 6) cascades compile errors across docs/call sites/tests that Tasks 7-8 resolve. Between Task 6 and Task 8 the tree will not typecheck; that is expected. Do not commit a half-migrated tree except at the task boundaries below, each of which restores green for its scope.

### Task 4: Public union types + pure projections

**Files:**
- Create: `packages/iso/src/loader-state.ts`
- Test: `packages/iso/src/__tests__/loader-state.test.ts`
- Test (types): `packages/iso/src/__tests__/loader-state.test-d.ts`

**Interfaces:**
- Produces:
  - `type LoaderState<T> = { status: 'loading' } | { status: 'success'; data: T } | { status: 'revalidating'; data: T } | { status: 'error'; error: Error; data: T }`
  - `type StreamState<T> = { status: 'connecting' } | { status: 'open'; data: T } | { status: 'closed'; data: T } | { status: 'error'; error: Error; data: T }`
  - `toLoaderState<T>(data: T | undefined, loading: boolean, error: Error | null): LoaderState<T>`
  - `toStreamState<T>(data: T | undefined, status: StreamStatus, error: Error | null): StreamState<T>`

- [ ] **Step 1: Write the failing runtime test**

```ts
// packages/iso/src/__tests__/loader-state.test.ts
import { describe, it, expect } from 'vitest';
import { toLoaderState, toStreamState } from '../loader-state.js';

describe('toLoaderState', () => {
  const e = new Error('boom');
  it('cold load -> loading', () => {
    expect(toLoaderState(undefined, true, null)).toEqual({ status: 'loading' });
  });
  it('settled value -> success', () => {
    expect(toLoaderState({ a: 1 }, false, null)).toEqual({ status: 'success', data: { a: 1 } });
  });
  it('reload with prior data -> revalidating', () => {
    expect(toLoaderState({ a: 1 }, true, null)).toEqual({ status: 'revalidating', data: { a: 1 } });
  });
  it('error with prior data -> error (stale-while-error)', () => {
    expect(toLoaderState({ a: 1 }, false, e)).toEqual({ status: 'error', error: e, data: { a: 1 } });
  });
  it('data===undefined projects to loading at this seam', () => {
    // The pure projection cannot distinguish "cold, no value" from "resolved to
    // undefined"; both have data===undefined, so both map to `loading` here.
    // The resolved-to-undefined-is-success case is a RUNNER concern (the phase
    // ADT carries `{ tag: 'success', value: undefined }`), asserted in Task 5,
    // not at this projection seam.
    expect(toLoaderState(undefined, false, null)).toEqual({ status: 'loading' });
  });
});

describe('toStreamState', () => {
  const e = new Error('boom');
  it('no data -> connecting', () => {
    expect(toStreamState(undefined, 'connecting', null)).toEqual({ status: 'connecting' });
    expect(toStreamState(undefined, 'open', null)).toEqual({ status: 'connecting' });
  });
  it('open with data', () => {
    expect(toStreamState([1], 'open', null)).toEqual({ status: 'open', data: [1] });
  });
  it('closed with data', () => {
    expect(toStreamState([1], 'closed', null)).toEqual({ status: 'closed', data: [1] });
  });
  it('error with data', () => {
    expect(toStreamState([1], 'error', e)).toEqual({ status: 'error', error: e, data: [1] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/iso && pnpm vitest run src/__tests__/loader-state.test.ts`
Expected: FAIL, cannot find module `../loader-state.js`.

- [ ] **Step 3: Write the types + projections**

```ts
// packages/iso/src/loader-state.ts
import type { StreamStatus } from './internal/use-loader-runner.js';

/** Single-value loader consumption state. Pattern-match on `status`. */
export type LoaderState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'revalidating'; data: T }
  | { status: 'error'; error: Error; data: T };

/** Streaming/live loader consumption state. Pattern-match on `status`. */
export type StreamState<T> =
  | { status: 'connecting' }
  | { status: 'open'; data: T }
  | { status: 'closed'; data: T }
  | { status: 'error'; error: Error; data: T };

/**
 * Project loose loader-context fields into a single-value union. Cold errors
 * (error with no data) are handled by errorFallback/ErrorBoundary before the
 * render fn runs, so the `error` arm always carries data here.
 */
export function toLoaderState<T>(
  data: T | undefined,
  loading: boolean,
  error: Error | null
): LoaderState<T> {
  if (error !== null && data !== undefined) return { status: 'error', error, data };
  if (data === undefined) return { status: 'loading' };
  if (loading) return { status: 'revalidating', data };
  return { status: 'success', data };
}

/**
 * Project loose streaming-context fields into a streaming union. `connecting`
 * carries no data (the `initial` accumulator is an internal reduce seed).
 */
export function toStreamState<T>(
  data: T | undefined,
  status: StreamStatus,
  error: Error | null
): StreamState<T> {
  if (data === undefined) return { status: 'connecting' };
  if (error !== null) return { status: 'error', error, data };
  if (status === 'closed') return { status: 'closed', data };
  return { status: 'open', data };
}
```

- [ ] **Step 4: Write the type-level test**

```ts
// packages/iso/src/__tests__/loader-state.test-d.ts
import { expectTypeOf } from 'vitest';
import type { LoaderState, StreamState } from '../loader-state.js';

// `data` is narrowed to T in value arms; no `| undefined`.
declare const s: LoaderState<{ title: string }>;
if (s.status === 'success') expectTypeOf(s.data).toEqualTypeOf<{ title: string }>();
if (s.status === 'loading') expectTypeOf<keyof typeof s>().toEqualTypeOf<'status'>();

declare const ss: StreamState<number[]>;
if (ss.status === 'open') expectTypeOf(ss.data).toEqualTypeOf<number[]>();
if (ss.status === 'connecting') expectTypeOf<keyof typeof ss>().toEqualTypeOf<'status'>();
```

- [ ] **Step 5: Run both tests + export from the public barrel**

Run: `cd packages/iso && pnpm vitest run src/__tests__/loader-state.test.ts && pnpm vitest --typecheck run src/__tests__/loader-state.test-d.ts`
Expected: PASS.

Export `LoaderState`, `StreamState` from the package public surface: in `packages/iso/src/define-loader.ts` add to the existing re-export line region:
```ts
export type { LoaderState, StreamState } from './loader-state.js';
```
(Confirm the iso package index/barrel re-exports `define-loader`'s types; it already exports `StreamStatus` from here, so these ride the same path.)

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/loader-state.ts packages/iso/src/__tests__/loader-state.test.ts packages/iso/src/__tests__/loader-state.test-d.ts packages/iso/src/define-loader.ts
git commit -m "feat(iso): LoaderState/StreamState unions + projections (review #1,#2,#13)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Runner `LoaderPhase` ADT (#10 stuck-loading, #5 reload-only foundation)

**Files:**
- Modify: `packages/iso/src/internal/use-loader-runner.tsx`
- Test: `packages/iso/src/internal/__tests__/use-loader-runner.test.tsx` (extend)

**Interfaces:**
- Produces: `LoaderRunnerState<T>` gains `reloading: boolean` (true only during an explicit `reload()`/revalidation, never a cold load). `data`/`loading`/`error`/`status`/`reader` keep their meaning. Internally the single-value value-lifecycle is a `LoaderPhase<T>` replacing the `overrideData` sentinel.

- [ ] **Step 1: Write the failing tests**

Append to `use-loader-runner.test.tsx` (reuse the existing `Probe`/`stateLoc` harness in that file):

```tsx
it('a loader resolving to undefined clears loading (review #10)', async () => {
  let resolve!: (v: Data | undefined) => void;
  const fn = vi.fn(() => new Promise<Data>((r) => { resolve = r as (v: Data) => void; }));
  const ref = defineLoader<Data>(fn);
  render(<Probe loaderRef={ref} />);
  await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
  await act(async () => { resolve(undefined); });
  // Resolved to undefined: loading must clear (not stay stuck on the sentinel).
  await waitFor(() => expect(captured.loading).toBe(false));
  expect(captured.data).toBeUndefined();
  expect(captured.error).toBeNull();
});

it('reloading is false on a cold load and true only during reload (review #5)', async () => {
  let resolveInitial!: (v: Data) => void;
  let resolveReload!: (v: Data) => void;
  const fn = vi.fn()
    .mockImplementationOnce(() => new Promise<Data>((r) => { resolveInitial = r; }))
    .mockImplementationOnce(() => new Promise<Data>((r) => { resolveReload = r; }));
  const ref = defineLoader<Data>(fn);
  render(<Probe loaderRef={ref} />);
  // Cold load in flight: loading true, reloading false.
  expect(captured.loading).toBe(true);
  expect(captured.reloading).toBe(false);
  await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
  await act(async () => { resolveInitial({ msg: 'A' }); });
  await waitFor(() => expect(captured.data).toEqual({ msg: 'A' }));
  expect(captured.reloading).toBe(false);
  // Explicit reload: reloading true.
  await act(async () => { captured.reload(); });
  expect(captured.reloading).toBe(true);
  expect(captured.loading).toBe(true);
  await act(async () => { resolveReload({ msg: 'B' }); });
  await waitFor(() => expect(captured.data).toEqual({ msg: 'B' }));
  expect(captured.reloading).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/use-loader-runner.test.tsx`
Expected: the #10 test FAILS (loading stuck true after resolve(undefined)); the #5 test FAILS (`captured.reloading` is undefined; field does not exist yet).

- [ ] **Step 3: Reshape the runner's single-value state to a `LoaderPhase` ADT**

In `use-loader-runner.tsx`:

Add the ADT type near `LoaderRunnerState`:
```ts
type LoaderPhase<T> =
  | { tag: 'loading' }
  | { tag: 'revalidating'; value: T }
  | { tag: 'success'; value: T }
  | { tag: 'error'; error: Error; value?: T };
```
Add `reloading: boolean;` to the `LoaderRunnerState<T>` type.

Replace the `overrideData` state and the separate `reloading` derivation. Concretely:
- Replace `const [overrideData, setOverrideData] = useState<T | undefined>(undefined);` and `const [reloading, setReloading] = useState(false);` with a single phase state:
  ```ts
  const [phase, setPhase] = useState<LoaderPhase<T>>({ tag: 'loading' });
  ```
- Every place that called `setOverrideData(v)` to surface a resolved/streamed value now sets a `success`/`open` phase carrying a fresh object, e.g. the single-value cold settle (`.then((r) => { ...; setOverrideData(r); ... })`) becomes `setPhase({ tag: 'success', value: r })`. A fresh object on every settle means a resolve-to-`undefined` (`{ tag: 'success', value: undefined }`) is a real state change (fixes #10).
- `runReload()` sets `setPhase((p) => 'value' in p && p.value !== undefined ? { tag: 'revalidating', value: p.value as T } : { tag: 'loading' })` at its start (retain prior value for SWR), and on settle sets `{ tag: 'success', value: result }`; on error sets `{ tag: 'error', error, value: priorValue }` when prior data exists, else `{ tag: 'error', error }`.
- The streaming path keeps `status`/`accRef`; its surfaced value uses `setPhase({ tag: 'success', value: accRef.current as T })` on each `applyChunk` (a fresh object per chunk; streaming already re-renders). The `setLoadError` path sets `{ tag: 'error', ... }`.
- Replace the location/loader-change reset (`if (locationChanged || loaderChanged) setOverrideData(undefined);`) with `setPhase({ tag: 'loading' })`.

Derive the public fields from `phase` + `syncDataRef` (the synchronous preload/cache value still feeds the first render before any phase settle):
```ts
  const settledValue = 'value' in phase ? phase.value : undefined;
  const data = settledValue !== undefined ? settledValue : syncDataRef.current;
  const reloading = phase.tag === 'revalidating';
  const error = phase.tag === 'error' ? phase.error : null;
  const loading =
    phase.tag === 'loading' ||
    phase.tag === 'revalidating' ||
    (inFlightRef.current && data === undefined && error === null);
```
Return `{ data, loading, reloading, error, reload, status, reader: readerRef.current }`.

> Keep `syncDataRef`, `readerRef` (SSR Mechanism-B carrier), `inFlightRef`, `queuedReloadRef`, the abort plumbing, and the preload-clear effect unchanged. Only the `overrideData`/`reloading` state and the `data`/`loading`/`error` derivation change. Preserve every existing behavior the file documents (querystring-only refetch, queued-reload draining).
>
> **Cast discipline (Global Constraint):** do not add `as T` casts to read a phase variant's value. Structure the reads so narrowing carries the type, e.g. a local `phaseValue(p: LoaderPhase<T>): T | undefined` helper that returns `'value' in p ? p.value : undefined` (no cast; `value` is `T` / `T | undefined` by the variant), and build the `revalidating` phase from that helper's result. The ONE acceptable cast is reading the erased streaming accumulator `accRef.current` (typed `unknown` by design) as `T` when surfacing a chunk, a pre-existing erased-ref boundary, not variant coercion, and is unrelated to the `accumulate.initial as T` casts this work removes (#13).

- [ ] **Step 4: Run the full runner suite**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/use-loader-runner.test.tsx`
Expected: PASS (new #10 + #5 tests and all pre-existing state-machine tests).

- [ ] **Step 5: Update the stale "Suspense" comment (#9, runner half)**

In `use-loader-runner.tsx`, replace the comment "True while either the initial Suspense fetch or an explicit reload is in flight." with a state-based wording (no "Suspense"): "True while a fetch is in flight: a cold load (no value yet) or an explicit reload."

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/use-loader-runner.tsx packages/iso/src/internal/__tests__/use-loader-runner.test.tsx
git commit -m "fix(iso): LoaderPhase ADT in runner; resolve-undefined clears loading, reloading reload-only (review #10,#5,#9)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `ViewRenderer` projects the union + `.View` retypes (the type-flip)

**Files:**
- Modify: `packages/iso/src/internal/view-renderer.tsx`
- Modify: `packages/iso/src/internal/loader.tsx` (`ReloadContext` wiring, #5)
- Modify: `packages/iso/src/reload-context.tsx` (JSDoc, #5)
- Modify: `packages/iso/src/define-loader.ts` (`SingleValueView`, `AccumulatingView` render-arg types)
- Test: `packages/iso/src/internal/__tests__/view-renderer.test.tsx`

**Interfaces:**
- Consumes: `toLoaderState`/`toStreamState`, `LoaderState`/`StreamState` (Task 4); runner `reloading` (Task 5).
- Produces: the `.View` render fn receives `LoaderState<Serialize<T>> & P` (single) or `StreamState<Acc> & P` (streaming). `reload` is no longer a render arg; consumers use `useReload()`. `ReloadContext.reloading` is reload-only.

- [ ] **Step 1: Write the failing ViewRenderer test**

Rewrite/extend `view-renderer.test.tsx` to assert the union is passed (follow the file's existing context-wrapping harness):

```tsx
it('passes a discriminated LoaderState to the render fn (single-value)', () => {
  // Wrap in LoaderDataContext {data, loading} + ReloadContext, render via ViewRenderer.
  // data present, not loading -> { status: 'success', data }
  const seen: any[] = [];
  renderViewRenderer({ data: { title: 'Dune' }, loading: false, live: false },
    (s) => { seen.push(s); return null; });
  expect(seen[0]).toEqual({ status: 'success', data: { title: 'Dune' } });
});

it('passes a StreamState for live loaders', () => {
  const seen: any[] = [];
  renderViewRenderer({ data: undefined, status: 'connecting', live: true },
    (s) => { seen.push(s); return null; });
  expect(seen[0]).toEqual({ status: 'connecting' });
});
```

> `renderViewRenderer` is a thin helper in the test file that mounts `ViewRenderer` inside the loader contexts with the given values; build it from the file's existing context-provider scaffolding.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/view-renderer.test.tsx`
Expected: FAIL, render fn currently receives the flat `{ data, loading, status, error, reload }`, not a `{ status, data }` union.

- [ ] **Step 3: Project the union in `ViewRenderer`**

Rewrite `view-renderer.tsx` so it builds the union and passes `union & props`:

```tsx
import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import { LoaderDataContext } from './contexts.js';
import { LoaderStatusContext } from './loader.js';
import {
  toLoaderState,
  toStreamState,
  type LoaderState,
  type StreamState,
} from '../loader-state.js';

export type ViewState = (LoaderState<unknown> | StreamState<unknown>) & {
  [key: string]: unknown;
};

export function ViewRenderer<T>({
  loaderRef,
  props,
  render,
}: {
  loaderRef: LoaderRef<T, boolean>;
  props: Record<string, unknown>;
  render: (args: ViewState) => ComponentChildren;
}) {
  const dataCtx = useContext(LoaderDataContext);
  const data = dataCtx?.data;
  const loading = dataCtx?.loading ?? false;
  const error = loaderRef.useError();
  const status = useContext(LoaderStatusContext);
  const state = loaderRef.live
    ? toStreamState(data, status, error)
    : toLoaderState(data, loading, error);
  return render({ ...state, ...props });
}
```

- [ ] **Step 4: Wire `ReloadContext` to reload-only `reloading` (#5)**

In `loader.tsx`, destructure `reloading` from the runner and feed it to `ReloadContext`:
```tsx
  const { data, loading, reloading, error, reload, status, reader } =
    useLoaderRunner<T>(loaderRef, location, id, accumulate);
  // ...
  <ReloadContext.Provider value={{ reload, reloading }}>
```
In `reload-context.tsx`, change the JSDoc on `reloading` from "True while the loader is fetching (cold load or reload)." to "True while an explicit reload/revalidation is in flight (not a cold initial load)."

Also in `loader.tsx`, **remove the client-branch `viewData` coercion** (`const viewData = accumulate && data === undefined ? (accumulate.initial as T) : data;`) and pass the RAW `data` into the client `LoaderDataContext.Provider` (`value={{ data, loading }}`). With the union, a streaming `connecting` state carries no data, so `ViewRenderer`'s `toStreamState(data, ...)` maps `data === undefined` to `{ status: 'connecting' }` directly; the seed must not be surfaced. This deletes the remaining `accumulate.initial as T` cast (the Global Constraint forbids it; review of Task 3 flagged it as the natural casualty of this task).

- [ ] **Step 5: Retype the `.View` render args in `define-loader.ts`**

`SingleValueView<T>` render arg (lines ~74-79):
```ts
type SingleValueView<T> = <P extends Record<string, unknown> = {}>(
  render: (args: LoaderState<Serialize<T>> & P) => ComponentChildren
) => ComponentType<P>;
```
`AccumulatingView<T>` render arg (lines ~52-60):
```ts
type AccumulatingView<T> = <Acc, P extends Record<string, unknown> = {}>(
  render: (args: StreamState<Acc> & P) => ComponentChildren,
  opts: {
    initial: Acc;
    reduce: (acc: Acc, chunk: Serialize<T>) => Acc;
  }
) => ComponentType<P>;
```
Add `import type { LoaderState, StreamState } from './loader-state.js';`. Remove `loading`/`status`/`error`/`reload` from the render-arg object types (they are now in the union or via `useReload()`).

- [ ] **Step 6: Run iso typecheck for the runtime (call-site fixes follow in Task 7/8)**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/view-renderer.test.tsx`
Expected: the ViewRenderer test PASSES. This is the ONLY suite that must pass at this task boundary. The `.View` retype cascades: after this commit, the OTHER iso tests (they still destructure the old flat `{data, loading}` render args) FAIL at runtime, and repo `pnpm typecheck` reports errors in iso tests / docs / apps/site call sites. That RED interval is expected and intentional; Task 7 migrates the iso tests (restoring iso green) and Task 8 migrates apps/site + docs (restoring repo green). Do NOT fix those cascading failures in this task; they belong to Tasks 7 and 8.

- [ ] **Step 7: Commit the runtime half (tests for it are green; tree typecheck is not, by design)**

```bash
git add packages/iso/src/internal/view-renderer.tsx packages/iso/src/internal/loader.tsx packages/iso/src/reload-context.tsx packages/iso/src/define-loader.ts packages/iso/src/internal/__tests__/view-renderer.test.tsx
git commit -m "feat(iso): ViewRenderer projects LoaderState/StreamState union; reload-only reloading (review #5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `useData()` returns the union (#1/#2) + migrate iso tests

**Files:**
- Modify: `packages/iso/src/define-loader.ts` (`useData` impl + type, JSDoc #9)
- Modify: iso tests asserting the old shape: `src/internal/__tests__/loader.test.tsx`, `src/__tests__/loader-view.test.tsx`, `src/__tests__/define-loader.test-d.ts`, `src/__tests__/define-loader-live.test-d.ts`, `src/__tests__/define-page.test.tsx`, `src/__tests__/page.test.tsx`, `src/__tests__/use-invalidate.test.tsx`, `src/internal/__tests__/loader-streaming.test.tsx`, plus the em-dash fix in `src/internal/__tests__/loader.test.tsx` (#15).

**Interfaces:**
- Consumes: `LoaderState` (Task 4), `LoaderDataContext` (`{ data, loading }`).
- Produces: `useData: Live extends true ? never : () => LoaderState<Serialize<T>>`.

- [ ] **Step 1: Write the failing `useData` test**

Add to `src/internal/__tests__/loader.test.tsx` (or `loader-view.test.tsx`, wherever `useData` inside a Boundary is exercised):

```tsx
it('useData() returns a discriminated LoaderState (review #1,#2)', async () => {
  // Render a Boundary whose child calls useData(); assert it sees {status,data}.
  // (Use the file's existing loader+Boundary render helper.)
  // After data resolves: { status: 'success', data: <value> }.
  // Assertion contract:
  expect(seenUseData).toEqual({ status: 'success', data: { title: 'Dune' } });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/iso && pnpm vitest run src/internal/__tests__/loader.test.tsx`
Expected: FAIL, `useData()` returns the raw value, not `{ status, data }`.

- [ ] **Step 3: Change the `useData` impl + type**

In `define-loader.ts`, the `useData()` implementation (lines ~384-397): build the union from the same context the render fn uses.
```ts
    useData() {
      if (live) {
        throw new Error(
          'This is a `live` loader: consume it via `loader.View(render, { initial, reduce })`, not `loader.useData()`.'
        );
      }
      const ctx = useContext(LoaderDataContext);
      if (!ctx) {
        throw new Error(
          'loader.useData() must be called inside a `loader.View` render function or inside a `loader.Boundary`.'
        );
      }
      const err = ref.useError();
      return toLoaderState(ctx.data, ctx.loading, err);
    },
```
Type (line ~140):
```ts
  useData: Live extends true ? never : () => LoaderState<Serialize<T>>;
```
Add `import { toLoaderState } from './loader-state.js';`. Update the `useData` JSDoc and the stale `LoaderRef.Boundary` "Suspense boundary" comment (line ~144) to the state-based model (#9). Update the `LoaderRef<T>` invariance comment (line ~170) that says `useData(): Serialize<T>` to `useData(): LoaderState<Serialize<T>>`.

- [ ] **Step 4: Migrate the iso tests + type tests to the union**

For each iso test that destructured the old render args or asserted `useData()` raw value, apply the transformation:
- `({ data }) => ...` / `({ data, loading }) => ...` render fns become `(s) => { switch (s.status) { ... } }` or guard `if (s.status !== 'success' && s.status !== 'revalidating') return ...; use s.data`.
- `const x = loader.useData()` followed by `x.field` becomes `const s = loader.useData(); if (s.status !== 'success' && s.status !== 'revalidating') return ...; s.data.field`.
- In `define-loader.test-d.ts` / `define-loader-live.test-d.ts`, replace `expectTypeOf` assertions on the old flat arg with the union (`LoaderState<Serialize<T>>` / `StreamState<Acc>`).
- `#15` em-dash: in `src/internal/__tests__/loader.test.tsx`, replace the two `—` comments (e.g. `// Trigger reload — should NOT remount`) with `// Trigger reload; should NOT remount` (semicolon).

Run after each file: `cd packages/iso && pnpm vitest run <file>` until green.

- [ ] **Step 5: Run the full iso unit + type suites**

Run: `cd packages/iso && pnpm vitest run && pnpm vitest --typecheck run`
Expected: PASS across `packages/iso`.

- [ ] **Step 6: Commit**

```bash
git add packages/iso
git commit -m "feat(iso): useData() returns LoaderState union; migrate iso tests; comment cleanups (review #1,#2,#9,#15)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Migrate `apps/site` call sites + docs; demo SWR (#8)

**Files (call sites):** `apps/site/src/pages/demo/project-board.tsx`, `apps/site/src/pages/demo/task.tsx`, **and every live/streaming `.View` consumer**: `apps/site/src/components/demo/ActivityBar.tsx` (feeds `Feed`, which derefs `events[0]`/`events.map` UNGUARDED), `apps/site/src/pages/demo/live-tally.tsx`, `apps/example-node/src/pages/home.tsx` (`LiveCounter`). After Task 3 removed the SSR seed coercion, these receive `data === undefined` during the `connecting` SSR frame; the union migration MUST give each a `connecting` arm (or `events={data ?? []}` interim) so SSR cannot throw. `ActivityBar` is SSR'd on every `/demo/projects*` request and currently 500s in the interim; this is a hard requirement, not cosmetic.

**SSR regression guard:** add a test that SSR-renders `ActivityBar`/`Feed` (or the projects shell) through the REAL `.View` path (not the mock in `ActivityBar.test.tsx`) with no chunks, asserting the `connecting` arm renders without throwing. Nothing in the current suite or `pnpm --filter site build` (demo pages are runtime worker-SSR, not prerendered) catches this, so the gap must be closed here.
**Files (docs):** `apps/site/src/pages/docs/loaders.mdx`, `quick-start.mdx`, `loading-states.mdx`, `reloading.mdx`, `streaming.mdx`, `live-loaders.mdx`, `actions.mdx`, `pages.mdx`, `layouts.mdx`, `optimistic-ui.mdx`, `structure.mdx`, `realtime.mdx`.
**Files (release notes):** `docs/superpowers/specs/2026-06-25-v0.9-release-notes.md`.

**Transformation rule (apply everywhere):**
- Single-value `({ data, loading, error, reload }) => BODY` becomes `(s) => { switch (s.status) { case 'loading': return <Loading/>; case 'error': return <ErrorUI err={s.error} data={s.data}/>; case 'revalidating': case 'success': return <Real data={s.data}/>; } }`. Where the old body used `reload`, add `const { reload } = useReload();` inside the render fn.
- Streaming `({ data, status }) => BODY` becomes `(s) => s.status === 'connecting' ? <Connecting/> : <Real data={s.data} status={s.status}/>`.
- `const x = loader.useData(); x.field` becomes `const s = loader.useData(); if (s.status !== 'success' && s.status !== 'revalidating') return <Loading/>; s.data.field`.

- [ ] **Step 1: Demo `task.tsx`, SWR (review #8)**

`TaskView` (line ~286): replace `if (loading) return <p class="p-6">Loading task…</p>;` with a union switch that keeps prior content during `revalidating`:
```tsx
const TaskView = taskLoader.View((s) => {
  if (s.status === 'loading') return <p class="p-6">Loading task…</p>;
  const reloadTask = useReload().reload;
  // success | revalidating | error all carry `data`: keep the task visible.
  const task = s.data;
  if (!task) return <p class="p-6">Task not found.</p>;
  return (/* existing body, using `task` and `reloadTask` */);
});
```
`CommentsView` (line ~226) and `ActivityView` (line ~276): same switch; render `s.data` for `success`/`revalidating`/`error`, the connecting/loading affordance only for `loading`. Add `import { useReload } from 'hono-preact'` (or the existing import path) where `reload` is used.

- [ ] **Step 2: Demo `project-board.tsx`**

Line 11 `const data = boardLoader.useData();` becomes:
```tsx
const s = boardLoader.useData();
if (s.status === 'loading') return <BoardSkeleton />;
const data = s.data;
```
Line 29 `boardLoader.View(({ loading }) => ...)` becomes `boardLoader.View((s) => s.status === 'loading' ? <BoardSkeleton/> : <Board .../>)`.

- [ ] **Step 3: Run the demo/app test + typecheck for apps/site call sites**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/loader-loading-state && pnpm --filter site exec tsc --noEmit` (or repo-root `pnpm typecheck`).
Expected: no type errors in `demo/task.tsx` / `project-board.tsx`. Fix any until clean.

- [ ] **Step 4: Rewrite the docs MDX examples**

Apply the transformation rule to every `.View(` / `.useData()` snippet in the docs files listed above. Key prose updates:
- `loaders.mdx:178`, `quick-start.mdx:134`, `streaming.mdx:37`, `loading-states.mdx:3`: replace "receives `{ data, loading, error, reload }`" / "branch on `loading`" with "receives a `LoaderState` you `switch` on (`loading | success | revalidating | error`); `reload` is available via `useReload()`".
- `loading-states.mdx`: the "render args reference" table becomes the union variants table.
- `live-loaders.mdx:125`, `streaming.mdx`: streaming consumes `StreamState` (`connecting | open | closed | error`); `connecting` carries no data.
- `reloading.mdx:68`: `reloading` is true only during an explicit reload, not a cold load.
- `loaders.mdx:514`: `useData()` and the `.View` arg are a `LoaderState<Serialize<T>>` union (still `Serialize<T>` payload).

- [ ] **Step 5: Rewrite the v0.9 release notes breaking-change #1**

In `2026-06-25-v0.9-release-notes.md`, replace breaking-change #1 ("`.View()` render-arg shape: `data` is now `T | undefined`, `loading` added") with the union shape: `.View` render fn receives a `LoaderState<T>` / `StreamState<T>` discriminated union; `data` is narrowed to `T` in value arms; `useData()` returns the union; `reload` moves to `useReload()`. Update the Before/After migration snippets to the `switch` form.

- [ ] **Step 6: Site build + full repo typecheck**

Run from worktree root:
`pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck && pnpm --filter site build`
Expected: PASS (the union type-flip is now green tree-wide).

- [ ] **Step 7: Commit**

```bash
git add apps/site docs/superpowers/specs/2026-06-25-v0.9-release-notes.md
git commit -m "docs+demo: migrate .View/useData to LoaderState union; demo SWR (review #8)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase C: Verification

### Task 9: Full pre-push CI gate

- [ ] **Step 1: Run the 8-step gate from the worktree root**

Run, in order, from `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/loader-loading-state`:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all PASS. If `format:check` fails, run `pnpm format`, then `git add -A && git commit -m "style: prettier"`.

- [ ] **Step 2: Confirm the finding map is fully covered**

Re-read the spec's finding→resolution table. Confirm each non-"no change" row has a landed change: #1/#2 (Task 4/7), #3 (Task 3), #5 (Task 5/6), #7/#11/#12 (Task 2), #8 (Task 8), #9 (Task 5/7), #10 (Task 5), #13 (Task 4 union), #14 (Task 1), #15 (Task 7). #4/#6 are intentional no-ops.

- [ ] **Step 3: Final review handoff**

Do not push. Report the commit range and the CI-gate results, and offer to open/update the PR.

---

## Self-Review (author checklist, completed before handoff)

1. **Spec coverage:** every spec section maps to a task (ADT→T5, unions→T4, ViewRenderer projection→T6, cold-error rule→T4 projection, hydration anchor→T3, reloading→T5/T6, useStoreSnapshot→T2, useForceUpdate→T1, demo SWR→T8, cleanups→T5/T7, migration→T7/T8). #4/#6 are documented no-ops.
2. **Placeholders:** runtime tasks carry full code; migration tasks carry the exact transformation rule + worked examples + exact file lists (a compiler-guided mechanical migration, verified by typecheck + site build).
3. **Type consistency:** `LoaderState`/`StreamState`/`toLoaderState`/`toStreamState` names are identical across Tasks 4, 6, 7, 8; `useForceUpdate` identical across Tasks 1, 2; runner `reloading` field identical across Tasks 5, 6.
