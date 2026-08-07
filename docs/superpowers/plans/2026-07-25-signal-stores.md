# Signal-Backed Stores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the action-result, form-submit, optimistic, and field-error stores to signals; the read hooks return signals like `useData`; per-field errors go granular; delete the `use-store-snapshot` / `use-force-update` bridges.

**Architecture:** A new `internal/store-signal.ts` factory (the sanctioned `@preact/signals` importer for stores, mirroring `loader-signal.ts`) backs the stores. The read hooks (`useActionResult`, `useFormStatus`, `useOptimistic`) return `ReadonlySignal`s via `useComputed`. `<Form>` exposes a per-field error signal accessor (the `member(id)` pattern). Spec: `docs/superpowers/specs/2026-07-25-signal-stores-design.md`.

**Tech Stack:** Preact, `@preact/signals` (re-exported first-party), preact-iso, vitest, `@testing-library/preact`.

## Global Constraints

- No em-dashes in prose, comments, or commit messages.
- No new inline `as` casts (reshape types).
- `@preact/signals` may be value-imported ONLY by the sanctioned factory modules: `internal/roster-signal.ts`, `internal/loader-signal.ts`, and the NEW `internal/store-signal.ts` (plus the barrel `index.ts` re-export). Every store signal is created through `store-signal.ts`; `action-result-store.ts` / `form-submit-store.ts` / `optimistic.ts` / the field-error store must NOT value-import `@preact/signals`. The module-graph guard (`signals-always-on.test.ts`) enforces this; extend its importer set to include `internal/store-signal.ts`.
- All of this is unreleased (umbrella only); the return-type changes to `useActionResult` / `useFormStatus` / `useOptimistic` ship with the umbrella release.
- Mutation-check every regression test.
- Run a single test with `pnpm exec vitest run <path>` from the worktree root (NOT `pnpm --filter`, a silent no-op). Type tests: `pnpm exec vitest --typecheck run <path>`.

---

### Task 1: `internal/store-signal.ts` factory + guard

**Files:**
- Create: `packages/iso/src/internal/store-signal.ts`
- Test: `packages/iso/src/internal/__tests__/store-signal.test.ts`
- Modify: `packages/iso/src/internal/__tests__/signals-always-on.test.ts` (add `internal/store-signal.ts` to the allowed value-importers)

**Interfaces:**
- Produces: `createStoreSignal<T>(initial: T): { readonly signal: ReadonlySignal<T>; set(value: T): void }` (a settable module-store cell); and `readStore<T, R>(source: ReadonlySignal<T>, project: (v: T) => R): ReadonlySignal<R>` (a memoized `useComputed`-equivalent projection helper, or just re-use `derive` from `loader-signal.ts` if identical). Prefer reusing `loader-signal.ts`'s `derive` if its shape matches to avoid duplication.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/store-signal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createStoreSignal } from '../store-signal.js';

describe('createStoreSignal', () => {
  it('exposes a readonly signal that reflects set()', () => {
    const store = createStoreSignal<number | null>(null);
    expect(store.signal.value).toBe(null);
    store.set(5);
    expect(store.signal.value).toBe(5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/store-signal.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the factory**

Create `packages/iso/src/internal/store-signal.ts`:

```ts
import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';

/**
 * A settable module-store cell backed by a signal. The store module writes via
 * `set`; consumers read the `readonly` signal (directly, or through a memoized
 * `useComputed` projection). This is the sanctioned `@preact/signals` importer
 * for the action / form / optimistic stores, so those store modules stay free
 * of a direct `@preact/signals` value import (the module-graph guard).
 */
export type StoreSignal<T> = {
  readonly signal: ReadonlySignal<T>;
  set(value: T): void;
};

export function createStoreSignal<T>(initial: T): StoreSignal<T> {
  const s = signal<T>(initial);
  return {
    signal: s,
    set(value: T) {
      s.value = value;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/store-signal.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend the module-graph guard**

In `packages/iso/src/internal/__tests__/signals-always-on.test.ts`, add `'internal/store-signal.ts'` to the expected value-importer set in the `@preact/signals enters the graph ONLY through the ... factory modules` test (the sorted array now has `internal/loader-signal.ts`, `internal/roster-signal.ts`, `internal/store-signal.ts`, and `index.ts`). Update the test's comment to name the store factory.

- [ ] **Step 6: Run the guard + commit**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/signals-always-on.test.ts`
Expected: PASS.

```bash
git add packages/iso/src/internal/store-signal.ts packages/iso/src/internal/__tests__/store-signal.test.ts packages/iso/src/internal/__tests__/signals-always-on.test.ts
git commit -m "feat(iso): store-signal factory (sanctioned @preact/signals importer for stores)"
```

---

### Task 2: action-result + form-submit stores to signals; hooks return signals

**Files:**
- Modify: `packages/iso/src/internal/action-result-store.ts`, `packages/iso/src/internal/form-submit-store.ts`, `packages/iso/src/use-action-result.ts`, `packages/iso/src/use-form-status.ts`
- Modify: call sites reading `useActionResult()` / `useFormStatus()` (they now read `.value`); the `*.test-d.ts` and unit tests for these
- Modify: `packages/hono-preact/__tests__/exports.test.ts` only if it pins these return types

**Interfaces:**
- Produces: `useActionResult(stub?): ReadonlySignal<ActionResult<TPayload, TResult>>`; `useFormStatus(stub?): ReadonlySignal<FormStatus>`.

- [ ] **Step 1: Convert the stores to `createStoreSignal`**

In `action-result-store.ts`: replace the `listeners: Set` + `subscribeLastActionResult` with a module `const store = createStoreSignal<...>(...)`. `setLastActionResult` / `clearLastActionResult` call `store.set(...)`; export the store's `signal` (e.g. `lastActionResultSignal`) for the hook. Delete `subscribeLastActionResult` and the `Set`. `getLastActionResult(stub)` may stay as a pure filter helper over `store.signal.peek()` for non-reactive callers, or be inlined into the hook. Same for `form-submit-store.ts` (the pending signal; delete `subscribe`).

- [ ] **Step 2: Retarget the hook tests (TDD), then convert the hooks**

Retarget `use-action-result` / `use-form-status` tests to expect a `ReadonlySignal` return (read `.value`); run them to confirm they FAIL against the current value-returning hooks. Then rewrite:
- `useActionResult(stub?)`: memoize (a `useRef`) a `useComputed` that reads `lastActionResultSignal.value`, filters by `stub`, and falls back to the SSR `ActionResultContext` (unchanged), returning `ReadonlySignal<ActionResult>`. Delete the `useStoreSnapshot` import.
- `useFormStatus(stub?)`: memoize a `useComputed` returning `{ pending }` off the pending signal. Delete the `useStoreSnapshot` import.
Import `useComputed` from `@preact/signals`.

- [ ] **Step 3: Run the hook tests + update call sites**

Run the retargeted hook tests (PASS). Then grep every `useActionResult(` / `useFormStatus(` call site (`rg -n "useActionResult\(|useFormStatus\("` across `packages` and `apps`), and add `.value` where the result is consumed (the value is now a signal). Typecheck: `pnpm typecheck` must be clean.

- [ ] **Step 4: Type tests + mutation-check + commit**

Add / update `*.test-d.ts` pinning `useActionResult(): ReadonlySignal<...>` and `useFormStatus(): ReadonlySignal<FormStatus>`. Mutation-check the action-result granularity test (a binding updates without the host re-rendering; break the memoized computed to a fresh value and confirm the granularity assertion fails). Then:
Run: `rg -n "useStoreSnapshot" packages/iso/src/use-action-result.ts packages/iso/src/use-form-status.ts` (expect zero).

```bash
git add -A packages/iso/src/internal/action-result-store.ts packages/iso/src/internal/form-submit-store.ts packages/iso/src/use-action-result.ts packages/iso/src/use-form-status.ts packages/iso/src/**/__tests__ apps
git commit -m "feat(iso): action-result/form-submit stores as signals; useActionResult/useFormStatus return signals"
```

---

### Task 3: `useOptimistic` returns a signal

**Files:**
- Modify: `packages/iso/src/optimistic.ts`, its tests, `*.test-d.ts`, and `useOptimistic` call sites

**Interfaces:**
- Produces: `useOptimistic<TBase, TPayload>(base, reducer, options?): [ReadonlySignal<TBase>, (payload: TPayload) => OptimisticHandle]`.

- [ ] **Step 1: Retarget the optimistic test (TDD)**

Retarget the `useOptimistic` test so it reads the value via `.value` (the first tuple element is now a `ReadonlySignal<TBase>`); run to confirm it FAILS against the current tuple-of-value.

- [ ] **Step 2: Convert to a signal-backed queue**

In `optimistic.ts`: replace the `useForceUpdate()` re-render with a per-call queue signal (via `createStoreSignal` on the entry array, or a `useSignal` from `@preact/signals` holding the queue). The derived value becomes a memoized `useComputed(() => queue.value.reduce((acc, e) => reducer(acc, e.payload), base))`. Return `[valueSignal, dispatch]`. The base-change reconciliation (drop `ready` entries when `base` changes by `Object.is`), the `dispatch` / `OptimisticHandle`, and `transition` behaviour are unchanged. Delete the `useForceUpdate` import.

- [ ] **Step 3: Run tests + update call sites + types**

Run the optimistic tests (PASS). Update `useOptimistic` call sites to read `.value`. Update `*.test-d.ts` to pin `[ReadonlySignal<TBase>, ...]`. Mutation-check: the value signal updates when `dispatch` enqueues and when `base` changes (break the queue-signal write and the test fails). `pnpm typecheck` clean.

- [ ] **Step 4: Commit**

```bash
git add -A packages/iso/src/optimistic.ts packages/iso/src/**/__tests__ apps
git commit -m "feat(iso): useOptimistic returns a signal value (signal-backed queue)"
```

---

### Task 4: per-field form errors go granular

**Files:**
- Modify: `packages/iso/src/internal/field-errors-context.ts`, `packages/iso/src/form.tsx`, `packages/iso/src/use-field-errors.tsx`, `packages/iso/src/field-error.tsx` (if separate)
- Test: `packages/iso/src/**/__tests__/field-errors-granularity.test.tsx` (create)

**Interfaces:**
- Produces: a context value `{ fieldError(name: string): ReadonlySignal<string[]>; all: ReadonlySignal<FieldErrorsMap> }` (per-field granular read + a coarse `all`). `useFieldErrors(name)` reads `fieldError(name).value`; `useFieldErrors()` (no name) reads `all.value`. `FieldErrorsMap` (the type) is unchanged.

- [ ] **Step 1: Write the granularity test (TDD)**

Create `field-errors-granularity.test.tsx`: render a `<Form>` with two `<FieldError name="a">` / `name="b">` (each a render-counter component); set field `a`'s errors; assert ONLY the `a` consumer re-renders (`b`'s counter unchanged). Run to confirm it FAILS against the current whole-map context (both re-render). Mutation-check target: the per-field split.

- [ ] **Step 2: Convert the field-error store to per-field signals**

In `field-errors-context.ts`: replace `createContext<FieldErrorsMap>({})` with a context of the accessor `{ fieldError(name), all }`. Add a `createFieldErrorStore()` factory (in `internal/store-signal.ts`, so `@preact/signals` stays sanctioned) holding per-field signals in a Map plus an `all` computed, mirroring `roster-signal.ts`'s `member(id)` / `members`. `<Form>` (`form.tsx`) drives the store from its merged client+server errors (`setFieldErrors(map)` updates only the changed fields, like the roster upsert) and provides the accessor on context. Server errors seed the store so first render matches SSR.

- [ ] **Step 3: Consume granularly**

`use-field-errors.tsx`: `useFieldErrors(name)` reads `ctx.fieldError(name).value`; `useFieldErrors()` reads `ctx.all.value`; `useFieldErrorProps` / `<FieldError>` read `fieldError(name)`. Each subscribes only to its field.

- [ ] **Step 4: Run the granularity test + SSR + mutation-check**

Run the granularity test (PASS: only the changed field re-renders). Confirm an SSR test (server-seeded errors render on first paint) stays green. Mutation-check: collapse the per-field signals back to one `all` read in `<FieldError>` and confirm the granularity test fails.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck` (clean).

```bash
git add -A packages/iso/src/internal/field-errors-context.ts packages/iso/src/internal/store-signal.ts packages/iso/src/form.tsx packages/iso/src/use-field-errors.tsx packages/iso/src/**/__tests__
git commit -m "feat(iso): per-field form-error signals (a FieldError re-renders only on its own field)"
```

---

### Task 5: delete the bridges, move page-middleware-host, docs, verification

**Files:**
- Delete: `packages/iso/src/internal/use-store-snapshot.ts`, `packages/iso/src/internal/__tests__/use-store-snapshot.test.tsx`, `packages/iso/src/internal/use-force-update.ts`, `packages/iso/src/internal/__tests__/use-force-update.test.tsx`
- Modify: `packages/iso/src/internal/page-middleware-host.tsx`
- Modify: `apps/site/src/pages/docs/*.mdx` (forms / actions / optimistic docs now read `.value`)

- [ ] **Step 1: Move `page-middleware-host` off `useForceUpdate`**

Replace `const force = useForceUpdate()` with a `useSignal(0)` tick (imported from `@preact/signals`): read `tick.value` in render, and the chain-promise settlement callback does `tick.value++` instead of `force()`. Behaviour (self-heal re-render on chain resolve) is unchanged. Run `page-middleware-host`'s tests (green).

- [ ] **Step 2: Delete the bridges**

```bash
git rm packages/iso/src/internal/use-store-snapshot.ts packages/iso/src/internal/__tests__/use-store-snapshot.test.tsx packages/iso/src/internal/use-force-update.ts packages/iso/src/internal/__tests__/use-force-update.test.tsx
```
Run: `rg -n "use-store-snapshot|useStoreSnapshot|use-force-update|useForceUpdate" packages --glob '!**/dist/**'`
Expected: zero hits.

- [ ] **Step 3: Docs sync**

Update the forms / actions / optimistic docs (`apps/site/src/pages/docs/`, grep `useActionResult|useFormStatus|useOptimistic`) so examples read the signal (`.value`) and describe the per-field error granularity. NO historical breadcrumbs (present tense, as if always so). No em-dashes.

- [ ] **Step 4: Full eight-step verification**

Run in order, each must pass (fix + re-run if not):
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check   # if it fails: pnpm format, then re-check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Then size: `node scripts/measure-framework-size.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).sectionA;console.log('core:',a.core.total,'| forms:',a.forms?.total,'| actions:',a.actions?.total);})"` and note the numbers.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(iso): delete use-store-snapshot/use-force-update bridges; docs sync; page-middleware-host on a signal"
```

---

## Self-Review

**Spec coverage:**
- store-signal factory + guard (spec 2, 3) -> Task 1.
- action-result/form-submit -> signals, hooks return signals (spec 3, return-signals) -> Task 2.
- useOptimistic -> signal (spec 3) -> Task 3.
- per-field errors granular (spec 4) -> Task 4.
- delete bridges + page-middleware-host + docs + SSR (spec 5, 6) -> Task 5 (+ SSR parity checked in Tasks 2/4).
- Testing incl. mutation-checks + guard (spec 8) -> per-task + Task 1/5.
- Scope excludes dispatch/validation/routing (spec 9) -> respected.

**Placeholder scan:** Task 1's factory is complete code; Tasks 2-4 give the exact interfaces + conversions and are TDD-gated (retarget the test, confirm it fails, convert, confirm it passes) rather than transcribing every call-site edit (the fan-out mirrors Phase 4b's, handled by the implementer). No TBD/TODO.

**Type consistency:** `createStoreSignal<T>(initial): StoreSignal<T>` (Task 1) is consumed by the stores (Task 2) and optimistic (Task 3); the field-error accessor `{ fieldError(name): ReadonlySignal<string[]>; all: ReadonlySignal<FieldErrorsMap> }` (Task 4) is consistent between `field-errors-context.ts`, `<Form>`, and `use-field-errors.tsx`. All read hooks return `ReadonlySignal` (from `@preact/signals`).
