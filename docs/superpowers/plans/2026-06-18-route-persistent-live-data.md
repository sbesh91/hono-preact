# Route-persistent live data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make persistent UI a scoped-layout child served by typed loaders/actions, add a `live` loader mode plus a `useStream` chunk accumulator, and remove the now-unused `<Persist>` primitive.

**Architecture:** Two orthogonal additions to the existing loader pipeline (no new `defineStream` pipeline): a `live` option on `defineLoader` (client-only, no SSR block, no timeout) and a `useStream` consumption hook that folds every streamed chunk. Persistence is achieved by placing UI in a scoped layout (already supported by the router's shared-component identity). `<Persist>` and its separate render root are deleted.

**Tech Stack:** preact / preact-iso, Hono, Vitest + @testing-library/preact + happy-dom, Vite plugin transforms (`.server.ts` strip + stub), pnpm workspace.

## Global Constraints

- No em-dashes (`—`) in prose, comments, or commit messages. Use commas/semicolons/parentheses or two sentences.
- Node engines floor (already set repo-wide): `^22.18.0 || >=24.11.0`. Do not lower it.
- `live` loaders are consumed ONLY via `loader.useStream(...)`. `loader.View` / `loader.Boundary` / `loader.useData()` on a `live` loader must throw a clear error (server-ref guard; this is the SSR-hang safety net).
- `useStream` is client-only: it returns `{ data: initial, status: 'connecting' }` during SSR and establishes the subscription post-hydration.
- Pre-push CI mirror, in order (CLAUDE.md): (1) `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`, (2) `pnpm format:check`, (3) `pnpm typecheck`, (4) `pnpm test:coverage`, (5) `pnpm test:integration`, (6) `pnpm --filter site build`. If `format:check` fails, run `pnpm format` and commit.
- A cross-package public-API change must run the consuming packages' suites (`pnpm test:coverage`), since build + typecheck skip test files.
- Run all commands from the worktree root. Vitest include globs are root-relative: run a single file as `npx vitest run packages/iso/src/__tests__/<file>`.
- `<Persist>` / `PersistHost` / `PersistProps` removal is a BREAKING change; record it in the next version's release notes (changelog), NOT as in-app "formerly Persist" breadcrumbs.

**Pre-flight (before Task 1):** The brainstorming spike left uncommitted edits in this worktree (`apps/site/src/pages/demo/demo-layout.tsx`, `projects-shell.tsx`, `projects-shell.server.ts`, `components/demo/ActivityBar.tsx`) and an untracked spike test (`packages/iso/src/__tests__/spike-layout-child-persist.test.tsx`). This plan rebuilds those cleanly. Revert the demo edits and delete the spike test so each task starts from a clean base:

```bash
git checkout -- apps/site/src/pages/demo/demo-layout.tsx apps/site/src/pages/demo/projects-shell.tsx apps/site/src/pages/demo/projects-shell.server.ts apps/site/src/components/demo/ActivityBar.tsx
rm -f packages/iso/src/__tests__/spike-layout-child-persist.test.tsx
```

The committed spec (`docs/superpowers/specs/2026-06-18-route-persistent-live-data-design.md`) stays.

---

### Task 1: `live` loader option + consumption guards

**Files:**
- Modify: `packages/iso/src/define-loader.ts` (DefineLoaderOpts ~81-99; defineLoader body ~162-256)
- Test: `packages/iso/src/__tests__/define-loader-live.test.ts` (create)

**Interfaces:**
- Produces: `DefineLoaderOpts<T>` gains `live?: boolean`. A loader created with `{ live: true }` has `ref.timeoutMs === false` (unless an explicit `timeoutMs` was passed) and throws from `useData()` / `Boundary` / `View` directing the caller to `useStream`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/iso/src/__tests__/define-loader-live.test.ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';

async function* gen() {
  yield 1;
}

describe('defineLoader({ live })', () => {
  it('defaults timeoutMs to false for live loaders', () => {
    const ref = defineLoader<number>(gen, { live: true });
    expect(ref.timeoutMs).toBe(false);
  });

  it('keeps an explicit timeoutMs over the live default', () => {
    const ref = defineLoader<number>(gen, { live: true, timeoutMs: 5000 });
    expect(ref.timeoutMs).toBe(5000);
  });

  it('leaves timeoutMs undefined for non-live loaders', () => {
    const ref = defineLoader<number>(gen);
    expect(ref.timeoutMs).toBeUndefined();
  });

  it('throws from View/Boundary/useData on a live loader', () => {
    const ref = defineLoader<number>(gen, { live: true });
    expect(() => ref.View(() => null)).toThrow(/useStream/);
    expect(() => ref.Boundary({ children: null })).toThrow(/useStream/);
    expect(() => ref.useData()).toThrow(/useStream/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/iso/src/__tests__/define-loader-live.test.ts`
Expected: FAIL (`live` not a known opt; `timeoutMs` undefined for live; guards do not throw).

- [ ] **Step 3: Add `live` to `DefineLoaderOpts`**

In `packages/iso/src/define-loader.ts`, add to the `DefineLoaderOpts<T>` type (after the `timeoutMs` field, ~line 91):

```ts
  /**
   * Marks this loader as a long-lived client-only subscription. A `live`
   * loader is consumed ONLY via `loader.useStream(...)`: it is never invoked
   * during SSR (so an infinite generator cannot hang the document response),
   * and its timeout defaults to `false` (no 30s cap) unless `timeoutMs` is set.
   * `loader.View` / `loader.Boundary` / `loader.useData()` throw for live
   * loaders.
   */
  live?: boolean;
```

- [ ] **Step 4: Apply the live defaults and guards in `defineLoader`**

In the `defineLoader` body, after the `const opts = ...` normalization (~line 170) add:

```ts
  const live = opts?.live ?? false;
```

Change the ref's `timeoutMs` field (currently `timeoutMs: opts?.timeoutMs,`) to:

```ts
    timeoutMs: opts?.timeoutMs ?? (live ? false : undefined),
```

Add a guard at the top of the ref's `useData()` (before the `useContext` call):

```ts
    useData() {
      if (live) {
        throw new Error(
          'This is a `live` loader: consume it with `loader.useStream(...)`, not `loader.useData()`.'
        );
      }
      const ctx = useContext(LoaderDataContext);
      // ...unchanged...
    },
```

Wrap the ref's `Boundary` and `View` with the same guard:

```ts
    Boundary: (props) => {
      if (live) {
        throw new Error(
          'This is a `live` loader: consume it with `loader.useStream(...)`, not `loader.Boundary`.'
        );
      }
      return h(LoaderHost<unknown>, {
        loader: ref,
        fallback: props.fallback,
        errorFallback: props.errorFallback,
        children: props.children,
      });
    },
    View: (render, viewOpts) => {
      if (live) {
        throw new Error(
          'This is a `live` loader: consume it with `loader.useStream(...)`, not `loader.View`.'
        );
      }
      const Wrapped: FunctionComponent<any> = (props) =>
        h(ref.Boundary, {
          fallback: viewOpts?.fallback,
          errorFallback: viewOpts?.errorFallback,
          children: h(ViewRenderer<unknown>, { loaderRef: ref, props, render }),
        });
      return Wrapped;
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/iso/src/__tests__/define-loader-live.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/define-loader-live.test.ts
git commit -m "feat(iso): add live loader option (client-only, no timeout) with consumption guards"
```

---

### Task 2: `useStream` chunk accumulator hook

**Files:**
- Create: `packages/iso/src/internal/use-loader-stream.tsx`
- Modify: `packages/iso/src/define-loader.ts` (import + re-export types; add `useStream` to `LoaderRef` interface ~30-73 and to the ref object ~204-256)
- Modify: `packages/iso/src/index.ts` (export the new public types)
- Test: `packages/iso/src/internal/__tests__/use-loader-stream.test.tsx` (create)

**Interfaces:**
- Consumes: `runLoader` (from `loader-runner.js`), `RouteLocationsContext` (from `route-locations.js`), `serializeLocationForCache` (from `cache-key.js`), `isBrowser`.
- Produces: `StreamStatus = 'connecting' | 'open' | 'closed' | 'error'`; `UseStreamOptions<T, Acc> = { reduce: (acc: Acc, chunk: T) => Acc; initial: Acc; onChunk?: (chunk: T) => void }`; `UseStreamResult<Acc> = { data: Acc; status: StreamStatus; error: Error | null }`. `LoaderRef<T>` gains `useStream<Acc>(opts: UseStreamOptions<T, Acc>): UseStreamResult<Acc>`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/iso/src/internal/__tests__/use-loader-stream.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { RouteLocationsProvider } from '../route-locations.js';

// Drip each SSE frame in its own microtask so Preact flushes between chunks.
function dripSseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(enc.encode(chunk));
        await Promise.resolve();
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LOC = { path: '/', pathParams: {}, searchParams: {} } as never;

describe('loader.useStream', () => {
  it('accumulates EVERY chunk (no coalescing loss) and ends closed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        dripSseResponse([
          'data: {"n":1}\n\n',
          'data: {"n":2}\n\n',
          'data: {"n":3}\n\n',
        ])
      )
    );
    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'test-stream',
    });
    function Probe() {
      const { data, status } = ref.useStream<number[]>({
        reduce: (acc, c) => [...acc, c.n],
        initial: [],
      });
      return (
        <p data-testid="out">
          {data.join(',')}|{status}
        </p>
      );
    }
    render(
      <LocationProvider>
        <RouteLocationsProvider moduleKey="test-stream" location={LOC}>
          <Probe />
        </RouteLocationsProvider>
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('1,2,3|closed')
    );
  });

  it('reports an error status when used with no resolvable location', async () => {
    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'no-loc',
    });
    function Probe() {
      const { status } = ref.useStream<number[]>({
        reduce: (acc) => acc,
        initial: [],
      });
      return <p data-testid="out">{status}</p>;
    }
    render(
      <LocationProvider>
        <Probe />
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('error')
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/iso/src/internal/__tests__/use-loader-stream.test.tsx`
Expected: FAIL (`ref.useStream` is not a function).

- [ ] **Step 3: Create the hook**

```tsx
// packages/iso/src/internal/use-loader-stream.tsx
import { useContext, useEffect, useId, useRef, useState } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import { RouteLocationsContext } from './route-locations.js';
import { runLoader } from './loader-runner.js';
import { serializeLocationForCache } from './cache-key.js';

export type StreamStatus = 'connecting' | 'open' | 'closed' | 'error';

export type UseStreamOptions<T, Acc> = {
  /** Fold each streamed chunk into the accumulated value. */
  reduce: (acc: Acc, chunk: T) => Acc;
  /** Accumulator seed (also the server-render value). */
  initial: Acc;
  /** Optional per-chunk side effect. */
  onChunk?: (chunk: T) => void;
};

export type UseStreamResult<Acc> = {
  data: Acc;
  status: StreamStatus;
  error: Error | null;
};

/**
 * Subscribe to a streaming loader and fold EVERY chunk into accumulated state.
 * Unlike `useData()` (latest value, Suspense), this is client-only and
 * status-driven: it returns `initial`/`'connecting'` during SSR and connects
 * post-hydration. The loader's location is read from `RouteLocationsContext`
 * (a layout's stable location), so inside a layout it connects once and
 * survives intra-scope navigation.
 */
export function useLoaderStream<T, Acc>(
  loaderRef: LoaderRef<T>,
  opts: UseStreamOptions<T, Acc>
): UseStreamResult<Acc> {
  const id = useId();
  const locMap = useContext(RouteLocationsContext);
  const ctxLocation = loaderRef.__moduleKey
    ? locMap?.get(loaderRef.__moduleKey)
    : undefined;

  // Track latest reduce/onChunk/initial without forcing a re-subscribe.
  const reduceRef = useRef(opts.reduce);
  reduceRef.current = opts.reduce;
  const onChunkRef = useRef(opts.onChunk);
  onChunkRef.current = opts.onChunk;
  const initialRef = useRef(opts.initial);

  const [data, setData] = useState<Acc>(opts.initial);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [error, setError] = useState<Error | null>(null);

  // Re-subscribe only when the loader identity or its resolved location changes.
  const locKey = ctxLocation
    ? serializeLocationForCache(ctxLocation, loaderRef.params)
    : '';

  useEffect(() => {
    if (!ctxLocation) {
      setStatus('error');
      setError(
        new Error(
          `loader.useStream for module '${loaderRef.__moduleKey ?? '<unkeyed>'}' has no location: ` +
            `use it inside a layout/route whose server module includes this loader's .server.ts file.`
        )
      );
      return;
    }

    // Fresh subscription: reset accumulated state.
    setData(initialRef.current);
    setStatus('connecting');
    setError(null);

    const controller = new AbortController();
    const apply = (chunk: T) => {
      onChunkRef.current?.(chunk);
      setData((prev) => reduceRef.current(prev, chunk));
      setStatus('open');
    };

    const first = runLoader<T>(loaderRef, ctxLocation, id, controller.signal, {
      onChunk: apply,
      onError: (err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setStatus('error');
      },
      onEnd: () => {
        if (controller.signal.aborted) return;
        setStatus('closed');
      },
    });
    first.then(
      (firstChunk) => {
        if (!controller.signal.aborted) apply(firstChunk);
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      }
    );

    return () => controller.abort();
    // ctxLocation is captured via locKey; reduce/onChunk/initial via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderRef.__id, locKey]);

  return { data, status, error };
}
```

- [ ] **Step 4: Wire `useStream` into the loader ref + types**

In `packages/iso/src/define-loader.ts`:

Add the import near the other internal imports (top of file):

```ts
import {
  useLoaderStream,
  type UseStreamOptions,
  type UseStreamResult,
} from './internal/use-loader-stream.js';
```

Re-export the public types (next to the existing `defineLoader` export block, ~line 34):

```ts
export type {
  StreamStatus,
  UseStreamOptions,
  UseStreamResult,
} from './internal/use-loader-stream.js';
```

Add `useStream` to the `LoaderRef<T>` interface (after `useData()` / `useError()`, ~line 53):

```ts
  useStream<Acc>(opts: UseStreamOptions<T, Acc>): UseStreamResult<Acc>;
```

Add the method to the ref object (after `useError()`, ~line 229):

```ts
    useStream(opts) {
      return useLoaderStream(ref, opts);
    },
```

- [ ] **Step 5: Export the public types from the iso barrel**

In `packages/iso/src/index.ts`, extend the `define-loader.js` type export block (~line 36-39) to include the new names:

```ts
export type {
  LoaderRef,
  // ...existing names...
  StreamStatus,
  UseStreamOptions,
  UseStreamResult,
} from './define-loader.js';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/iso/src/internal/__tests__/use-loader-stream.test.tsx`
Expected: PASS (2 tests).

Run: `npx vitest run packages/iso/src/__tests__/define-loader-live.test.ts`
Expected: PASS (still 4; the ref shape change did not break the guards).

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/use-loader-stream.tsx packages/iso/src/define-loader.ts packages/iso/src/index.ts packages/iso/src/internal/__tests__/use-loader-stream.test.tsx
git commit -m "feat(iso): add loader.useStream chunk accumulator hook"
```

---

### Task 3: Layout-child persistence regression test

**Files:**
- Create: `packages/iso/src/__tests__/layout-child-persistence.test.tsx`

**Interfaces:**
- Consumes: `defineRoutes`, `Routes` (from `define-routes.js`); preact-iso `LocationProvider`.
- Produces: nothing (a guard test for the persistence mechanism the design relies on).

- [ ] **Step 1: Write the test (this is the deliverable)**

```tsx
// packages/iso/src/__tests__/layout-child-persistence.test.tsx
// @vitest-environment happy-dom
//
// Guards the core property behind layout-based persistence: a component a
// layout renders as a plain sibling of {children} persists (no remount, state
// + a live resource survive) across intra-scope navigation, tears down cleanly
// on scope exit, and remounts fresh on re-entry. This is the mechanism that
// replaces <Persist>.
import { describe, it, expect, beforeEach } from 'vitest';
import type { ComponentType } from 'preact';
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  fireEvent,
  render,
  findByTestId,
  waitFor,
} from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import {
  defineRoutes,
  Routes,
  type LayoutProps,
  type ViewProps,
} from '../define-routes.js';

let barMounts = 0;
let liveConnections = 0;

beforeEach(() => {
  barMounts = 0;
  liveConnections = 0;
});

const Bar: ComponentType = () => {
  const [seq] = useState(() => ++barMounts);
  const [count, setCount] = useState(0);
  useEffect(() => {
    liveConnections++;
    return () => {
      liveConnections--;
    };
  }, []);
  return h(
    'div',
    { 'data-testid': 'bar', 'data-seq': String(seq) },
    h('span', { 'data-testid': 'bar-count' }, String(count)),
    h('button', { 'data-testid': 'bar-inc', onClick: () => setCount((c) => c + 1) }, 'inc')
  );
};

const Layout: ComponentType<LayoutProps> = ({ children }) =>
  h('div', null, children as never, h(Bar, null));

const IndexView: ComponentType<ViewProps> = () =>
  h(
    'div',
    null,
    h('a', { href: '/app/123', 'data-testid': 'to-detail' }, 'detail'),
    h('a', { href: '/other', 'data-testid': 'to-other' }, 'leave')
  );
const DetailView: ComponentType<ViewProps> = () =>
  h(
    'div',
    null,
    h('a', { href: '/app', 'data-testid': 'to-index' }, 'back'),
    h('a', { href: '/other', 'data-testid': 'to-other' }, 'leave')
  );
const OtherView: ComponentType<ViewProps> = () =>
  h('a', { href: '/app', 'data-testid': 'to-app' }, 'enter');

const manifest = defineRoutes([
  {
    path: '/app',
    layout: () => Promise.resolve({ default: Layout }),
    children: [
      { path: '', view: () => Promise.resolve({ default: IndexView }) },
      { path: ':id', view: () => Promise.resolve({ default: DetailView }) },
    ],
  },
  { path: '/other', view: () => Promise.resolve({ default: OtherView }) },
]);

describe('layout-child persistence', () => {
  it('persists across intra-scope nav, tears down on exit, remounts on re-entry', async () => {
    history.replaceState(null, '', '/app');
    const { container } = render(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );

    await findByTestId(container, 'bar');
    expect(barMounts).toBe(1);
    await waitFor(() => expect(liveConnections).toBe(1));

    fireEvent.click(await findByTestId(container, 'bar-inc'));
    fireEvent.click(await findByTestId(container, 'bar-inc'));
    await waitFor(() =>
      expect(
        (container.querySelector('[data-testid=bar-count]') as HTMLElement)
          .textContent
      ).toBe('2')
    );

    // Intra-scope nav: no remount, state preserved.
    fireEvent.click(await findByTestId(container, 'to-detail'));
    await findByTestId(container, 'to-index');
    expect(barMounts).toBe(1);
    expect(liveConnections).toBe(1);
    expect(
      (container.querySelector('[data-testid=bar]') as HTMLElement).dataset.seq
    ).toBe('1');
    expect(
      (container.querySelector('[data-testid=bar-count]') as HTMLElement)
        .textContent
    ).toBe('2');

    // Leave the scope: bar gone, connection torn down (a transient remount on
    // the way out is preact-iso rendering the outgoing route during the swap;
    // assert the end state).
    const mountsBeforeExit = barMounts;
    fireEvent.click(await findByTestId(container, 'to-other'));
    await findByTestId(container, 'to-app');
    expect(container.querySelector('[data-testid=bar]')).toBeNull();
    await waitFor(() => expect(liveConnections).toBe(0));
    expect(barMounts).toBeGreaterThan(mountsBeforeExit);

    // Re-enter: fresh instance, one connection, reset state.
    const mountsBeforeReentry = barMounts;
    fireEvent.click(await findByTestId(container, 'to-app'));
    await findByTestId(container, 'bar');
    expect(barMounts).toBeGreaterThan(mountsBeforeReentry);
    await waitFor(() => expect(liveConnections).toBe(1));
    expect(
      (container.querySelector('[data-testid=bar-count]') as HTMLElement)
        .textContent
    ).toBe('0');
  });
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `npx vitest run packages/iso/src/__tests__/layout-child-persistence.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/layout-child-persistence.test.tsx
git commit -m "test(iso): guard layout-child persistence across intra-scope navigation"
```

---

### Task 4: Demo dogfood — activity bar on a live loader

**Files:**
- Modify: `apps/site/src/pages/demo/projects-shell.server.ts` (add the `activity` live loader)
- Modify: `apps/site/src/components/demo/ActivityBar.tsx` (consume via `useStream`)
- Modify: `apps/site/src/pages/demo/projects-shell.tsx` (render `<ActivityBar />` as a child)
- Modify: `apps/site/src/pages/demo/demo-layout.tsx` (drop the `<Persist>` block)
- Delete: `apps/site/src/api.ts` (hand-written SSE endpoint, now replaced)
- Modify: `apps/site/src/components/demo/__tests__/ActivityBar.test.tsx` (retarget off the EventSource mock)

**Interfaces:**
- Consumes: `defineLoader({ live: true })` and `loader.useStream` from Tasks 1-2; the existing `subscribeActivity` / `recentActivityEvents` / `simulateActivity` helpers and `ActivityEvent` type.
- Produces: `serverLoaders.activity` on the projects-shell module; an `ActivityBar` that takes no props and is a plain child of `ProjectsShell`.

- [ ] **Step 1: Add the `activity` live loader to the layout's server module**

Append to `apps/site/src/pages/demo/projects-shell.server.ts`. Add imports at the top:

```ts
import {
  subscribeActivity,
  recentActivityEvents,
  type ActivityEvent,
} from '../../demo/activity-stream.js';
import { simulateActivity } from '../../demo/activity-sim.js';
```

Add the generator + loader (the `default` shell loader export stays; extend `serverLoaders`):

```ts
async function* activityStream(
  ctx: LoaderCtx
): AsyncGenerator<ActivityEvent, void, unknown> {
  for (const e of recentActivityEvents(5)) yield e;

  const queue: ActivityEvent[] = [];
  let wake!: () => void;
  let wakeP = new Promise<void>((r) => (wake = r));
  const unsub = subscribeActivity((e) => {
    queue.push(e);
    wake();
  });
  const onAbort = () => {
    unsub();
    wake();
  };
  ctx.signal.addEventListener('abort', onAbort);
  try {
    while (!ctx.signal.aborted) {
      while (queue.length) yield queue.shift()!;
      const tick = 4000 + Math.floor(Math.random() * 4000);
      await Promise.race([wakeP, new Promise<void>((r) => setTimeout(r, tick))]);
      wakeP = new Promise<void>((r) => (wake = r));
      if (ctx.signal.aborted) break;
      if (queue.length === 0) {
        const e = simulateActivity();
        if (e) yield e;
      }
    }
  } finally {
    unsub();
    ctx.signal.removeEventListener('abort', onAbort);
  }
}

export const serverLoaders = {
  default: defineLoader(shellLoader),
  activity: defineLoader(activityStream, { live: true }),
};
```

(Replace the existing single-key `serverLoaders` export with the two-key version above.)

- [ ] **Step 2: Rewrite `ActivityBar.tsx` to consume the live loader via `useStream`**

```tsx
// apps/site/src/components/demo/ActivityBar.tsx
import { useState } from 'preact/hooks';
import { ChevronUp, ChevronDown } from 'lucide-preact';
import type { ActivityEvent } from '../../demo/activity-stream.js';
import type { TaskStatus } from '../../demo/data.js';
import { serverLoaders } from '../../pages/demo/projects-shell.server.js';

const activityLoader = serverLoaders.activity;
const MAX = 50;
const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

function describeEvent(e: ActivityEvent): string {
  if (e.kind === 'task-created') return `${e.actor} created "${e.taskTitle}"`;
  if (e.kind === 'task-moved')
    return `${e.actor} moved "${e.taskTitle}" → ${STATUS_LABEL[e.to]}`;
  return `${e.actor} commented on "${e.taskTitle}"`;
}

// Persistent live-activity bar: a plain child of the projects-shell layout,
// scoped to /demo/projects/**. `useStream` connects once (the layout's stable
// location) and survives intra-scope navigation; on SSR it renders the
// "connecting" state and upgrades after hydration. No EventSource, no URL, no
// JSON.parse cast: chunks are typed ActivityEvent.
export function ActivityBar() {
  const { data: events, status } = activityLoader.useStream<ActivityEvent[]>({
    reduce: (acc, e) => (acc[0]?.id === e.id ? acc : [e, ...acc].slice(0, MAX)),
    initial: [],
  });
  const [expanded, setExpanded] = useState(false);

  const connected = status === 'open';
  const latest = events[0];
  return (
    <div class="demo-activity-bar fixed bottom-6 right-6 z-40 w-[22rem] max-w-[90vw] overflow-hidden rounded-xl border border-border bg-surface-subtle/95 shadow-lg backdrop-blur">
      {expanded && (
        <div
          role="log"
          aria-label="Recent activity"
          class="demo-activity-feed max-h-64 overflow-y-auto border-b border-border px-4 py-2"
        >
          {events.length === 0 ? (
            <p class="py-4 text-center text-xs text-muted">No activity yet.</p>
          ) : (
            <ul class="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} class="flex items-baseline gap-2 text-[13px]">
                  <span class="text-foreground">{describeEvent(e)}</span>
                  <span class="ml-auto shrink-0 text-[11px] uppercase tracking-wide text-muted">
                    {e.projectSlug}
                  </span>
                  <time class="shrink-0 text-[11px] text-muted">
                    {new Date(e.at).toLocaleTimeString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label="Toggle activity feed"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px]"
      >
        <span
          class={`h-2 w-2 shrink-0 rounded-full ${
            connected ? 'demo-activity-pulse bg-accent' : 'bg-muted'
          }`}
          aria-hidden
        />
        <span class="min-w-0 flex-1 truncate text-foreground">
          {latest ? describeEvent(latest) : 'Listening for activity…'}
        </span>
        <span class="shrink-0 rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-semibold text-muted">
          {events.length}
        </span>
        {expanded ? (
          <ChevronDown size={15} aria-hidden />
        ) : (
          <ChevronUp size={15} aria-hidden />
        )}
      </button>
    </div>
  );
}
ActivityBar.displayName = 'ActivityBar';
```

- [ ] **Step 3: Render the bar as a layout child; drop Persist from demo-layout**

In `apps/site/src/pages/demo/projects-shell.tsx`, add the import:

```ts
import { ActivityBar } from '../../components/demo/ActivityBar.js';
```

Change `ProjectsShell` to render the bar as a sibling of the shell content:

```tsx
export default function ProjectsShell({ children }: LayoutProps) {
  return (
    <>
      <ShellView children={children} />
      <ActivityBar />
    </>
  );
}
```

In `apps/site/src/pages/demo/demo-layout.tsx`, remove the `Persist` and `ActivityBar` imports and the `<Persist>` block, leaving the view-transition hook intact:

```tsx
import type { LayoutProps } from 'hono-preact';
import { useViewTransitionTypes } from 'hono-preact';

export default function DemoLayout({ children }: LayoutProps) {
  useViewTransitionTypes((nav) => {
    const types: string[] = [];
    if (nav.from && nav.from.startsWith(nav.to + '/')) types.push('nav-up');
    const fromProjects = nav.from?.startsWith('/demo/projects') ?? false;
    const toProjects = nav.to?.startsWith('/demo/projects') ?? false;
    if (fromProjects && toProjects) types.push('demo-within');
    return types;
  });
  return <>{children}</>;
}
```

- [ ] **Step 4: Delete the hand-written SSE endpoint**

```bash
git rm apps/site/src/api.ts
```

(If anything still imports `./api.js`, grep and remove the import; the framework auto-mounts `api.ts` only when present.)

Run: `rg -n "api\.js|/api/demo/activity" apps/site/src`
Expected: no remaining references except the deleted file.

- [ ] **Step 5: Retarget the ActivityBar test off the EventSource mock**

Replace `apps/site/src/components/demo/__tests__/ActivityBar.test.tsx` with a `useStream`-based test that mocks the loader RPC SSE (mirror the `dripSseResponse` harness from Task 2 and wrap in `RouteLocationsProvider` keyed by the projects-shell module key). Assert: the bar accumulates streamed events (latest line + count) and expands to show the feed. Use the real module key the plugin would assign by importing the loader's `__moduleKey` from the transformed module is not available in unit tests, so wrap with an explicit `RouteLocationsProvider moduleKey={serverLoaders.activity.__moduleKey ?? 'pages/demo/projects-shell'}`.

```tsx
// apps/site/src/components/demo/__tests__/ActivityBar.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { RouteLocationsProvider } from 'hono-preact/internal/runtime';
import { ActivityBar } from '../ActivityBar.js';
import { serverLoaders } from '../../../pages/demo/projects-shell.server.js';

function dripSseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(c));
        await Promise.resolve();
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const MODULE_KEY = serverLoaders.activity.__moduleKey ?? 'pages/demo/projects-shell';
const LOC = { path: '/demo/projects', pathParams: {}, searchParams: {} } as never;

function frame(e: Record<string, unknown>): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ActivityBar', () => {
  it('accumulates streamed events and shows the latest line + count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        dripSseResponse([
          frame({ id: 'e1', kind: 'task-created', at: 1, actor: 'Alice', taskId: 't1', taskTitle: 'A', projectSlug: 'p', simulated: false }),
          frame({ id: 'e2', kind: 'task-created', at: 2, actor: 'Bob', taskId: 't2', taskTitle: 'B', projectSlug: 'p', simulated: false }),
        ])
      )
    );
    render(
      <LocationProvider>
        <RouteLocationsProvider moduleKey={MODULE_KEY} location={LOC}>
          <ActivityBar />
        </RouteLocationsProvider>
      </LocationProvider>
    );
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
    expect(screen.getByText(/Bob created "B"/)).toBeTruthy();
  });
});
```

- [ ] **Step 6: Typecheck + run the site test + the demo suite**

Run: `cd apps/site && npx tsc --noEmit && cd ../..`
Expected: no errors.

Run: `npx vitest run apps/site/src/components/demo/__tests__/ActivityBar.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/pages/demo/projects-shell.server.ts apps/site/src/components/demo/ActivityBar.tsx apps/site/src/pages/demo/projects-shell.tsx apps/site/src/pages/demo/demo-layout.tsx apps/site/src/components/demo/__tests__/ActivityBar.test.tsx
git rm apps/site/src/api.ts
git commit -m "feat(site): dogfood the activity bar as a live-loader layout child"
```

---

### Task 5: Remove the `<Persist>` primitive

**Files:**
- Delete: `packages/iso/src/persist.tsx`, `packages/iso/src/internal/persist-registry.ts`, `packages/iso/src/__tests__/persist.test.tsx`, `packages/iso/src/__tests__/persist-registry.test.ts`
- Modify: `packages/iso/src/index.ts` (remove the Persist export, ~172-173)
- Modify: `packages/vite/src/client-entry.ts` (remove the PersistHost mount + unused `render` import)
- Modify: `packages/vite/src/__tests__/client-entry.test.ts` (drop PersistHost-mount assertions)
- Modify: `packages/iso/src/__tests__/view-transitions-integration.test.tsx` (trim "D"/Persist leg)
- Modify: `packages/iso/src/__tests__/public-exports.test.ts` (drop Persist/PersistHost assertions)
- Modify: `apps/site/src/pages/docs/view-transitions.mdx` (remove the "Persistent elements" section)
- Modify: `apps/site/src/styles/root.css` (fix the one "Persist wrapper" comment)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Persist` / `PersistHost` / `PersistProps` no longer exported from `hono-preact`; the client entry no longer creates `#__hp_persist_root`.

- [ ] **Step 1: Delete the primitive + its unit tests**

```bash
git rm packages/iso/src/persist.tsx packages/iso/src/internal/persist-registry.ts packages/iso/src/__tests__/persist.test.tsx packages/iso/src/__tests__/persist-registry.test.ts
```

- [ ] **Step 2: Remove the barrel export**

In `packages/iso/src/index.ts`, delete the two lines:

```ts
// Persist components.
export { Persist, PersistHost, type PersistProps } from './persist.js';
```

- [ ] **Step 3: Remove the separate render root from the client entry**

In `packages/vite/src/client-entry.ts`, in `generateClientEntrySource`:
- Change the preact import line from `import { h, hydrate, render as renderPreact } from 'preact';` to `import { h, hydrate } from 'preact';`.
- Change `import { Routes, PersistHost } from 'hono-preact';` to `import { Routes } from 'hono-preact';`.
- Delete the block that creates `#__hp_persist_root` and the `renderPreact(h(PersistHost, null), persistHost);` line.

- [ ] **Step 4: Update the affected tests**

- `packages/vite/src/__tests__/client-entry.test.ts`: remove assertions that the source imports `PersistHost`, creates `#__hp_persist_root`, or calls `renderPreact(h(PersistHost,...))`. Keep the assertions about hydrating `<Routes>` into `#app`.
- `packages/iso/src/__tests__/view-transitions-integration.test.tsx`: remove the `Persist` / `PersistHost` imports, the `<Persist id="player">...<PersistHost />` render, and the "D: PersistHost rendered the registry entry" assertion. Rename the test from "A+B+C+D fire together" to "A+B+C fire together" and keep the A/B/C assertions.
- `packages/iso/src/__tests__/public-exports.test.ts`: remove the `expect(typeof iso.Persist).toBe('function')` and `expect(typeof iso.PersistHost).toBe('function')` assertions.

- [ ] **Step 5: Remove the docs section + fix the CSS comment**

- `apps/site/src/pages/docs/view-transitions.mdx`: delete the "Persistent elements" section (its heading, prose, and the `<Persist id="player">` example), and change the four-primitives sentence to three (drop "and persist live DOM across navigations").
- `apps/site/src/styles/root.css`: in the demo-activity-bar comment block (~line 614), reword the line that mentions "the Persist wrapper" so it refers to the bar element directly (the `.demo-activity-bar` view-transition-name rules are unchanged).

- [ ] **Step 6: Verify no dangling references**

Run: `rg -n --no-ignore -g '!node_modules' -g '!dist' -g '!docs/superpowers' 'Persist|PersistHost|__hp_persist|persist-registry' packages apps`
Expected: no matches (the only remaining `persist` hits are `apps/site/wrangler.jsonc`'s observability `"persist": true`, which is unrelated).

- [ ] **Step 7: Build the framework + run the iso/vite suites**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: success (the consolidated `hono-preact/dist` no longer exports Persist).

Run: `npx vitest run packages/iso packages/vite`
Expected: PASS (no Persist tests; trimmed VT + client-entry tests green).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(iso)!: remove the Persist primitive (persistence is now layout placement)"
```

---

### Task 6: Docs, generated artifacts, baselines, release note

**Files:**
- Create/Modify: a docs page or section on persistence-via-layout under `apps/site/src/pages/docs/` (follow the local skill)
- Modify: generated `llms.txt` / `llms-full.txt` (via the repo script)
- Modify: client-size baseline (via the repo script)
- Create/Modify: the next-version release-notes entry under `docs/superpowers/specs/` (the repo's release-notes location)

**Interfaces:**
- Consumes: the `live` / `useStream` API (Tasks 1-2) for the doc examples.
- Produces: user-facing documentation + regenerated drift-gate artifacts.

- [ ] **Step 1: Read the local docs skill before writing docs**

Read `.claude/skills/add-docs-page.md` and follow its "Page templates" section (this is the source of truth for doc structure; a `PostToolUse` hook soft-warns on drift).

- [ ] **Step 2: Document persistence-via-layout + `live`/`useStream`**

Add a guide section/page covering: persistent UI = a child of a layout scoped to the routes it should survive (root/`*` layout for app-wide, prefix layout for scoped); a `live` loader on the layout's server module connects once and persists across intra-scope nav; consume it with `loader.useStream({ reduce, initial })`. Use the demo activity bar as the worked example. Include a live `<Example>` per the docs template where applicable.

- [ ] **Step 3: Regenerate llms.txt and verify the drift gates**

Run the repo's llms generation (the script referenced by the `llm-facing-documentation` program; check `package.json` scripts for the `llms`/`docs` generator) and the exports-coverage + appendix-sync gates.

Run: `pnpm typecheck && pnpm test:coverage`
Expected: the exports-coverage gate passes (Persist is gone from both exports and docs; the new `useStream` types are exported and documented).

- [ ] **Step 4: Refresh the client-size baseline**

Run the size-tracking script (see `scripts/` and the `client-size-tracking` setup) to regenerate the committed baseline; the runtime shrinks with `PersistHost` removed.

- [ ] **Step 5: Add the breaking-change release note**

Add an entry to the next version's release notes (the `docs/superpowers/specs/*-release-notes.md` pattern this repo uses) recording: `Persist` / `PersistHost` / `PersistProps` removed (breaking); persistent UI is now expressed as a scoped-layout child; new `defineLoader({ live })` + `loader.useStream(...)`.

- [ ] **Step 6: Full pre-push CI mirror**

Run, in order:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all green. If `format:check` fails, run `pnpm format`, re-check, and include the formatting fixes in the commit.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: document persistence-via-layout + live/useStream; remove Persist docs; refresh baselines"
```

---

## Self-Review

**Spec coverage:**
- Spec A (`live` loader option) → Task 1. ✓
- Spec B (`useStream` accumulator) → Task 2. ✓
- Spec C (persistence-via-layout docs + dogfood; actions need nothing) → Task 4 (dogfood) + Task 6 (docs). ✓
- Spec D (remove Persist + breaking-change note) → Task 5 + Task 6 Step 5. ✓
- Spec testing strategy (promote the persistence test; live-not-SSR-collected; useStream chunk completeness; retarget demo tests; full CI mirror) → Task 3, Task 1 (guards), Task 2, Task 4 Step 5, Task 6 Step 6. ✓
- Spec "known behavior: scope-exit blip" → asserted as end-state in Task 3. ✓
- Spec open question "is .View on a live loader a hard error" → resolved YES, on the server ref (Task 1). Client-side stub guard intentionally out of scope (the stub inherits `useStream`; SSR-hang prevention is server-side, where SSR resolves the real ref). Recorded here so the implementer does not also touch `loader-stub.ts` / source-extraction.

**Placeholder scan:** Task 6 references repo scripts (llms generation, size baseline) by role rather than exact command because their names are not load-bearing for correctness and the implementer confirms them from `package.json`; every code-bearing step (Tasks 1-5) shows full code. No `TODO`/`TBD`/"handle edge cases".

**Type consistency:** `StreamStatus` / `UseStreamOptions<T, Acc>` / `UseStreamResult<Acc>` and `useStream<Acc>(opts)` are used identically in Task 2's hook, the `LoaderRef` interface, the index export, and Task 4's `ActivityBar`. `live?: boolean` on `DefineLoaderOpts` matches its use in Task 1 and Task 4's loader. `ctx.signal` / `LoaderCtx` match the existing `define-loader.ts` types.
