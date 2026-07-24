# Loader Signal Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add additive, opt-in `useDataSignal()` / `useFieldSignal()` to the loader ref, so a component under a `<Loader>` can bind one field of the loaded data and update without re-rendering the `.View` subtree, with zero new bytes for apps that do not import `hono-preact/signals`.

**Architecture:** Reuse Phase 1's reactive registration (`internal/reactive.ts`, the `hono-preact/signals` entry, the `@preact/signals` dependency) and build on Phase 0's decomposed loader. The loader HOST (not the runner) owns a phase cell: it writes the memoized `LoaderState` (the same value it puts on `LoaderDataContext`) into the cell each render, and provides the cell's reactive source on a new context. `useDataSignal` reads that context. The host keeps re-rendering and keeps the data context, so `.View`/`.useData` are byte-identical; the win comes from a `useFieldSignal` child (passed as stable `children`) bailing on the host re-render and updating only via its own signal.

**Tech Stack:** Preact, `@preact/signals` (opt-in only), TypeScript, Vitest, happy-dom, preact-render-to-string, pnpm workspaces.

## Global Constraints

- No em-dashes (U+2014) in prose, comments, or commit messages.
- No inline `as` casts where the type can be reshaped; acceptable only at JSON/FormData/user-module/structural-context boundaries.
- `@preact/signals` reachable ONLY from `signals.ts`; never from the core `index.ts` graph.
- Additive: `.View()`, `.useData()`, `.Boundary`, `useError()`, `invalidate()` and the `LoaderDataContext` path are unchanged.
- Mirror law (loaders): the host KEEPS `setPhase` and keeps providing `LoaderDataContext`. The signal is an added channel.
- Value-presence is structural (`status`-based), never `data === undefined`.
- Single-value loaders only; streaming (`accumulate`) loaders throw a clear error on `useDataSignal`/`useFieldSignal`.
- Run from the worktree root: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/phase2-loader-signals`. Tests via `pnpm exec vitest run <path>` (not `pnpm --filter <pkg> test`).
- `@preact/signals` version already present (Phase 1): `^2.9.4`.

## File Structure

- `packages/iso/src/internal/reactive.ts` (modify): add `PhaseCell`, `LoaderReactiveImpl`, `registerLoaderReactiveImpl`, `getLoaderReactiveImpl` beside the presence registration.
- `packages/iso/src/signals.ts` (modify): register the signal-backed loader impl (`createPhaseCell` via `signal`, `derive` via `computed`); call `installLoaderSignals()` at module load.
- `packages/iso/src/internal/contexts.ts` (modify): add `LoaderViewSignalContext`.
- `packages/iso/src/internal/loader.tsx` (modify): host creates the cell, writes `viewState` each render, provides the signal context in BOTH the client branch and the server `DataReader` branch.
- `packages/iso/src/define-loader.ts` (modify): add `useDataSignal` / `useFieldSignal` methods and their types.
- Tests under `packages/iso/src/internal/__tests__/`.

---

### Task 1: Loader reactive registration in the seam

**Files:**
- Modify: `packages/iso/src/internal/reactive.ts`
- Test: `packages/iso/src/internal/__tests__/loader-reactive-registration.test.ts`

**Interfaces:**
- Produces:
  - `type PhaseCell<T> = { set(value: T): void; readonly source: ReadonlyReactive<T> }`
  - `type LoaderReactiveImpl = { createPhaseCell<T>(initial: T): PhaseCell<T>; derive<T, R>(source: ReadonlyReactive<T>, select: (v: T) => R): ReadonlyReactive<R> }`
  - `registerLoaderReactiveImpl(impl: LoaderReactiveImpl | null): void`
  - `getLoaderReactiveImpl(): LoaderReactiveImpl | null`
- Consumes: the existing `ReadonlyReactive<T>` in the same file.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/loader-reactive-registration.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  registerLoaderReactiveImpl,
  getLoaderReactiveImpl,
  type LoaderReactiveImpl,
} from '../reactive.js';

afterEach(() => registerLoaderReactiveImpl(null));

describe('loader reactive registration', () => {
  it('is null until an implementation registers', () => {
    expect(getLoaderReactiveImpl()).toBeNull();
  });

  it('returns the registered implementation and clears on null', () => {
    const impl = {
      createPhaseCell: () => {
        throw new Error('unused');
      },
      derive: () => {
        throw new Error('unused');
      },
    } as unknown as LoaderReactiveImpl;
    registerLoaderReactiveImpl(impl);
    expect(getLoaderReactiveImpl()).toBe(impl);
    registerLoaderReactiveImpl(null);
    expect(getLoaderReactiveImpl()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-reactive-registration.test.ts`
Expected: FAIL, `registerLoaderReactiveImpl` is not exported.

- [ ] **Step 3: Add to `reactive.ts`**

Append to `packages/iso/src/internal/reactive.ts` (after the presence registration, before end of file):

```ts
/**
 * A settable reactive cell mirroring one loader's projected `LoaderState`. The
 * loader host writes it each render (with the memoized state, so an unchanged
 * value is a no-op); `useDataSignal` reads `source`. Signal-backed in signal
 * mode; unused in default mode (the host falls back to a context snapshot).
 */
export type PhaseCell<T> = {
  set(value: T): void;
  readonly source: ReadonlyReactive<T>;
};

/** Factory for the loader signal machinery, registered by the signals entry. */
export type LoaderReactiveImpl = {
  createPhaseCell<T>(initial: T): PhaseCell<T>;
  /** A memoized projection off a reactive source (a `computed` in signal mode). */
  derive<T, R>(
    source: ReadonlyReactive<T>,
    select: (v: T) => R
  ): ReadonlyReactive<R>;
};

let loaderImpl: LoaderReactiveImpl | null = null;

/** Install (or clear, with `null`) the signal-backed loader implementation. */
export function registerLoaderReactiveImpl(
  impl: LoaderReactiveImpl | null
): void {
  loaderImpl = impl;
}

/** The registered loader implementation, or null when the signals entry is unused. */
export function getLoaderReactiveImpl(): LoaderReactiveImpl | null {
  return loaderImpl;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-reactive-registration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/reactive.ts packages/iso/src/internal/__tests__/loader-reactive-registration.test.ts
git commit -m "feat(iso): loader reactive registration in the seam

PhaseCell + LoaderReactiveImpl beside the presence registration; core
names them structurally without importing @preact/signals."
```

---

### Task 2: The signal-backed loader implementation

**Files:**
- Modify: `packages/iso/src/signals.ts`
- Test: `packages/iso/src/internal/__tests__/loader-signal-impl.test.ts`

**Interfaces:**
- Consumes: `registerLoaderReactiveImpl`, `PhaseCell`, `LoaderReactiveImpl`, `ReadonlyReactive` (`./internal/reactive.js`); `signal`, `computed` (`@preact/signals`).
- Produces: `installLoaderSignals(): void` (also invoked at module load).

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/loader-signal-impl.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import {
  getLoaderReactiveImpl,
  registerLoaderReactiveImpl,
} from '../reactive.js';
import { installLoaderSignals } from '../../signals.js';

afterEach(() => registerLoaderReactiveImpl(null));

describe('signal-backed loader impl', () => {
  it('registers on install', () => {
    installLoaderSignals();
    expect(getLoaderReactiveImpl()).not.toBeNull();
  });

  it('createPhaseCell holds and updates a value via its source', () => {
    installLoaderSignals();
    const impl = getLoaderReactiveImpl()!;
    const cell = impl.createPhaseCell<{ n: number }>({ n: 0 });
    expect(cell.source.value).toEqual({ n: 0 });
    cell.set({ n: 5 });
    expect(cell.source.value).toEqual({ n: 5 });
  });

  it('derive projects reactively off the source', () => {
    installLoaderSignals();
    const impl = getLoaderReactiveImpl()!;
    const cell = impl.createPhaseCell<{ n: number }>({ n: 2 });
    const doubled = impl.derive(cell.source, (v) => v.n * 2);
    expect(doubled.value).toBe(4);
    cell.set({ n: 3 });
    expect(doubled.value).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-signal-impl.test.ts`
Expected: FAIL, `installLoaderSignals` is not exported.

- [ ] **Step 3: Add to `signals.ts`**

In `packages/iso/src/signals.ts`, extend the import from `./internal/reactive.js` to also bring in the loader symbols:

```ts
import {
  registerPresenceReactiveImpl,
  registerLoaderReactiveImpl,
  type ReadonlyReactive,
  type RosterStore,
  type PhaseCell,
} from './internal/reactive.js';
```

Add before the final `installPresenceSignals()` call:

```ts
/**
 * The signal-backed loader implementation: `createPhaseCell` is a `Signal`, and
 * `derive` is a `computed`. Reading a derived signal in a component subscribes
 * that component, so a `useFieldSignal` node updates alone when its field
 * changes, without the loader host re-rendering it.
 */
export function installLoaderSignals(): void {
  registerLoaderReactiveImpl({
    createPhaseCell: <T,>(initial: T): PhaseCell<T> => {
      const s = signal(initial);
      return {
        set(value) {
          s.value = value;
        },
        source: s,
      };
    },
    derive: <T, R>(source: ReadonlyReactive<T>, select: (v: T) => R) =>
      computed(() => select(source.value)),
  });
}

installLoaderSignals();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-signal-impl.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Build iso and verify the size gate still passes**

Run: `pnpm --filter '@hono-preact/iso' build`
Expected: build succeeds.
Run: `pnpm exec vitest run scripts/__tests__/`
Expected: PASS (the `signals.js` bucket already exists from Phase 1; this only adds code to it).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: no errors.

```bash
git add packages/iso/src/signals.ts packages/iso/src/internal/__tests__/loader-signal-impl.test.ts
git commit -m "feat(iso): signal-backed loader impl (phase cell + derive)

Registered by the hono-preact/signals entry beside the presence impl.
createPhaseCell is a Signal, derive is a computed."
```

---

### Task 3: Host wiring and the view-signal context

**Files:**
- Modify: `packages/iso/src/internal/contexts.ts`
- Modify: `packages/iso/src/internal/loader.tsx`
- Test: `packages/iso/src/internal/__tests__/loader-view-signal-context.test.tsx`

**Interfaces:**
- Produces: `LoaderViewSignalContext` (from `contexts.ts`), a context of `{ readonly value: unknown } | null`.
- Consumes: `getLoaderReactiveImpl`, `PhaseCell`, `ReadonlyReactive` (`./reactive.js`); `LoaderState` (`../loader-state.js`).

**Context for the implementer:** `LoaderHost` in `loader.tsx` computes `viewState` (a memoized `LoaderState | null`; `null` on a cold error, when children are NOT rendered). The client branch (`isBrowser()`) provides `LoaderDataContext.Provider value={viewState}`. The server branch renders `DataReader`, which itself provides `LoaderDataContext.Provider value={state}` where `state` is the settled `{ status: 'success', data: raw }` for single-value loaders. Both must ALSO provide `LoaderViewSignalContext`.

- [ ] **Step 1: Add the context**

In `packages/iso/src/internal/contexts.ts`, after `LoaderDataContext`:

```ts
/**
 * The loader's projected `LoaderState` as a reactive value, provided alongside
 * `LoaderDataContext`. `useDataSignal()` reads it: in signal mode it is the
 * host's phase-cell source (granular); in default mode / on the server it is a
 * plain `{ value }` snapshot. Structurally typed so core names no signal. */
export const LoaderViewSignalContext = createContext<{
  readonly value: unknown;
} | null>(null);
```

- [ ] **Step 2: Write the failing test**

Create `packages/iso/src/internal/__tests__/loader-view-signal-context.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useContext } from 'preact/hooks';
import type { JSX } from 'preact';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { LoaderViewSignalContext } from '../contexts.js';
import { installLoaderSignals } from '../../signals.js';
import { registerLoaderReactiveImpl } from '../reactive.js';
import type { RouteHook } from 'preact-iso';

const loc = { path: '/', pathParams: {}, searchParams: {} } as unknown as RouteHook;

afterEach(() => {
  cleanup();
  registerLoaderReactiveImpl(null);
  vi.restoreAllMocks();
});

describe('LoaderViewSignalContext provision', () => {
  it('provides a reactive whose value tracks the loader state (signal mode)', async () => {
    installLoaderSignals();
    const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }));

    let seen: { readonly value: unknown } | null = null;
    function Probe(): JSX.Element {
      seen = useContext(LoaderViewSignalContext);
      return <span>probe</span>;
    }

    render(
      <Loader loader={loader} location={loc}>
        <Probe />
      </Loader>
    );

    // The context is provided (non-null) and exposes a `.value`.
    expect(seen).not.toBeNull();
    expect(seen).toHaveProperty('value');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-view-signal-context.test.tsx`
Expected: FAIL, `seen` is null (context not provided yet).

- [ ] **Step 4: Wire the host (client branch)**

In `packages/iso/src/internal/loader.tsx`:

Add imports near the other internal imports:

```ts
import { LoaderViewSignalContext } from './contexts.js';
import {
  getLoaderReactiveImpl,
  type PhaseCell,
  type ReadonlyReactive,
} from './reactive.js';
import type { LoaderState } from '../loader-state.js';
```

Inside `LoaderHost`, after `viewState` is computed (the `useMemo`), add the cell and its write. `useRef` and `useMemo` are already imported by the file; if `useRef` is not imported, add it to the `preact/hooks` import.

```ts
  // Signal mirror (opt-in). The host writes the memoized `viewState` into a
  // phase cell each render; an unchanged `viewState` is the SAME ref, so the
  // cell.set is a no-op (the signal skips notify). A `useFieldSignal` child
  // subscribes to a projection of this and updates alone. Created once per host
  // instance; null in default mode.
  const viewCellRef = useRef<PhaseCell<LoaderState<T> | null> | null>(null);
  if (viewCellRef.current === null) {
    const impl = getLoaderReactiveImpl();
    if (impl) viewCellRef.current = impl.createPhaseCell<LoaderState<T> | null>(null);
  }
  const viewCell = viewCellRef.current;
  if (viewCell) viewCell.set(viewState);
  // In default mode expose a plain snapshot so `useDataSignal` still returns a
  // correct (coarse) value; consumers update through the data-context re-render.
  const viewSignal: ReadonlyReactive<LoaderState<T> | null> = viewCell
    ? viewCell.source
    : { value: viewState };
```

Then wrap the client branch's provider. Change:

```tsx
  const content = isBrowser() ? (
    <LoaderDataContext.Provider value={viewState}>
      <Envelope anchor={{ kind: 'none' }}>{children}</Envelope>
    </LoaderDataContext.Provider>
  ) : (
```

to:

```tsx
  const content = isBrowser() ? (
    <LoaderDataContext.Provider value={viewState}>
      <LoaderViewSignalContext.Provider value={viewSignal}>
        <Envelope anchor={{ kind: 'none' }}>{children}</Envelope>
      </LoaderViewSignalContext.Provider>
    </LoaderDataContext.Provider>
  ) : (
```

- [ ] **Step 5: Wire the server branch (`DataReader`)**

In `DataReader`, the single-value success return provides `LoaderDataContext.Provider value={state}`. Wrap its children with the signal context carrying a plain snapshot. Change the final return:

```tsx
  return (
    <LoaderDataContext.Provider value={state}>
      <Envelope anchor={anchor}>{children}</Envelope>
    </LoaderDataContext.Provider>
```

to:

```tsx
  return (
    <LoaderDataContext.Provider value={state}>
      <LoaderViewSignalContext.Provider value={{ value: state }}>
        <Envelope anchor={anchor}>{children}</Envelope>
      </LoaderViewSignalContext.Provider>
    </LoaderDataContext.Provider>
```

(`state` here is `LoaderState<T> | StreamState<T>`; the signal context is typed `{ value: unknown }`, so this needs no cast. `useDataSignal` throws for streaming before reading it.)

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-view-signal-context.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck and confirm the existing loader suite is green**

Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: no errors.
Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/ packages/iso/src/__tests__/`
Expected: all pass (the `.View`/`useData`/loader-host tests unchanged: the data context path is untouched).

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/internal/contexts.ts packages/iso/src/internal/loader.tsx packages/iso/src/internal/__tests__/loader-view-signal-context.test.tsx
git commit -m "feat(iso): provide the loader view-signal context from the host

The host writes the memoized viewState into a phase cell each render and
provides its source on LoaderViewSignalContext, in both the client and the
server (DataReader) branches. LoaderDataContext and .View/useData are
untouched (mirror law)."
```

---

### Task 4: The `useDataSignal` / `useFieldSignal` ref API

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Test: `packages/iso/src/internal/__tests__/loader-data-signal-api.test.tsx`

**Interfaces:**
- Consumes: `LoaderViewSignalContext` (`./internal/contexts.js`), `getLoaderReactiveImpl`, `ReadonlyReactive` (`./internal/reactive.js`), `LoaderState` (`./loader-state.js`), `useContext`, `useRef` (`preact/hooks`).
- Produces on `LoaderRef` (single-value; `never` on streaming, like `useData`):
  - `useDataSignal(): ReadonlyReactive<LoaderState<Serialize<T>>>`
  - `useFieldSignal<R>(select: (data: Serialize<T>) => R, fallback: R): ReadonlyReactive<R>`

**Context for the implementer:** `useData()` (around `define-loader.ts:577`) reads `LoaderDataContext` and throws if absent (called outside a `<Loader>`) or if the loader is streaming. Mirror that structure. The view signal from context carries `LoaderState<T> | null`; a `null` (cold error) never reaches a mounted child, but treat it as the loading arm for safety.

- [ ] **Step 1: Add the types to the `LoaderRef` interface**

In `packages/iso/src/define-loader.ts`, in the `LoaderRef` type, after the `useData` member:

```ts
  /** The loader's state as a reactive value. Read `.value`. With the
   * `hono-preact/signals` entry imported this is a granular signal, so a
   * component that binds it updates without the loader host re-rendering it;
   * otherwise it is a coarse snapshot that updates through the data context.
   * `never` on a streaming loader (its status is separate state). */
  useDataSignal: Live extends true
    ? never
    : () => ReadonlyReactive<LoaderState<Serialize<T>>>;
  /** A reactive projection of one field of the loaded data. Read `.value` in
   * render. `fallback` is returned while loading. `never` on a streaming
   * loader. */
  useFieldSignal: Live extends true
    ? never
    : <R>(
        select: (data: Serialize<T>) => R,
        fallback: R
      ) => ReadonlyReactive<R>;
```

Add the import for `ReadonlyReactive` at the top of `define-loader.ts` (from `./internal/reactive.js`), and `LoaderViewSignalContext` / `getLoaderReactiveImpl` where the runtime methods are defined.

- [ ] **Step 2: Write the failing test**

Create `packages/iso/src/internal/__tests__/loader-data-signal-api.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import type { JSX } from 'preact';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { registerLoaderReactiveImpl } from '../reactive.js';
import type { RouteHook } from 'preact-iso';

const loc = { path: '/', pathParams: {}, searchParams: {} } as unknown as RouteHook;

afterEach(() => {
  cleanup();
  registerLoaderReactiveImpl(null);
  vi.restoreAllMocks();
});

describe('useDataSignal / useFieldSignal (default mode, no signals entry)', () => {
  it('reads the current loader state and a projected field', async () => {
    const loader = defineLoader<{ title: string }>(async () => ({
      title: 'hi',
    }));

    function View(): JSX.Element {
      const s = loader.useDataSignal();
      const title = loader.useFieldSignal((d) => d.title, '(loading)');
      const status = s.value.status;
      return (
        <p data-testid="v">
          {status}:{title.value}
        </p>
      );
    }

    render(
      <Loader loader={loader} location={loc}>
        <View />
      </Loader>
    );
    // On first client render the loader is loading (no cache/preload here).
    expect(screen.getByTestId('v').textContent).toContain('(loading)');
  });

  it('throws a clear error when called outside a <Loader>', () => {
    const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }));
    function Bare(): JSX.Element {
      loader.useDataSignal();
      return <span />;
    }
    expect(() => render(<Bare />)).toThrow(/useDataSignal/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-data-signal-api.test.tsx`
Expected: FAIL, `useDataSignal` is not a function.

- [ ] **Step 4: Implement the methods**

In `define-loader.ts`, in the object that carries `useData()` (the `makeLoaderRef` return), add after `useData()`:

```ts
    useDataSignal() {
      if (isStreaming) {
        throw new Error(
          'This is a streaming loader: useDataSignal() is single-value only; consume it via `loader.View(render, { initial, reduce })`.'
        );
      }
      const ctx = useContext(LoaderViewSignalContext);
      if (!ctx) {
        throw new Error(
          'loader.useDataSignal() must be called inside a `loader.View` render function or a `<Loader>`.'
        );
      }
      // The context reactive carries `LoaderState | null` (null only on a cold
      // error, which never renders children). Present it as a non-null state
      // reactive by mapping null to the loading arm.
      const source = ctx as ReadonlyReactive<LoaderState<Serialize<T>> | null>;
      const impl = getLoaderReactiveImpl();
      const ref = useRef<ReadonlyReactive<LoaderState<Serialize<T>>> | null>(
        null
      );
      if (ref.current === null) {
        ref.current = impl
          ? impl.derive(source, (s) => s ?? { status: 'loading' })
          : {
              get value() {
                return source.value ?? { status: 'loading' };
              },
            };
      }
      return ref.current;
    },
    useFieldSignal<R>(select: (data: Serialize<T>) => R, fallback: R) {
      const state = (
        this as {
          useDataSignal: () => ReadonlyReactive<LoaderState<Serialize<T>>>;
        }
      ).useDataSignal();
      const impl = getLoaderReactiveImpl();
      const ref = useRef<ReadonlyReactive<R> | null>(null);
      if (ref.current === null) {
        const project = (s: LoaderState<Serialize<T>>): R =>
          s.status === 'loading' ? fallback : select(s.data);
        ref.current = impl
          ? impl.derive(state, project)
          : {
              get value() {
                return project(state.value);
              },
            };
      }
      return ref.current;
    },
```

If `this`-typing is awkward, extract the `useDataSignal` body into a local helper the object method calls, and have `useFieldSignal` call the same helper; do NOT introduce an `as any`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-data-signal-api.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck and type-level tests**

Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: no errors.
Run: `pnpm test:types`
Expected: no errors (streaming loaders type `useDataSignal`/`useFieldSignal` as `never`).

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/internal/__tests__/loader-data-signal-api.test.tsx
git commit -m "feat(iso): useDataSignal / useFieldSignal on the loader ref

Additive, single-value only (never on streaming). Reads the view-signal
context: granular signal with the signals entry imported, a coarse
snapshot otherwise. Value-presence stays status-based."
```

---

### Task 5: End-to-end granularity, SSR, and verification

**Files:**
- Test: `packages/iso/src/internal/__tests__/loader-field-granularity.test.tsx`
- Test: `packages/iso/src/internal/__tests__/loader-signal-ssr.test.tsx`

**Interfaces:** consumes `installLoaderSignals`, `defineLoader`, `Loader`, `@testing-library/preact`, `preact-render-to-string`.

- [ ] **Step 1: Write the field-granularity test (the headline proof)**

Create `packages/iso/src/internal/__tests__/loader-field-granularity.test.tsx`. Drive a real `<Loader>` whose data settles, then changes via `reload`, and assert a `useFieldSignal` child updates alone.

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import type { JSX } from 'preact';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { useReload } from '../../reload-context.js';
import { installLoaderSignals } from '../../signals.js';
import { registerLoaderReactiveImpl } from '../reactive.js';
import type { RouteHook } from 'preact-iso';

const loc = { path: '/', pathParams: {}, searchParams: {} } as unknown as RouteHook;

afterEach(() => {
  cleanup();
  registerLoaderReactiveImpl(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loader field granularity through <Loader> (signal mode)', () => {
  it('a field change re-renders only the bound field node, not a sibling field', async () => {
    installLoaderSignals();
    // A loader whose value changes across reloads.
    let n = 1;
    const loader = defineLoader<{ a: number; b: number }>(async () => ({
      a: n,
      b: 100,
    }));

    const titleRenders = vi.fn();
    const otherRenders = vi.fn();
    let doReload: () => void = () => {};

    function TitleField(): JSX.Element {
      titleRenders();
      const a = loader.useFieldSignal((d) => d.a, 0);
      return <p data-testid="a">{a.value}</p>;
    }
    function OtherField(): JSX.Element {
      otherRenders();
      const b = loader.useFieldSignal((d) => d.b, 0);
      return <p data-testid="b">{b.value}</p>;
    }
    function ReloadButton(): JSX.Element {
      doReload = useReload();
      return <span />;
    }

    render(
      <Loader loader={loader} location={loc}>
        <TitleField />
        <OtherField />
        <ReloadButton />
      </Loader>
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('a').textContent).toBe('1');
    expect(screen.getByTestId('b').textContent).toBe('100');
    const otherBefore = otherRenders.mock.calls.length;

    // Change only field `a`, then reload.
    n = 2;
    await act(async () => {
      doReload();
      await Promise.resolve();
    });

    expect(screen.getByTestId('a').textContent).toBe('2');
    // `b` is unchanged; its bound component must NOT have re-rendered from the
    // field-`a` change (it subscribed only to `b`'s projection).
    expect(screen.getByTestId('b').textContent).toBe('100');
    expect(otherRenders.mock.calls.length).toBe(otherBefore);
  });
});
```

- [ ] **Step 2: Run it; then mutation-check**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-field-granularity.test.tsx`
Expected: PASS. If `b`'s render count increased, the projection is not granular; investigate before proceeding.

Mutation check: in `packages/iso/src/signals.ts`, temporarily change `derive` to `(source, select) => ({ get value() { return select(source.value); } })` (a non-reactive getter). Re-run the test.
Expected: FAIL (the `useFieldSignal` node no longer updates, or the sibling re-renders through the host path). Revert the change and confirm PASS again. Record the before/after in the report.

- [ ] **Step 3: Write the SSR-with-signals test**

Create `packages/iso/src/internal/__tests__/loader-signal-ssr.test.tsx`:

```tsx
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStringAsync } from 'preact-render-to-string';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { installLoaderSignals } from '../../signals.js';
import {
  registerLoaderReactiveImpl,
  getLoaderReactiveImpl,
} from '../reactive.js';
import { env } from '../../is-browser.js';
import type { RouteHook } from 'preact-iso';
import type { JSX } from 'preact';

const loc = { path: '/', pathParams: {}, searchParams: {} } as unknown as RouteHook;
const original = env.current;

afterEach(() => {
  env.current = original;
  registerLoaderReactiveImpl(null);
});

describe('loader signal under preact-render-to-string', () => {
  it('renders a useFieldSignal node to the SSR value without throwing', async () => {
    installLoaderSignals();
    expect(getLoaderReactiveImpl()).not.toBeNull();
    env.current = 'server';
    const loader = defineLoader<{ title: string }>(async () => ({
      title: 'server-title',
    }));

    function View(): JSX.Element {
      const t = loader.useFieldSignal((d) => d.title, '(loading)');
      return <h1>{t.value}</h1>;
    }

    const html = await renderToStringAsync(
      <Loader loader={loader} location={loc}>
        <View />
      </Loader>
    );
    expect(html).toContain('server-title');
  });
});
```

- [ ] **Step 4: Run the SSR test**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-signal-ssr.test.tsx`
Expected: PASS (the SSR `DataReader` provides the signal context with the settled state; `useFieldSignal` reads `server-title`; the signals options hooks do not throw under RTS).

- [ ] **Step 5: Full pre-push verification**

Run each and confirm pass:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check   # if it fails: pnpm format, then re-check
pnpm typecheck
pnpm test:types
pnpm test
pnpm test:integration
pnpm --filter site build
```
Expected: all green. The existing loader suite is unchanged (mirror law: the data-context path is untouched).

- [ ] **Step 6: Record the size cost**

Run:
```bash
node scripts/measure-framework-size.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).sectionA;console.log('core:',a.core.total,'| loaders:',a.loaders.total,'| signals glue:',a.signals?.marginal);})"
```
Confirm `core` is unchanged. Note the numbers in the PR description (do NOT edit the umbrella charter here; it is on the `feat/signals-migration` branch).

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/__tests__/loader-field-granularity.test.tsx packages/iso/src/internal/__tests__/loader-signal-ssr.test.tsx
git commit -m "test(iso): loader field granularity (mutation-checked) + SSR

A field change re-renders only the bound field node, not a sibling field,
through a real <Loader> in signal mode; mutation-checked against a
non-reactive derive. SSR renders a useFieldSignal node to its value with
the signals options hooks active."
```

---

## Self-Review

**Spec coverage:**
- Reactive seam / loader registration (spec §4) -> Task 1.
- Two implementations (spec §5): default (Tasks 3/4 fallbacks), signal (Task 2).
- Host keeps re-render + provides signal context (spec §3, §6b) -> Task 3.
- Ref API `useDataSignal`/`useFieldSignal` (spec §6c) -> Task 4.
- SSR (spec §7) -> Task 3 server branch + Task 5 SSR test.
- Field granularity, mutation-checked (spec §8) -> Task 5.
- Default coarseness (spec §8) -> Task 4 test.
- `.View`/`.useData` parity (spec §8) -> Task 3 Step 7.
- Streaming rejects (spec §8, §9) -> Task 4 (`never` type + runtime throw).
- Referential stability (spec §11) -> Task 4 (`useRef` memoization of the derived reactive).
- Render-time write purity (spec §6a, §11): the host writes the cell during render with the MEMOIZED `viewState` (no-op when unchanged, no cycle since the host never reads `.value`); covered by Task 3's parity run and Task 5's SSR test.

**Placeholder scan:** No TBD/TODO; every code step is complete. The one judgement note (Task 4 Step 4, extract a helper if `this`-typing is awkward) gives a concrete non-cast alternative rather than a placeholder.

**Type consistency:** `PhaseCell<T>` / `LoaderReactiveImpl` / `ReadonlyReactive<T>` identical across Tasks 1, 2, 3, 4. `useDataSignal(): ReadonlyReactive<LoaderState<Serialize<T>>>` and `useFieldSignal<R>(select, fallback): ReadonlyReactive<R>` consistent between the type (Task 4 Step 1) and the impl (Task 4 Step 4). `LoaderViewSignalContext` value shape `{ readonly value: unknown } | null` consistent between Task 3 (provide) and Task 4 (consume).
