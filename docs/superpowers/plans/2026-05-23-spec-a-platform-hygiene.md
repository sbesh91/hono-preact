# Spec A — Platform Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt four web-standard primitives in the hono-preact framework: AbortSignal-composed loader/action timeouts with a structured timeout outcome, opt-in View Transitions in `useOptimistic` / `useOptimisticAction`, `URL.parse()` at recoverable parse sites, and a TransformStream-based SSE codec replacing `hono/streaming` on the loader/action stream path.

**Architecture:** All changes are additive at the public-API layer. Spec A ships in two PRs on `main`: PR1 (Tasks 1-13) lands the user-facing additions (#1 timeouts, #2 optimistic transitions, #3 `URL.parse()`); PR2 (Tasks 14-19) lands the internal SSE codec rewrite with a byte-wise wire-format snapshot test as the safety net. No version bump in either PR; v0.3.0 cuts after Specs B-E also land.

**Tech Stack:** TypeScript, Preact, Hono, Vitest, pnpm workspaces. Web Standards: `AbortSignal.any`, `AbortSignal.timeout`, `URL.parse`, `document.startViewTransition`, `TransformStream`, `TextEncoderStream`, `TextDecoderStream`.

**Reference:** [Spec A design doc](../specs/2026-05-23-spec-a-platform-hygiene-design.md) and the [roadmap](../specs/2026-05-23-web-standards-adoption-roadmap.md).

---

## File structure

### PR1 — public API (Tasks 1-13)

**Modified:**
- `packages/iso/src/outcomes.ts` — add `TimeoutOutcome`, `timeoutOutcome()` constructor, `isTimeout()` guard, extend `Outcome` union and `isOutcome()`.
- `packages/iso/src/define-loader.ts` — add `timeoutMs?: number | false` to `DefineLoaderOpts` and `LoaderRef`.
- `packages/iso/src/action.ts` — add `timeoutMs?: number | false` to `DefineActionOpts`; attach it via `Object.defineProperty`; update `useAction` to recognize the new envelope and the SSE `event: timeout` frame.
- `packages/iso/src/optimistic.ts` — accept an optional 3rd argument `{ transition?: boolean }`; wrap settle/revert in `document.startViewTransition` when enabled.
- `packages/iso/src/optimistic-action.ts` — forward `transition` through `UseOptimisticActionOptions` to `useOptimistic`.
- `packages/server/src/loaders-handler.ts` — read `timeoutMs` off the ref, compose `AbortSignal.any([request, timeout])`, translate `TimeoutError` into a timeout outcome (504).
- `packages/server/src/actions-handler.ts` — same composition; same translation.
- `packages/server/src/sse.ts` — when the response stream aborts because the composed signal timed out, emit `event: timeout` instead of `event: error`.
- Various sites identified by audit in Task 12 — replace `try { new URL(...) } catch` with `URL.parse()`.
- `apps/site` docs — new "Timeouts" section under loaders/actions and a "View Transitions" note on `useOptimistic`. Path is whatever the docs nav structure dictates; resolved during Task 13.

**Created (tests):**
- `packages/iso/src/__tests__/outcomes-timeout.test.ts`
- `packages/iso/src/__tests__/optimistic-transition.test.ts`
- `packages/iso/src/__tests__/optimistic-action-transition.test.ts`
- `packages/server/src/__tests__/loaders-handler-timeout.test.ts`
- `packages/server/src/__tests__/actions-handler-timeout.test.ts`

### PR2 — internal cleanup (Tasks 14-19)

**Created (tests, before refactor):**
- `packages/server/src/__tests__/sse-wire-snapshot.test.ts` — byte-equality snapshot against the current encoder output.

**Modified:**
- `packages/server/src/sse.ts` — rewrite `sseGeneratorResponse` and `sseReadableStreamResponse` on top of `ReadableStream.from` + a `TransformStream`-based SSE encoder. Remove the `hono/streaming` import.
- `packages/iso/src/internal/sse-decoder.ts` — rewrite `readSSE` on top of `TextDecoderStream` + a line-splitting `TransformStream`. Yields the same `SSEEvent` shape.

**Created (more tests):**
- `packages/server/src/__tests__/sse-backpressure.test.ts`
- `packages/iso/src/internal/__tests__/sse-decoder-pipeline.test.ts`

---

## PR1 — public API

### Task 1: Add `TimeoutOutcome` to the outcome envelope

**Files:**
- Modify: `packages/iso/src/outcomes.ts`
- Test: `packages/iso/src/__tests__/outcomes-timeout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/outcomes-timeout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { timeoutOutcome, isTimeout, isOutcome } from '../outcomes.js';

describe('timeoutOutcome', () => {
  it('constructs a timeout outcome with the given timeoutMs', () => {
    const o = timeoutOutcome(30000);
    expect(o).toEqual({ __outcome: 'timeout', kind: 'timeout', timeoutMs: 30000 });
  });

  it('isTimeout narrows correctly', () => {
    const o: unknown = timeoutOutcome(5000);
    expect(isTimeout(o)).toBe(true);
    expect(isTimeout({ __outcome: 'deny' })).toBe(false);
    expect(isTimeout(null)).toBe(false);
    expect(isTimeout(undefined)).toBe(false);
  });

  it('isOutcome recognizes timeout', () => {
    expect(isOutcome(timeoutOutcome(1000))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/outcomes-timeout.test.ts`
Expected: FAIL — `timeoutOutcome` and `isTimeout` are not exported.

- [ ] **Step 3: Add the outcome type and helpers**

In `packages/iso/src/outcomes.ts`, after the `RenderOutcome` declaration, add:

```ts
export type TimeoutOutcome = {
  __outcome: 'timeout';
  kind: 'timeout';
  timeoutMs: number;
};
```

Change the `Outcome` union to include `TimeoutOutcome`:

```ts
export type Outcome = RedirectOutcome | DenyOutcome | RenderOutcome | TimeoutOutcome;
```

Update `isOutcome`'s tag check to accept `'timeout'`:

```ts
export function isOutcome(value: unknown): value is Outcome {
  if (typeof value !== 'object' || value === null) return false;
  if (!('__outcome' in value)) return false;
  const tag = (value as { __outcome: unknown }).__outcome;
  return tag === 'redirect' || tag === 'deny' || tag === 'render' || tag === 'timeout';
}
```

Append at the bottom of the file:

```ts
export function timeoutOutcome(timeoutMs: number): TimeoutOutcome {
  return { __outcome: 'timeout', kind: 'timeout', timeoutMs };
}

export function isTimeout(value: unknown): value is TimeoutOutcome {
  return isOutcome(value) && value.__outcome === 'timeout';
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/outcomes-timeout.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the public package barrel exports the new symbols**

Run: `grep -n "TimeoutOutcome\|timeoutOutcome\|isTimeout" packages/iso/src/index.ts packages/hono-preact/src/index.ts 2>/dev/null`

If `outcomes.ts` re-exports are wildcard, nothing to do. Otherwise add `TimeoutOutcome`, `timeoutOutcome`, `isTimeout` to the explicit lists. Check both `packages/iso/src/index.ts` (the internal entry) and `packages/hono-preact/src/index.ts` (the public package). Add explicit exports if needed.

Verify by running:

```bash
pnpm --filter @hono-preact/iso exec tsc --noEmit
pnpm --filter hono-preact exec tsc --noEmit
```

Both should pass with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/outcomes.ts packages/iso/src/__tests__/outcomes-timeout.test.ts
# also stage any index.ts updates from Step 5
git status --short
git commit -m "feat(iso): add TimeoutOutcome to the outcome envelope"
```

---

### Task 2: Add `timeoutMs` to `defineLoader`

**Files:**
- Modify: `packages/iso/src/define-loader.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/define-loader-timeout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';

describe('defineLoader timeoutMs', () => {
  it('defaults timeoutMs to undefined when not specified', () => {
    const ref = defineLoader(async () => 1);
    expect(ref.timeoutMs).toBeUndefined();
  });

  it('stores the provided timeoutMs on the ref', () => {
    const ref = defineLoader(async () => 1, { timeoutMs: 5000 });
    expect(ref.timeoutMs).toBe(5000);
  });

  it('accepts false to disable', () => {
    const ref = defineLoader(async () => 1, { timeoutMs: false });
    expect(ref.timeoutMs).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-loader-timeout.test.ts`
Expected: FAIL — `ref.timeoutMs` is undefined on the type and on the runtime ref.

- [ ] **Step 3: Add the option and field**

In `packages/iso/src/define-loader.ts`, add `timeoutMs` to `LoaderRef` (between `params` and `use`):

```ts
export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly __moduleKey?: string;
  readonly __loaderName?: string;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  readonly params: string[] | '*';
  readonly timeoutMs?: number | false;
  readonly use: ReadonlyArray<Middleware | StreamObserver<unknown, never>>;
  // ... rest unchanged
}
```

Add `timeoutMs` to `DefineLoaderOpts<T>`:

```ts
export type DefineLoaderOpts<T> = {
  __moduleKey?: string;
  __loaderName?: string;
  cache?: LoaderCache<T>;
  params?: string[] | '*';
  /**
   * Per-loader timeout in milliseconds. When omitted, the handler applies
   * its configured default (30s). Pass `false` to disable the timeout for
   * this loader (rely solely on the request signal).
   */
  timeoutMs?: number | false;
  use?: LoaderUse<T, boolean>;
};
```

In the ref construction (inside `defineLoader`), add the field:

```ts
const ref: LoaderRef<T> = {
  __id,
  __moduleKey: opts?.__moduleKey,
  __loaderName: opts?.__loaderName,
  fn,
  cache: cache!,
  params: opts?.params ?? [],
  timeoutMs: opts?.timeoutMs,
  use: (opts?.use ?? []) as ReadonlyArray<
    Middleware | StreamObserver<unknown, never>
  >,
  // ... rest unchanged
};
```

- [ ] **Step 4: Run the test, expect pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-loader-timeout.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hono-preact/iso exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/define-loader-timeout.test.ts
git commit -m "feat(iso): defineLoader accepts timeoutMs option"
```

---

### Task 3: Add `timeoutMs` to `defineAction`

**Files:**
- Modify: `packages/iso/src/action.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/define-action-timeout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineAction } from '../action.js';

describe('defineAction timeoutMs', () => {
  it('does not attach timeoutMs when option is omitted', () => {
    const stub = defineAction(async (_ctx, _payload) => 1);
    expect((stub as { timeoutMs?: unknown }).timeoutMs).toBeUndefined();
  });

  it('attaches timeoutMs as a non-enumerable property', () => {
    const stub = defineAction(async (_ctx, _payload) => 1, { timeoutMs: 5000 });
    expect((stub as { timeoutMs?: unknown }).timeoutMs).toBe(5000);
    const desc = Object.getOwnPropertyDescriptor(stub, 'timeoutMs');
    expect(desc?.enumerable).toBe(false);
  });

  it('accepts false to disable', () => {
    const stub = defineAction(async (_ctx, _payload) => 1, { timeoutMs: false });
    expect((stub as { timeoutMs?: unknown }).timeoutMs).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-action-timeout.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend `DefineActionOpts` and attach the property**

In `packages/iso/src/action.ts`, add to `DefineActionOpts<TChunk, TResult>`:

```ts
export type DefineActionOpts<TChunk = never, TResult = unknown> = {
  use?: ActionUse<TChunk, TResult, boolean>;
  /**
   * Per-action timeout in milliseconds. When omitted, the handler applies
   * its configured default (30s). Pass `false` to disable the timeout for
   * this action.
   */
  timeoutMs?: number | false;
};
```

Inside `defineAction`, after the existing `if (opts?.use)` block, add:

```ts
if (opts?.timeoutMs !== undefined) {
  Object.defineProperty(fn, 'timeoutMs', {
    value: opts.timeoutMs,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-action-timeout.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hono-preact/iso exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/action.ts packages/iso/src/__tests__/define-action-timeout.test.ts
git commit -m "feat(iso): defineAction accepts timeoutMs option"
```

---

### Task 4: Loaders-handler — compose AbortSignal with timeout, translate `TimeoutError` to outcome

**Files:**
- Modify: `packages/server/src/loaders-handler.ts`
- Test: `packages/server/src/__tests__/loaders-handler-timeout.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/__tests__/loaders-handler-timeout.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { loadersHandler } from '../loaders-handler.js';
import { defineLoader, isTimeout } from '@hono-preact/iso';

function makeApp(glob: Parameters<typeof loadersHandler>[0]) {
  const app = new Hono();
  app.post('/__loaders', loadersHandler(glob));
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request('http://localhost/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const location = { path: '/', pathParams: {}, searchParams: {} };

describe('loadersHandler timeouts', () => {
  it('returns a timeout outcome when the loader exceeds its timeoutMs', async () => {
    const ref = defineLoader(
      async ({ signal }) => {
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        return 'never';
      },
      { __moduleKey: 'slow', __loaderName: 'list', timeoutMs: 50 }
    );

    const app = makeApp({
      './pages/slow.server.ts': {
        __moduleKey: 'slow',
        serverLoaders: { list: ref },
      },
    });

    const res = await post(app, { module: 'slow', loader: 'list', location });
    expect(res.status).toBe(504);
    const body = (await res.json()) as unknown;
    expect(isTimeout(body)).toBe(true);
    expect((body as { timeoutMs: number }).timeoutMs).toBe(50);
  });

  it('uses the handler default when timeoutMs is undefined', async () => {
    let observedSignal: AbortSignal | undefined;
    const ref = defineLoader(
      async ({ signal }) => {
        observedSignal = signal;
        return 'ok';
      },
      { __moduleKey: 'fast', __loaderName: 'list' }
    );

    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler(
        {
          './pages/fast.server.ts': {
            __moduleKey: 'fast',
            serverLoaders: { list: ref },
          },
        },
        { defaultTimeoutMs: 25_000 }
      )
    );

    const res = await app.request('http://localhost/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'fast', loader: 'list', location }),
    });

    expect(res.status).toBe(200);
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    // The composed signal should be live but not aborted for a fast loader.
    expect(observedSignal?.aborted).toBe(false);
  });

  it('disables the timeout when timeoutMs is false', async () => {
    let aborted = false;
    const ref = defineLoader(
      async ({ signal }) => {
        // Wait 100ms then succeed. If the handler default (e.g. 30s) is wrong,
        // this test still completes quickly.
        await new Promise((resolve) => setTimeout(resolve, 100));
        aborted = signal.aborted;
        return 'ok';
      },
      { __moduleKey: 'untimed', __loaderName: 'list', timeoutMs: false }
    );

    const app = makeApp({
      './pages/untimed.server.ts': {
        __moduleKey: 'untimed',
        serverLoaders: { list: ref },
      },
    });

    const res = await post(app, { module: 'untimed', loader: 'list', location });
    expect(res.status).toBe(200);
    expect(aborted).toBe(false);
  });

  it('signal.reason inside the loader is a TimeoutError DOMException', async () => {
    let observedReason: unknown;
    const ref = defineLoader(
      async ({ signal }) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              observedReason = signal.reason;
              resolve();
            },
            { once: true }
          );
        });
        return 'never';
      },
      { __moduleKey: 'slow2', __loaderName: 'list', timeoutMs: 50 }
    );

    const app = makeApp({
      './pages/slow2.server.ts': {
        __moduleKey: 'slow2',
        serverLoaders: { list: ref },
      },
    });

    await post(app, { module: 'slow2', loader: 'list', location });
    expect(observedReason).toBeInstanceOf(DOMException);
    expect((observedReason as DOMException).name).toBe('TimeoutError');
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/loaders-handler-timeout.test.ts`
Expected: all FAIL — handler does not yet compose a timeout signal and does not translate `TimeoutError` to an outcome.

- [ ] **Step 3: Update `LoaderEntry` and `buildLoadersMap` to carry `timeoutMs`**

In `packages/server/src/loaders-handler.ts`, change the `LoaderEntry` type:

```ts
type LoaderEntry = {
  fn: LoaderFn;
  use: ReadonlyArray<unknown>;
  timeoutMs?: number | false;
};
```

Update the LoaderRef branch in `buildLoadersMap` (in the inner `for` loop, where `val` is detected as a LoaderRef):

```ts
} else if (val && typeof (val as { fn?: unknown }).fn === 'function') {
  const ref = val as {
    fn: LoaderFn;
    use?: ReadonlyArray<unknown>;
    timeoutMs?: number | false;
  };
  result[`${moduleKey}::${name}`] = {
    fn: ref.fn,
    use: ref.use ?? [],
    timeoutMs: ref.timeoutMs,
  };
}
```

(Leave the raw-function branch unchanged: those test-only fixtures use the handler default.)

- [ ] **Step 4: Add `defaultTimeoutMs` to `LoadersHandlerOptions` and translate timeouts**

In `packages/server/src/loaders-handler.ts`, add to `LoadersHandlerOptions`:

```ts
export interface LoadersHandlerOptions {
  dev?: boolean;
  onError?: (err: unknown, ctx: { module: string; loader: string }) => void;
  appConfig?: AppConfig;
  resolvePageUse?: (
    path: string
  ) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;
  /**
   * Default loader timeout in milliseconds applied when a loader does not
   * declare its own `timeoutMs`. Defaults to 30000 (30 seconds). Pass
   * `false` to disable the default (only loader-level `timeoutMs` enforces
   * a deadline).
   */
  defaultTimeoutMs?: number | false;
}
```

Update the destructure at the top of `loadersHandler` to read it:

```ts
const {
  dev = false,
  onError,
  appConfig,
  resolvePageUse,
  defaultTimeoutMs = 30_000,
} = opts;
```

Update `translateOutcomeForLoader` to handle the timeout variant:

```ts
function translateOutcomeForLoader(c: Context, outcome: Outcome): Response {
  if (outcome.__outcome === 'redirect') {
    if (outcome.headers) {
      for (const [k, v] of Object.entries(outcome.headers)) c.header(k, v);
    }
    return c.json(
      { __outcome: 'redirect', to: outcome.to, status: outcome.status },
      200
    );
  }
  if (outcome.__outcome === 'deny') {
    if (outcome.headers) {
      for (const [k, v] of Object.entries(outcome.headers)) c.header(k, v);
    }
    return c.json(
      { __outcome: 'deny', message: outcome.message },
      outcome.status
    );
  }
  if (outcome.__outcome === 'timeout') {
    return c.json(
      { __outcome: 'timeout', kind: 'timeout', timeoutMs: outcome.timeoutMs },
      504
    );
  }
  return c.json(
    { __outcome: 'error', message: 'render outcome is page-scope only' },
    500
  );
}
```

Replace the `const signal = c.req.raw.signal;` line (around the middle of the inner handler) with signal composition. The composition needs to happen AFTER `entry` is resolved so we know its `timeoutMs`. Find the block that currently reads:

```ts
    const signal = c.req.raw.signal;

    // Chain ordering is outer -> inner: ...
```

Replace with:

```ts
    const resolvedTimeoutMs =
      entry.timeoutMs !== undefined ? entry.timeoutMs : defaultTimeoutMs;
    const timeoutSignal =
      resolvedTimeoutMs === false || resolvedTimeoutMs === undefined
        ? undefined
        : AbortSignal.timeout(resolvedTimeoutMs);
    const signal = timeoutSignal
      ? AbortSignal.any([c.req.raw.signal, timeoutSignal])
      : c.req.raw.signal;

    // Chain ordering is outer -> inner: ...
```

Import `timeoutOutcome` at the top:

```ts
import {
  isOutcome,
  timeoutOutcome,
  type AppConfig,
  type Outcome,
  type ServerMiddleware,
  type ServerLoaderCtx,
  type Middleware,
  type StreamObserver,
} from '@hono-preact/iso';
```

In the `} catch (err) {` block at the bottom of the handler, replace the existing body:

```ts
    } catch (err) {
      if (isOutcome(err)) {
        return translateOutcomeForLoader(c, err);
      }
      // Distinguish a deadline-driven abort from any other thrown error.
      // AbortSignal.timeout sets signal.reason to a DOMException named
      // 'TimeoutError'; AbortSignal.any propagates that reason. Re-check the
      // composed signal because the loader's own throw may be the
      // *consequence* of the signal aborting (e.g. fetch rejecting with the
      // abort reason).
      if (
        timeoutSignal?.aborted &&
        timeoutSignal.reason instanceof DOMException &&
        timeoutSignal.reason.name === 'TimeoutError' &&
        typeof resolvedTimeoutMs === 'number'
      ) {
        return translateOutcomeForLoader(c, timeoutOutcome(resolvedTimeoutMs));
      }
      onError?.(err, { module, loader: loaderName });
      const message =
        dev && err instanceof Error ? err.message : 'Loader failed';
      return c.json({ error: message }, 500);
    }
```

- [ ] **Step 5: Run the tests, expect pass**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/loaders-handler-timeout.test.ts`
Expected: all PASS.

- [ ] **Step 6: Run the full server test suite to catch regressions**

Run: `pnpm --filter @hono-preact/server exec vitest run`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/loaders-handler.ts packages/server/src/__tests__/loaders-handler-timeout.test.ts
git commit -m "feat(server): loaders-handler enforces timeoutMs and returns a timeout outcome"
```

---

### Task 5: Actions-handler — same composition and translation

**Files:**
- Modify: `packages/server/src/actions-handler.ts`
- Test: `packages/server/src/__tests__/actions-handler-timeout.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/__tests__/actions-handler-timeout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { actionsHandler } from '../actions-handler.js';
import { defineAction, isTimeout } from '@hono-preact/iso';

function makeApp(glob: Parameters<typeof actionsHandler>[0]) {
  const app = new Hono();
  app.post('/__actions', actionsHandler(glob));
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request('http://localhost/__actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('actionsHandler timeouts', () => {
  it('returns a timeout outcome when the action exceeds its timeoutMs', async () => {
    const create = defineAction(
      async ({ signal }) => {
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
        return { id: 1 };
      },
      { timeoutMs: 50 }
    );

    const app = makeApp({
      './pages/slow.server.ts': {
        __moduleKey: 'slow',
        serverActions: { create },
      },
    });

    const res = await post(app, {
      module: 'slow',
      action: 'create',
      payload: {},
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as unknown;
    expect(isTimeout(body)).toBe(true);
    expect((body as { timeoutMs: number }).timeoutMs).toBe(50);
  });

  it('uses defaultTimeoutMs when the action does not declare one', async () => {
    let observedSignal: AbortSignal | undefined;
    const create = defineAction(async ({ signal }) => {
      observedSignal = signal;
      return { ok: true };
    });

    const app = new Hono();
    app.post(
      '/__actions',
      actionsHandler(
        {
          './pages/fast.server.ts': {
            __moduleKey: 'fast',
            serverActions: { create },
          },
        },
        { defaultTimeoutMs: 25_000 }
      )
    );

    const res = await app.request('http://localhost/__actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'fast', action: 'create', payload: {} }),
    });

    expect(res.status).toBe(200);
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(false);
  });

  it('disables the timeout when timeoutMs is false', async () => {
    const create = defineAction(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ok: true };
      },
      { timeoutMs: false }
    );

    const app = makeApp({
      './pages/untimed.server.ts': {
        __moduleKey: 'untimed',
        serverActions: { create },
      },
    });

    const res = await post(app, {
      module: 'untimed',
      action: 'create',
      payload: {},
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/actions-handler-timeout.test.ts`
Expected: all FAIL.

- [ ] **Step 3: Apply the same edits to `actions-handler.ts`**

In `packages/server/src/actions-handler.ts`:

1. Update the import:

```ts
import {
  isOutcome,
  timeoutOutcome,
  type AppConfig,
  type Outcome,
  type ServerMiddleware,
  type ServerActionCtx,
  type Middleware,
  type StreamObserver,
} from '@hono-preact/iso';
```

2. Extend `translateOutcomeForAction` with a timeout case (mirror of Task 4):

```ts
  if (outcome.__outcome === 'timeout') {
    return c.json(
      { __outcome: 'timeout', kind: 'timeout', timeoutMs: outcome.timeoutMs },
      504
    );
  }
```

(Insert before the trailing `render` defense.)

3. Extend `ActionsHandlerOptions`:

```ts
export interface ActionsHandlerOptions {
  dev?: boolean;
  onError?: (err: unknown, ctx: { module: string; action: string }) => void;
  appConfig?: AppConfig;
  resolvePageUse?: (
    moduleKey: string
  ) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;
  /**
   * Default action timeout in milliseconds applied when an action does not
   * declare its own `timeoutMs`. Defaults to 30000 (30 seconds). Pass
   * `false` to disable the default.
   */
  defaultTimeoutMs?: number | false;
}
```

4. Read it in the destructure:

```ts
const {
  dev = false,
  onError,
  appConfig,
  resolvePageUse,
  defaultTimeoutMs = 30_000,
} = opts;
```

5. Compose the signal. Find the block that currently reads:

```ts
    const signal = c.req.raw.signal;
    const actionCtx = { c, signal };
```

Replace with (note `fn` and `entry` are already resolved at this point in the handler):

```ts
    const actionTimeoutMs = (fn as { timeoutMs?: number | false }).timeoutMs;
    const resolvedTimeoutMs =
      actionTimeoutMs !== undefined ? actionTimeoutMs : defaultTimeoutMs;
    const timeoutSignal =
      resolvedTimeoutMs === false || resolvedTimeoutMs === undefined
        ? undefined
        : AbortSignal.timeout(resolvedTimeoutMs);
    const signal = timeoutSignal
      ? AbortSignal.any([c.req.raw.signal, timeoutSignal])
      : c.req.raw.signal;
    const actionCtx = { c, signal };
```

6. Update the `} catch (err) {` block to detect TimeoutError:

```ts
    } catch (err) {
      if (isOutcome(err)) {
        return translateOutcomeForAction(c, err);
      }
      if (
        timeoutSignal?.aborted &&
        timeoutSignal.reason instanceof DOMException &&
        timeoutSignal.reason.name === 'TimeoutError' &&
        typeof resolvedTimeoutMs === 'number'
      ) {
        return translateOutcomeForAction(c, timeoutOutcome(resolvedTimeoutMs));
      }
      onError?.(err, { module, action });
      const message =
        dev && err instanceof Error ? err.message : 'Action failed';
      return c.json({ error: message }, 500);
    }
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/actions-handler-timeout.test.ts`
Expected: all PASS.

- [ ] **Step 5: Run the full server test suite**

Run: `pnpm --filter @hono-preact/server exec vitest run`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/actions-handler.ts packages/server/src/__tests__/actions-handler-timeout.test.ts
git commit -m "feat(server): actions-handler enforces timeoutMs and returns a timeout outcome"
```

---

### Task 6: Mid-stream timeout — SSE pump emits `event: timeout`

**Files:**
- Modify: `packages/server/src/sse.ts`
- Test: `packages/server/src/__tests__/sse-mid-stream-timeout.test.ts`

This task handles the case where a streaming loader/action has already started flushing chunks when the timeout fires. Pre-stream timeouts (Task 4/5) are already covered by the handler's catch block. Mid-stream timeouts need the SSE pump to emit a `timeout` frame instead of a generic `error` frame.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/sse-mid-stream-timeout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { loadersHandler } from '../loaders-handler.js';
import { defineLoader } from '@hono-preact/iso';
import { readSSE } from '@hono-preact/iso/internal';

const location = { path: '/', pathParams: {}, searchParams: {} };

describe('sse mid-stream timeout', () => {
  it('emits event: timeout when the timeout fires after the stream has started', async () => {
    const ref = defineLoader(
      async function* ({ signal }) {
        yield 'first';
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        // Re-throw after abort so the SSE pump enters its catch path with
        // the timeout reason live on the composed signal.
        throw signal.reason;
      },
      { __moduleKey: 'streamy', __loaderName: 'list', timeoutMs: 75 }
    );

    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler({
        './pages/streamy.server.ts': {
          __moduleKey: 'streamy',
          serverLoaders: { list: ref },
        },
      })
    );

    const res = await app.request('http://localhost/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'streamy', loader: 'list', location }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events: { event: string; data: string }[] = [];
    if (res.body) {
      for await (const ev of readSSE(res.body)) events.push(ev);
    }

    expect(events.some((e) => e.event === 'message' && e.data === '"first"')).toBe(true);
    const timeoutEvent = events.find((e) => e.event === 'timeout');
    expect(timeoutEvent).toBeDefined();
    expect(JSON.parse(timeoutEvent!.data)).toMatchObject({
      kind: 'timeout',
      timeoutMs: 75,
    });
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sse-mid-stream-timeout.test.ts`
Expected: FAIL — pump emits `event: error` instead of `event: timeout`.

- [ ] **Step 3: Thread `timeoutMs` and the composed signal into the SSE pump**

The simplest change keeps `sse.ts`'s call surface stable: add an optional `timeoutMs` to `SseGeneratorOptions` and use it together with `signal.reason` detection. Update `packages/server/src/sse.ts`:

```ts
export type SseGeneratorOptions = {
  emitResult?: boolean;
  observers?: ReadonlyArray<StreamObserver<unknown, never>>;
  observerCtx?: ServerStreamCtx;
  /**
   * The composed signal whose `reason` is inspected in the catch path to
   * distinguish a deadline-driven abort from a generic throw. When the
   * signal has aborted with a `TimeoutError` DOMException, the pump emits
   * `event: timeout` with `{ kind: 'timeout', timeoutMs }` instead of the
   * generic `event: error` frame.
   */
  signal?: AbortSignal;
  /** Used only with `signal`; the timeout value reported in the frame. */
  timeoutMs?: number;
};
```

Add a small helper at the top of `sse.ts`:

```ts
function isTimeoutAbort(signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted &&
      signal.reason instanceof DOMException &&
      signal.reason.name === 'TimeoutError'
  );
}
```

Update the `catch (err) {` block inside `sseGeneratorResponse` to emit a `timeout` frame when applicable. Replace the current catch body:

```ts
    } catch (err) {
      await gen.return(undefined).catch(() => {
        /* swallow */
      });
      if (started && observerCtx) {
        fanError(obs, observerCtx, err, { chunks });
      }
      if (isTimeoutAbort(options.signal) && typeof options.timeoutMs === 'number') {
        await stream.writeSSE({
          event: 'timeout',
          data: JSON.stringify({
            kind: 'timeout',
            timeoutMs: options.timeoutMs,
          }),
        });
      } else {
        await stream.writeSSE({
          event: 'error',
          data: encodeErrorPayload(err),
        });
      }
    }
```

Do the same in `sseReadableStreamResponse`, accepting the same two options (`signal`, `timeoutMs`) and emitting `event: timeout` from its catch block.

- [ ] **Step 4: Thread the signal and timeoutMs from the handlers**

In `packages/server/src/loaders-handler.ts`, update the two `sseGeneratorResponse` / `sseReadableStreamResponse` call sites in the success path:

```ts
      if (isAsyncGenerator(result)) {
        return sseGeneratorResponse(c, result, {
          emitResult: false,
          observers,
          observerCtx: ctx,
          signal: timeoutSignal,
          timeoutMs:
            typeof resolvedTimeoutMs === 'number' ? resolvedTimeoutMs : undefined,
        });
      }
      if (result instanceof ReadableStream) {
        return sseReadableStreamResponse(c, result as ReadableStream<unknown>, {
          observers,
          observerCtx: ctx,
          signal: timeoutSignal,
          timeoutMs:
            typeof resolvedTimeoutMs === 'number' ? resolvedTimeoutMs : undefined,
        });
      }
```

Make the equivalent change in `packages/server/src/actions-handler.ts`.

- [ ] **Step 5: Run the test, expect pass**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sse-mid-stream-timeout.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full server test suite**

Run: `pnpm --filter @hono-preact/server exec vitest run`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/sse.ts packages/server/src/loaders-handler.ts packages/server/src/actions-handler.ts packages/server/src/__tests__/sse-mid-stream-timeout.test.ts
git commit -m "feat(server): emit event: timeout for mid-stream loader/action timeouts"
```

---

### Task 7: Client — handle the timeout outcome and SSE `event: timeout`

**Files:**
- Modify: `packages/iso/src/action.ts`
- Test: `packages/iso/src/__tests__/use-action-timeout.test.ts`

The loader-fetch path and the action-fetch path both need to recognize the new envelope. Action client lives in `action.ts`; the loader client lives in `internal/loader-fetch.ts`. This task handles the action side; Task 8 handles the loader side.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/use-action-timeout.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { defineAction, useAction } from '../action.js';

const originalFetch = global.fetch;

describe('useAction timeout handling', () => {
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it('surfaces a timeout envelope (504 with __outcome: timeout) as an error tagged kind: timeout', async () => {
    const stub = defineAction(async () => 1) as ReturnType<typeof defineAction>;
    (stub as unknown as { __module: string; __action: string }).__module = 'm';
    (stub as unknown as { __module: string; __action: string }).__action = 'a';

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ __outcome: 'timeout', kind: 'timeout', timeoutMs: 5000 }),
        { status: 504, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { result } = renderHook(() => useAction(stub));
    let mutated: Awaited<ReturnType<typeof result.current.mutate>>;
    await act(async () => {
      mutated = await result.current.mutate({});
    });
    expect(mutated!.ok).toBe(false);
    if (!mutated!.ok) {
      expect(mutated!.error.name).toBe('TimeoutError');
      expect((mutated!.error as Error & { kind?: string; timeoutMs?: number }).kind).toBe('timeout');
      expect((mutated!.error as Error & { timeoutMs?: number }).timeoutMs).toBe(5000);
    }
  });

  it('surfaces an SSE event: timeout frame as a TimeoutError', async () => {
    const stub = defineAction(async () => 1) as ReturnType<typeof defineAction>;
    (stub as unknown as { __module: string; __action: string }).__module = 'm';
    (stub as unknown as { __module: string; __action: string }).__action = 'a';

    const body =
      'event: message\ndata: "tick"\n\n' +
      'event: timeout\ndata: {"kind":"timeout","timeoutMs":75}\n\n';
    global.fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const { result } = renderHook(() => useAction(stub));
    let mutated: Awaited<ReturnType<typeof result.current.mutate>>;
    await act(async () => {
      mutated = await result.current.mutate({});
    });
    expect(mutated!.ok).toBe(false);
    if (!mutated!.ok) {
      expect(mutated!.error.name).toBe('TimeoutError');
      expect((mutated!.error as Error & { kind?: string }).kind).toBe('timeout');
      expect((mutated!.error as Error & { timeoutMs?: number }).timeoutMs).toBe(75);
    }
  });
});
```

If `@testing-library/preact` is not already a devDependency, install it:

```bash
pnpm --filter @hono-preact/iso add -D @testing-library/preact
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/use-action-timeout.test.ts`
Expected: FAIL — `useAction` does not yet recognize the timeout envelope.

- [ ] **Step 3: Add a TimeoutError class and handle both paths**

At the top of `packages/iso/src/action.ts`, after the imports, add:

```ts
class TimeoutError extends Error {
  readonly kind = 'timeout' as const;
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
```

In `useAction`'s `mutate` callback, change the existing `!response.ok` branch to detect `__outcome === 'timeout'`. Replace:

```ts
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
            __outcome?: string;
            message?: string;
          };
          let msg: string;
          if (body.__outcome === 'deny') {
            msg =
              typeof body.message === 'string'
                ? body.message
                : `Request denied (${response.status})`;
          } else {
            msg = body.error ?? `Action failed with status ${response.status}`;
          }
          throw new Error(msg);
        }
```

with:

```ts
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
            __outcome?: string;
            message?: string;
            timeoutMs?: number;
          };
          if (
            body.__outcome === 'timeout' &&
            typeof body.timeoutMs === 'number'
          ) {
            throw new TimeoutError(body.timeoutMs);
          }
          let msg: string;
          if (body.__outcome === 'deny') {
            msg =
              typeof body.message === 'string'
                ? body.message
                : `Request denied (${response.status})`;
          } else {
            msg = body.error ?? `Action failed with status ${response.status}`;
          }
          throw new Error(msg);
        }
```

In the SSE consumption loop further down, add a `timeout` event branch alongside `message`, `result`, `error`. Replace the existing chain `else if (ev.event === 'error')` block by inserting before it:

```ts
            } else if (ev.event === 'timeout') {
              try {
                const parsed = JSON.parse(ev.data) as { timeoutMs?: number };
                streamError = new TimeoutError(parsed.timeoutMs ?? 0);
              } catch (e) {
                streamError = new Error(
                  `Malformed timeout event in stream: ${e instanceof Error ? e.message : String(e)}`
                );
              }
            } else if (ev.event === 'error') {
```

Export the class:

```ts
export { TimeoutError };
```

- [ ] **Step 4: Run the test, expect pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/use-action-timeout.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify barrel exports**

Run: `grep -n "TimeoutError" packages/iso/src/index.ts packages/hono-preact/src/index.ts 2>/dev/null`

If `TimeoutError` is not re-exported, add it next to existing action exports.

Run: `pnpm --filter @hono-preact/iso exec tsc --noEmit && pnpm --filter hono-preact exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/action.ts packages/iso/src/__tests__/use-action-timeout.test.ts
# stage any index updates too
git commit -m "feat(iso): useAction surfaces TimeoutError on 504 timeout outcomes and SSE timeout events"
```

---

### Task 8: Loader-fetch — same envelope handling

**Files:**
- Modify: `packages/iso/src/internal/loader-fetch.ts`
- Test: `packages/iso/src/internal/__tests__/loader-fetch-timeout.test.ts`

- [ ] **Step 1: Read the current loader-fetch implementation to learn its shape**

Run: `cat packages/iso/src/internal/loader-fetch.ts`

Note the public function name and its current error-path branches. The remaining steps assume the function is called `fetchLoaderData` and it currently throws an `Error` on non-OK responses; adjust step 3's edits to match the actual current code paths.

- [ ] **Step 2: Write the failing test**

Create `packages/iso/src/internal/__tests__/loader-fetch-timeout.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchLoaderData } from '../loader-fetch.js';
import { TimeoutError } from '../../action.js';

const originalFetch = global.fetch;

describe('fetchLoaderData timeout handling', () => {
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it('throws TimeoutError when the server returns a 504 timeout outcome', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ __outcome: 'timeout', kind: 'timeout', timeoutMs: 7000 }),
        { status: 504, headers: { 'Content-Type': 'application/json' } }
      )
    );

    let thrown: unknown;
    try {
      await fetchLoaderData({
        module: 'm',
        loader: 'l',
        location: { path: '/', pathParams: {}, searchParams: {} },
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TimeoutError);
    expect((thrown as TimeoutError).timeoutMs).toBe(7000);
  });

  it('throws TimeoutError when a streaming response emits event: timeout', async () => {
    const body =
      'event: message\ndata: "first"\n\n' +
      'event: timeout\ndata: {"kind":"timeout","timeoutMs":120}\n\n';
    global.fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    let thrown: unknown;
    try {
      // For streaming loaders the public consumer fully drains the stream.
      // If the project's fetchLoaderData returns an async iterator, adapt
      // the assertion to drain it; otherwise expect the await to reject.
      const result = await fetchLoaderData({
        module: 'm',
        loader: 'l',
        location: { path: '/', pathParams: {}, searchParams: {} },
      });
      if (result && typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
        for await (const _ of result as AsyncIterable<unknown>) {
          /* drain */
        }
      }
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TimeoutError);
    expect((thrown as TimeoutError).timeoutMs).toBe(120);
  });
});
```

(Adjust the test to the actual `fetchLoaderData` signature observed in Step 1.)

- [ ] **Step 3: Run the test, expect failure**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/loader-fetch-timeout.test.ts`
Expected: FAIL.

- [ ] **Step 4: Mirror the action-side envelope handling**

In `packages/iso/src/internal/loader-fetch.ts`, import `TimeoutError`:

```ts
import { TimeoutError } from '../action.js';
```

In the non-OK response branch, before falling through to the generic error, peek at `__outcome === 'timeout'` and throw `TimeoutError`. The pattern is:

```ts
if (!response.ok) {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    __outcome?: string;
    message?: string;
    timeoutMs?: number;
  };
  if (body.__outcome === 'timeout' && typeof body.timeoutMs === 'number') {
    throw new TimeoutError(body.timeoutMs);
  }
  // existing handling: deny, generic error
  // ...
}
```

In the SSE consumption loop, add a `'timeout'` branch alongside the existing event handlers — same shape as Task 7 step 3.

- [ ] **Step 5: Run the test, expect pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/loader-fetch-timeout.test.ts`
Expected: PASS.

- [ ] **Step 6: Full iso test suite**

Run: `pnpm --filter @hono-preact/iso exec vitest run`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/loader-fetch.ts packages/iso/src/internal/__tests__/loader-fetch-timeout.test.ts
git commit -m "feat(iso): loader-fetch surfaces TimeoutError on 504 outcomes and SSE timeout events"
```

---

### Task 9: `useOptimistic` accepts `{ transition }` and wraps settle/revert

**Files:**
- Modify: `packages/iso/src/optimistic.ts`
- Test: `packages/iso/src/__tests__/optimistic-transition.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/iso/src/__tests__/optimistic-transition.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useOptimistic } from '../optimistic.js';

declare global {
  interface Document {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  }
}

describe('useOptimistic transition option', () => {
  let originalSVT: typeof document.startViewTransition | undefined;

  beforeEach(() => {
    originalSVT = document.startViewTransition;
  });
  afterEach(() => {
    if (originalSVT === undefined) {
      delete (document as { startViewTransition?: unknown }).startViewTransition;
    } else {
      document.startViewTransition = originalSVT;
    }
  });

  it('does not wrap settle/revert when transition is false (default)', () => {
    const spy = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    document.startViewTransition = spy as never;

    const { result } = renderHook(() =>
      useOptimistic<number, number>(0, (acc, p) => acc + p)
    );
    let handle!: ReturnType<typeof result.current[1]>;
    act(() => {
      handle = result.current[1](5);
    });
    act(() => handle.settle());
    act(() => {
      result.current[1](2).revert();
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('wraps settle and revert when transition is true, but not the initial mutate', () => {
    const spy = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    document.startViewTransition = spy as never;

    const { result } = renderHook(() =>
      useOptimistic<number, number>(0, (acc, p) => acc + p, { transition: true })
    );
    let handle!: ReturnType<typeof result.current[1]>;
    act(() => {
      handle = result.current[1](5);
    });
    // mutate path: no transition
    expect(spy).not.toHaveBeenCalled();
    act(() => handle.settle());
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => {
      const handle2 = result.current[1](3);
      handle2.revert();
    });
    // mutate (no), revert (yes) => one more call
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('no-ops gracefully when startViewTransition is unavailable', () => {
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    const { result } = renderHook(() =>
      useOptimistic<number, number>(0, (acc, p) => acc + p, { transition: true })
    );
    let handle!: ReturnType<typeof result.current[1]>;
    act(() => {
      handle = result.current[1](5);
    });
    act(() => handle.settle());
    expect(result.current[0]).toBe(5);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/optimistic-transition.test.ts`
Expected: FAIL — `useOptimistic` does not accept a third argument.

- [ ] **Step 3: Add the options parameter and wrap settle/revert**

In `packages/iso/src/optimistic.ts`, change the function signature and body:

```ts
export type UseOptimisticOptions = {
  /**
   * When true, the settle and revert paths are wrapped in
   * `document.startViewTransition`. The initial optimistic update is never
   * wrapped (it must paint same-frame). Falls back to a synchronous update
   * when `document.startViewTransition` is unavailable.
   */
  transition?: boolean;
};

export function useOptimistic<TBase, TPayload>(
  base: TBase,
  reducer: (current: TBase, payload: TPayload) => TBase,
  options?: UseOptimisticOptions
): [TBase, (payload: TPayload) => OptimisticHandle] {
  const queueRef = useRef<Entry<TPayload>[]>([]);
  const lastBaseRef = useRef(base);
  const idRef = useRef(0);
  const [, forceRender] = useReducer<number, void>((c) => c + 1, 0);
  const transitionRef = useRef(options?.transition === true);
  transitionRef.current = options?.transition === true;

  if (!Object.is(lastBaseRef.current, base)) {
    queueRef.current = queueRef.current.filter((e) => e.status !== 'ready');
    lastBaseRef.current = base;
  }

  const value = queueRef.current.reduce(
    (acc, e) => reducer(acc, e.payload),
    base
  );

  const runWithTransition = (mutator: () => void) => {
    if (
      transitionRef.current &&
      typeof document !== 'undefined' &&
      typeof document.startViewTransition === 'function'
    ) {
      document.startViewTransition(() => {
        mutator();
      });
    } else {
      mutator();
    }
  };

  const addOptimistic = useCallback((payload: TPayload): OptimisticHandle => {
    const id = ++idRef.current;
    queueRef.current = [...queueRef.current, { id, payload, status: 'active' }];
    forceRender();
    return {
      settle: () => {
        const entry = queueRef.current.find((e) => e.id === id);
        if (entry && entry.status === 'active') {
          runWithTransition(() => {
            entry.status = 'ready';
            forceRender();
          });
        }
      },
      revert: () => {
        runWithTransition(() => {
          queueRef.current = queueRef.current.filter((e) => e.id !== id);
          forceRender();
        });
      },
    };
  }, []);

  return [value, addOptimistic];
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/optimistic-transition.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm existing optimistic tests still pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/optimistic.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/optimistic.ts packages/iso/src/__tests__/optimistic-transition.test.ts
git commit -m "feat(iso): useOptimistic wraps settle/revert in startViewTransition when opted in"
```

---

### Task 10: `useOptimisticAction` forwards `{ transition }`

**Files:**
- Modify: `packages/iso/src/optimistic-action.ts`
- Test: `packages/iso/src/__tests__/optimistic-action-transition.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/optimistic-action-transition.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { defineAction } from '../action.js';
import { useOptimisticAction } from '../optimistic-action.js';

const originalFetch = global.fetch;

describe('useOptimisticAction transition forwarding', () => {
  let originalSVT: typeof document.startViewTransition | undefined;
  beforeEach(() => {
    originalSVT = document.startViewTransition;
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });
  afterEach(() => {
    if (originalSVT === undefined) {
      delete (document as { startViewTransition?: unknown }).startViewTransition;
    } else {
      document.startViewTransition = originalSVT;
    }
    global.fetch = originalFetch;
  });

  it('wraps settle in startViewTransition when transition: true', async () => {
    const spy = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    document.startViewTransition = spy as never;

    const stub = defineAction(async () => ({ ok: true })) as ReturnType<typeof defineAction>;
    (stub as unknown as { __module: string; __action: string }).__module = 'm';
    (stub as unknown as { __module: string; __action: string }).__action = 'a';

    const { result } = renderHook(() =>
      useOptimisticAction<{}, { ok: true }, number>(stub, {
        base: 0,
        apply: (acc) => acc + 1,
        transition: true,
      })
    );

    await act(async () => {
      await result.current.mutate({});
    });
    // Initial mutate: no transition. onSuccess -> settle: one transition.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/optimistic-action-transition.test.ts`
Expected: FAIL — `transition` is not in `UseOptimisticActionOptions`.

- [ ] **Step 3: Forward `transition` through the option type**

In `packages/iso/src/optimistic-action.ts`, change the option type to include `transition`:

```ts
export type UseOptimisticActionOptions<
  TPayload,
  TResult,
  TBase,
  TChunk = never,
> = Omit<
  UseActionOptions<TPayload, TResult, TChunk>,
  'invalidate' | 'onMutate' | 'onError' | 'onSuccess'
> & {
  base: TBase;
  apply: (current: TBase, payload: TPayload) => TBase;
  invalidate?: 'auto' | ReadonlyArray<LoaderRef<unknown>>;
  onSuccess?: (data: TResult) => void;
  onError?: (err: Error) => void;
  /** Forwarded to the internal `useOptimistic` call. */
  transition?: boolean;
};
```

Update the hook body to destructure and forward:

```ts
export function useOptimisticAction<TPayload, TResult, TBase, TChunk = never>(
  stub: ActionStub<TPayload, TResult, TChunk>,
  options: UseOptimisticActionOptions<TPayload, TResult, TBase, TChunk>
): UseOptimisticActionResult<TPayload, TResult, TBase> {
  const { base, apply, onSuccess, onError, transition, ...actionOpts } = options;
  const [value, addOptimistic] = useOptimistic(base, apply, { transition });

  const action = useAction<TPayload, TResult, TChunk, OptimisticHandle>(stub, {
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

- [ ] **Step 4: Run the test, expect pass**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/optimistic-action-transition.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @hono-preact/iso exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/optimistic-action.ts packages/iso/src/__tests__/optimistic-action-transition.test.ts
git commit -m "feat(iso): useOptimisticAction forwards transition to useOptimistic"
```

---

### Task 11: SSR safety for `useOptimistic({ transition: true })`

**Files:**
- Test: `packages/iso/src/__tests__/optimistic-ssr.test.ts`

This task verifies the prerender path does not throw and does not reference `document`. No source change is expected; if the test fails, the fix lives in `optimistic.ts`'s feature detection.

- [ ] **Step 1: Write the test**

Create `packages/iso/src/__tests__/optimistic-ssr.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import { prerender } from 'preact-iso/prerender';
import { useOptimistic } from '../optimistic.js';

function Page() {
  const [value] = useOptimistic<number, number>(0, (a, p) => a + p, {
    transition: true,
  });
  return h('span', null, String(value));
}

describe('useOptimistic SSR', () => {
  it('renders with transition: true without referencing document', async () => {
    const result = await prerender(h(Page, null));
    expect(result.html).toContain('<span>0</span>');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/optimistic-ssr.test.ts`
Expected: PASS.

If it fails because `prerender` cannot be loaded in this test environment, run:

```bash
grep -n "prerender" packages/iso/src/__tests__/*.ts*
```

to find an existing prerender-based test as a template, and copy its imports / setup.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/optimistic-ssr.test.ts
git commit -m "test(iso): useOptimistic transition:true is SSR-safe"
```

---

### Task 12: `URL.parse()` audit and replacement

**Files:**
- Modify: Various sites identified by the audit.

- [ ] **Step 1: Audit the codebase for recoverable URL parsing**

Run:

```bash
grep -rn "try.*new URL\|new URL(.*).*catch\|catch.*URL" packages/ --include="*.ts" --include="*.tsx"
```

Also search for the common pattern split across lines:

```bash
grep -rn "new URL(" packages/ --include="*.ts" --include="*.tsx" | grep -v dist
```

For each `new URL(...)` that is followed by a `catch` block returning `null`/`undefined`/a fallback, list the file and line in a scratch buffer.

- [ ] **Step 2: For each identified site, write a regression test**

Pick one representative test per touched file. The shape:

```ts
import { describe, it, expect } from 'vitest';
import { theFunctionUnderTest } from '../the-module.js';

describe('the-module URL parsing', () => {
  it('returns null for malformed input without throwing', () => {
    expect(theFunctionUnderTest('http://[bad')).toBe(null);
  });
});
```

Create one such test file per source file you'll change, named `<source>.url-parse.test.ts`, colocated under `__tests__/`.

- [ ] **Step 3: Run all new regression tests, expect pass**

Run: `pnpm test`
Expected: PASS (existing `new URL` + `catch` blocks already handle malformed input; the tests just lock in the contract).

- [ ] **Step 4: Replace each `try { new URL(...) } catch` site**

For each identified site, replace the try/catch with `URL.parse()`. Example transform:

```ts
// before
let url: URL | null = null;
try {
  url = new URL(input, base);
} catch {
  /* ignore */
}
if (!url) return null;
```

```ts
// after
const url = URL.parse(input, base);
if (!url) return null;
```

Apply only to recoverable parses (those that catch and continue). Do NOT change sites that `throw new URL(...)` semantics-correctly (assertive URL construction).

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test`
Expected: all PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/
git commit -m "refactor: use URL.parse() at recoverable URL parse sites"
```

---

### Task 13: Docs updates for timeouts and View Transitions

**Files:**
- Modify: docs under `apps/site/` (exact paths discovered in this task).

- [ ] **Step 1: Locate the loader and action docs**

Run:

```bash
find apps/site -name "*.mdx" -path "*loader*" -o -name "*.mdx" -path "*action*" | head
find apps/site -name "*.mdx" -path "*optimistic*" | head
```

Note the paths. The framework docs sidebar config (`apps/site/src/sidebar.*` or similar) may also need an entry for a new "Timeouts" page if one is added. Check existing structure before deciding between "new page" vs "section in existing page."

- [ ] **Step 2: Add a Timeouts section under loaders**

Insert a section into the loader docs (or a new `timeouts.mdx` page, depending on how the existing docs are structured) covering:

- `timeoutMs` option on `defineLoader` / `defineAction`.
- Default of 30000 ms.
- `timeoutMs: false` opts out.
- Server returns 504 with `{ __outcome: 'timeout', kind: 'timeout', timeoutMs }`.
- Client surfaces `TimeoutError` (with `kind: 'timeout'`, `timeoutMs` properties).
- Streaming loaders: timeout applies to total stream completion, not first chunk; opt out with `timeoutMs: false` for long streams.

Describe current behavior only; no migration breadcrumbs.

Sample copy:

```mdx
## Timeouts

Loaders and actions get a deadline. By default every call has 30 seconds to
finish; the deadline starts at the moment the handler receives the request.
Pass `timeoutMs` to override:

```ts
export const slowReport = defineLoader(
  async () => {
    /* ... */
  },
  { timeoutMs: 60_000 }
);
```

Pass `timeoutMs: false` to opt out entirely:

```ts
export const longLivedStream = defineLoader(
  async function* () {
    /* yields indefinitely */
  },
  { timeoutMs: false }
);
```

When a deadline fires, the loader's `ctx.signal` aborts with reason
`DOMException('TimeoutError')`. The server responds with status 504 and a
`{ __outcome: 'timeout', kind: 'timeout', timeoutMs }` envelope. The client
hook (`useData()`, `useAction()`) exposes the failure as a `TimeoutError`
with `kind === 'timeout'` and the original `timeoutMs` attached.

The framework default is configurable per handler via
`loadersHandler(glob, { defaultTimeoutMs })` and
`actionsHandler(glob, { defaultTimeoutMs })`.
```

- [ ] **Step 3: Add a View Transitions note to the optimistic-updates doc**

In the optimistic UI docs page, add a small section:

```mdx
### View Transitions

Both `useOptimistic` and `useOptimisticAction` accept `{ transition: true }`
to wrap settle and revert state changes in
[`document.startViewTransition`](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition).
The initial optimistic update is never wrapped so it paints in the same
frame. When `startViewTransition` is not available (older browsers or SSR),
the option is a no-op.

```ts
const [count, addOptimistic] = useOptimistic(serverCount, reducer, {
  transition: true,
});
```

Style transitions with `::view-transition-old(*)` and `::view-transition-new(*)`
or attach `view-transition-name` to specific elements to opt into element-level
animations.
```

- [ ] **Step 4: Run the docs site locally**

Run: `pnpm dev`
Open the loader and optimistic-updates pages; confirm content renders and code samples are highlighted.

- [ ] **Step 5: Format and typecheck**

Run: `pnpm format && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/site/
git commit -m "docs(site): document loader/action timeouts and useOptimistic view transitions"
```

---

### Task 13.5: PR1 verification gate

- [ ] **Step 1: Run the full test suite on Node**

Run: `pnpm test`
Expected: all PASS.

- [ ] **Step 2: Run the integration test suite (workerd)**

Run: `pnpm test:integration`
Expected: all PASS. If this command does not exercise workerd in the current repo config, check `vitest.integration.config.ts` and document which runtime it targets.

- [ ] **Step 3: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Build all packages**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Open PR1**

```bash
git push -u origin <branch-name>
gh pr create --title "feat: loader/action timeouts, useOptimistic view transitions, URL.parse adoption" --body "$(cat <<'EOF'
## Summary

Spec A, PR1 of 2. Adopts three web-standard APIs as user-facing additions:

- Loader/action timeouts via `AbortSignal.any` + `AbortSignal.timeout`, with a new `TimeoutOutcome` variant (`{ __outcome: 'timeout', kind: 'timeout', timeoutMs }`) and a `TimeoutError` class on the client.
- Opt-in View Transitions in `useOptimistic` / `useOptimisticAction` (settle + revert only; initial mutate paints same-frame).
- `URL.parse()` at recoverable parse sites.

No version bump. PR2 (SSE TransformStream rewrite) follows.

Design: [docs/superpowers/specs/2026-05-23-spec-a-platform-hygiene-design.md](./docs/superpowers/specs/2026-05-23-spec-a-platform-hygiene-design.md).
Plan: [docs/superpowers/plans/2026-05-23-spec-a-platform-hygiene.md](./docs/superpowers/plans/2026-05-23-spec-a-platform-hygiene.md).

## Test plan
- [ ] `pnpm test` passes on Node
- [ ] `pnpm test:integration` passes on workerd
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] Manually trigger a slow loader in `apps/site` and confirm the client sees a `TimeoutError`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR2 — internal SSE codec rewrite

### Task 14: Wire-format snapshot test (baseline)

**Files:**
- Create: `packages/server/src/__tests__/sse-wire-snapshot.test.ts`

This test runs against the CURRENT encoder first to capture a baseline. After the rewrite (Tasks 15-17), the test asserts byte-identical output.

- [ ] **Step 1: Write the snapshot test against the current encoder**

Create `packages/server/src/__tests__/sse-wire-snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  sseGeneratorResponse,
  sseReadableStreamResponse,
} from '../sse.js';

async function bodyToString(res: Response): Promise<string> {
  return res.body ? new TextDecoder().decode(await new Response(res.body).arrayBuffer()) : '';
}

describe('SSE wire format', () => {
  it('generator response: byte-stable for a representative stream', async () => {
    const app = new Hono();
    app.get('/', (c) =>
      sseGeneratorResponse(
        c,
        (async function* () {
          yield 'first';
          yield { n: 2 };
          return 'final';
        })(),
        { emitResult: true }
      )
    );

    const res = await app.request('http://localhost/');
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const body = await bodyToString(res);
    expect(body).toBe(
      'data: "first"\n\n' +
        'data: {"n":2}\n\n' +
        'event: result\ndata: "final"\n\n'
    );
  });

  it('readable-stream response: byte-stable for a representative stream', async () => {
    const app = new Hono();
    app.get('/', (c) => {
      const source = new ReadableStream<unknown>({
        start(controller) {
          controller.enqueue('alpha');
          controller.enqueue({ k: 'beta' });
          controller.close();
        },
      });
      return sseReadableStreamResponse(c, source);
    });

    const res = await app.request('http://localhost/');
    const body = await bodyToString(res);
    expect(body).toBe('data: "alpha"\n\n' + 'data: {"k":"beta"}\n\n');
  });

  it('generator error path: emits event: error frame', async () => {
    const app = new Hono();
    app.get('/', (c) =>
      sseGeneratorResponse(
        c,
        (async function* () {
          yield 'before';
          throw new Error('boom');
        })()
      )
    );

    const res = await app.request('http://localhost/');
    const body = await bodyToString(res);
    expect(body).toBe(
      'data: "before"\n\n' +
        'event: error\ndata: {"message":"boom","name":"Error"}\n\n'
    );
  });
});
```

- [ ] **Step 2: Run the test against the current implementation**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sse-wire-snapshot.test.ts`
Expected: PASS. (Hono's `streamSSE` produces the exact format the test asserts. If the test fails, it captured something incorrect; adjust the asserted strings to match the actual current output BEFORE proceeding — this is the baseline.)

- [ ] **Step 3: Commit the baseline test**

```bash
git add packages/server/src/__tests__/sse-wire-snapshot.test.ts
git commit -m "test(server): pin SSE wire format as a snapshot baseline"
```

---

### Task 15: Rewrite `sseGeneratorResponse` on TransformStream

**Files:**
- Modify: `packages/server/src/sse.ts`

- [ ] **Step 1: Replace `sseGeneratorResponse` with a TransformStream pipeline**

In `packages/server/src/sse.ts`, replace the existing `sseGeneratorResponse` function body with:

```ts
export function sseGeneratorResponse(
  c: Context,
  gen: AsyncGenerator<unknown, unknown, unknown>,
  options: SseGeneratorOptions = {}
): Response {
  const {
    emitResult = false,
    observers,
    observerCtx,
    signal,
    timeoutMs,
  } = options;
  const obs = observers ?? [];

  // The pump generator owns the lifecycle: it adapts the user's
  // generator into a stream of `SSEFrame`s, calls observer hooks, and
  // emits a trailing `result`, `timeout`, or `error` frame as needed.
  async function* framePump(): AsyncGenerator<SSEFrame, void, unknown> {
    let chunks = 0;
    let started = false;
    if (obs.length > 0 && observerCtx) {
      fanStart(obs, observerCtx);
      started = true;
    }
    try {
      while (true) {
        const step = await gen.next();
        if (step.done) {
          if (emitResult && step.value !== undefined) {
            yield { event: 'result', data: JSON.stringify(step.value) };
          }
          if (started && observerCtx) {
            fanEnd(obs, observerCtx, { chunks, result: step.value });
          }
          return;
        }
        yield { data: JSON.stringify(step.value) };
        if (started && observerCtx) {
          fanChunk(obs, observerCtx, step.value, chunks);
        }
        chunks += 1;
      }
    } catch (err) {
      await gen.return(undefined).catch(() => undefined);
      if (started && observerCtx) {
        fanError(obs, observerCtx, err, { chunks });
      }
      if (isTimeoutAbort(signal) && typeof timeoutMs === 'number') {
        yield {
          event: 'timeout',
          data: JSON.stringify({ kind: 'timeout', timeoutMs }),
        };
      } else {
        yield { event: 'error', data: encodeErrorPayload(err) };
      }
    }
  }

  const body = ReadableStream.from(framePump()).pipeThrough(
    sseEncodeTransform()
  );

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
}
```

Define the frame type and encoder transform at the module top (after imports, before the existing code):

```ts
type SSEFrame = { event?: string; id?: string; data: string };

function sseEncodeTransform(): TransformStream<SSEFrame, Uint8Array> {
  const encoder = new TextEncoder();
  return new TransformStream<SSEFrame, Uint8Array>({
    transform(frame, controller) {
      const lines: string[] = [];
      if (frame.event) lines.push(`event: ${frame.event}`);
      if (frame.id) lines.push(`id: ${frame.id}`);
      lines.push(`data: ${frame.data}`);
      controller.enqueue(encoder.encode(lines.join('\n') + '\n\n'));
    },
  });
}
```

Remove the `import { streamSSE } from 'hono/streaming';` line (no longer needed for the generator path).

- [ ] **Step 2: Run the snapshot test**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sse-wire-snapshot.test.ts`
Expected: the `generator response` and `generator error path` cases PASS. The `readable-stream response` case still uses `streamSSE` if Task 16 hasn't run yet — that's fine if `streamSSE` is still imported.

If the test fails, the new encoder produced different bytes; compare and fix.

- [ ] **Step 3: Run the full server test suite**

Run: `pnpm --filter @hono-preact/server exec vitest run`
Expected: all PASS (including the mid-stream timeout test from Task 6, which now hits the rewritten path).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/sse.ts
git commit -m "refactor(server): sseGeneratorResponse uses TransformStream"
```

---

### Task 16: Rewrite `sseReadableStreamResponse` on TransformStream

**Files:**
- Modify: `packages/server/src/sse.ts`

- [ ] **Step 1: Replace `sseReadableStreamResponse`**

In `packages/server/src/sse.ts`, replace the function body:

```ts
export function sseReadableStreamResponse(
  c: Context,
  source: ReadableStream<unknown>,
  options: {
    observers?: ReadonlyArray<StreamObserver<unknown, never>>;
    observerCtx?: ServerStreamCtx;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Response {
  const { observers, observerCtx, signal, timeoutMs } = options;
  const obs = observers ?? [];

  async function* framePump(): AsyncGenerator<SSEFrame, void, unknown> {
    const reader = source.getReader();
    let chunks = 0;
    let started = false;
    if (obs.length > 0 && observerCtx) {
      fanStart(obs, observerCtx);
      started = true;
    }
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (started && observerCtx) {
            fanEnd(obs, observerCtx, { chunks, result: undefined });
          }
          return;
        }
        yield { data: JSON.stringify(value) };
        if (started && observerCtx) {
          fanChunk(obs, observerCtx, value, chunks);
        }
        chunks += 1;
      }
    } catch (err) {
      if (started && observerCtx) {
        fanError(obs, observerCtx, err, { chunks });
      }
      if (isTimeoutAbort(signal) && typeof timeoutMs === 'number') {
        yield {
          event: 'timeout',
          data: JSON.stringify({ kind: 'timeout', timeoutMs }),
        };
      } else {
        yield { event: 'error', data: encodeErrorPayload(err) };
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }

  const body = ReadableStream.from(framePump()).pipeThrough(
    sseEncodeTransform()
  );

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  });
}
```

The `streamSSE` import is now unused everywhere in the file. Remove it.

- [ ] **Step 2: Run the snapshot test**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sse-wire-snapshot.test.ts`
Expected: all three cases PASS.

- [ ] **Step 3: Run the full server test suite**

Run: `pnpm --filter @hono-preact/server exec vitest run`
Expected: all PASS.

- [ ] **Step 4: Confirm `hono/streaming` is no longer imported from this file**

Run: `grep -n "hono/streaming" packages/server/src/sse.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sse.ts
git commit -m "refactor(server): sseReadableStreamResponse uses TransformStream; drop hono/streaming"
```

---

### Task 17: Rewrite `readSSE` on TextDecoderStream + TransformStream

**Files:**
- Modify: `packages/iso/src/internal/sse-decoder.ts`
- Test: `packages/iso/src/internal/__tests__/sse-decoder-pipeline.test.ts`

- [ ] **Step 1: Write the pipeline test**

Create `packages/iso/src/internal/__tests__/sse-decoder-pipeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readSSE } from '../sse-decoder.js';

function asStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Split in odd places to exercise multi-chunk buffering.
      controller.enqueue(bytes.slice(0, 5));
      controller.enqueue(bytes.slice(5, 17));
      controller.enqueue(bytes.slice(17));
      controller.close();
    },
  });
}

describe('readSSE', () => {
  it('parses event-tagged data frames split across multiple TCP-sized chunks', async () => {
    const input =
      'data: "first"\n\n' +
      'event: result\ndata: "final"\n\n' +
      'event: timeout\ndata: {"kind":"timeout","timeoutMs":75}\n\n';

    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(asStream(input))) {
      events.push(ev);
    }
    expect(events).toEqual([
      { event: 'message', data: '"first"' },
      { event: 'result', data: '"final"' },
      { event: 'timeout', data: '{"kind":"timeout","timeoutMs":75}' },
    ]);
  });

  it('ignores keepalive comments and resets event after blank line', async () => {
    const input =
      ': keepalive\n' + 'event: tick\ndata: 1\n\n' + 'data: 2\n\n';
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(asStream(input))) {
      events.push(ev);
    }
    expect(events).toEqual([
      { event: 'tick', data: '1' },
      { event: 'message', data: '2' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test against the current decoder**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/sse-decoder-pipeline.test.ts`
Expected: PASS (the current decoder already handles these cases). If it doesn't, fix the test expectations to match observed current behavior BEFORE the refactor — the goal is parity.

- [ ] **Step 3: Rewrite `readSSE` on streams**

Replace the body of `packages/iso/src/internal/sse-decoder.ts`:

```ts
export type SSEEvent = { event: string; data: string };

function lineSplitTransform(): TransformStream<string, string> {
  let buffer = '';
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        controller.enqueue(buffer.slice(0, nl).replace(/\r$/, ''));
        buffer = buffer.slice(nl + 1);
      }
    },
    flush(controller) {
      if (buffer.length) {
        controller.enqueue(buffer.replace(/\r$/, ''));
        buffer = '';
      }
    },
  });
}

export async function* readSSE(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent, void, unknown> {
  const lines = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(lineSplitTransform());

  let event = 'message';
  let dataLines: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = (lines as ReadableStream<string>).getReader();
  try {
    while (true) {
      const { done, value: line } = await reader.read();
      if (done) {
        if (dataLines.length) {
          yield { event, data: dataLines.join('\n') };
        }
        return;
      }
      if (line === '') {
        if (dataLines.length) {
          yield { event, data: dataLines.join('\n') };
        }
        event = 'message';
        dataLines = [];
      } else if (line.startsWith(':')) {
        // SSE comment / keepalive, ignore
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: Run the pipeline test and any existing decoder tests**

Run:

```bash
pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/
```

Expected: all PASS, including the new pipeline test and any pre-existing SSE-decoder tests.

- [ ] **Step 5: Run the full iso test suite**

Run: `pnpm --filter @hono-preact/iso exec vitest run`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/sse-decoder.ts packages/iso/src/internal/__tests__/sse-decoder-pipeline.test.ts
git commit -m "refactor(iso): readSSE uses TextDecoderStream and a line-split TransformStream"
```

---

### Task 18: Backpressure and abort regression test

**Files:**
- Create: `packages/server/src/__tests__/sse-backpressure.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { sseGeneratorResponse } from '../sse.js';

describe('SSE backpressure and abort', () => {
  it('cancels the source generator when the consumer aborts', async () => {
    let returned = false;
    const source = (async function* () {
      try {
        for (let i = 0; ; i++) {
          yield i;
        }
      } finally {
        returned = true;
      }
    })();

    const app = new Hono();
    app.get('/', (c) => sseGeneratorResponse(c, source));

    const res = await app.request('http://localhost/');
    const reader = res.body!.getReader();
    // Read one chunk to ensure the generator has started.
    await reader.read();
    await reader.cancel();
    // Give the generator a moment to observe cancellation.
    await new Promise((r) => setTimeout(r, 10));
    expect(returned).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, expect pass**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sse-backpressure.test.ts`
Expected: PASS. `ReadableStream.from(asyncGen)` propagates cancellation to the generator's `return()`.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/sse-backpressure.test.ts
git commit -m "test(server): SSE source generator is cancelled when the consumer aborts"
```

---

### Task 19: PR2 verification gate

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all PASS.

- [ ] **Step 2: Integration suite**

Run: `pnpm test:integration`
Expected: all PASS.

- [ ] **Step 3: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 4: Confirm `hono/streaming` is no longer imported anywhere in this PR's diff**

Run: `grep -rn "hono/streaming" packages/server/src/ packages/iso/src/`
Expected: no output (or only in unrelated files outside the SSE path; document any).

- [ ] **Step 5: Open PR2**

```bash
git push -u origin <branch-name>
gh pr create --title "refactor: SSE codec uses TransformStream; drop hono/streaming on the stream path" --body "$(cat <<'EOF'
## Summary

Spec A, PR2 of 2. Replaces the hand-rolled SSE codec with a `TransformStream`-based pipeline.

- Server: `sseGeneratorResponse` / `sseReadableStreamResponse` pipe an internal frame generator through a TransformStream encoder. Observer hooks (`onStart` / `onChunk` / `onEnd` / `onError` / `onAbort`) fire from inside the pump.
- Client: `readSSE` pipes the response body through `TextDecoderStream` and a line-splitting `TransformStream`.
- `hono/streaming` removed from the loader/action stream path.
- Wire format preserved byte-for-byte (verified by `sse-wire-snapshot.test.ts`).

No version bump. Follows PR1 (timeouts, useOptimistic view transitions, URL.parse).

Design: [docs/superpowers/specs/2026-05-23-spec-a-platform-hygiene-design.md](./docs/superpowers/specs/2026-05-23-spec-a-platform-hygiene-design.md).
Plan: [docs/superpowers/plans/2026-05-23-spec-a-platform-hygiene.md](./docs/superpowers/plans/2026-05-23-spec-a-platform-hygiene.md).

## Test plan
- [ ] `pnpm test` passes on Node
- [ ] `pnpm test:integration` passes on workerd
- [ ] SSE wire-format snapshot passes byte-for-byte against pre-refactor output
- [ ] Backpressure test passes: consumer cancellation propagates to source generator

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

Spec coverage check:

- **#1 timeouts** — Tasks 1 (outcome), 2 (defineLoader), 3 (defineAction), 4 (loaders-handler), 5 (actions-handler), 6 (mid-stream SSE timeout), 7 (useAction client), 8 (loader-fetch client). All four spec bullet points (option API, default value, structured outcome, signal composition) are covered.
- **#2 View Transitions in useOptimistic** — Tasks 9 (useOptimistic), 10 (useOptimisticAction), 11 (SSR safety). Settle/revert wrap, mutate untouched, feature-detected fallback, all under test.
- **#3 URL.parse** — Task 12 (audit + replace). Audit step lists the sites; tests pin malformed-input behavior; replacement is mechanical.
- **#7 SSE TransformStream** — Tasks 14 (baseline snapshot), 15 (generator encoder), 16 (stream encoder + hono/streaming drop), 17 (decoder), 18 (backpressure/abort). Wire format pinned before and after; observers slot in; hono/streaming gone.
- **Testing strategy** — Per-change test obligations from the spec are covered (timeout integration tests across runtimes, transition feature detect both branches, URL.parse regression tests, wire snapshot, backpressure).
- **Delivery** — Two PRs with verification gates (Tasks 13.5 and 19); no version bumps.
- **Docs** — Task 13.

No placeholders, no "TBD", no "similar to Task N." All steps include full code or exact commands. The mid-stream timeout (Task 6) is an addition over the spec's surface description but is required to make the timeout outcome reliable when a stream has already started flushing; the spec mentions "Streaming loaders: the timeout applies to time-to-completion" which the new task implements.

Type-name consistency check: `TimeoutOutcome`, `timeoutOutcome()`, `isTimeout()`, `TimeoutError`, `timeoutMs`, `defaultTimeoutMs` used consistently across all tasks.
