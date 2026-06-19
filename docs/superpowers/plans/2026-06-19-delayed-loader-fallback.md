# Delayed Loader Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wait 100ms before mounting a loader's Suspense fallback on a client navigation, so fast responses never flash a loading state.

**Architecture:** A tiny internal `DelayedFallback` component renders nothing for `delay` ms, then renders the real fallback. It is mounted only while Suspense is suspended, so a response that arrives before the delay unmounts it before its timer fires and the fallback never paints. `LoaderHost` wraps the user's `fallback` in `DelayedFallback`, reading the delay from a new per-loader `fallbackDelay` option (default 100ms, `0` = immediate). Reading the delay off the `LoaderRef` inside `LoaderHost` means both `defineLoader(...).Boundary` and `.View` inherit it with no signature change.

**Tech Stack:** TypeScript, Preact (`preact/compat` Suspense, `preact/hooks`), Vitest + `@testing-library/preact` (happy-dom), pnpm workspaces.

## Global Constraints

- **No em-dashes** (`—`) in prose, code comments, or commit messages. Use a comma, semicolon, colon, parentheses, or two sentences. (CLI flags, code identifiers, and Markdown table separators are fine.)
- **Server/browser detection uses `isBrowser()`** from `packages/iso/src/is-browser.tsx` (backed by the mutable `env.current` flag), never `typeof window`. Tests toggle `env.current`.
- **`DelayedFallback` is internal.** It lives under `packages/iso/src/internal/` and is NOT added to the public barrel (`packages/iso/src/index.ts`). Tests import it directly from its file.
- **`fallbackDelay` type is `number`** (not `number | false`): `undefined` means "use the 100ms default", `0` means "show immediately". Validate it as a non-negative finite number the same way `timeoutMs` is validated (throw `RangeError` otherwise).
- **TDD:** write the failing test, watch it fail, implement, watch it pass, commit. One logical change per commit.
- **Do NOT run `git push` or open a PR** as part of these tasks. Task 5 runs the full local CI sequence only.

---

### Task 1: `DelayedFallback` internal component

**Files:**
- Create: `packages/iso/src/internal/delayed-fallback.tsx`
- Test: `packages/iso/src/internal/__tests__/delayed-fallback.test.tsx`

**Interfaces:**
- Consumes: `isBrowser` from `../is-browser.js`.
- Produces (used by Task 3):
  - `export const DEFAULT_FALLBACK_DELAY_MS = 100`
  - `export function DelayedFallback(props: { delay: number; children: ComponentChildren }): VNode | null`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/delayed-fallback.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import {
  DelayedFallback,
  DEFAULT_FALLBACK_DELAY_MS,
} from '../delayed-fallback.js';
import { env } from '../../is-browser.js';

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  env.current = originalEnv;
  cleanup();
});

const Fb = () => <div data-testid="fb">Loading…</div>;

describe('DelayedFallback', () => {
  it('exposes a 100ms default delay', () => {
    expect(DEFAULT_FALLBACK_DELAY_MS).toBe(100);
  });

  it('renders nothing before the delay elapses', () => {
    render(
      <DelayedFallback delay={100}>
        <Fb />
      </DelayedFallback>
    );
    expect(screen.queryByTestId('fb')).toBeNull();
  });

  it('renders children once the delay elapses', () => {
    render(
      <DelayedFallback delay={100}>
        <Fb />
      </DelayedFallback>
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByTestId('fb')).not.toBeNull();
  });

  it('keeps waiting right up to the threshold', () => {
    render(
      <DelayedFallback delay={100}>
        <Fb />
      </DelayedFallback>
    );
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(screen.queryByTestId('fb')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('fb')).not.toBeNull();
  });

  it('renders immediately when delay is 0', () => {
    render(
      <DelayedFallback delay={0}>
        <Fb />
      </DelayedFallback>
    );
    expect(screen.queryByTestId('fb')).not.toBeNull();
  });

  it('renders immediately on the server', () => {
    env.current = 'server';
    render(
      <DelayedFallback delay={100}>
        <Fb />
      </DelayedFallback>
    );
    expect(screen.queryByTestId('fb')).not.toBeNull();
  });

  it('does not render children if unmounted before the delay', () => {
    const { unmount } = render(
      <DelayedFallback delay={100}>
        <Fb />
      </DelayedFallback>
    );
    unmount();
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(200);
      })
    ).not.toThrow();
    expect(screen.queryByTestId('fb')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/delayed-fallback.test.tsx`
Expected: FAIL — cannot resolve `../delayed-fallback.js` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/iso/src/internal/delayed-fallback.tsx`:

```tsx
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';

/**
 * Default delay (ms) before a loader's fallback mounts on a client navigation.
 * On a fast connection the data usually lands within this window, so the
 * fallback never paints and the user sees no flicker. Override per loader with
 * `defineLoader(fn, { fallbackDelay })`.
 */
export const DEFAULT_FALLBACK_DELAY_MS = 100;

/**
 * Wraps a Suspense `fallback` so it only mounts after `delay` ms. Suspense
 * mounts this component only while suspended and unmounts it on resolve, so a
 * response that arrives before `delay` unmounts us before the timer fires and
 * the fallback never appears.
 *
 * The delay applies in the browser only. On the server (`!isBrowser()`) and
 * when `delay <= 0`, the fallback renders immediately, so SSR and hydration
 * output is unchanged and `fallbackDelay: 0` is a clean per-loader opt-out.
 */
export function DelayedFallback({
  delay,
  children,
}: {
  delay: number;
  children: ComponentChildren;
}) {
  const immediate = !isBrowser() || delay <= 0;
  const [show, setShow] = useState(immediate);
  useEffect(() => {
    if (immediate) return;
    const timer = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(timer);
  }, [delay, immediate]);
  return show ? <>{children}</> : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/delayed-fallback.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/delayed-fallback.tsx packages/iso/src/internal/__tests__/delayed-fallback.test.tsx
git commit -m "feat(iso): DelayedFallback component for delayed loading state"
```

---

### Task 2: `fallbackDelay` option on `defineLoader`

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Test: `packages/iso/src/__tests__/define-loader-fallback-delay.test.ts`
- Type test: `packages/iso/src/__tests__/define-loader-fallback-delay.test-d.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces (used by Task 3):
  - `DefineLoaderOpts<T>` gains `fallbackDelay?: number`.
  - `LoaderRef<T>` gains `readonly fallbackDelay?: number`.
  - `defineLoader` stores `opts.fallbackDelay` on the ref and validates it (throws `RangeError` on negative / `NaN` / `Infinity`).

- [ ] **Step 1: Write the failing runtime test**

Create `packages/iso/src/__tests__/define-loader-fallback-delay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';

describe('defineLoader fallbackDelay', () => {
  it('defaults fallbackDelay to undefined when not specified', () => {
    const ref = defineLoader(async () => 1);
    expect(ref.fallbackDelay).toBeUndefined();
  });

  it('stores the provided fallbackDelay on the ref', () => {
    const ref = defineLoader(async () => 1, { fallbackDelay: 250 });
    expect(ref.fallbackDelay).toBe(250);
  });

  it('accepts 0 (shows the fallback immediately)', () => {
    const ref = defineLoader(async () => 1, { fallbackDelay: 0 });
    expect(ref.fallbackDelay).toBe(0);
  });

  it('rejects negative numbers', () => {
    expect(() => defineLoader(async () => 1, { fallbackDelay: -1 })).toThrow(
      RangeError
    );
  });

  it('rejects NaN', () => {
    expect(() =>
      defineLoader(async () => 1, { fallbackDelay: Number.NaN })
    ).toThrow(RangeError);
  });

  it('rejects Infinity', () => {
    expect(() =>
      defineLoader(async () => 1, { fallbackDelay: Number.POSITIVE_INFINITY })
    ).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Write the failing type test**

Create `packages/iso/src/__tests__/define-loader-fallback-delay.test-d.ts`:

```ts
import { expectTypeOf } from 'vitest';
import { defineLoader } from '../define-loader.js';
import type { DefineLoaderOpts, LoaderRef } from '../define-loader.js';

// The option is an optional number.
expectTypeOf<DefineLoaderOpts<number>['fallbackDelay']>().toEqualTypeOf<
  number | undefined
>();

// The ref surfaces it as number | undefined.
expectTypeOf<LoaderRef<number>['fallbackDelay']>().toEqualTypeOf<
  number | undefined
>();

// defineLoader accepts it at the call site.
const ref = defineLoader(async () => 1, { fallbackDelay: 100 });
expectTypeOf(ref.fallbackDelay).toEqualTypeOf<number | undefined>();
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `pnpm vitest run packages/iso/src/__tests__/define-loader-fallback-delay.test.ts`
Expected: FAIL — `ref.fallbackDelay` is `undefined` for the "stores" case and no `RangeError` is thrown for the rejection cases.

Run: `pnpm test:types`
Expected: FAIL — `fallbackDelay` does not exist on `DefineLoaderOpts` / `LoaderRef`.

- [ ] **Step 4: Add `fallbackDelay` to `LoaderRef<T>`**

In `packages/iso/src/define-loader.ts`, inside `interface LoaderRef<T>`, immediately after the `timeoutMs` field (the block ending `readonly timeoutMs?: number | false;`), add:

```ts
  /**
   * Per-loader delay in milliseconds before the Suspense fallback mounts on a
   * client navigation, as authored on `defineLoader({ fallbackDelay })`.
   * `undefined` means "use the framework default (100ms)"; `0` shows the
   * fallback immediately.
   */
  readonly fallbackDelay?: number;
```

- [ ] **Step 5: Add `fallbackDelay` to `DefineLoaderOpts<T>`**

In the same file, inside `type DefineLoaderOpts<T>`, immediately after the `timeoutMs` field (the block ending `timeoutMs?: number | false;`), add:

```ts
  /**
   * Delay in milliseconds before this loader's fallback (loading UI) mounts on
   * a client navigation. When omitted, the framework default of 100ms applies.
   * Pass `0` to show the fallback immediately. On a fast connection the data
   * usually lands within the window, so the fallback never paints.
   */
  fallbackDelay?: number;
```

- [ ] **Step 6: Add a validator (mirror `validateTimeoutMs`)**

In the same file, immediately after the `validateTimeoutMs` function, add:

```ts
function validateFallbackDelay(
  value: number | undefined,
  context: string
): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${context}: fallbackDelay must be a non-negative finite number, got ${String(value)}`
    );
  }
}
```

- [ ] **Step 7: Call the validator and store the value on the ref**

In the same file, immediately after the existing `validateTimeoutMs(opts?.timeoutMs, 'defineLoader');` line, add:

```ts
  validateFallbackDelay(opts?.fallbackDelay, 'defineLoader');
```

Then in the `ref` object literal, immediately after the `timeoutMs: opts?.timeoutMs,` line, add:

```ts
    fallbackDelay: opts?.fallbackDelay,
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `pnpm vitest run packages/iso/src/__tests__/define-loader-fallback-delay.test.ts`
Expected: PASS (6 tests).

Run: `pnpm test:types`
Expected: PASS (all type tests, including the new `.test-d.ts`).

- [ ] **Step 9: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/define-loader-fallback-delay.test.ts packages/iso/src/__tests__/define-loader-fallback-delay.test-d.ts
git commit -m "feat(iso): fallbackDelay option on defineLoader"
```

---

### Task 3: Wire `DelayedFallback` into `LoaderHost`

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx`
- Test: `packages/iso/src/internal/__tests__/loader-fallback-delay.test.tsx`

**Interfaces:**
- Consumes: `DelayedFallback` and `DEFAULT_FALLBACK_DELAY_MS` from `./delayed-fallback.js` (Task 1); `loaderRef.fallbackDelay` from `LoaderRef` (Task 2).
- Produces: no new exported surface. `LoaderHost` now wraps a non-null `fallback` in `DelayedFallback`.

- [ ] **Step 1: Write the failing integration test**

Create `packages/iso/src/internal/__tests__/loader-fallback-delay.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { env } from '../../is-browser.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

const loc = {
  path: '/test',
  url: 'http://localhost/test',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  env.current = originalEnv;
  cleanup();
});

const Loading = () => <div data-testid="loading">Loading…</div>;

describe('LoaderHost delayed fallback', () => {
  it('delays the loader fallback by the 100ms default', () => {
    const ref = defineLoader(() => new Promise<{ msg: string }>(() => {}));
    function Child() {
      return <span>{ref.useData().msg}</span>;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc} fallback={<Loading />}>
          <Child />
        </Loader>
      </LocationProvider>
    );
    expect(screen.queryByTestId('loading')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(screen.queryByTestId('loading')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('loading')).not.toBeNull();
  });

  it('never shows the fallback when the loader resolves before the delay', async () => {
    let resolve!: (v: { msg: string }) => void;
    const ref = defineLoader(
      () =>
        new Promise<{ msg: string }>((r) => {
          resolve = r;
        })
    );
    function Child() {
      return <span data-testid="msg">{ref.useData().msg}</span>;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc} fallback={<Loading />}>
          <Child />
        </Loader>
      </LocationProvider>
    );
    expect(screen.queryByTestId('loading')).toBeNull();

    await act(async () => {
      resolve({ msg: 'done' });
    });
    expect(screen.getByTestId('msg')).toHaveTextContent('done');
    expect(screen.queryByTestId('loading')).toBeNull();

    // The fallback's timer was cleared on unmount, so advancing past the
    // threshold must not resurrect it.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('respects a custom fallbackDelay', () => {
    const ref = defineLoader(() => new Promise<{ msg: string }>(() => {}), {
      fallbackDelay: 50,
    });
    function Child() {
      return <span>{ref.useData().msg}</span>;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc} fallback={<Loading />}>
          <Child />
        </Loader>
      </LocationProvider>
    );
    expect(screen.queryByTestId('loading')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId('loading')).not.toBeNull();
  });

  it('shows the fallback immediately when fallbackDelay is 0', () => {
    const ref = defineLoader(() => new Promise<{ msg: string }>(() => {}), {
      fallbackDelay: 0,
    });
    function Child() {
      return <span>{ref.useData().msg}</span>;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc} fallback={<Loading />}>
          <Child />
        </Loader>
      </LocationProvider>
    );
    expect(screen.queryByTestId('loading')).not.toBeNull();
  });
});
```

Note on the second test: if the `await act(async () => { resolve(...) })` checkpoint does not fully flush the Suspense re-render in your local run, add one more `await act(async () => {});` immediately after it. This is a microtask-flush belt-and-suspenders, not a behavior change.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/loader-fallback-delay.test.tsx`
Expected: FAIL — today the fallback mounts immediately, so "delays the loader fallback by the 100ms default" fails at the first `expect(screen.queryByTestId('loading')).toBeNull()` (loading is already present at 0ms).

- [ ] **Step 3: Wrap the fallback in `LoaderHost`**

In `packages/iso/src/internal/loader.tsx`, add this import alongside the other `./...` imports (e.g. after the `useLoaderRunner` import):

```ts
import { DelayedFallback, DEFAULT_FALLBACK_DELAY_MS } from './delayed-fallback.js';
```

Then replace the `suspenseContent` block:

```tsx
  const suspenseContent = (
    <Suspense fallback={fallback}>
      <DataReader reader={reader} overrideData={overrideData}>
        <Envelope>{children}</Envelope>
      </DataReader>
    </Suspense>
  );
```

with:

```tsx
  const fallbackDelay = loaderRef.fallbackDelay ?? DEFAULT_FALLBACK_DELAY_MS;
  const wrappedFallback =
    fallback == null ? (
      fallback
    ) : (
      <DelayedFallback delay={fallbackDelay}>{fallback}</DelayedFallback>
    );

  const suspenseContent = (
    <Suspense fallback={wrappedFallback}>
      <DataReader reader={reader} overrideData={overrideData}>
        <Envelope>{children}</Envelope>
      </DataReader>
    </Suspense>
  );
```

- [ ] **Step 4: Run the new test plus the existing loader tests to verify they pass**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/loader-fallback-delay.test.tsx packages/iso/src/internal/__tests__/loader.test.tsx`
Expected: PASS (new file 4 tests; `loader.test.tsx` unchanged and still green, confirming no regression to the existing fallback/reload behavior).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/loader.tsx packages/iso/src/internal/__tests__/loader-fallback-delay.test.tsx
git commit -m "feat(iso): delay loader fallback mount by default"
```

---

### Task 4: Document `fallbackDelay`

**Files:**
- Modify: `apps/site/src/pages/docs/loaders.mdx`

**Interfaces:**
- Consumes: the `fallbackDelay` option shipped in Task 2.
- Produces: a documented option (no code surface).

- [ ] **Step 1: Add the options-table row**

In `apps/site/src/pages/docs/loaders.mdx`, find the loader-config options table (the row block starting at `| `params`    | ...`). Immediately after the `timeoutMs` row:

```
| `timeoutMs` | `number \| false` | `30000` | Per-loader deadline; `false` disables it.                 |
```

add:

```
| `fallbackDelay` | `number`        | `100`   | Delay (ms) before the loading fallback mounts on a client nav; `0` shows it immediately. |
```

- [ ] **Step 2: Add a short prose note**

In the same file, find the paragraph that documents `timeoutMs` behavior (it begins "deadline starts when the handler receives the request. Pass `timeoutMs` on ..." and includes a `{ timeoutMs: 60_000 }` snippet). Immediately after that `timeoutMs` discussion block (after the `{ timeoutMs: false }` snippet and its trailing paragraph), add a new subsection:

```mdx
### Delaying the loading fallback

On a fast connection a loader's `fallback` can flash on screen for a few
milliseconds before the data lands, which reads as a flicker. The framework
waits `fallbackDelay` milliseconds (default `100`) before mounting the fallback
on a client navigation; if the response arrives first, the fallback never
paints. Set it per loader:

```ts
import { defineLoader } from 'hono-preact';

export const movie = defineLoader(
  async ({ location }) => fetchMovie(location.pathParams.id),
  { fallbackDelay: 200 }
);
```

Pass `fallbackDelay: 0` to show the fallback immediately (the pre-100ms
behavior). The delay applies in the browser only; server-rendered output is
unchanged. Both `loader.Boundary` and `loader.View` inherit it.
```

(Adjust the surrounding blank lines so the new `###` section sits between the `timeoutMs` discussion and whatever section follows it. Use the existing import name shown elsewhere in this file, `defineLoader`.)

- [ ] **Step 3: Verify the docs site still builds and is formatted**

Run: `pnpm format:check`
Expected: PASS (if it fails on the edited file, run `pnpm format` and re-stage).

Run: `pnpm --filter site build`
Expected: PASS (MDX compiles, no broken page).

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs/loaders.mdx
git commit -m "docs(site): document defineLoader fallbackDelay"
```

---

### Task 5: Full pre-push verification

**Files:** none (verification only).

**Interfaces:** none.

This task runs the seven CI steps from `CLAUDE.md` in order, so nothing reaches CI that should have been caught locally. Do NOT push or open a PR; just confirm green.

- [ ] **Step 1: Build the framework packages first (dist must be current)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: PASS. (`typecheck` and `apps/site` resolve cross-package types through `dist/`, so a stale dist surfaces as fake "missing export" errors.)

- [ ] **Step 2: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format`, then `git add -A && git commit -m "chore: format"`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Type-level tests**

Run: `pnpm test:types`
Expected: PASS (includes `define-loader-fallback-delay.test-d.ts`).

- [ ] **Step 5: Unit tests with coverage**

Run: `pnpm test:coverage`
Expected: PASS (includes `delayed-fallback.test.tsx`, `define-loader-fallback-delay.test.ts`, and `loader-fallback-delay.test.tsx`).

- [ ] **Step 6: Integration tests**

Run: `pnpm test:integration`
Expected: PASS.

- [ ] **Step 7: Site build**

Run: `pnpm --filter site build`
Expected: PASS.

- [ ] **Step 8: Confirm a clean tree**

Run: `git status`
Expected: clean working tree (all changes committed). Report the final commit list.

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-06-19-delayed-loader-fallback-design.md`):
- Public API `fallbackDelay` on `DefineLoaderOpts` + `LoaderRef`, default 100, `0` = immediate, validated like `timeoutMs` → Task 2.
- New internal `DelayedFallback` + `DEFAULT_FALLBACK_DELAY_MS`, server/`delay<=0` immediate via `isBrowser()` → Task 1.
- Wiring in `LoaderHost`, no wrap when `fallback` is nullish, `Boundary`/`View` inherit → Task 3.
- Behavior cases (fast resolve never shows, slow shows after delay, `0` immediate, server unchanged) → Tests in Tasks 1 and 3.
- Tests: unit, integration, type, validation → Tasks 1, 2, 3.
- Out-of-scope items (min display time, page route boundary, `reloading` debounce, global/per-prop override) are correctly absent.
- Added beyond the spec: human docs (Task 4) and the full local CI gate (Task 5). Docs are warranted for a new public option; CI gate mirrors `CLAUDE.md`.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output.

**3. Type consistency:** `fallbackDelay` (option + ref field), `DEFAULT_FALLBACK_DELAY_MS`, `DelayedFallback`, `validateFallbackDelay`, `wrappedFallback`, `fallbackDelay` local in `LoaderHost` are spelled identically across Tasks 1-3. `fallbackDelay` is `number` (not `number | false`) everywhere, matching the Global Constraints.
