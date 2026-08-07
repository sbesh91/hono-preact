# Unified Reactive Loader Read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the loader reactive read to one adaptive `useData` (single-value + live), remove `useFieldSignal`, re-export `@preact/signals` first-party, and retire `ReadonlyReactive` for `ReadonlySignal`.

**Architecture:** `useData` is host-bound (inside `<Loader>`/`.View`). Single-value reads the existing signal context (renamed from `useDataSignal`). Live adds a runner collect-mode that logs chunks into a `LoaderStreamContext`; `useData(initial, reduce)` folds that log into a `ReadonlySignal<StreamState<Acc>>`. `.View` is untouched. Spec: `docs/superpowers/specs/2026-07-24-unified-reactive-read-api-design.md`.

**Tech Stack:** Preact, `@preact/signals` (now re-exported first-party), preact-iso, vitest, `@testing-library/preact`, `preact-render-to-string`.

## Global Constraints

- No em-dashes in prose, comments, or commit messages.
- No new inline `as` casts (reshape types instead). The one sanctioned structural context read in `define-loader.ts` may stay.
- Everything here is unreleased (umbrella only); removing `useDataSignal` / `useFieldSignal` / `ReadonlyReactive` breaks no released consumer.
- Core stays 5521 B gz; re-exports tree-shake (barrel `index.js` is not in `CORE_MODULES`). The Phase 5 module-graph guard invariant holds (core signals-free).
- `.View` / `.Boundary` behaviour and signatures are unchanged; only the runner gains a collect-mode used solely by `useData`.
- Mutation-check every regression test.
- Run a single test file with `pnpm exec vitest run <path>` from the worktree root (NOT `pnpm --filter`, a silent no-op). Type tests: `pnpm exec vitest --typecheck run <path>`.

---

### Task 1: Re-export `@preact/signals` first-party

**Files:**
- Modify: `packages/iso/src/index.ts`
- Test: `packages/hono-preact/__tests__/signals-reexport.test.ts` (create)

**Interfaces:**
- Produces: from `hono-preact`, the values `signal`, `computed`, `effect`, `batch`, `untracked`, `useSignal`, `useComputed`, `useSignalEffect`, and the types `Signal`, `ReadonlySignal`.

- [ ] **Step 1: Write the failing test**

Create `packages/hono-preact/__tests__/signals-reexport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as hp from 'hono-preact';
import * as sig from '@preact/signals';

describe('hono-preact re-exports @preact/signals first-party', () => {
  it('re-exports the primitive set, identical to @preact/signals', () => {
    for (const name of [
      'signal',
      'computed',
      'effect',
      'batch',
      'untracked',
      'useSignal',
      'useComputed',
      'useSignalEffect',
    ] as const) {
      expect(hp[name]).toBe(sig[name]);
    }
  });

  it('a re-exported signal/computed works through the framework entry', () => {
    const a = hp.signal(1);
    const b = hp.computed(() => a.value + 1);
    expect(b.value).toBe(2);
    a.value = 10;
    expect(b.value).toBe(11);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/hono-preact/__tests__/signals-reexport.test.ts`
Expected: FAIL (`hp.signal` is undefined).

- [ ] **Step 3: Add the re-export**

In `packages/iso/src/index.ts`, after the `hoofd/preact` re-export block (near line 227), add:

```ts
// Signals: re-exported first-party. The framework owns the signals integration
// (the always-on data-layer opinion), so it offers @preact/signals' primitives
// through its own entry rather than making apps depend on @preact/signals
// directly. Tree-shakeable and side-effect free; the barrel adds nothing to the
// always-loaded core graph.
export {
  signal,
  computed,
  effect,
  batch,
  untracked,
  useSignal,
  useComputed,
  useSignalEffect,
} from '@preact/signals';
export type { Signal, ReadonlySignal } from '@preact/signals';
```

- [ ] **Step 4: Build and run tests**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Run: `pnpm exec vitest run packages/hono-preact/__tests__/signals-reexport.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/index.ts packages/hono-preact/__tests__/signals-reexport.test.ts
git commit -m "feat(iso): re-export @preact/signals first-party (like hoofd)"
```

---

### Task 2: Retire `ReadonlyReactive` for `ReadonlySignal`

**Files:**
- Modify: `packages/iso/src/internal/reactive.ts`, `packages/iso/src/use-room.ts`, `packages/iso/src/define-loader.ts`, `packages/iso/src/internal/loader-signal.ts`, `packages/iso/src/internal/loader.tsx`
- Test: existing type + granularity tests (retargeted); `packages/iso/src/__tests__/show.test.tsx` comment only

**Interfaces:**
- Consumes: `ReadonlySignal<T>` from `@preact/signals`.
- Produces: `RosterStore<S>` and `PhaseCell<T>` retype their signal fields to `ReadonlySignal`; the `ReadonlyReactive` alias is deleted.

- [ ] **Step 1: Replace the alias in `reactive.ts`**

In `packages/iso/src/internal/reactive.ts`: delete the `ReadonlyReactive` type and its doc comment. Add at the top:

```ts
import type { ReadonlySignal } from '@preact/signals';
```

Replace every `ReadonlyReactive<X>` in this file with `ReadonlySignal<X>` (in `RosterStore.memberIds`, `.members`, `member(...)` return, and `PhaseCell.source`). Update the `RosterStore` / `PhaseCell` doc comments that referenced `ReadonlyReactive` to say `ReadonlySignal`.

- [ ] **Step 2: Update the four consumers**

In `use-room.ts`, `define-loader.ts`, `internal/loader-signal.ts`, `internal/loader.tsx`: replace `import type { ReadonlyReactive } from './internal/reactive.js'` (or `./reactive.js`) with `import type { ReadonlySignal } from '@preact/signals'`, and replace every `ReadonlyReactive<X>` textual use with `ReadonlySignal<X>`. In `internal/loader-signal.ts`, keep the `PhaseCell` import from `./reactive.js`. In `define-loader.ts`, the sanctioned structural context read becomes `ctx as ReadonlySignal<LoaderState<unknown> | null>` (still the one allowed cast boundary).

In `packages/iso/src/__tests__/show.test.tsx`, update the comment `A custom ReadonlyReactive whose getter...` to `A custom ReadonlySignal-shaped object whose getter...` (comment only; the test object stays a plain `{ get value() }`, which still structurally satisfies the `when` prop typed as `ReadonlySignal`).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: clean. (`computed()` / `signal()` results are `ReadonlySignal` / `Signal`, so the assignments already hold.)

- [ ] **Step 4: Run the affected suites (behaviour unchanged)**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/use-room-signals-granularity.test.tsx packages/iso/src/internal/__tests__/loader-field-granularity.test.tsx packages/iso/src/__tests__/show.test.tsx packages/iso/src/internal/__tests__/signals-always-on.test.ts`
Expected: all PASS (type-only change; runtime identical).

- [ ] **Step 5: Grep for stragglers**

Run: `rg -n "ReadonlyReactive" packages/iso/src`
Expected: zero hits.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/reactive.ts packages/iso/src/use-room.ts packages/iso/src/define-loader.ts packages/iso/src/internal/loader-signal.ts packages/iso/src/internal/loader.tsx packages/iso/src/__tests__/show.test.tsx
git commit -m "refactor(iso): retire ReadonlyReactive for @preact/signals ReadonlySignal"
```

---

### Task 3: Unify to `useData` (single-value); remove `useDataSignal` / `useFieldSignal`

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Modify/rename tests: `packages/iso/src/internal/__tests__/loader-data-signal-api.test.tsx`, `loader-field-granularity.test.tsx`, `loader-signal-ssr.test.tsx`, `loader-view-signal-context.test.tsx`; `packages/iso/src/__tests__/define-loader-live.test-d.ts`
- Modify: `packages/hono-preact/__tests__/exports.test.ts` (if it names the loader hooks)

**Interfaces:**
- Produces (single-value arm; live arm handled in Task 4):
  ```ts
  useData: Live extends true ? /* Task 4 */ : () => ReadonlySignal<LoaderState<Serialize<T>>>;
  ```
  `useDataSignal`, `useFieldSignal`, and the old value-returning `useData` are removed.

- [ ] **Step 1: Retarget the API test to `useData`**

In `packages/iso/src/internal/__tests__/loader-data-signal-api.test.tsx`, rename every `loader.useDataSignal()` call to `loader.useData()` and drop any `loader.useFieldSignal(...)` cases (projection is no longer a hook). Keep the "settles to value" and "throws outside a host" assertions, now through `useData()`. Run it to verify it FAILS against the current code (there is no `useData()` returning a signal yet):

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-data-signal-api.test.tsx`
Expected: FAIL (type/call mismatch, `useData` still returns a value).

- [ ] **Step 2: Reshape the single-value `useData` in `define-loader.ts`**

Replace the three hook fields (`useData`, `useDataSignal`, `useFieldSignal`) in the `LoaderRef` type with a single `useData` (single-value arm shown; the live arm is a placeholder resolved in Task 4, keep `never` for now so the file compiles):

```ts
  /**
   * Read the loader's data as a reactive signal. On a single-value loader,
   * `useData()` returns a `ReadonlySignal<LoaderState<Serialize<T>>>`
   * (pattern-match `.value.status`). Read `.value` in render; a binding updates
   * without the loader host re-rendering. Called inside a `<Loader>` / `.View`.
   * (Live loaders take `useData(initial, reduce)`, added in Task 4.)
   */
  useData: Live extends true
    ? never
    : () => ReadonlySignal<LoaderState<Serialize<T>>>;
```

Delete the `useDataSignal` and `useFieldSignal` type fields. In the ref implementation, rename the `useDataSignal()` method body to `useData()` (it already returns the memoized `derive(source, ...)` signal), and delete the `useFieldSignal` method and the old value-returning `useData` method. `readDataSignal()` stays as the shared body.

- [ ] **Step 3: Run to verify the API test passes**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-data-signal-api.test.tsx`
Expected: PASS.

- [ ] **Step 4: Retarget the other single-value tests**

In `loader-field-granularity.test.tsx` (rename the field-granularity assertions to read a projected field via `useComputed(() => ...)` off `loader.useData()`, keeping the mutation-checked "only the projected consumer re-renders" assertion), `loader-signal-ssr.test.tsx` and `loader-view-signal-context.test.tsx` (rename `useDataSignal` -> `useData`), and `define-loader-live.test-d.ts` (the live arm still `never` after this task; assert `useData` has no callable single-value shape on a live loader yet). Run each:

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-field-granularity.test.tsx packages/iso/src/internal/__tests__/loader-signal-ssr.test.tsx packages/iso/src/internal/__tests__/loader-view-signal-context.test.tsx`
Run: `pnpm exec vitest --typecheck run packages/iso/src/__tests__/define-loader-live.test-d.ts`
Expected: all PASS.

- [ ] **Step 5: Update the exports test + grep**

If `packages/hono-preact/__tests__/exports.test.ts` references `useDataSignal` / `useFieldSignal` on the loader ref, remove those references. Then:
Run: `rg -n "useDataSignal|useFieldSignal" packages --glob '!**/dist/**'`
Expected: zero hits.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: clean.

```bash
git add -A packages/iso/src/define-loader.ts packages/iso/src/internal/__tests__ packages/iso/src/__tests__/define-loader-live.test-d.ts packages/hono-preact/__tests__/exports.test.ts
git commit -m "feat(iso): unify the single-value loader read to useData; drop useDataSignal/useFieldSignal"
```

---

### Task 4: Live `useData(initial, reduce)` via runner collect-mode

**Files:**
- Modify: `packages/iso/src/internal/use-loader-runner.tsx` (add collect-mode: a chunk-log signal alongside the existing fold)
- Modify: `packages/iso/src/internal/loader.tsx` (expose `LoaderStreamContext` when a live loader is hosted for `useData`)
- Modify: `packages/iso/src/internal/contexts.ts` (add `LoaderStreamContext`)
- Modify: `packages/iso/src/define-loader.ts` (the live `useData` arm: type + implementation folding the log)
- Test: `packages/iso/src/internal/__tests__/use-data-live.test.tsx` (create), `packages/iso/src/__tests__/define-loader-live.test-d.ts` (extend)

**Interfaces:**
- Consumes: `LoaderStreamContext` = `{ chunks: ReadonlySignal<readonly unknown[]>; status: ReadonlySignal<StreamStatus>; error: ReadonlySignal<Error | null> }` (provided by the live host).
- Produces (the live arm of `useData`):
  ```ts
  useData: Live extends true
    ? <Acc>(initial: Acc, reduce: (acc: Acc, chunk: Serialize<T>) => Acc) => ReadonlySignal<StreamState<Acc>>
    : () => ReadonlySignal<LoaderState<Serialize<T>>>;
  ```

This task is TDD-first: the tests below define correctness; the implementer wires the runner collect-mode and host context to satisfy them. `.View` fold-mode must stay behaviourally identical (Task 4 adds a mode, it does not change the existing one).

- [ ] **Step 1: Write the failing behaviour tests**

Create `packages/iso/src/internal/__tests__/use-data-live.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { useComputed } from '@preact/signals';
import { defineLoader } from '../../define-loader.js';
// A live loader test harness that lets the test push chunks. The exact harness
// mirrors the existing streaming loader tests (loader-signal-ssr.test.tsx);
// reuse their chunk-driving helper for the underlying stream source.
import { makeLiveLoaderHarness } from './helpers/live-harness.js'; // create alongside, factoring the existing streaming test's driver

afterEach(cleanup);

describe('live useData(initial, reduce)', () => {
  it('folds chunks into a StreamState<Acc> signal, granularly', async () => {
    const h = makeLiveLoaderHarness<number>();
    function View() {
      const total = h.loader.useData(0, (acc, n) => acc + n);
      // bind a projection so only this node updates per chunk
      const shown = useComputed(() =>
        total.value.status === 'connecting' ? 'connecting' : String(total.value.data)
      );
      return <p data-testid="t">{shown}</p>;
    }
    render(<h.Host><View /></h.Host>);
    expect(screen.getByTestId('t').textContent).toBe('connecting');
    await act(async () => h.push(2));
    expect(screen.getByTestId('t').textContent).toBe('2');
    await act(async () => h.push(3));
    expect(screen.getByTestId('t').textContent).toBe('5');
  });

  it('two consumers under one host fold the same stream independently (one subscription)', async () => {
    const h = makeLiveLoaderHarness<number>();
    function Sum() {
      const s = h.loader.useData(0, (a, n) => a + n);
      return <p data-testid="sum">{s.value.status === 'connecting' ? '-' : String(s.value.data)}</p>;
    }
    function Count() {
      const c = h.loader.useData(0, (a) => a + 1);
      return <p data-testid="count">{c.value.status === 'connecting' ? '-' : String(c.value.data)}</p>;
    }
    render(<h.Host><Sum /><Count /></h.Host>);
    await act(async () => { h.push(10); h.push(20); });
    expect(screen.getByTestId('sum').textContent).toBe('30');
    expect(screen.getByTestId('count').textContent).toBe('2');
    expect(h.subscriptionCount()).toBe(1); // one stream, two folds
  });

  it('a late-mounting consumer folds from the retained log (no missed chunks)', async () => {
    const h = makeLiveLoaderHarness<number>();
    const Late = () => {
      const s = h.loader.useData(0, (a, n) => a + n);
      return <p data-testid="late">{s.value.status === 'connecting' ? '-' : String(s.value.data)}</p>;
    };
    const { rerender } = render(<h.Host><span /></h.Host>);
    await act(async () => { h.push(1); h.push(2); h.push(3); });
    rerender(<h.Host><Late /></h.Host>);
    // Late mount must reflect the full fold (1+2+3), not just chunks after mount.
    expect(screen.getByTestId('late').textContent).toBe('6');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/use-data-live.test.tsx`
Expected: FAIL (no live `useData`; `LoaderStreamContext` absent).

- [ ] **Step 3: Add `LoaderStreamContext`**

In `packages/iso/src/internal/contexts.ts`, add:

```ts
import type { ReadonlySignal } from '@preact/signals';
import type { StreamStatus } from '../loader-state.js';

export type LoaderStreamValue = {
  chunks: ReadonlySignal<readonly unknown[]>;
  status: ReadonlySignal<StreamStatus>;
  error: ReadonlySignal<Error | null>;
};
export const LoaderStreamContext = createContext<LoaderStreamValue | null>(null);
```

- [ ] **Step 4: Add runner collect-mode**

In `packages/iso/src/internal/use-loader-runner.tsx`, add a collect-mode that, for a live loader hosted for `useData` (signalled by a new option, e.g. `collect: true` distinct from `accumulate`), appends each chunk to an ordered log kept in a `signal([])` and updates a status `signal`, instead of folding. Expose `{ chunks, status, error }` signals on the returned runner state. Keep the existing `accumulate` fold-mode path untouched (it serves `.View`). The chunk log retains history (documented memory cost).

- [ ] **Step 5: Expose the context from the host**

In `packages/iso/src/internal/loader.tsx`, when the host runs a live loader in collect-mode (i.e. consumed by `useData`, not `.View` accumulate), wrap children in `LoaderStreamContext.Provider` with the runner's `{ chunks, status, error }` signals. Server render: empty log, `connecting` status (existing streaming SSR contract). `.View` (fold-mode) path is unchanged.

- [ ] **Step 6: Implement the live `useData` arm in `define-loader.ts`**

Set the live arm of the `useData` type (interfaces above). Implement: read `LoaderStreamContext`; throw a sharp error if absent ("live loader.useData(initial, reduce) must be called inside a `<Loader>` / `.View` host"). Return a memoized `ReadonlySignal<StreamState<Acc>>` that folds `chunks` incrementally through `reduce` (track last-consumed index in a ref so the fold is O(n) over the stream; on first render consume the whole retained log so a late mount is correct), projecting `toStreamState(status.value, acc, error.value)`.

- [ ] **Step 7: Run the behaviour tests**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/use-data-live.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 8: Mutation-check granularity + late-mount**

Break the incremental fold to re-fold from scratch every render without the retained log seed (so a late mount would start from mount time): the late-mount test must FAIL. Restore. Re-fold-from-scratch on every chunk (drop the ref index): the fold values stay correct but assert (temporarily) a render-count spy on the folding consumer to confirm the granular projection still updates only the bound node; restore. Document both in the report.

- [ ] **Step 9: Extend the type test**

In `packages/iso/src/__tests__/define-loader-live.test-d.ts`, assert the live `useData(initial, reduce)` infers `Acc` from `initial`/`reduce` and returns `ReadonlySignal<StreamState<Acc>>`, and that calling `useData()` with no args on a live loader is a type error. Run:

Run: `pnpm exec vitest --typecheck run packages/iso/src/__tests__/define-loader-live.test-d.ts`
Expected: PASS.

- [ ] **Step 10: Confirm `.View` streaming parity + commit**

Run the existing streaming `.View` tests to confirm fold-mode is untouched:
Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-signal-ssr.test.tsx` and any `*view*streaming*` / accumulate tests.
Expected: PASS unchanged.

```bash
git add -A packages/iso/src/internal packages/iso/src/define-loader.ts packages/iso/src/__tests__/define-loader-live.test-d.ts
git commit -m "feat(iso): live useData(initial, reduce) via runner collect-mode + chunk-log fold"
```

---

### Task 5: Docs, gates, and full verification

**Files:**
- Modify: `packages/create-hono-preact/templates/agents/AGENTS.md` (if it lists the loader read hooks or the signal entry), `packages/create-hono-preact/__tests__/agents-appendix.test.ts` (only if a subpath changed, it did not, so likely no change), `packages/iso/src/internal/__tests__/signals-always-on.test.ts` (guard: re-export site not in CORE_MODULES), `scripts/size-probe-config.mjs` (no bucket change expected; confirm)
- Modify: `apps/site` docs only if a documented symbol changed (defer per the migration convention; confirm nothing on the site references `useDataSignal`)

- [ ] **Step 1: Docs sync sweep**

Run: `rg -n "useDataSignal|useFieldSignal|ReadonlyReactive" apps/site packages/create-hono-preact/templates --glob '!**/dist/**'`
Fix any stale references (rename to `useData` / describe `useComputed` projection). AGENTS.md: the loader read hooks are on the main entry (no subpath change), so the appendix gate is unaffected; update any prose that names the removed hooks.

- [ ] **Step 2: Extend the module-graph guard**

In `packages/iso/src/internal/__tests__/signals-always-on.test.ts`, add an assertion that `index.ts` re-exporting `@preact/signals` does not pull it into `CORE_MODULES` (the invariant already holds via tree-shaking; assert the re-export lines exist and that core stays signals-free per the existing whole-tree check). Run it:

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/signals-always-on.test.ts`
Expected: PASS.

- [ ] **Step 3: Regenerate corpus + size**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Run: `pnpm gen:agents-corpus`
Run: `node scripts/measure-framework-size.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).sectionA;console.log('core:',a.core.total,'| loaders:',a.loaders.total);})"`
Expected: core 5521 (unchanged); note the loaders delta (collect-mode adds a little) for the PR.

- [ ] **Step 4: Full eight-step verification**

Run in order, each must pass (fix and re-run if not):
```bash
pnpm format:check   # if it fails: pnpm format, then re-check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(iso): module-graph guard + docs sync for the unified read API; corpus"
```

---

## Self-Review

**Spec coverage:**
- One adaptive `useData` (spec 3) -> Task 3 (single-value) + Task 4 (live).
- Remove `useFieldSignal`, projection via `useComputed` (spec 4) -> Task 3 (removal) + the re-exported `useComputed` from Task 1.
- Re-export `@preact/signals` (spec 5) -> Task 1.
- Retire `ReadonlyReactive` -> `ReadonlySignal` (spec 6) -> Task 2.
- Wiring: uniform host-bound, `.View` untouched, collect-mode + chunk-log fold, late-mount from retained log (spec 7 resolved) -> Task 4.
- Testing (spec 11) -> per-task tests + Task 5 gates.
- Scope excludes `.View`/`.Boundary` change, routing, Phase 3 (spec 10) -> respected.

**Placeholder scan:** Task 4's runner/host steps specify the approach and interfaces and are TDD-gated by complete test code (the correctness spec), rather than prescribing exact runner internals I have not validated; every other step shows exact code/commands. The `live-harness.js` helper is to be factored from the existing streaming test's chunk driver (named, not invented).

**Type consistency:** `useData` single-value `() => ReadonlySignal<LoaderState<Serialize<T>>>` (Task 3) and live `<Acc>(initial, reduce) => ReadonlySignal<StreamState<Acc>>` (Task 4) match across the type, the impl, and the `*.test-d.ts`. `ReadonlySignal` (from `@preact/signals`) is used uniformly after Task 2. `LoaderStreamContext` shape is consistent between `contexts.ts`, the host, and the live `useData` reader.
